const https = require('https');
const { parseBody } = require('./_nf-store');

const UPSTREAM_HOST = 'api.getthispdf.com';
const DEFAULT_QUEUE_TTL_MS = 30 * 1000;
const MAX_ERROR_SNIPPET = 240;

const queueStore = new Map();

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanupQueue() {
    const now = Date.now();
    Array.from(queueStore.entries()).forEach(([queueId, entry]) => {
        if (!entry || Number(entry.expiresAt || 0) <= now) {
            queueStore.delete(queueId);
        }
    });
}

function normalizeQueueId(input = '') {
    return String(input || '').trim();
}

function ensureQueue(queueId = '') {
    const normalized = normalizeQueueId(queueId) || `q_${Date.now()}`;
    const entry = {
        queueId: normalized,
        expiresAt: Date.now() + DEFAULT_QUEUE_TTL_MS
    };
    queueStore.set(normalized, entry);
    return entry;
}

function sendQueueState(res, queueId = '') {
    cleanupQueue();
    const entry = ensureQueue(queueId);
    return res.status(200).json({
        queue_id: entry.queueId,
        position: 1,
        total: 1,
        ahead: 0
    });
}

function toRawBody(body) {
    if (!body) return '';
    if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
    try {
        return JSON.stringify(body);
    } catch (e) {
        return '';
    }
}

function shouldSkipHeader(name = '') {
    const normalized = String(name || '').trim().toLowerCase();
    return normalized === 'host' || normalized === 'content-length';
}

function buildProxyHeaders(req, rawBody) {
    const sourceHeaders = req && req.headers ? req.headers : {};
    const headers = {};
    Object.keys(sourceHeaders).forEach((name) => {
        if (shouldSkipHeader(name)) return;
        headers[name] = sourceHeaders[name];
    });
    headers.host = UPSTREAM_HOST;
    headers.origin = 'https://getthispdf.com';
    headers.referer = 'https://getthispdf.com/';
    if (rawBody) {
        headers['content-length'] = Buffer.byteLength(rawBody);
    } else {
        delete headers['content-length'];
    }
    return headers;
}

function toUtf8Snippet(bufferValue) {
    const raw = Buffer.isBuffer(bufferValue) ? bufferValue.toString('utf8') : String(bufferValue || '');
    const compact = raw.replace(/\s+/g, ' ').trim();
    return compact.slice(0, MAX_ERROR_SNIPPET);
}

function tryParseJsonBuffer(bufferValue) {
    if (!bufferValue || !Buffer.isBuffer(bufferValue) || bufferValue.length === 0) return null;
    try {
        return JSON.parse(bufferValue.toString('utf8'));
    } catch (e) {
        return null;
    }
}

function logProxyIssue(label, meta = {}) {
    try {
        console.error('[stu-proxy]', label, meta);
    } catch (e) {
        // ignore logging failures
    }
}

function proxyUpstream(req, res, upstreamPath) {
    return new Promise((resolve) => {
        const rawBody = toRawBody(req.body);
        const options = {
            hostname: UPSTREAM_HOST,
            port: 443,
            path: upstreamPath,
            method: req.method || 'GET',
            headers: buildProxyHeaders(req, rawBody)
        };

        const upstreamReq = https.request(options, (upstreamRes) => {
            const chunks = [];
            upstreamRes.on('data', (chunk) => chunks.push(chunk));
            upstreamRes.on('end', () => {
                const body = Buffer.concat(chunks);
                const headers = upstreamRes.headers || {};
                const statusCode = Number(upstreamRes.statusCode || 502);
                const isFetchJsonEndpoint = upstreamPath === '/ads/serve/fetch';

                if (isFetchJsonEndpoint) {
                    const parsed = tryParseJsonBuffer(body);
                    const snippet = toUtf8Snippet(body);

                    if (statusCode < 200 || statusCode >= 300) {
                        logProxyIssue('upstream_fetch_non_2xx', {
                            statusCode,
                            upstreamPath,
                            snippet
                        });
                        res.status(502).json({
                            error: 'Studocu fetch failed',
                            statusCode,
                            upstreamBodySnippet: snippet
                        });
                        return resolve();
                    }

                    if (!body || body.length === 0) {
                        logProxyIssue('upstream_fetch_empty_body', {
                            statusCode,
                            upstreamPath
                        });
                        res.status(502).json({
                            error: 'Upstream returned empty response',
                            statusCode,
                            upstreamBodySnippet: ''
                        });
                        return resolve();
                    }

                    if (!parsed || typeof parsed !== 'object') {
                        logProxyIssue('upstream_fetch_invalid_json', {
                            statusCode,
                            upstreamPath,
                            snippet
                        });
                        res.status(502).json({
                            error: 'Upstream returned invalid JSON',
                            statusCode,
                            upstreamBodySnippet: snippet
                        });
                        return resolve();
                    }

                    res.status(200).json(parsed);
                    return resolve();
                }

                Object.keys(headers).forEach((name) => {
                    if (shouldSkipHeader(name)) return;
                    const value = headers[name];
                    if (value !== undefined) {
                        res.setHeader(name, value);
                    }
                });

                res.status(statusCode).end(body);
                resolve();
            });
        });

        upstreamReq.on('error', (error) => {
            const errorMessage = error && error.message ? error.message : 'Studocu upstream proxy failed';
            logProxyIssue('upstream_request_error', {
                upstreamPath,
                message: errorMessage
            });

            if (upstreamPath === '/ads/serve/fetch') {
                res.status(502).json({
                    error: errorMessage,
                    statusCode: 502,
                    upstreamBodySnippet: ''
                });
                return resolve();
            }

            res.status(502).json({
                error: errorMessage
            });
            resolve();
        });

        if (rawBody) {
            upstreamReq.write(rawBody);
        }
        upstreamReq.end();
    });
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const pathname = String((req.url || '').split('?')[0] || '').trim();

    if (pathname === '/api/queue/join' && req.method === 'POST') {
        const body = parseBody(req.body);
        return sendQueueState(res, body.queue_id);
    }

    if (pathname === '/api/queue/heartbeat' && req.method === 'POST') {
        const body = parseBody(req.body);
        return sendQueueState(res, body.queue_id);
    }

    if (pathname.startsWith('/ads/') || pathname.startsWith('/serve/')) {
        return proxyUpstream(req, res, req.url || pathname);
    }

    return res.status(404).json({ error: 'Not found' });
};

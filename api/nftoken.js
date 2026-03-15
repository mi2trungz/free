const https = require('https');
const fs = require('fs');
const path = require('path');
const { requestNetflixToken } = require('./_netflix-token-engine');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';
const POOL_DOC_PATH = 'settings/netflix_cookie_pool';
const LEGACY_DOC_PATH = 'settings/netflix_server_cookie';
const UI_STATUS_DOC_PATH = 'settings/netflix';
const LOCAL_COOKIE_STORE = path.join(__dirname, '..', 'data', 'netflix-cookie.json');

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function parseBody(rawBody) {
    if (!rawBody) return {};
    if (typeof rawBody === 'object') return rawBody;
    if (typeof rawBody === 'string') {
        try { return JSON.parse(rawBody); } catch (e) { return {}; }
    }
    return {};
}

function sanitizeAccountKey(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function readLocalSavedCookie() {
    try {
        if (!fs.existsSync(LOCAL_COOKIE_STORE)) return null;
        const raw = fs.readFileSync(LOCAL_COOKIE_STORE, 'utf-8');
        const parsed = JSON.parse(raw || '{}');
        const netflixId = parsed && parsed.netflixId ? String(parsed.netflixId).trim() : '';
        const secureNetflixId = parsed && parsed.secureNetflixId ? String(parsed.secureNetflixId).trim() : '';
        if (!netflixId) return null;
        return { netflixId, secureNetflixId };
    } catch (e) {
        return null;
    }
}

function firestorePath(docPath) {
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
}

async function readDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestorePath(docPath),
        method: 'GET'
    });
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    try { return JSON.parse(response.body || '{}'); } catch (e) { return null; }
}

async function patchDoc(docPath, fields) {
    const payload = JSON.stringify({ fields });
    const response = await httpRequest(
        {
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: firestorePath(docPath),
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        },
        payload
    );
    return response.statusCode >= 200 && response.statusCode < 300;
}

function toStringValue(v) {
    return { stringValue: String(v || '') };
}

function toTimestampValue(v) {
    return { timestampValue: v || new Date().toISOString() };
}

function toIntegerValue(v) {
    return { integerValue: String(Number(v || 0)) };
}

function toBooleanValue(v) {
    return { booleanValue: !!v };
}

function makeCookieId() {
    return `ck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCookieStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'disabled' || normalized === 'dead') return normalized;
    return 'active';
}

function sanitizeCookieItem(item) {
    return {
        id: String(item.id || makeCookieId()),
        netflixId: String(item.netflixId || '').trim(),
        secureNetflixId: String(item.secureNetflixId || '').trim(),
        status: sanitizeCookieStatus(item.status || 'active'),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
        lastSuccessAt: item.lastSuccessAt || '',
        lastErrorAt: item.lastErrorAt || '',
        lastError: item.lastError || ''
    };
}

function buildCookieMapValue(cookie) {
    return {
        mapValue: {
            fields: {
                id: toStringValue(cookie.id),
                netflixId: toStringValue(cookie.netflixId),
                secureNetflixId: toStringValue(cookie.secureNetflixId || ''),
                status: toStringValue(cookie.status),
                createdAt: toTimestampValue(cookie.createdAt),
                updatedAt: toTimestampValue(cookie.updatedAt),
                lastSuccessAt: toStringValue(cookie.lastSuccessAt || ''),
                lastErrorAt: toStringValue(cookie.lastErrorAt || ''),
                lastError: toStringValue(cookie.lastError || '')
            }
        }
    };
}

function parseCookieMapValue(value) {
    const fields = (((value || {}).mapValue || {}).fields) || {};
    return sanitizeCookieItem({
        id: fields.id && fields.id.stringValue,
        netflixId: fields.netflixId && fields.netflixId.stringValue,
        secureNetflixId: fields.secureNetflixId && fields.secureNetflixId.stringValue,
        status: fields.status && fields.status.stringValue,
        createdAt: fields.createdAt && (fields.createdAt.timestampValue || fields.createdAt.stringValue),
        updatedAt: fields.updatedAt && (fields.updatedAt.timestampValue || fields.updatedAt.stringValue),
        lastSuccessAt: fields.lastSuccessAt && fields.lastSuccessAt.stringValue,
        lastErrorAt: fields.lastErrorAt && fields.lastErrorAt.stringValue,
        lastError: fields.lastError && fields.lastError.stringValue
    });
}

function parsePoolFromDoc(doc) {
    const fields = (doc && doc.fields) || {};
    const arr = ((((fields.cookies || {}).arrayValue) || {}).values) || [];
    return arr.map(parseCookieMapValue).filter((item) => !!item.netflixId);
}

function buildSummary(cookies = []) {
    const total = cookies.length;
    const activeCount = cookies.filter((c) => c.status === 'active').length;
    const deadCount = cookies.filter((c) => c.status === 'dead').length;
    return { total, activeCount, deadCount, hasCookie: activeCount > 0 };
}

async function persistPool(cookies = []) {
    const normalized = cookies.map(sanitizeCookieItem).filter((item) => !!item.netflixId);
    const summary = buildSummary(normalized);
    const nowIso = new Date().toISOString();

    const okPool = await patchDoc(POOL_DOC_PATH, {
        cookies: {
            arrayValue: {
                values: normalized.map(buildCookieMapValue)
            }
        },
        updatedAt: toTimestampValue(nowIso),
        activeCount: toIntegerValue(summary.activeCount),
        totalCount: toIntegerValue(summary.total)
    });

    await patchDoc(UI_STATUS_DOC_PATH, {
        hasActiveCookies: toBooleanValue(summary.hasCookie),
        activeCount: toIntegerValue(summary.activeCount),
        totalCount: toIntegerValue(summary.total),
        updatedAt: toTimestampValue(nowIso)
    });

    return okPool;
}

async function ensurePoolWithMigration() {
    const poolDoc = await readDoc(POOL_DOC_PATH);
    const currentPool = parsePoolFromDoc(poolDoc);
    if (currentPool.length > 0) return currentPool;

    const legacyDoc = await readDoc(LEGACY_DOC_PATH);
    const fields = (legacyDoc && legacyDoc.fields) || {};
    const legacyNetflixId = fields.netflixId && fields.netflixId.stringValue ? fields.netflixId.stringValue : '';
    const legacySecureNetflixId = fields.secureNetflixId && fields.secureNetflixId.stringValue ? fields.secureNetflixId.stringValue : '';
    if (!legacyNetflixId) return [];

    const migrated = [sanitizeCookieItem({
        id: makeCookieId(),
        netflixId: legacyNetflixId,
        secureNetflixId: legacySecureNetflixId,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    })];
    await persistPool(migrated);
    return migrated;
}

async function readAccountCookieFromFirestore(accountKey) {
    const safeKey = sanitizeAccountKey(accountKey);
    if (!safeKey) return null;
    const doc = await readDoc(`netflix_account_cookies/${safeKey}`);
    const fields = (doc && doc.fields) || {};
    const netflixId = fields.netflixId && fields.netflixId.stringValue ? fields.netflixId.stringValue : '';
    const secureNetflixId = fields.secureNetflixId && fields.secureNetflixId.stringValue ? fields.secureNetflixId.stringValue : '';
    if (!netflixId) return null;
    return { netflixId, secureNetflixId };
}

module.exports = async function (req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const requestBody = parseBody(req.body);
        const requestedNetflixId = requestBody.netflixId ? String(requestBody.netflixId).trim() : '';
        const requestedSecureNetflixId = requestBody.secureNetflixId ? String(requestBody.secureNetflixId).trim() : '';
        const accountKey = sanitizeAccountKey(requestBody.accountKey || '');

        if (accountKey) {
            const accountCookie = await readAccountCookieFromFirestore(accountKey);
            if (!accountCookie || !accountCookie.netflixId) {
                return res.status(400).json({ error: 'Khong tim thay cookie cho tai khoan Netflix nay tren server.' });
            }
            const result = await requestNetflixToken(accountCookie.netflixId, accountCookie.secureNetflixId || '');
            if (result.outcome !== 'ok' || !result.nftoken) {
                if (result.outcome === 'sbd_blocked') {
                    return res.status(400).json({ error: 'Cookie LIVE nhung bi Netflix chan tao token tu dong.' });
                }
                return res.status(400).json({ error: result.error || 'Khong tao duoc link Netflix cho tai khoan nay.' });
            }
            return res.status(200).json({ nftoken: result.nftoken });
        }

        if (requestedNetflixId) {
            const result = await requestNetflixToken(requestedNetflixId, requestedSecureNetflixId);
            if (result.outcome !== 'ok' || !result.nftoken) {
                if (result.outcome === 'sbd_blocked') {
                    return res.status(400).json({ error: 'Cookie LIVE nhung bi Netflix chan tao token tu dong.' });
                }
                return res.status(400).json({ error: result.error || 'Khong tao duoc link Netflix tu cookie cung cap.' });
            }
            return res.status(200).json({ nftoken: result.nftoken });
        }

        const pool = await ensurePoolWithMigration();
        const activeIndexes = [];
        for (let i = 0; i < pool.length; i += 1) {
            if (pool[i].status === 'active') activeIndexes.push(i);
        }

        if (activeIndexes.length === 0) {
            const localCookie = readLocalSavedCookie();
            if (!localCookie || !localCookie.netflixId) {
                return res.status(503).json({ error: 'Khong con cookie LIVE trong pool Netflix.' });
            }
            const localResult = await requestNetflixToken(localCookie.netflixId, localCookie.secureNetflixId || '');
            if (localResult.outcome === 'ok' && localResult.nftoken) {
                return res.status(200).json({ nftoken: localResult.nftoken });
            }
            if (localResult.outcome === 'sbd_blocked') {
                return res.status(503).json({ error: 'Cookie LIVE nhung bi Netflix chan tao token tu dong.' });
            }
            return res.status(503).json({ error: localResult.error || 'Khong tao duoc token tu cookie local.' });
        }

        let hasPoolMutation = false;
        let hasPermissionDeniedCookie = false;
        for (let i = 0; i < activeIndexes.length; i += 1) {
            const idx = activeIndexes[i];
            const cookie = pool[idx];
            const result = await requestNetflixToken(cookie.netflixId, cookie.secureNetflixId || '');

            if (result.outcome === 'ok' && result.nftoken) {
                pool[idx] = sanitizeCookieItem({
                    ...pool[idx],
                    status: 'active',
                    lastSuccessAt: new Date().toISOString(),
                    lastError: '',
                    lastErrorAt: '',
                    updatedAt: new Date().toISOString()
                });
                hasPoolMutation = true;
                if (hasPoolMutation) await persistPool(pool);
                return res.status(200).json({ nftoken: result.nftoken, cookieId: cookie.id });
            }

            const errorText = result.error || 'Cookie error';
            if (result.outcome === 'sbd_blocked') {
                hasPermissionDeniedCookie = true;
                pool[idx] = sanitizeCookieItem({
                    ...pool[idx],
                    status: 'active',
                    lastError: errorText,
                    lastErrorAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                hasPoolMutation = true;
                continue;
            }

            if (result.outcome === 'dead') {
                pool[idx] = sanitizeCookieItem({
                    ...pool[idx],
                    status: 'dead',
                    lastError: errorText,
                    lastErrorAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                hasPoolMutation = true;
            } else {
                pool[idx] = sanitizeCookieItem({
                    ...pool[idx],
                    lastError: errorText,
                    lastErrorAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                hasPoolMutation = true;
            }
        }

        if (hasPoolMutation) await persistPool(pool);
        const localCookie = readLocalSavedCookie();
        if (localCookie && localCookie.netflixId) {
            const localResult = await requestNetflixToken(localCookie.netflixId, localCookie.secureNetflixId || '');
            if (localResult.outcome === 'ok' && localResult.nftoken) {
                return res.status(200).json({ nftoken: localResult.nftoken });
            }
            if (localResult.outcome === 'sbd_blocked') {
                hasPermissionDeniedCookie = true;
            }
        }
        if (hasPermissionDeniedCookie) {
            return res.status(503).json({
                error: 'Cookie LIVE nhung bi Netflix chan tao token tu dong. Vui long thay cookie khac.'
            });
        }
        return res.status(503).json({ error: 'Khong con cookie LIVE trong pool Netflix.' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

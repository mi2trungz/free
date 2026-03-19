const https = require('https');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';
const POOL_DOC_PATH = 'settings/netflix_cookie_pool';
const LEGACY_DOC_PATH = 'settings/netflix_server_cookie';
const UI_STATUS_DOC_PATH = 'settings/netflix';

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
    const cookies = arr.map(parseCookieMapValue).filter((item) => !!item.netflixId);
    return cookies;
}

function maskNetflixId(netflixId = '') {
    const val = String(netflixId || '').trim();
    if (!val) return 'N/A';
    if (val.length <= 6) return `${val.slice(0, 2)}***`;
    return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

function buildSummary(cookies = []) {
    const total = cookies.length;
    const activeCount = cookies.filter((c) => c.status === 'active').length;
    const deadCount = cookies.filter((c) => c.status === 'dead').length;
    return {
        hasCookie: activeCount > 0,
        total,
        activeCount,
        deadCount
    };
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
    const existingPool = parsePoolFromDoc(poolDoc);
    if (existingPool.length > 0) return existingPool;

    const legacyDoc = await readDoc(LEGACY_DOC_PATH);
    const legacyFields = (legacyDoc && legacyDoc.fields) || {};
    const legacyNetflixId = legacyFields.netflixId && legacyFields.netflixId.stringValue
        ? legacyFields.netflixId.stringValue
        : '';
    const legacySecureNetflixId = legacyFields.secureNetflixId && legacyFields.secureNetflixId.stringValue
        ? legacyFields.secureNetflixId.stringValue
        : '';

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

module.exports = async function (req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    return res.status(410).json({
        error: 'Netflix LIVE/DIE status API has been disabled to optimize Firestore reads.'
    });

    try {
        const currentPool = await ensurePoolWithMigration();

        if (req.method === 'GET') {
            const summary = buildSummary(currentPool);
            const publicCookies = currentPool.map((cookie) => ({
                id: cookie.id,
                status: cookie.status,
                createdAt: cookie.createdAt,
                updatedAt: cookie.updatedAt,
                lastSuccessAt: cookie.lastSuccessAt || '',
                lastErrorAt: cookie.lastErrorAt || '',
                lastError: cookie.lastError || '',
                maskedNetflixId: maskNetflixId(cookie.netflixId)
            }));
            return res.status(200).json({ ...summary, cookies: publicCookies });
        }

        const body = parseBody(req.body);

        if (req.method === 'POST') {
            const netflixId = body.netflixId ? String(body.netflixId).trim() : '';
            const secureNetflixId = body.secureNetflixId ? String(body.secureNetflixId).trim() : '';
            if (!netflixId) {
                return res.status(400).json({ error: 'Missing NetflixId' });
            }
            const nextPool = [
                sanitizeCookieItem({
                    id: makeCookieId(),
                    netflixId,
                    secureNetflixId,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }),
                ...currentPool
            ];
            const ok = await persistPool(nextPool);
            if (!ok) return res.status(500).json({ error: 'Failed to save cookie pool' });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'PUT') {
            const cookieId = body.cookieId ? String(body.cookieId).trim() : '';
            const status = sanitizeCookieStatus(body.status);
            if (!cookieId) {
                return res.status(400).json({ error: 'Missing cookieId' });
            }
            const found = currentPool.find((item) => item.id === cookieId);
            if (!found) {
                return res.status(404).json({ error: 'Cookie not found' });
            }
            const nextPool = currentPool.map((item) => {
                if (item.id !== cookieId) return item;
                return sanitizeCookieItem({
                    ...item,
                    status,
                    updatedAt: new Date().toISOString()
                });
            });
            const ok = await persistPool(nextPool);
            if (!ok) return res.status(500).json({ error: 'Failed to update cookie status' });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'DELETE') {
            const cookieId = body.cookieId ? String(body.cookieId).trim() : '';
            if (!cookieId) {
                return res.status(400).json({ error: 'Missing cookieId' });
            }
            const nextPool = currentPool.filter((item) => item.id !== cookieId);
            if (nextPool.length === currentPool.length) {
                return res.status(404).json({ error: 'Cookie not found' });
            }
            const ok = await persistPool(nextPool);
            if (!ok) return res.status(500).json({ error: 'Failed to delete cookie' });
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal error' });
    }
};

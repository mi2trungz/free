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

function extractNetflixIdsFromCookie(cookieVal) {
    const raw = String(cookieVal || '').trim();
    if (!raw) return { netflixId: '', secureNetflixId: '' };

    let netflixId = '';
    let secureNetflixId = '';
    const lines = raw.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const parts = line.split('\t');
        if (parts.length >= 7) {
            const name = String(parts[5] || '').trim();
            const value = String(parts[6] || '').trim();
            if (name === 'NetflixId' && value) netflixId = value;
            if (name === 'SecureNetflixId' && value) secureNetflixId = value;
            continue;
        }
        if (line.includes('NetflixId=')) {
            const n = line.match(/NetflixId=([^;\s]+)/i);
            const s = line.match(/SecureNetflixId=([^;\s]+)/i);
            if (n && n[1]) netflixId = String(n[1]).trim();
            if (s && s[1]) secureNetflixId = String(s[1]).trim();
        }
    }

    if (!netflixId) {
        const n = raw.match(/NetflixId=([^;\s]+)/i);
        if (n && n[1]) netflixId = String(n[1]).trim();
    }
    if (!secureNetflixId) {
        const s = raw.match(/SecureNetflixId=([^;\s]+)/i);
        if (s && s[1]) secureNetflixId = String(s[1]).trim();
    }

    return { netflixId, secureNetflixId };
}

function buildCookieRawFromIds(netflixId, secureNetflixId) {
    const netflix = String(netflixId || '').trim();
    const secure = String(secureNetflixId || '').trim();
    if (!netflix) return '';
    if (secure) return `NetflixId=${netflix}; SecureNetflixId=${secure};`;
    return `NetflixId=${netflix};`;
}

function sanitizeCookieItem(item) {
    const cookieRaw = String(item.cookieRaw || '').trim();
    const idsFromRaw = extractNetflixIdsFromCookie(cookieRaw);
    const netflixId = String(item.netflixId || idsFromRaw.netflixId || '').trim();
    const secureNetflixId = String(item.secureNetflixId || idsFromRaw.secureNetflixId || '').trim();
    const normalizedRaw = cookieRaw || buildCookieRawFromIds(netflixId, secureNetflixId);

    return {
        id: String(item.id || makeCookieId()),
        netflixId,
        secureNetflixId,
        cookieRaw: normalizedRaw,
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
                cookieRaw: toStringValue(cookie.cookieRaw || ''),
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
        cookieRaw: fields.cookieRaw && fields.cookieRaw.stringValue,
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
        cookieRaw: buildCookieRawFromIds(legacyNetflixId, legacySecureNetflixId),
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    })];
    await persistPool(migrated);
    return migrated;
}

function toPublicCookie(cookie) {
    return {
        ...cookie,
        maskedNetflixId: maskNetflixId(cookie.netflixId)
    };
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

    try {
        if (req.method === 'GET') {
            const pool = await ensurePoolWithMigration();
            const summary = buildSummary(pool);
            return res.status(200).json({
                ...summary,
                cookies: pool.map(toPublicCookie)
            });
        }

        if (req.method === 'POST') {
            const currentPool = await ensurePoolWithMigration();
            const body = parseBody(req.body);
            const cookieRaw = String(body.cookieRaw || '').trim();

            let ids;
            if (cookieRaw) {
                ids = extractNetflixIdsFromCookie(cookieRaw);
            } else {
                const netflixId = String(body.netflixId || '').trim();
                const secureNetflixId = String(body.secureNetflixId || '').trim();
                ids = { netflixId, secureNetflixId };
            }

            if (!ids.netflixId) {
                return res.status(400).json({ error: 'Cookie không hợp lệ: thiếu NetflixId' });
            }

            const nextItem = sanitizeCookieItem({
                id: makeCookieId(),
                netflixId: ids.netflixId,
                secureNetflixId: ids.secureNetflixId || '',
                cookieRaw: cookieRaw || buildCookieRawFromIds(ids.netflixId, ids.secureNetflixId || ''),
                status: 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            const nextPool = [nextItem, ...currentPool];
            const ok = await persistPool(nextPool);
            if (!ok) return res.status(500).json({ error: 'Failed to save cookie pool' });
            return res.status(200).json({ success: true, cookie: toPublicCookie(nextItem) });
        }

        if (req.method === 'PUT') {
            const body = parseBody(req.body);
            const cookieId = String(body.cookieId || '').trim();
            if (!cookieId) return res.status(400).json({ error: 'Missing cookieId' });

            const pool = await ensurePoolWithMigration();
            const idx = pool.findIndex((item) => String(item.id || '') === cookieId);
            if (idx < 0) return res.status(404).json({ error: 'Cookie not found' });

            pool[idx] = sanitizeCookieItem({
                ...pool[idx],
                status: sanitizeCookieStatus(body.status),
                updatedAt: new Date().toISOString()
            });

            const ok = await persistPool(pool);
            if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
            return res.status(200).json({ success: true, cookie: toPublicCookie(pool[idx]) });
        }

        if (req.method === 'DELETE') {
            const body = parseBody(req.body);
            const cookieId = String(body.cookieId || '').trim();
            if (!cookieId) return res.status(400).json({ error: 'Missing cookieId' });

            const pool = await ensurePoolWithMigration();
            const nextPool = pool.filter((item) => String(item.id || '') !== cookieId);
            if (nextPool.length === pool.length) return res.status(404).json({ error: 'Cookie not found' });

            const ok = await persistPool(nextPool);
            if (!ok) return res.status(500).json({ error: 'Failed to delete cookie' });
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal error' });
    }
};

const https = require('https');
const { parseBody } = require('./_nf-store');
const { adminAuthConfig, applyCors, applySecurityHeaders } = require('./_security');
const {
    extractShareIdFromQuery,
    isValidShareId,
    readShareById,
    updateShareCookie,
    setShareStatus,
    rotateShareId,
    sanitizeCookieRaw,
    setShareExpiry,
    isShareExpired
} = require('./_getlink-share-store');

const FIREBASE_API_KEY = String(process.env.FIREBASE_API_KEY || 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58').trim();

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: Number(res.statusCode || 0), body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function getBearerToken(headers = {}) {
    const raw = String(headers.authorization || headers.Authorization || '').trim();
    if (!raw) return '';
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return String(match && match[1] ? match[1] : '').trim();
}

async function lookupFirebaseUserByIdToken(idToken = '') {
    const token = String(idToken || '').trim();
    if (!token) return { ok: false, statusCode: 401, error: 'Missing bearer token' };
    if (!FIREBASE_API_KEY) return { ok: false, statusCode: 500, error: 'Firebase API key is not configured' };

    const payload = JSON.stringify({ idToken: token });
    const response = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        port: 443,
        path: `/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);

    let parsed = {};
    try {
        parsed = JSON.parse(response.body || '{}');
    } catch (e) {
        return { ok: false, statusCode: 502, error: 'Firebase verify response parse failed' };
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        const firebaseMessage = String(parsed && parsed.error && parsed.error.message ? parsed.error.message : '').trim();
        return {
            ok: false,
            statusCode: 401,
            error: firebaseMessage ? `Firebase token invalid: ${firebaseMessage}` : 'Firebase token invalid'
        };
    }

    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const user = users[0] || null;
    const email = String(user && user.email ? user.email : '').trim().toLowerCase();
    if (!email) return { ok: false, statusCode: 401, error: 'Firebase token has no email' };
    return { ok: true, email };
}

function isAllowedAdminEmail(email = '') {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    const cfg = adminAuthConfig();
    const adminEmails = Array.isArray(cfg && cfg.adminEmails) ? cfg.adminEmails : [];
    if (adminEmails.length === 0) return false;
    return adminEmails.includes(normalized);
}

async function ensureAdmin(req, res) {
    const token = getBearerToken(req.headers || {});
    const lookup = await lookupFirebaseUserByIdToken(token);
    if (!lookup.ok) {
        res.status(lookup.statusCode || 401).json({ error: lookup.error || 'Admin authentication required' });
        return null;
    }
    if (!isAllowedAdminEmail(lookup.email)) {
        res.status(401).json({ error: 'Email is not allowed for /getlink admin' });
        return null;
    }
    return {
        email: lookup.email,
        role: 'admin'
    };
}

function toAdminShareDto(record, req) {
    const host = String((req.headers && req.headers.host) || '').trim();
    const proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '').trim();
    const origin = proto && host
        ? `${proto}://${host}`
        : (host ? `http://${host}` : 'http://localhost:3005');

    return {
        id: record.id,
        status: record.status,
        cookieRaw: record.cookieRaw || '',
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
        revokedAt: record.revokedAt || '',
        expiresAt: record.expiresAt || '',
        expired: isShareExpired(record),
        shareUrl: `${origin}/getlink?s=${encodeURIComponent(record.id)}`
    };
}

module.exports = async function (req, res) {
    applyCors(req, res, 'GET,POST,PUT,OPTIONS');
    applySecurityHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pathname = String((req.url || '').split('?')[0] || '').trim();

        if (pathname === '/api/getlink-admin/session' && req.method === 'GET') {
            const user = await ensureAdmin(req, res);
            if (!user) return;
            return res.status(200).json({ authenticated: true, user });
        }

        if (pathname === '/api/getlink-admin/login' && req.method === 'POST') {
            const body = parseBody(req.body);
            const idToken = String(body.idToken || '').trim();
            const lookup = await lookupFirebaseUserByIdToken(idToken);
            if (!lookup.ok) {
                return res.status(lookup.statusCode || 401).json({ error: lookup.error || 'Firebase verify failed' });
            }
            if (!isAllowedAdminEmail(lookup.email)) {
                return res.status(401).json({ error: 'Email is not allowed for /getlink admin' });
            }
            return res.status(200).json({ success: true, user: { email: lookup.email, role: 'admin' } });
        }

        if (pathname === '/api/getlink-admin/logout' && req.method === 'POST') {
            return res.status(200).json({ success: true });
        }

        const adminUser = await ensureAdmin(req, res);
        if (!adminUser) return;

        if (pathname === '/api/getlink-admin/search' && req.method === 'POST') {
            const body = parseBody(req.body);
            const query = String(body.query || '').trim();
            const shareId = extractShareIdFromQuery(query);
            if (!shareId) return res.status(400).json({ error: 'Invalid share id or URL' });
            const record = await readShareById(shareId);
            if (!record) return res.status(404).json({ error: 'Share link not found' });
            return res.status(200).json({ success: true, share: toAdminShareDto(record, req) });
        }

        const updateMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)$/);
        if (updateMatch && req.method === 'PUT') {
            const shareId = decodeURIComponent(updateMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const body = parseBody(req.body);
            const cookieStr = sanitizeCookieRaw(body.cookieStr || '');
            if (!cookieStr) return res.status(400).json({ error: 'Missing cookieStr' });
            const updated = await updateShareCookie(shareId, cookieStr, adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const expiryMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/expiry$/);
        if (expiryMatch && req.method === 'PUT') {
            const shareId = decodeURIComponent(expiryMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const body = parseBody(req.body);
            const updated = await setShareExpiry(shareId, {
                expiresAt: body.expiresAt,
                addDays: body.addDays
            }, adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const revokeMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/revoke$/);
        if (revokeMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(revokeMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const updated = await setShareStatus(shareId, 'revoked', adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const restoreMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/restore$/);
        if (restoreMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(restoreMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const updated = await setShareStatus(shareId, 'active', adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const rotateMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/rotate-id$/);
        if (rotateMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(rotateMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const rotated = await rotateShareId(shareId, adminUser.email);
            return res.status(200).json({
                success: true,
                oldId: rotated.oldId,
                newId: rotated.newId,
                shareUrl: toAdminShareDto(rotated.share, req).shareUrl,
                share: toAdminShareDto(rotated.share, req)
            });
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};

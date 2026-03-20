const { parseBody } = require('./_nf-store');
const {
    issueAdminSession,
    getSessionUserFromHeaders,
    setAdminSessionCookie,
    clearAdminSessionCookie,
    verifyAdminCredentials,
    applyCors,
    applySecurityHeaders
} = require('./_security');
const {
    extractShareIdFromQuery,
    isValidShareId,
    readShareById,
    updateShareCookie,
    setShareStatus,
    rotateShareId,
    sanitizeCookieRaw
} = require('./_getlink-share-store');

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
        shareUrl: `${origin}/getlink?s=${encodeURIComponent(record.id)}`
    };
}

function ensureAdmin(req, res) {
    const user = getSessionUserFromHeaders(req.headers || {});
    if (!user) {
        res.status(401).json({ error: 'Admin authentication required' });
        return null;
    }
    return user;
}

module.exports = async function (req, res) {
    applyCors(req, res, 'GET,POST,PUT,OPTIONS');
    applySecurityHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pathname = String((req.url || '').split('?')[0] || '').trim();

        if (pathname === '/api/getlink-admin/session' && req.method === 'GET') {
            const user = getSessionUserFromHeaders(req.headers || {});
            return res.status(200).json({ authenticated: !!user, user: user || null });
        }

        if (pathname === '/api/getlink-admin/login' && req.method === 'POST') {
            const body = parseBody(req.body);
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
            if (!verifyAdminCredentials(email, password)) return res.status(401).json({ error: 'Invalid admin credentials' });

            const token = issueAdminSession(email);
            if (!token) return res.status(500).json({ error: 'Admin session is not configured' });
            setAdminSessionCookie(res, token);
            return res.status(200).json({ success: true, user: { email, role: 'admin' } });
        }

        if (pathname === '/api/getlink-admin/logout' && req.method === 'POST') {
            clearAdminSessionCookie(res);
            return res.status(200).json({ success: true });
        }

        const adminUser = ensureAdmin(req, res);
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

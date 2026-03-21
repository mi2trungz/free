const { parseBody } = require('./_nf-store');
const {
    createShare,
    readShareById,
    sanitizeCookieRaw,
    isValidShareId,
    isShareExpired
} = require('./_getlink-share-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getRequestOrigin(req) {
    const proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '').trim();
    const host = String((req.headers && req.headers.host) || '').trim();
    if (proto && host) return `${proto}://${host}`;
    const origin = String((req.headers && req.headers.origin) || '').trim();
    if (origin) return origin.replace(/\/+$/, '');
    if (host) return `http://${host}`;
    return 'http://localhost:3005';
}

function shareDto(record, req) {
    const origin = getRequestOrigin(req);
    return {
        id: record.id,
        status: record.status,
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
        revokedAt: record.revokedAt || '',
        expiresAt: record.expiresAt || '',
        shareUrl: `${origin}/getlink?s=${encodeURIComponent(record.id)}`
    };
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pathname = String((req.url || '').split('?')[0] || '').trim();

        if (req.method === 'POST' && pathname === '/api/getlink-shares') {
            const body = parseBody(req.body);
            const cookieStr = sanitizeCookieRaw(body.cookieStr || '');
            if (!cookieStr) return res.status(400).json({ error: 'Missing cookieStr' });
            const created = await createShare(cookieStr, 'guest');
            return res.status(200).json({ success: true, ...shareDto(created, req) });
        }

        if (req.method === 'GET' && pathname.startsWith('/api/getlink-shares/')) {
            const shareId = decodeURIComponent(pathname.slice('/api/getlink-shares/'.length));
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const record = await readShareById(shareId);
            if (!record) return res.status(404).json({ error: 'Share link not found' });
            if (record.status !== 'active') {
                return res.status(410).json({ error: 'Share link has been revoked' });
            }
            if (isShareExpired(record)) {
                return res.status(410).json({ error: 'Share link has expired' });
            }

            return res.status(200).json({
                success: true,
                id: record.id,
                cookieStr: record.cookieRaw || ''
            });
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};

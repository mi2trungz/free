const {
    parseBody,
    extractNetflixIdsFromCookie,
    buildUrlByDevice
} = require('./_nf-store');
const { requestNetflixToken } = require('./_netflix-token-engine');

const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'tv']);

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const cookieStr = String(body.cookieStr || '').trim();
        const device = String(body.device || 'desktop').trim().toLowerCase();

        if (!cookieStr) return res.status(400).json({ error: 'Missing cookieStr' });
        if (!ALLOWED_DEVICES.has(device)) return res.status(400).json({ error: 'Invalid device' });

        // 1. Trích xuất ID
        const ids = extractNetflixIdsFromCookie(cookieStr);

        if (!ids.netflixId) {
            return res.status(400).json({ error: 'Không tìm thấy NetflixId hợp lệ trong chuỗi cung cấp.' });
        }

        // 2. Request Token
        const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');

        // 3. Xử lý kết quả
        if (tokenResult.outcome === 'ok' && tokenResult.nftoken) {
            const url = buildUrlByDevice(tokenResult.nftoken, device);
            return res.status(200).json({
                success: true,
                device,
                url,
                accountInfo: tokenResult.accountInfo || null
            });
        }

        // Trả về lỗi chi tiết nếu có
        const reason = tokenResult.error || 'Cookie error';

        if (tokenResult.outcome === 'sbd_blocked') {
            return res.status(403).json({ error: `Cookie bị Netflix chặn (Access Denied / SBD): ${reason}` });
        }
        if (tokenResult.outcome === 'dead') {
            return res.status(401).json({ error: `Cookie lỗi hoặc đã hết hạn (DEAD): ${reason}` });
        }

        return res.status(500).json({ error: `Lỗi tạo token: ${reason}` });

    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

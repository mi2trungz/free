const {
    parseBody,
    extractNetflixIdsFromCookie,
    buildUrlByDevice
} = require('./_nf-store');
const { requestNetflixToken, detectPlaybackOverCapacity } = require('./_netflix-token-engine');

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

        const ids = extractNetflixIdsFromCookie(cookieStr);
        if (!ids.netflixId) {
            return res.status(400).json({ error: 'Khong tim thay NetflixId hop le trong chuoi cung cap.' });
        }

        const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');

        if (tokenResult.outcome === 'ok' && tokenResult.nftoken) {
            const accountInfo = tokenResult.accountInfo || null;
            const overcap = detectPlaybackOverCapacity(accountInfo);
            let overloadOutcome = 'unknown';
            let overloadMessage = 'Cookie LIVE nhung khong du du lieu de ket luan qua tai.';
            if (accountInfo) {
                if (overcap.overloaded) {
                    overloadOutcome = 'overloaded';
                    overloadMessage = 'Cookie LIVE nhung co dau hieu qua tai nguoi dung.';
                } else {
                    overloadOutcome = 'live_ok';
                    overloadMessage = 'Cookie LIVE va khong co dau hieu qua tai.';
                }
            }

            const url = buildUrlByDevice(tokenResult.nftoken, device);
            return res.status(200).json({
                success: true,
                device,
                url,
                accountInfo,
                overloadOutcome,
                overloadSignal: overcap.signal || '',
                overloadMessage
            });
        }

        const reason = tokenResult.error || 'Cookie error';

        if (tokenResult.outcome === 'sbd_blocked') {
            return res.status(403).json({
                error: `Cookie bi Netflix chan (Access Denied / SBD): ${reason}`,
                overloadOutcome: 'not_live',
                overloadSignal: 'token_sbd_blocked',
                overloadMessage: 'Cookie khong LIVE o buoc tao token.'
            });
        }
        if (tokenResult.outcome === 'dead') {
            return res.status(401).json({
                error: `Cookie loi hoac da het han (DEAD): ${reason}`,
                overloadOutcome: 'not_live',
                overloadSignal: 'token_dead',
                overloadMessage: 'Cookie khong LIVE o buoc tao token.'
            });
        }

        return res.status(500).json({
            error: `Loi tao token: ${reason}`,
            overloadOutcome: 'not_live',
            overloadSignal: 'token_error',
            overloadMessage: 'Khong the xac dinh qua tai vi cookie chua LIVE.'
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

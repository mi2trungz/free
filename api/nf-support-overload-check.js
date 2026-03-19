const {
    parseBody,
    readCustomers,
    readCookies,
    writeDelta,
    findCustomerByCode,
    isCustomerWarrantyValid,
    extractNetflixIdsFromCookie,
    buildApiErrorPayload
} = require('./_nf-store');
const { requestNetflixToken, detectPlaybackOverCapacity } = require('./_netflix-token-engine');

const OVERCAP_TTL_MINUTES = 30;

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function resolveEffectiveCookieIds(cookie = {}) {
    const storedNetflixId = String(cookie.netflixId || '').trim();
    const storedSecureNetflixId = String(cookie.secureNetflixId || '').trim();
    const parsed = extractNetflixIdsFromCookie(cookie.cookieRaw || '');
    const parsedNetflixId = String(parsed.netflixId || '').trim();
    const parsedSecureNetflixId = String(parsed.secureNetflixId || '').trim();

    const hasInvalidStoredNetflixId = !!storedNetflixId && /\s/.test(storedNetflixId);
    const hasInvalidStoredSecureNetflixId = !!storedSecureNetflixId && /\s/.test(storedSecureNetflixId);

    const netflixId = hasInvalidStoredNetflixId
        ? (parsedNetflixId || '')
        : (storedNetflixId || parsedNetflixId || '');
    const secureNetflixId = hasInvalidStoredSecureNetflixId
        ? (parsedSecureNetflixId || '')
        : (storedSecureNetflixId || parsedSecureNetflixId || '');
    return { netflixId, secureNetflixId };
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const customerCode = String(body.customerCode || '').trim().toUpperCase();
        if (!customerCode) return res.status(400).json({ error: 'Missing customerCode' });

        const [customers, cookies] = await Promise.all([readCustomers(), readCookies()]);
        const customer = findCustomerByCode(customers, customerCode);
        if (!customer) return res.status(404).json({ error: 'Ma khach hang khong ton tai.' });
        if (customer.status === 'inactive') return res.status(403).json({ error: 'Ma khach hang dang tam khoa.' });
        if (!isCustomerWarrantyValid(customer)) return res.status(403).json({ error: 'Ma khach hang da het thoi gian bao hanh.' });

        const assignedCookieId = String(customer.assignedCookieId || '').trim();
        if (!assignedCookieId) {
            return res.status(200).json({
                success: true,
                outcome: 'not_assigned',
                message: 'Khach hang chua duoc gan cookie.'
            });
        }

        const cookie = cookies.find((item) => String(item.id || '').trim() === assignedCookieId);
        if (!cookie) {
            const now = new Date().toISOString();
            await writeDelta({
                source: 'nf-support-overload-check',
                upsertCustomers: [{
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                }]
            });
            return res.status(200).json({
                success: true,
                outcome: 'not_assigned',
                message: 'Cookie da gan khong con ton tai, da bo gan khoi khach.'
            });
        }

        const ids = resolveEffectiveCookieIds(cookie);
        if (!ids.netflixId) {
            return res.status(200).json({
                success: true,
                outcome: 'not_live',
                message: 'Cookie khong co NetflixId hop le.'
            });
        }

        const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');
        if (!(tokenResult.outcome === 'ok' && tokenResult.nftoken)) {
            return res.status(200).json({
                success: true,
                outcome: 'not_live',
                message: tokenResult.error || 'Cookie khong LIVE.',
                detail: tokenResult.outcome || 'error'
            });
        }

        if (!tokenResult.accountInfo) {
            return res.status(200).json({
                success: true,
                outcome: 'unknown',
                message: 'Cookie LIVE nhung khong du du lieu de ket luan qua tai.'
            });
        }

        const overload = detectPlaybackOverCapacity(tokenResult.accountInfo);
        if (overload.overloaded) {
            const now = new Date().toISOString();
            const until = new Date(Date.now() + OVERCAP_TTL_MINUTES * 60 * 1000).toISOString();
            const updatedCookie = {
                ...cookie,
                status: 'active',
                overCapacityTagged: true,
                overCapacityUntil: until,
                lastOverCapacityAt: now,
                assignedCustomerCode: '',
                lastCheckedAt: now,
                lastErrorAt: now,
                lastError: `Cookie bi qua tai nguoi dung (${overload.signal}). Tam khoa 30 phut.`,
                updatedAt: now
            };
            const updatedCustomer = {
                ...customer,
                assignedCookieId: '',
                updatedAt: now
            };
            const ok = await writeDelta({
                source: 'nf-support-overload-check',
                upsertCookies: [updatedCookie],
                upsertCustomers: [updatedCustomer]
            });
            if (!ok) return res.status(500).json({ error: 'Failed to persist overload result' });
            return res.status(200).json({
                success: true,
                outcome: 'overloaded_unassigned',
                overCapacityUntil: until,
                message: 'Da phat hien qua tai. Da bo gan cookie va tam khoa 30 phut.'
            });
        }

        const hasOvercapState = !!cookie.overCapacityTagged || !!String(cookie.overCapacityUntil || '').trim() || !!String(cookie.lastOverCapacityAt || '').trim();
        if (hasOvercapState) {
            const now = new Date().toISOString();
            await writeDelta({
                source: 'nf-support-overload-check',
                upsertCookies: [{
                    ...cookie,
                    overCapacityTagged: false,
                    overCapacityUntil: '',
                    lastOverCapacityAt: '',
                    lastCheckedAt: now,
                    updatedAt: now
                }]
            });
        }

        return res.status(200).json({
            success: true,
            outcome: 'live_ok',
            message: 'Cookie LIVE va khong co dau hieu qua tai.'
        });
    } catch (e) {
        return res.status(500).json(buildApiErrorPayload(e, 'Internal server error'));
    }
};

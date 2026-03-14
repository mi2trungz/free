const {
    parseBody,
    readCookies,
    readCustomers,
    persistAll,
    isLikelyDeadCookie,
    callNetflixCreateAutoLoginToken
} = require('../_nf-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseCookieIds(body = {}) {
    const ids = [];
    const seen = new Set();
    if (!Array.isArray(body.cookieIds)) return ids;
    body.cookieIds.forEach((value) => {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    });
    return ids;
}

function isTokenPermissionDenied(errorMessage = '') {
    return /detailedaccessdeniedexception|access denied by sbd|permission_denied/i.test(String(errorMessage || ''));
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function unassignCustomersForCookie(customers = [], cookie, nowIso) {
    let changed = false;
    const cookieId = String(cookie && cookie.id ? cookie.id : '').trim();
    const assignedCode = normalizeCode(cookie && cookie.assignedCustomerCode ? cookie.assignedCustomerCode : '');

    for (let i = 0; i < customers.length; i += 1) {
        const customer = customers[i];
        const customerCode = normalizeCode(customer.code || '');
        const byCookieId = String(customer.assignedCookieId || '').trim() === cookieId;
        const byStaleCode = !!assignedCode
            && customerCode === assignedCode
            && (!customer.assignedCookieId || String(customer.assignedCookieId || '').trim() === cookieId);

        if (!byCookieId && !byStaleCode) continue;

        customers[i] = {
            ...customer,
            assignedCookieId: '',
            updatedAt: nowIso
        };
        changed = true;
    }

    return changed;
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const mode = String(body.mode || 'selected').trim().toLowerCase();
        if (mode !== 'all' && mode !== 'selected') {
            return res.status(400).json({ error: 'Invalid mode. Use "selected" or "all".' });
        }

        const [cookies, customers] = await Promise.all([readCookies(), readCustomers()]);

        let targetIndexes = [];
        let selectedIds = [];
        if (mode === 'all') {
            targetIndexes = cookies.map((_, index) => index);
        } else {
            selectedIds = parseCookieIds(body);
            if (selectedIds.length === 0) {
                return res.status(400).json({ error: 'Missing cookieIds for selected mode' });
            }
            const selectedSet = new Set(selectedIds);
            targetIndexes = cookies
                .map((item, index) => ({ id: item.id, index }))
                .filter((item) => selectedSet.has(item.id))
                .map((item) => item.index);
            const foundIds = new Set(targetIndexes.map((idx) => cookies[idx].id));
            const missingIds = selectedIds.filter((id) => !foundIds.has(id));
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }
        }

        if (targetIndexes.length === 0) {
            return res.status(200).json({
                success: true,
                totalChecked: 0,
                liveCount: 0,
                deadCount: 0,
                sbdCount: 0,
                errorCount: 0,
                results: []
            });
        }

        let liveCount = 0;
        let deadCount = 0;
        let sbdCount = 0;
        let errorCount = 0;
        let mutated = false;
        const results = [];

        for (let i = 0; i < targetIndexes.length; i += 1) {
            const index = targetIndexes[i];
            const cookie = cookies[index];
            if (!cookie) continue;

            const result = await callNetflixCreateAutoLoginToken(cookie.netflixId, cookie.secureNetflixId || '');
            const reason = String(result.error || '').trim();

            if (result.ok && result.nftoken) {
                const now = new Date().toISOString();
                cookies[index] = {
                    ...cookie,
                    status: 'active',
                    lastCheckedAt: now,
                    lastSuccessAt: now,
                    lastErrorAt: '',
                    lastError: '',
                    updatedAt: now
                };
                liveCount += 1;
                mutated = true;
                results.push({
                    cookieId: cookie.id,
                    outcome: 'live',
                    message: 'Cookie LIVE'
                });
                continue;
            }

            if (isTokenPermissionDenied(reason)) {
                sbdCount += 1;
                results.push({
                    cookieId: cookie.id,
                    outcome: 'sbd',
                    message: reason || 'Access denied by SBD'
                });
                continue;
            }

            if (isLikelyDeadCookie(reason, result.statusCode || 0)) {
                const now = new Date().toISOString();
                cookies[index] = {
                    ...cookie,
                    status: 'dead',
                    assignedCustomerCode: '',
                    lastCheckedAt: now,
                    lastErrorAt: now,
                    lastError: reason || 'Cookie DIE',
                    updatedAt: now
                };
                unassignCustomersForCookie(customers, cookie, now);
                deadCount += 1;
                mutated = true;
                results.push({
                    cookieId: cookie.id,
                    outcome: 'dead',
                    message: reason || 'Cookie DIE'
                });
                continue;
            }

            errorCount += 1;
            results.push({
                cookieId: cookie.id,
                outcome: 'error',
                message: reason || 'Unknown check error'
            });
        }

        if (mutated) {
            const ok = await persistAll(customers, cookies, 'nf-cookies-check');
            if (!ok) return res.status(500).json({ error: 'Failed to persist check results' });
        }

        return res.status(200).json({
            success: true,
            totalChecked: targetIndexes.length,
            liveCount,
            deadCount,
            sbdCount,
            errorCount,
            results
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

const {
    parseBody,
    readCookies,
    readCookiesByIds,
    readCustomers,
    readCustomerByCode,
    writeDelta
} = require('../_nf-store');
const { invalidateMany } = require('../_response-cache');
const { requestNetflixToken } = require('../_netflix-token-engine');

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

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function isUnknownPlan(planValue = '') {
    const text = String(planValue || '').trim().toLowerCase();
    if (!text) return true;
    return /unknow|unknown|n\/a/.test(text);
}

function isPaymentHoldYes(value = '') {
    const text = String(value || '').trim().toLowerCase();
    return text === 'yes' || text === 'true' || text === '1';
}

async function unassignCustomersForCookieSelected(cookie, nowIso, changedCustomersMap) {
    const cookieId = String(cookie && cookie.id ? cookie.id : '').trim();
    const assignedCode = normalizeCode(cookie && cookie.assignedCustomerCode ? cookie.assignedCustomerCode : '');
    if (!cookieId && !assignedCode) return;

    if (assignedCode) {
        const customer = await readCustomerByCode(assignedCode);
        if (customer && String(customer.assignedCookieId || '').trim() === cookieId) {
            changedCustomersMap.set(customer.code, {
                ...customer,
                assignedCookieId: '',
                updatedAt: nowIso
            });
        }
    }
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

        let cookies = [];
        let targetIndexes = [];
        let selectedIds = [];
        let customers = [];

        if (mode === 'all') {
            // Intentionally heavy path: full scan for admin "check all".
            [cookies, customers] = await Promise.all([readCookies(), readCustomers()]);
            targetIndexes = cookies.map((_, index) => index);
        } else {
            selectedIds = parseCookieIds(body);
            if (selectedIds.length === 0) {
                return res.status(400).json({ error: 'Missing cookieIds for selected mode' });
            }
            cookies = await readCookiesByIds(selectedIds);
            const foundIds = new Set(cookies.map((item) => item.id));
            const missingIds = selectedIds.filter((id) => !foundIds.has(id));
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }
            targetIndexes = cookies.map((_item, index) => index);
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
        const changedCustomerCodes = new Set();
        const changedCustomersMap = new Map();
        const results = [];

        function unassignCustomersForCookieAll(cookie, nowIso) {
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
                changedCustomerCodes.add(customer.code);
                changed = true;
            }

            return changed;
        }

        for (let i = 0; i < targetIndexes.length; i += 1) {
            const index = targetIndexes[i];
            const cookie = cookies[index];
            if (!cookie) continue;

            const tokenResult = await requestNetflixToken(cookie.netflixId, cookie.secureNetflixId || '');
            const reason = String(tokenResult.error || '').trim();

            if (tokenResult.outcome === 'ok' && tokenResult.nftoken) {
                const now = new Date().toISOString();
                const account = tokenResult.accountInfo || null;
                const unknownTagged = !!(account && isUnknownPlan(account.plan));
                const holdTagged = !!(account && isPaymentHoldYes(account.on_payment_hold));
                const hasPolicyTag = unknownTagged || holdTagged;
                cookies[index] = {
                    ...cookie,
                    status: 'active',
                    sbdTagged: false,
                    unknownTagged,
                    holdTagged,
                    assignedCustomerCode: hasPolicyTag ? '' : cookie.assignedCustomerCode,
                    lastCheckedAt: now,
                    lastSuccessAt: hasPolicyTag ? (cookie.lastSuccessAt || '') : now,
                    lastErrorAt: hasPolicyTag ? now : '',
                    lastError: hasPolicyTag
                        ? `Cookie LIVE nhung bi tag ${unknownTagged && holdTagged ? 'UNKNOW+HOLD' : (unknownTagged ? 'UNKNOW' : 'HOLD')}.`
                        : '',
                    updatedAt: now
                };
                if (hasPolicyTag) {
                    if (mode === 'all') {
                        unassignCustomersForCookieAll(cookie, now);
                    } else {
                        await unassignCustomersForCookieSelected(cookie, now, changedCustomersMap);
                    }
                    errorCount += 1;
                    results.push({
                        cookieId: cookie.id,
                        outcome: unknownTagged && holdTagged ? 'unknown_hold' : (unknownTagged ? 'unknown' : 'hold'),
                        message: cookies[index].lastError
                    });
                    mutated = true;
                    continue;
                }
                liveCount += 1;
                mutated = true;
                results.push({
                    cookieId: cookie.id,
                    outcome: 'live',
                    message: 'Cookie LIVE'
                });
                continue;
            }

            if (tokenResult.outcome === 'sbd_blocked') {
                const now = new Date().toISOString();
                cookies[index] = {
                    ...cookie,
                    sbdTagged: true,
                    unknownTagged: false,
                    holdTagged: false,
                    assignedCustomerCode: '',
                    lastCheckedAt: now,
                    lastErrorAt: now,
                    lastError: reason || 'Access denied by SBD',
                    updatedAt: now
                };
                if (mode === 'all') {
                    unassignCustomersForCookieAll(cookie, now);
                } else {
                    await unassignCustomersForCookieSelected(cookie, now, changedCustomersMap);
                }
                sbdCount += 1;
                mutated = true;
                results.push({
                    cookieId: cookie.id,
                    outcome: 'sbd',
                    message: reason || 'Access denied by SBD'
                });
                continue;
            }

            if (tokenResult.outcome === 'dead') {
                const now = new Date().toISOString();
                cookies[index] = {
                    ...cookie,
                    status: 'dead',
                    unknownTagged: false,
                    holdTagged: false,
                    assignedCustomerCode: '',
                    lastCheckedAt: now,
                    lastErrorAt: now,
                    lastError: reason || 'Cookie DIE',
                    updatedAt: now
                };
                if (mode === 'all') {
                    unassignCustomersForCookieAll(cookie, now);
                } else {
                    await unassignCustomersForCookieSelected(cookie, now, changedCustomersMap);
                }
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
            const changedCookies = targetIndexes
                .map((idx) => cookies[idx])
                .filter(Boolean);
            const changedCustomers = mode === 'all'
                ? customers.filter((customer) => changedCustomerCodes.has(customer.code))
                : Array.from(changedCustomersMap.values());
            const ok = await writeDelta({
                source: 'nf-cookies-check',
                upsertCookies: changedCookies,
                upsertCustomers: changedCustomers
            });
            if (!ok) return res.status(500).json({ error: 'Failed to persist check results' });
            invalidateMany(['nf_cookies_get', 'nf_customers_get', 'nf_customer_lookup']);
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

const {
    parseBody,
    readCookies,
    readCustomers,
    persistCookies,
    persistAll,
    sanitizeCookie,
    sanitizeCookieStatus,
    maskNetflixId,
    buildCookieSummary,
    extractNetflixIdsFromCookie,
    splitImportCookieBlocks
} = require('../_nf-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cookiePublicDto(cookie) {
    return {
        id: cookie.id,
        status: cookie.status,
        assignedCustomerCode: cookie.assignedCustomerCode || '',
        cookieRaw: cookie.cookieRaw || '',
        netflixIdMasked: maskNetflixId(cookie.netflixId),
        createdAt: cookie.createdAt || '',
        updatedAt: cookie.updatedAt || '',
        lastCheckedAt: cookie.lastCheckedAt || '',
        lastSuccessAt: cookie.lastSuccessAt || '',
        lastErrorAt: cookie.lastErrorAt || '',
        lastError: cookie.lastError || ''
    };
}

function parseCookieIds(body = {}) {
    const ids = [];
    const seen = new Set();

    function pushId(value) {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    }

    if (Array.isArray(body.cookieIds)) {
        body.cookieIds.forEach(pushId);
    }
    if (body.cookieId !== undefined) {
        pushId(body.cookieId);
    }

    return ids;
}

function findMissingCookieIds(cookies = [], cookieIds = []) {
    const existing = new Set(cookies.map((item) => item.id));
    return cookieIds.filter((id) => !existing.has(id));
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const cookies = await readCookies();

        if (req.method === 'GET') {
            const summary = buildCookieSummary(cookies);
            return res.status(200).json({
                ...summary,
                cookies: cookies.map(cookiePublicDto)
            });
        }

        const body = parseBody(req.body);

        if (req.method === 'PUT') {
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) return res.status(400).json({ error: 'Missing cookieId' });

            const missingIds = findMissingCookieIds(cookies, cookieIds);
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const targetIdSet = new Set(cookieIds);
            const now = new Date().toISOString();

            const cookieRawInput = body.cookieRaw !== undefined ? String(body.cookieRaw || '').trim() : '';
            const hasCookieRawUpdate = cookieRawInput.length > 0;
            let parsedCookieIds = null;
            if (hasCookieRawUpdate) {
                if (cookieIds.length !== 1) {
                    return res.status(400).json({ error: 'cookieRaw only supports single cookie update' });
                }
                const parsedBlocks = splitImportCookieBlocks(cookieRawInput);
                if (parsedBlocks.length !== 1) {
                    return res.status(400).json({ error: 'cookieRaw must contain exactly 1 cookie block' });
                }
                const normalizedCookieRaw = String(parsedBlocks[0] || '').trim();
                parsedCookieIds = extractNetflixIdsFromCookie(normalizedCookieRaw);
                if (!parsedCookieIds || !parsedCookieIds.netflixId) {
                    return res.status(400).json({ error: 'cookieRaw missing NetflixId' });
                }
                parsedCookieIds.cookieRaw = normalizedCookieRaw;
            }

            let shouldUnassignAny = false;
            const nextCookies = cookies.map((current) => {
                if (!targetIdSet.has(current.id)) return current;

                const nextStatus = body.status !== undefined ? sanitizeCookieStatus(body.status) : current.status;
                const shouldUnassign = !!body.unassign || nextStatus !== 'active';
                if (shouldUnassign) shouldUnassignAny = true;

                if (hasCookieRawUpdate) {
                    return sanitizeCookie({
                        ...current,
                        netflixId: parsedCookieIds.netflixId,
                        secureNetflixId: parsedCookieIds.secureNetflixId || '',
                        cookieRaw: parsedCookieIds.cookieRaw,
                        status: 'active',
                        updatedAt: now,
                        lastCheckedAt: '',
                        lastSuccessAt: '',
                        lastErrorAt: '',
                        lastError: ''
                    });
                }

                return sanitizeCookie({
                    ...current,
                    status: nextStatus,
                    assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                    updatedAt: now,
                    lastError: body.lastError !== undefined ? String(body.lastError || '') : current.lastError
                });
            });

            if (!shouldUnassignAny) {
                const ok = await persistCookies(nextCookies);
                if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
                return res.status(200).json({ success: true, affectedCount: cookieIds.length });
            }

            const customers = await readCustomers();
            const nextCustomers = customers.map((customer) => {
                if (!targetIdSet.has(customer.assignedCookieId || '')) return customer;
                return {
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                };
            });

            const ok = await persistAll(nextCustomers, nextCookies, 'nf-cookies-put');
            if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        if (req.method === 'DELETE') {
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) return res.status(400).json({ error: 'Missing cookieId' });

            const missingIds = findMissingCookieIds(cookies, cookieIds);
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const now = new Date().toISOString();
            const targetIdSet = new Set(cookieIds);
            const nextCookies = cookies.filter((item) => !targetIdSet.has(item.id));
            const customers = await readCustomers();
            const nextCustomers = customers.map((customer) => {
                if (!targetIdSet.has(customer.assignedCookieId || '')) return customer;
                return {
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                };
            });

            const ok = await persistAll(nextCustomers, nextCookies, 'nf-cookies-delete');
            if (!ok) return res.status(500).json({ error: 'Failed to delete cookie' });
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

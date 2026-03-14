const {
    parseBody,
    readCookies,
    readCustomers,
    persistCookies,
    persistAll,
    sanitizeCookie,
    sanitizeCookieStatus,
    maskNetflixId,
    buildCookieSummary
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
        netflixIdMasked: maskNetflixId(cookie.netflixId),
        createdAt: cookie.createdAt || '',
        updatedAt: cookie.updatedAt || '',
        lastCheckedAt: cookie.lastCheckedAt || '',
        lastSuccessAt: cookie.lastSuccessAt || '',
        lastErrorAt: cookie.lastErrorAt || '',
        lastError: cookie.lastError || ''
    };
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
            const cookieId = String(body.cookieId || '').trim();
            if (!cookieId) return res.status(400).json({ error: 'Missing cookieId' });

            const idx = cookies.findIndex((item) => item.id === cookieId);
            if (idx < 0) return res.status(404).json({ error: 'Cookie not found' });

            const nextCookies = cookies.slice();
            const current = nextCookies[idx];
            const nextStatus = body.status !== undefined ? sanitizeCookieStatus(body.status) : current.status;
            const shouldUnassign = !!body.unassign || nextStatus !== 'active';
            const now = new Date().toISOString();

            nextCookies[idx] = sanitizeCookie({
                ...current,
                status: nextStatus,
                assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                updatedAt: now,
                lastError: body.lastError !== undefined ? String(body.lastError || '') : current.lastError
            });

            if (!shouldUnassign) {
                const ok = await persistCookies(nextCookies);
                if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
                return res.status(200).json({ success: true });
            }

            const customers = await readCustomers();
            const nextCustomers = customers.map((customer) => {
                if (customer.assignedCookieId !== cookieId) return customer;
                return {
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                };
            });

            const ok = await persistAll(nextCustomers, nextCookies, 'nf-cookies-put');
            if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'DELETE') {
            const cookieId = String(body.cookieId || '').trim();
            if (!cookieId) return res.status(400).json({ error: 'Missing cookieId' });

            const exists = cookies.some((item) => item.id === cookieId);
            if (!exists) return res.status(404).json({ error: 'Cookie not found' });

            const now = new Date().toISOString();
            const nextCookies = cookies.filter((item) => item.id !== cookieId);
            const customers = await readCustomers();
            const nextCustomers = customers.map((customer) => {
                if (customer.assignedCookieId !== cookieId) return customer;
                return {
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                };
            });

            const ok = await persistAll(nextCustomers, nextCookies, 'nf-cookies-delete');
            if (!ok) return res.status(500).json({ error: 'Failed to delete cookie' });
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

const {
    parseBody,
    readCustomers,
    readCookies,
    writeDelta,
    sanitizeCustomer,
    sanitizeCustomerStatus,
    makeCustomerCode,
    findCustomerIndexByCode,
    buildWarrantyInfo,
    buildApiErrorPayload
} = require('./_nf-store');
const { getCache, setCache, deleteCache } = require('./_nf-cache');

const CUSTOMERS_CACHE_KEY = 'customers:list';
const CUSTOMERS_CACHE_TTL_MS = 30 * 1000;

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function customerPublicDto(customer) {
    const warranty = buildWarrantyInfo(customer);
    return {
        code: customer.code,
        name: customer.name,
        status: customer.status,
        warrantyExpiresAt: customer.warrantyExpiresAt || '',
        warrantyValid: warranty.warrantyValid,
        remainingDays: warranty.remainingDays,
        assignedCookieId: customer.assignedCookieId || '',
        createdAt: customer.createdAt || '',
        updatedAt: customer.updatedAt || '',
        lastLinkedAt: customer.lastLinkedAt || ''
    };
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const cached = getCache(CUSTOMERS_CACHE_KEY);
            if (cached) return res.status(200).json(cached);
            const customers = await readCustomers();
            const sorted = customers
                .slice()
                .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
            const payload = {
                total: sorted.length,
                customers: sorted.map(customerPublicDto)
            };
            setCache(CUSTOMERS_CACHE_KEY, payload, CUSTOMERS_CACHE_TTL_MS);
            return res.status(200).json(payload);
        }

        const body = parseBody(req.body);
        const customers = await readCustomers();

        if (req.method === 'POST') {
            const name = String(body.name || '').trim();
            const warrantyExpiresAt = String(body.warrantyExpiresAt || '').trim();
            if (!name) return res.status(400).json({ error: 'Missing customer name' });
            if (!warrantyExpiresAt) return res.status(400).json({ error: 'Missing warrantyExpiresAt' });

            const now = new Date().toISOString();
            const code = makeCustomerCode(customers.map((c) => c.code));
            const next = sanitizeCustomer({
                code,
                name,
                warrantyExpiresAt,
                status: 'active',
                assignedCookieId: '',
                createdAt: now,
                updatedAt: now,
                lastLinkedAt: ''
            });

            const ok = await writeDelta({
                source: 'nf-customers-create',
                upsertCustomers: [next]
            });
            if (!ok) return res.status(500).json({ error: 'Failed to create customer' });
            deleteCache(CUSTOMERS_CACHE_KEY);
            deleteCache(`lookup:${next.code}`);
            return res.status(200).json({ success: true, customer: customerPublicDto(next) });
        }

        if (req.method === 'PUT') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const idx = findCustomerIndexByCode(customers, code);
            if (idx < 0) return res.status(404).json({ error: 'Customer not found' });
            const newCode = String(body.newCode || '').trim().toUpperCase();
            const nextCode = newCode || code;
            if (!nextCode) return res.status(400).json({ error: 'Customer code cannot be empty' });
            if (nextCode !== code) {
                const conflictIndex = findCustomerIndexByCode(customers, nextCode);
                if (conflictIndex >= 0) return res.status(409).json({ error: 'Customer code already exists' });
            }

            const current = customers[idx];
            const updated = sanitizeCustomer({
                ...current,
                code: nextCode,
                name: body.name !== undefined ? String(body.name || '').trim() : current.name,
                warrantyExpiresAt: body.warrantyExpiresAt !== undefined ? String(body.warrantyExpiresAt || '').trim() : current.warrantyExpiresAt,
                status: body.status !== undefined ? sanitizeCustomerStatus(body.status) : current.status,
                updatedAt: new Date().toISOString()
            });

            if (!updated.name) return res.status(400).json({ error: 'Customer name cannot be empty' });
            if (!updated.warrantyExpiresAt) return res.status(400).json({ error: 'warrantyExpiresAt cannot be empty' });

            let ok = false;
            if (nextCode !== code) {
                const now = new Date().toISOString();
                const cookies = await readCookies();
                const changedCookies = [];
                cookies.forEach((cookie) => {
                    if (cookie.assignedCustomerCode !== code) return;
                    changedCookies.push({
                        ...cookie,
                        assignedCustomerCode: nextCode,
                        updatedAt: now
                    });
                });
                ok = await writeDelta({
                    source: 'nf-customers-update-code',
                    upsertCustomers: [updated],
                    deleteCustomerCodes: [code],
                    upsertCookies: changedCookies
                });
            } else {
                ok = await writeDelta({
                    source: 'nf-customers-update',
                    upsertCustomers: [updated]
                });
            }
            if (!ok) return res.status(500).json({ error: 'Failed to update customer' });
            deleteCache(CUSTOMERS_CACHE_KEY);
            deleteCache('cookies:list');
            if (nextCode !== code) {
                deleteCache(`lookup:${code}`);
                deleteCache(`lookup:${nextCode}`);
            } else {
                deleteCache(`lookup:${code}`);
            }
            return res.status(200).json({ success: true, customer: customerPublicDto(updated) });
        }

        if (req.method === 'DELETE') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const idx = findCustomerIndexByCode(customers, code);
            if (idx < 0) return res.status(404).json({ error: 'Customer not found' });

            const cookies = await readCookies();
            const now = new Date().toISOString();
            const changedCookies = [];
            cookies.forEach((cookie) => {
                if (cookie.assignedCustomerCode !== code) return;
                changedCookies.push({
                    ...cookie,
                    assignedCustomerCode: '',
                    updatedAt: now
                });
            });

            const ok = await writeDelta({
                source: 'nf-customers-delete',
                deleteCustomerCodes: [code],
                upsertCookies: changedCookies
            });
            if (!ok) return res.status(500).json({ error: 'Failed to delete customer' });
            deleteCache(CUSTOMERS_CACHE_KEY);
            deleteCache('cookies:list');
            deleteCache(`lookup:${code}`);
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json(buildApiErrorPayload(e, 'Internal server error'));
    }
};

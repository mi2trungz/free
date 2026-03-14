const {
    parseBody,
    readCustomers,
    readCookies,
    persistCustomers,
    persistAll,
    sanitizeCustomer,
    sanitizeCustomerStatus,
    makeCustomerCode,
    findCustomerIndexByCode,
    buildWarrantyInfo
} = require('./_nf-store');

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
        const customers = await readCustomers();

        if (req.method === 'GET') {
            const sorted = customers
                .slice()
                .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
            return res.status(200).json({
                total: sorted.length,
                customers: sorted.map(customerPublicDto)
            });
        }

        const body = parseBody(req.body);

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

            const nextCustomers = [next, ...customers];
            const ok = await persistCustomers(nextCustomers);
            if (!ok) return res.status(500).json({ error: 'Failed to create customer' });
            return res.status(200).json({ success: true, customer: customerPublicDto(next) });
        }

        if (req.method === 'PUT') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const idx = findCustomerIndexByCode(customers, code);
            if (idx < 0) return res.status(404).json({ error: 'Customer not found' });

            const current = customers[idx];
            const updated = sanitizeCustomer({
                ...current,
                name: body.name !== undefined ? String(body.name || '').trim() : current.name,
                warrantyExpiresAt: body.warrantyExpiresAt !== undefined ? String(body.warrantyExpiresAt || '').trim() : current.warrantyExpiresAt,
                status: body.status !== undefined ? sanitizeCustomerStatus(body.status) : current.status,
                updatedAt: new Date().toISOString()
            });

            if (!updated.name) return res.status(400).json({ error: 'Customer name cannot be empty' });
            if (!updated.warrantyExpiresAt) return res.status(400).json({ error: 'warrantyExpiresAt cannot be empty' });

            const nextCustomers = customers.slice();
            nextCustomers[idx] = updated;
            const ok = await persistCustomers(nextCustomers);
            if (!ok) return res.status(500).json({ error: 'Failed to update customer' });
            return res.status(200).json({ success: true, customer: customerPublicDto(updated) });
        }

        if (req.method === 'DELETE') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const idx = findCustomerIndexByCode(customers, code);
            if (idx < 0) return res.status(404).json({ error: 'Customer not found' });

            const nextCustomers = customers.filter((item) => item.code !== code);
            const cookies = await readCookies();
            let mutatedCookies = false;
            const nextCookies = cookies.map((cookie) => {
                if (cookie.assignedCustomerCode !== code) return cookie;
                mutatedCookies = true;
                return {
                    ...cookie,
                    assignedCustomerCode: '',
                    updatedAt: new Date().toISOString()
                };
            });

            const ok = mutatedCookies
                ? await persistAll(nextCustomers, nextCookies, 'nf-customers-delete')
                : await persistCustomers(nextCustomers);
            if (!ok) return res.status(500).json({ error: 'Failed to delete customer' });
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

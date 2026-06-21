const {
    parseBody,
    readCustomers,
    readCustomersPage,
    readCustomerByCode,
    readCookieById,
    writeDelta,
    sanitizeCustomer,
    sanitizeCustomerStatus,
    makeCustomerCode,
    buildWarrantyInfo
} = require('./_nf-store');
const { getOrSet, invalidateMany } = require('./_response-cache');

const CUSTOMERS_CACHE_NS = 'nf_customers_get';
const CUSTOMERS_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const CUSTOMER_CODE_V2_REGEX = /^[A-Z0-9]{4}$/;

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parsePagination(req) {
    try {
        const parsed = new URL(String((req && req.url) || ''), 'http://localhost');
        const page = Math.max(1, Number(parsed.searchParams.get('page') || DEFAULT_PAGE));
        const pageSize = Math.max(1, Math.min(Number(parsed.searchParams.get('pageSize') || DEFAULT_PAGE_SIZE), 100));
        const search = String(parsed.searchParams.get('search') || '').trim();
        const code = String(parsed.searchParams.get('code') || '').trim().toUpperCase();
        return { page, pageSize, search, code };
    } catch (e) {
        return { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE, search: '', code: '' };
    }
}

function paginateArray(items = [], page = 1, pageSize = DEFAULT_PAGE_SIZE) {
    const total = Math.max(0, Array.isArray(items) ? items.length : 0);
    const safePageSize = Math.max(1, Number(pageSize || DEFAULT_PAGE_SIZE));
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.max(1, Number(page || 1));
    const normalizedPage = Math.min(safePage, totalPages);
    const start = (normalizedPage - 1) * safePageSize;
    return {
        items: (Array.isArray(items) ? items : []).slice(start, start + safePageSize),
        total,
        page: normalizedPage,
        pageSize: safePageSize,
        totalPages,
        hasNext: normalizedPage < totalPages,
        hasPrev: normalizedPage > 1
    };
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

function invalidateCustomerRelatedCaches() {
    invalidateMany(['nf_customers_get', 'nf_cookies_get', 'nf_customer_lookup']);
}

async function createUniqueCustomerCode(maxAttempts = 120) {
    for (let i = 0; i < maxAttempts; i += 1) {
        const code = makeCustomerCode([]);
        const exists = await readCustomerByCode(code);
        if (!exists) return code;
    }
    throw new Error('Failed to allocate customer code');
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const { page, pageSize, search, code } = parsePagination(req);
            if (code) {
                const customer = await readCustomerByCode(code);
                if (!customer) return res.status(404).json({ error: 'Customer not found' });
                return res.status(200).json({ customer: customerPublicDto(customer) });
            }
            const normalizedSearch = String(search || '').trim().toLowerCase();
            const cacheKey = `q=${encodeURIComponent(normalizedSearch)}|p=${page}|s=${pageSize}`;
            const { value } = await getOrSet(
                CUSTOMERS_CACHE_NS,
                cacheKey,
                async () => {
                    let paged = null;
                    if (normalizedSearch) {
                        const allCustomers = await readCustomers();
                        const sorted = allCustomers
                            .slice()
                            .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
                        const filtered = sorted.filter((item) => {
                            const code = String(item.code || '').toLowerCase();
                            const name = String(item.name || '').toLowerCase();
                            return code.includes(normalizedSearch) || name.includes(normalizedSearch);
                        });
                        paged = paginateArray(filtered, page, pageSize);
                    } else {
                        paged = await readCustomersPage({ page, pageSize });
                    }

                    const items = (paged.items || []).map(customerPublicDto);
                    return {
                        items,
                        customers: items,
                        search: normalizedSearch,
                        total: paged.total || 0,
                        page: paged.page || page,
                        pageSize: paged.pageSize || pageSize,
                        totalPages: paged.totalPages || 1,
                        hasNext: !!paged.hasNext,
                        hasPrev: !!paged.hasPrev
                    };
                },
                CUSTOMERS_CACHE_TTL_MS
            );
            return res.status(200).json(value);
        }

        const body = parseBody(req.body);

        if (req.method === 'POST') {
            const name = String(body.name || '').trim();
            const warrantyExpiresAt = String(body.warrantyExpiresAt || '').trim();
            if (!name) return res.status(400).json({ error: 'Missing customer name' });
            if (!warrantyExpiresAt) return res.status(400).json({ error: 'Missing warrantyExpiresAt' });

            const now = new Date().toISOString();
            const code = await createUniqueCustomerCode();
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
            invalidateCustomerRelatedCaches();
            return res.status(200).json({ success: true, customer: customerPublicDto(next) });
        }

        if (req.method === 'PUT') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const current = await readCustomerByCode(code);
            if (!current) return res.status(404).json({ error: 'Customer not found' });

            const newCode = String(body.newCode || '').trim().toUpperCase();
            const nextCode = newCode || code;
            if (!nextCode) return res.status(400).json({ error: 'Customer code cannot be empty' });
            if (nextCode !== code && !CUSTOMER_CODE_V2_REGEX.test(nextCode)) {
                return res.status(400).json({ error: 'newCode must be 4 chars [A-Z0-9]' });
            }
            if (nextCode !== code) {
                const conflict = await readCustomerByCode(nextCode);
                if (conflict) return res.status(409).json({ error: 'Customer code already exists' });
            }

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
                const changedCookies = [];
                const assignedCookieId = String(current.assignedCookieId || '').trim();
                if (assignedCookieId) {
                    const assignedCookie = await readCookieById(assignedCookieId);
                    if (assignedCookie && String(assignedCookie.assignedCustomerCode || '').trim().toUpperCase() === code) {
                        changedCookies.push({
                            ...assignedCookie,
                            assignedCustomerCode: nextCode,
                            updatedAt: now
                        });
                    }
                }
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
            invalidateCustomerRelatedCaches();
            return res.status(200).json({ success: true, customer: customerPublicDto(updated) });
        }

        if (req.method === 'DELETE') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ error: 'Missing customer code' });

            const current = await readCustomerByCode(code);
            if (!current) return res.status(404).json({ error: 'Customer not found' });

            const now = new Date().toISOString();
            const changedCookies = [];
            const assignedCookieId = String(current.assignedCookieId || '').trim();
            if (assignedCookieId) {
                const assignedCookie = await readCookieById(assignedCookieId);
                if (assignedCookie && String(assignedCookie.assignedCustomerCode || '').trim().toUpperCase() === code) {
                    changedCookies.push({
                        ...assignedCookie,
                        assignedCustomerCode: '',
                        updatedAt: now
                    });
                }
            }

            const ok = await writeDelta({
                source: 'nf-customers-delete',
                deleteCustomerCodes: [code],
                upsertCookies: changedCookies
            });
            if (!ok) return res.status(500).json({ error: 'Failed to delete customer' });
            invalidateCustomerRelatedCaches();
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        const status = Math.max(400, Math.min(599, Number(e && e.httpStatus ? e.httpStatus : 500)));
        const payload = { error: (e && e.message) || 'Internal server error' };
        if (e && e.code) payload.code = e.code;
        return res.status(status).json(payload);
    }
};

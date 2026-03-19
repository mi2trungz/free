const {
    parseBody,
    readCustomerByCode,
    buildWarrantyInfo,
    buildApiErrorPayload
} = require('./_nf-store');
const { getCache, setCache } = require('./_nf-cache');

const LOOKUP_CACHE_TTL_MS = 60 * 1000;

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
        const customerCode = String(body.customerCode || '').trim().toUpperCase();
        if (!customerCode) return res.status(400).json({ error: 'Missing customerCode' });

        const cacheKey = `lookup:${customerCode}`;
        const cached = getCache(cacheKey);
        if (cached) {
            if (cached.notFound) return res.status(404).json({ error: 'Ma khach hang khong ton tai.' });
            return res.status(200).json(cached.payload);
        }

        const customer = await readCustomerByCode(customerCode);
        if (!customer) {
            setCache(cacheKey, { notFound: true }, LOOKUP_CACHE_TTL_MS);
            return res.status(404).json({ error: 'Ma khach hang khong ton tai.' });
        }

        const warranty = buildWarrantyInfo(customer);
        if (customer.status === 'inactive') {
            const payload = {
                customer: {
                    code: customer.code,
                    name: customer.name
                },
                eligible: false,
                reason: 'inactive',
                message: 'Ma khach hang dang tam khoa.'
            };
            setCache(cacheKey, { payload }, LOOKUP_CACHE_TTL_MS);
            return res.status(200).json(payload);
        }

        if (!warranty.warrantyValid) {
            const payload = {
                customer: {
                    code: customer.code,
                    name: customer.name
                },
                eligible: false,
                reason: 'expired',
                message: 'Ma khach hang da het thoi gian bao hanh.'
            };
            setCache(cacheKey, { payload }, LOOKUP_CACHE_TTL_MS);
            return res.status(200).json(payload);
        }

        const payload = {
            customer: {
                code: customer.code,
                name: customer.name
            },
            eligible: true,
            reason: null
        };
        setCache(cacheKey, { payload }, LOOKUP_CACHE_TTL_MS);
        return res.status(200).json(payload);
    } catch (e) {
        return res.status(500).json(buildApiErrorPayload(e, 'Internal server error'));
    }
};

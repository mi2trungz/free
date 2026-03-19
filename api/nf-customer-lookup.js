const {
    parseBody,
    readCustomerByCode,
    buildWarrantyInfo
} = require('./_nf-store');
const { getOrSet, invalidateMany } = require('./_response-cache');

const LOOKUP_CACHE_NS = 'nf_customer_lookup';
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

        const { value: payload } = await getOrSet(
            LOOKUP_CACHE_NS,
            customerCode,
            async () => {
                const customer = await readCustomerByCode(customerCode);
                if (!customer) {
                    return {
                        __error: {
                            statusCode: 404,
                            message: 'Mã khách hàng không tồn tại.'
                        }
                    };
                }

                const warranty = buildWarrantyInfo(customer);
                if (customer.status === 'inactive') {
                    return {
                        customer: {
                            code: customer.code,
                            name: customer.name
                        },
                        eligible: false,
                        reason: 'inactive',
                        message: 'Mã khách hàng đang tạm khóa.'
                    };
                }

                if (!warranty.warrantyValid) {
                    return {
                        customer: {
                            code: customer.code,
                            name: customer.name
                        },
                        eligible: false,
                        reason: 'expired',
                        message: 'Mã khách hàng đã hết thời gian bảo hành.'
                    };
                }

                return {
                    customer: {
                        code: customer.code,
                        name: customer.name
                    },
                    eligible: true,
                    reason: null
                };
            },
            LOOKUP_CACHE_TTL_MS
        );

        if (payload && payload.__error) {
            return res.status(payload.__error.statusCode || 404).json({ error: payload.__error.message || 'Lookup failed' });
        }

        return res.status(200).json(payload || {
            customer: {
                code: customerCode,
                name: ''
            },
            eligible: false,
            reason: 'unknown'
        });
    } catch (e) {
        invalidateMany([LOOKUP_CACHE_NS]);
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

const {
    parseBody,
    readCustomers,
    findCustomerByCode,
    buildWarrantyInfo
} = require('./_nf-store');

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

        const customers = await readCustomers();
        const customer = findCustomerByCode(customers, customerCode);
        if (!customer) return res.status(404).json({ error: 'Mã khách hàng không tồn tại.' });

        const warranty = buildWarrantyInfo(customer);
        if (customer.status === 'inactive') {
            return res.status(200).json({
                customer: {
                    code: customer.code,
                    name: customer.name
                },
                eligible: false,
                reason: 'inactive',
                message: 'Mã khách hàng đang tạm khóa.'
            });
        }

        if (!warranty.warrantyValid) {
            return res.status(200).json({
                customer: {
                    code: customer.code,
                    name: customer.name
                },
                eligible: false,
                reason: 'expired',
                message: 'Mã khách hàng đã hết thời gian bảo hành.'
            });
        }

        return res.status(200).json({
            customer: {
                code: customer.code,
                name: customer.name
            },
            eligible: true,
            reason: null
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

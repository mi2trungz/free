const {
    readAuthorizedGetlinkOperation,
    advanceGetlinkOperation,
    shapeOperationPayload
} = require('./_getlink-operation-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const pathname = String((req.url || '').split('?')[0] || '').trim();
        const match = pathname.match(/^\/api\/getlink-operations\/([^/]+)$/);
        if (!match) return res.status(404).json({ error: 'Not found' });

        const operationId = decodeURIComponent(match[1] || '');
        const parsedUrl = new URL(req.url, 'http://localhost');
        const token = String(parsedUrl.searchParams.get('token') || req.headers['x-getlink-operation-token'] || '').trim();
        if (!token) return res.status(400).json({ error: 'Missing getlink operation token' });

        const operation = await readAuthorizedGetlinkOperation(operationId, token);
        if (!operation) return res.status(404).json({ error: 'Getlink operation not found' });

        const advanced = await advanceGetlinkOperation(operation);
        const payload = shapeOperationPayload(advanced);
        if (advanced.status === 'failed') {
            return res.status(422).json({
                ...payload,
                error: String(advanced.lastError || advanced.message || 'Getlink operation failed').trim() || 'Getlink operation failed'
            });
        }
        return res.status(200).json(payload);
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};

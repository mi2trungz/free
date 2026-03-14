const {
    parseBody,
    readCookies,
    persistCookies,
    sanitizeCookie,
    splitImportLines,
    extractNetflixIdsFromCookie,
    makeCustomerCode
} = require('../_nf-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function makeImportCookieId() {
    const seed = makeCustomerCode([]).toLowerCase();
    return `nf_ck_${Date.now()}_${seed}`;
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const content = String(body.content || '').trim();
        if (!content) return res.status(400).json({ error: 'Missing import content' });

        const lines = splitImportLines(content);
        if (lines.length === 0) return res.status(400).json({ error: 'No cookie lines found' });

        const currentPool = await readCookies();
        const existingKeySet = new Set(
            currentPool.map((item) => `${item.netflixId}|${item.secureNetflixId || ''}`)
        );

        const now = new Date().toISOString();
        const added = [];
        let skipped = 0;
        let invalid = 0;

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const ids = extractNetflixIdsFromCookie(line);
            if (!ids.netflixId) {
                invalid += 1;
                continue;
            }
            const key = `${ids.netflixId}|${ids.secureNetflixId || ''}`;
            if (existingKeySet.has(key)) {
                skipped += 1;
                continue;
            }
            existingKeySet.add(key);
            added.push(sanitizeCookie({
                id: makeImportCookieId(),
                netflixId: ids.netflixId,
                secureNetflixId: ids.secureNetflixId || '',
                status: 'active',
                assignedCustomerCode: '',
                createdAt: now,
                updatedAt: now,
                lastCheckedAt: '',
                lastSuccessAt: '',
                lastErrorAt: '',
                lastError: ''
            }));
        }

        if (added.length === 0) {
            return res.status(200).json({
                success: true,
                addedCount: 0,
                skippedCount: skipped,
                invalidCount: invalid
            });
        }

        const nextPool = [...currentPool, ...added];
        const ok = await persistCookies(nextPool);
        if (!ok) return res.status(500).json({ error: 'Failed to import cookies' });

        return res.status(200).json({
            success: true,
            addedCount: added.length,
            skippedCount: skipped,
            invalidCount: invalid
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

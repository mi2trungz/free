const {
    parseBody,
    readCookies,
    writeDelta,
    sanitizeCookie,
    splitImportCookieBlocks,
    extractNetflixIdsFromCookie,
    makeCustomerCode,
    buildApiErrorPayload
} = require('../_nf-store');
const { deleteCache } = require('../_nf-cache');

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

        const blocks = splitImportCookieBlocks(content);
        if (blocks.length === 0) return res.status(400).json({ error: 'No cookie found in import content' });

        const currentPool = await readCookies();
        const existingKeySet = new Set(
            currentPool.map((item) => `${item.netflixId}|${item.secureNetflixId || ''}`)
        );

        const now = new Date().toISOString();
        const added = [];
        let skipped = 0;
        let invalid = 0;

        for (let i = 0; i < blocks.length; i += 1) {
            const block = blocks[i];
            const ids = extractNetflixIdsFromCookie(block);
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
                cookieRaw: block,
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

        const ok = await writeDelta({
            source: 'nf-cookies-import',
            upsertCookies: added
        });
        if (!ok) return res.status(500).json({ error: 'Failed to import cookies' });
        deleteCache('cookies:list');

        return res.status(200).json({
            success: true,
            addedCount: added.length,
            skippedCount: skipped,
            invalidCount: invalid
        });
    } catch (e) {
        return res.status(500).json(buildApiErrorPayload(e, 'Internal server error'));
    }
};

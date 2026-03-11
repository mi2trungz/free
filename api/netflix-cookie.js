const fs = require('fs');
const path = require('path');

const NETFLIX_COOKIE_STORE = path.join('/tmp', 'trada-netflix-cookie.json');

function readStoredNetflixCookie() {
    try {
        if (!fs.existsSync(NETFLIX_COOKIE_STORE)) return null;
        const raw = fs.readFileSync(NETFLIX_COOKIE_STORE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.netflixId) return null;
        return {
            netflixId: parsed.netflixId,
            secureNetflixId: parsed.secureNetflixId || ''
        };
    } catch (e) {
        return null;
    }
}

function writeStoredNetflixCookie(netflixId, secureNetflixId) {
    if (!netflixId) return false;
    try {
        fs.writeFileSync(
            NETFLIX_COOKIE_STORE,
            JSON.stringify(
                {
                    netflixId,
                    secureNetflixId: secureNetflixId || '',
                    updatedAt: new Date().toISOString()
                },
                null,
                2
            ),
            'utf-8'
        );
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = function (req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method === 'GET') {
        const saved = readStoredNetflixCookie();
        return res.status(200).json({ hasCookie: !!(saved && saved.netflixId) });
    }

    if (req.method === 'POST') {
        const { netflixId, secureNetflixId } = req.body || {};
        if (!netflixId) {
            return res.status(400).json({ error: 'Missing NetflixId' });
        }
        const ok = writeStoredNetflixCookie(netflixId, secureNetflixId);
        if (!ok) {
            return res.status(500).json({ error: 'Failed to save cookie on server' });
        }
        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};

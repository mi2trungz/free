const https = require('https');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';
const FIRESTORE_DOC = 'settings/netflix_server_cookie';

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode || 0, body: data });
            });
        });

        req.on('error', reject);

        if (body) req.write(body);
        req.end();
    });
}

async function writeCookieToFirestore(netflixId, secureNetflixId) {
    const payload = JSON.stringify({
        fields: {
            netflixId: { stringValue: netflixId },
            secureNetflixId: { stringValue: secureNetflixId || '' },
            updatedAt: { timestampValue: new Date().toISOString() }
        }
    });

    const path = `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_DOC}?key=${FIREBASE_API_KEY}`;
    const response = await httpRequest(
        {
            hostname: 'firestore.googleapis.com',
            port: 443,
            path,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        },
        payload
    );

    return response.statusCode >= 200 && response.statusCode < 300;
}

async function readCookieFromFirestore() {
    const path = `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_DOC}?key=${FIREBASE_API_KEY}`;
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path,
        method: 'GET'
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
    }

    try {
        const parsed = JSON.parse(response.body || '{}');
        const fields = parsed.fields || {};
        const netflixId = fields.netflixId && fields.netflixId.stringValue ? fields.netflixId.stringValue : '';
        const secureNetflixId = fields.secureNetflixId && fields.secureNetflixId.stringValue ? fields.secureNetflixId.stringValue : '';
        if (!netflixId) return null;
        return { netflixId, secureNetflixId };
    } catch (e) {
        return null;
    }
}

module.exports = async function (req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'GET') {
            const saved = await readCookieFromFirestore();
            return res.status(200).json({ hasCookie: !!(saved && saved.netflixId) });
        }

        if (req.method === 'POST') {
            const { netflixId, secureNetflixId } = req.body || {};
            if (!netflixId) {
                return res.status(400).json({ error: 'Missing NetflixId' });
            }

            const ok = await writeCookieToFirestore(netflixId, secureNetflixId);
            if (!ok) {
                return res.status(500).json({ error: 'Failed to save cookie on server store' });
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal error' });
    }
};

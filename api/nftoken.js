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
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const saved = await readCookieFromFirestore();
        if (!saved || !saved.netflixId) {
            return res.status(400).json({ error: 'Du lieu khong co cookie NetflixId tren server. Admin phai luu cookie truoc.' });
        }

        const netflixId = saved.netflixId;
        const secureNetflixId = saved.secureNetflixId || '';

        // Build cookie string for upstream Netflix request
        let cookieStr = `NetflixId=${netflixId};`;
        if (secureNetflixId) {
            cookieStr += ` SecureNetflixId=${secureNetflixId};`;
        }

        const payload = JSON.stringify({
            operationName: 'CreateAutoLoginToken',
            variables: {
                scope: 'WEBVIEW_MOBILE_STREAMING'
            },
            extensions: {
                persistedQuery: {
                    version: 102,
                    id: '76e97129-f4b5-41a0-a73c-12e674896849'
                }
            }
        });

        const options = {
            hostname: 'android13.prod.ftl.netflix.com',
            port: 443,
            path: '/graphql',
            method: 'POST',
            headers: {
                'User-Agent': 'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Cookie: cookieStr,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const netflixReq = https.request(options, (netflixRes) => {
            let responseData = '';

            netflixRes.on('data', (d) => {
                responseData += d;
            });

            netflixRes.on('end', () => {
                try {
                    const jsonBase = JSON.parse(responseData);
                    if (jsonBase.errors) {
                        return res.status(400).json({ error: jsonBase.errors[0]?.message || 'Loi tra ve tu server Netflix' });
                    }

                    const token = jsonBase.data?.createAutoLoginToken;
                    if (token) {
                        return res.status(200).json({ nftoken: token });
                    }

                    return res.status(500).json({ error: 'Khong tim thay token. Co the cookie da het han hoac bi doi mat khau.' });
                } catch (e) {
                    return res.status(500).json({ error: 'Khong the phan tich du lieu tra ve tu Netflix' });
                }
            });
        });

        netflixReq.on('error', (e) => {
            return res.status(500).json({ error: `Loi ket noi may chu: ${e.message}` });
        });

        netflixReq.write(payload);
        netflixReq.end();
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

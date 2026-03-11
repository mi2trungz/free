const https = require('https');
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

    let netflixId = '';
    let secureNetflixId = '';
    const saved = readStoredNetflixCookie();
    if (saved && saved.netflixId) {
        netflixId = saved.netflixId;
        secureNetflixId = saved.secureNetflixId || '';
    }

    if (!netflixId) {
        return res.status(400).json({ error: 'Du lieu khong co cookie NetflixId tren server. Admin phai luu cookie truoc.' });
    }

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
};

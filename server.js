const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const nfCustomersHandler = require('./api/nf-customers');
const nfCookiesHandler = require('./api/nf-cookies');
const nfCookiesImportHandler = require('./api/nf-cookies/import');
const nfCustomerLookupHandler = require('./api/nf-customer-lookup');
const nfGenerateLinkHandler = require('./api/nf-generate-link');

const PORT = 3005;
const DATA_DIR = path.join(__dirname, 'data');
const NETFLIX_COOKIE_STORE = path.join(DATA_DIR, 'netflix-cookie.json');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

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
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
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

function invokeServerlessApi(handler, req, res) {
    let body = '';
    req.on('data', (chunk) => {
        body += chunk.toString();
    });
    req.on('end', async () => {
        const reqLike = {
            method: req.method,
            headers: req.headers,
            body
        };

        const resLike = {
            _statusCode: 200,
            _ended: false,
            setHeader(name, value) {
                res.setHeader(name, value);
            },
            status(code) {
                this._statusCode = code;
                return this;
            },
            json(payload) {
                if (this._ended) return;
                this._ended = true;
                res.writeHead(this._statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
            },
            end(payload = '') {
                if (this._ended) return;
                this._ended = true;
                res.writeHead(this._statusCode);
                res.end(payload);
            }
        };

        try {
            await handler(reqLike, resLike);
            if (!resLike._ended) {
                resLike.end();
            }
        } catch (e) {
            if (!resLike._ended) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message || 'Internal server error' }));
            }
        }
    });
}

const server = http.createServer((req, res) => {
    // Enable CORS for local development just in case
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const requestPath = String(req.url || '/').split('?')[0];

    if (requestPath === '/api/nf-cookies/import') {
        return invokeServerlessApi(nfCookiesImportHandler, req, res);
    }
    if (requestPath === '/api/nf-cookies') {
        return invokeServerlessApi(nfCookiesHandler, req, res);
    }
    if (requestPath === '/api/nf-customers') {
        return invokeServerlessApi(nfCustomersHandler, req, res);
    }
    if (requestPath === '/api/nf-customer-lookup') {
        return invokeServerlessApi(nfCustomerLookupHandler, req, res);
    }
    if (requestPath === '/api/nf-generate-link') {
        return invokeServerlessApi(nfGenerateLinkHandler, req, res);
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === 'GET' && req.url === '/api/netflix-cookie') {
        const saved = readStoredNetflixCookie();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ hasCookie: !!(saved && saved.netflixId) }));
    }

    if (req.method === 'POST' && req.url === '/api/netflix-cookie') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const { netflixId, secureNetflixId } = data;
                if (!netflixId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing NetflixId' }));
                }
                const ok = writeStoredNetflixCookie(netflixId, secureNetflixId);
                if (!ok) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Failed to save cookie on server' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Bad Request JSON' }));
            }
        });
        return;
    }

    // API Endpoint
    if (req.method === 'POST' && req.url === '/api/nftoken') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                JSON.parse(body || '{}');
                let netflixId = '';
                let secureNetflixId = '';
                const saved = readStoredNetflixCookie();
                if (saved && saved.netflixId) {
                    netflixId = saved.netflixId;
                    secureNetflixId = saved.secureNetflixId || '';
                }

                if (!netflixId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing NetflixId on server. Admin must save cookie first.' }));
                }

                // Construct Cookie String
                let cookieStr = `NetflixId=${netflixId};`;
                if (secureNetflixId) {
                    cookieStr += ` SecureNetflixId=${secureNetflixId};`;
                }

                const payload = JSON.stringify({
                    "operationName": "CreateAutoLoginToken",
                    "variables": {
                        "scope": "WEBVIEW_MOBILE_STREAMING",
                    },
                    "extensions": {
                        "persistedQuery": {
                            "version": 102,
                            "id": "76e97129-f4b5-41a0-a73c-12e674896849",
                        }
                    },
                });

                const options = {
                    hostname: 'android13.prod.ftl.netflix.com',
                    port: 443,
                    path: '/graphql',
                    method: 'POST',
                    headers: {
                        'User-Agent': 'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Cookie': cookieStr,
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
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                return res.end(JSON.stringify({ error: jsonBase.errors[0]?.message || 'API Error from Netflix' }));
                            }

                            const token = jsonBase.data?.createAutoLoginToken;
                            if (token) {
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ nftoken: token }));
                            } else {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'Token not found in response. Your cookie might be expired.' }));
                            }
                        } catch (e) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Failed to parse Netflix response' }));
                        }
                    });
                });

                netflixReq.on('error', (e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Internal Server Error: ${e.message}` }));
                });

                netflixReq.write(payload);
                netflixReq.end();

            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Request JSON' }));
            }
        });
        return;
    }

    // Serve Static Files
    const rawUrl = requestPath;
    let relativePath = rawUrl.replace(/^\/+/, '');
    if (!relativePath) relativePath = 'index.html';
    if (relativePath === 'nf') relativePath = path.join('nf', 'index.html');
    if (relativePath === 'banggia') relativePath = path.join('banggia', 'index.html');

    let filePath = path.join(__dirname, relativePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });

});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`To use the tool, open this link in your browser!`);
});

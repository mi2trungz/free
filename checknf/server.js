const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3005;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    // Enable CORS for local development just in case
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // API Endpoint
    if (req.method === 'POST' && req.url === '/api/nftoken') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { netflixId, secureNetflixId } = data;

                if (!netflixId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing NetflixId' }));
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
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
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

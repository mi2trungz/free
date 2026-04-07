const http = require('http');
const fs = require('fs');
const path = require('path');
const nfCustomersHandler = require('./api/nf-customers');
const nfCookiesHandler = require('./api/nf-cookies');
const nfCookiesImportHandler = require('./api/nf-cookies/import');
const nfCookiesCheckHandler = require('./api/nf-cookies/check');
const nfCustomerLookupHandler = require('./api/nf-customer-lookup');
const nfGenerateLinkHandler = require('./api/nf-generate-link');
const nfSupportOverloadCheckHandler = require('./api/nf-support-overload-check');
const nfCookieToLinkHandler = require('./api/nf-cookie-to-link');
const nfLanguageChangeTestHandler = require('./api/nf-language-change-test');
const nfTvActivateHandler = require('./api/nf-tv-activate');
const nftokenHandler = require('./api/nftoken');
const getlinkSharesHandler = require('./api/getlink-shares');
const getlinkAdminHandler = require('./api/getlink-admin');
const stuProxyHandler = require('./api/stu-proxy');

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
            body,
            url: req.url
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
    if (requestPath === '/api/nf-cookies/check') {
        return invokeServerlessApi(nfCookiesCheckHandler, req, res);
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
    if (requestPath === '/api/nf-support-overload-check') {
        return invokeServerlessApi(nfSupportOverloadCheckHandler, req, res);
    }
    if (requestPath === '/api/nf-cookie-to-link') {
        return invokeServerlessApi(nfCookieToLinkHandler, req, res);
    }
    if (requestPath === '/api/nf-language-change-test') {
        return invokeServerlessApi(nfLanguageChangeTestHandler, req, res);
    }
    if (requestPath === '/api/nf-tv-activate') {
        return invokeServerlessApi(nfTvActivateHandler, req, res);
    }
    if (requestPath === '/api/nftoken') {
        return invokeServerlessApi(nftokenHandler, req, res);
    }
    if (requestPath === '/api/getlink-shares' || requestPath.startsWith('/api/getlink-shares/')) {
        return invokeServerlessApi(getlinkSharesHandler, req, res);
    }
    if (requestPath.startsWith('/api/getlink-admin')) {
        return invokeServerlessApi(getlinkAdminHandler, req, res);
    }
    if (
        requestPath === '/api/queue/join'
        || requestPath === '/api/queue/heartbeat'
        || requestPath.startsWith('/ads/')
        || requestPath.startsWith('/serve/')
    ) {
        return invokeServerlessApi(stuProxyHandler, req, res);
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
    const normalizedFilePath = filePath.replace(/\\/g, '/').toLowerCase();
    const isNfIndex = normalizedFilePath.endsWith('/nf/index.html');
    const isNfAsset = normalizedFilePath.endsWith('/nf/app.js')
        || normalizedFilePath.endsWith('/nf/styles.css');

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
            const headers = { 'Content-Type': contentType };
            if (isNfIndex) {
                headers['Cache-Control'] = 'no-cache, max-age=0, must-revalidate';
            } else if (isNfAsset) {
                headers['Cache-Control'] = 'public, max-age=31536000, immutable';
            }
            res.writeHead(200, headers);
            res.end(content, 'utf-8');
        }
    });

});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`To use the tool, open this link in your browser!`);
});

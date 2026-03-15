const http = require('http');
const fs = require('fs');
const path = require('path');
const nfCustomersHandler = require('./api/nf-customers');
const nfCookiesHandler = require('./api/nf-cookies');
const nfCookiesImportHandler = require('./api/nf-cookies/import');
const nfCookiesCheckHandler = require('./api/nf-cookies/check');
const nfCustomerLookupHandler = require('./api/nf-customer-lookup');
const nfGenerateLinkHandler = require('./api/nf-generate-link');
const nfCookieToLinkHandler = require('./api/nf-cookie-to-link');
const nfTvActivateHandler = require('./api/nf-tv-activate');
const nftokenHandler = require('./api/nftoken');
const {
    issueAdminSession,
    getSessionUserFromHeaders,
    setAdminSessionCookie,
    clearAdminSessionCookie,
    applyCors,
    applySecurityHeaders,
    checkRateLimit,
    verifyAdminCredentials,
    adminAuthConfig
} = require('./api/_security');

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
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let body = '';
    req.on('data', (chunk) => {
        body += chunk.toString();
    });
    req.on('end', async () => {
        const reqLike = {
            method: req.method,
            headers: req.headers,
            body,
            url: parsedUrl.pathname,
            query: Object.fromEntries(parsedUrl.searchParams.entries()),
            sessionUser: getSessionUserFromHeaders(req.headers)
        };

        const resLike = {
            _statusCode: 200,
            _ended: false,
            setHeader(name, value) {
                const key = String(name || '').toLowerCase();
                if (key.startsWith('access-control-allow-')) return;
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
    applySecurityHeaders(res);
    applyCors(req, res);

    const requestPath = String(req.url || '/').split('?')[0];
    const sessionUser = getSessionUserFromHeaders(req.headers);
    const isAdmin = !!sessionUser;
    const ip =
        String(req.headers['x-forwarded-for'] || '')
            .split(',')[0]
            .trim() ||
        req.socket.remoteAddress ||
        'unknown';

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (requestPath === '/api/admin/session' && req.method === 'GET') {
        const cfg = adminAuthConfig();
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            authenticated: isAdmin,
            user: isAdmin ? { email: sessionUser.email, role: sessionUser.role } : null,
            configured: cfg.hasSessionSecret && cfg.hasAdminPassword
        }));
    }

    if (requestPath === '/api/admin/login' && req.method === 'POST') {
        const cfg = adminAuthConfig();
        if (!cfg.hasSessionSecret || !cfg.hasAdminPassword) {
            return res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                error: 'Admin auth chua duoc cau hinh tren server (ADMIN_SESSION_SECRET, ADMIN_PASSWORD).'
            }));
        }
        const rate = checkRateLimit(`admin-login:${ip}`, 10, 60 * 1000);
        if (!rate.allowed) {
            res.setHeader('Retry-After', String(Math.ceil((rate.retryAfterMs || 1000) / 1000)));
            return res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Too many login attempts' }));
        }

        let bodyRaw = '';
        req.on('data', (chunk) => { bodyRaw += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(bodyRaw || '{}');
                const email = String(parsed.email || '').trim().toLowerCase();
                const password = String(parsed.password || '');
                if (!verifyAdminCredentials(email, password)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Email hoặc mật khẩu không hợp lệ.' }));
                }
                const token = issueAdminSession(email);
                if (!token) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Admin auth chưa cấu hình xong ở server.' }));
                }
                setAdminSessionCookie(res, token);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, user: { email, role: 'admin' } }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Bad request JSON' }));
            }
        });
        return;
    }

    if (requestPath === '/api/admin/logout' && req.method === 'POST') {
        clearAdminSessionCookie(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
    }

    const adminOnlyApiRoutes = new Set([
        '/api/nf-cookies/import',
        '/api/nf-cookies/check',
        '/api/nf-cookies',
        '/api/nf-customers',
        '/api/nf-cookie-to-link',
        '/api/nftoken',
        '/api/netflix-cookie'
    ]);

    if (adminOnlyApiRoutes.has(requestPath) && !isAdmin) {
        return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }));
    }

    const sensitiveRoutes = new Set(['/api/nf-cookie-to-link', '/api/nf-generate-link', '/api/nf-cookies/check', '/api/nftoken']);
    if (sensitiveRoutes.has(requestPath)) {
        const limiterScope = isAdmin ? `sid:${sessionUser.email}` : `ip:${ip}`;
        const rate = checkRateLimit(`${requestPath}:${limiterScope}`, isAdmin ? 90 : 45, 60 * 1000);
        if (!rate.allowed) {
            res.setHeader('Retry-After', String(Math.ceil((rate.retryAfterMs || 1000) / 1000)));
            return res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Too many requests' }));
        }
    }

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
    if (requestPath === '/api/nf-cookie-to-link') {
        return invokeServerlessApi(nfCookieToLinkHandler, req, res);
    }
    if (requestPath === '/api/nf-tv-activate') {
        return invokeServerlessApi(nfTvActivateHandler, req, res);
    }
    if (requestPath === '/api/nftoken') {
        return invokeServerlessApi(nftokenHandler, req, res);
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
    if (rawUrl.startsWith('/checknf')) {
        if (!isAdmin && String(process.env.ALLOW_PUBLIC_CHECKNF || 'false').toLowerCase() !== 'true') {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Forbidden', 'utf-8');
        }
    }
    if (rawUrl === '/nf/nf-cookie-to-link.html' && !isAdmin) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden', 'utf-8');
    }

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

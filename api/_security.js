const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'nf_admin_session';
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || '').trim();
const ADMIN_EMAILS = String(process.env.NF_ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'cungbocap306@gmail.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => !!item);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const CORS_ALLOWED_ORIGINS = String(
    process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3005,http://127.0.0.1:3005'
)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => !!item);

const rateBuckets = new Map();

function base64UrlEncode(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function hashHmac(input) {
    if (!SESSION_SECRET) return '';
    return crypto.createHmac('sha256', SESSION_SECRET).update(input).digest('base64url');
}

function parseCookies(cookieHeader = '') {
    const out = {};
    String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => !!part)
        .forEach((part) => {
            const eq = part.indexOf('=');
            if (eq <= 0) return;
            const name = part.slice(0, eq).trim();
            const value = part.slice(eq + 1).trim();
            if (!name) return;
            out[name] = value;
        });
    return out;
}

function issueAdminSession(email) {
    const now = Date.now();
    const payload = {
        sub: String(email || '').trim().toLowerCase(),
        role: 'admin',
        iat: now,
        exp: now + SESSION_TTL_MS,
        sid: crypto.randomBytes(16).toString('hex')
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = hashHmac(encodedPayload);
    if (!signature) return '';
    return `${encodedPayload}.${signature}`;
}

function verifyAdminSession(token = '') {
    const raw = String(token || '').trim();
    if (!raw || !SESSION_SECRET) return null;
    const parts = raw.split('.');
    if (parts.length !== 2) return null;

    const payloadEncoded = parts[0];
    const signature = parts[1];
    const expected = hashHmac(payloadEncoded);
    if (!expected || signature !== expected) return null;

    let payload = null;
    try {
        payload = JSON.parse(base64UrlDecode(payloadEncoded));
    } catch (e) {
        return null;
    }

    if (!payload || payload.role !== 'admin') return null;
    if (!payload.sub || !ADMIN_EMAILS.includes(String(payload.sub).toLowerCase())) return null;
    if (!payload.exp || Date.now() > Number(payload.exp)) return null;
    return {
        email: String(payload.sub).toLowerCase(),
        role: 'admin',
        exp: Number(payload.exp)
    };
}

function getSessionUserFromHeaders(headers = {}) {
    const cookies = parseCookies(headers.cookie || headers.Cookie || '');
    const rawToken = String(cookies[SESSION_COOKIE_NAME] || '').trim();
    let decoded = rawToken;
    try {
        decoded = decodeURIComponent(rawToken);
    } catch (e) {
        decoded = rawToken;
    }
    return verifyAdminSession(decoded);
}

function serializeCookie(name, value, options = {}) {
    const segments = [`${name}=${value}`];
    if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
    if (options.httpOnly !== false) segments.push('HttpOnly');
    if (options.secure !== false) segments.push('Secure');
    segments.push(`SameSite=${options.sameSite || 'Lax'}`);
    segments.push(`Path=${options.path || '/'}`);
    return segments.join('; ');
}

function setAdminSessionCookie(res, token) {
    const isSecure = String(process.env.SESSION_COOKIE_SECURE || 'false').toLowerCase() === 'true';
    const cookie = serializeCookie(SESSION_COOKIE_NAME, encodeURIComponent(token), {
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
        httpOnly: true,
        secure: isSecure,
        sameSite: 'Lax',
        path: '/'
    });
    res.setHeader('Set-Cookie', cookie);
}

function clearAdminSessionCookie(res) {
    const isSecure = String(process.env.SESSION_COOKIE_SECURE || 'false').toLowerCase() === 'true';
    const cookie = serializeCookie(SESSION_COOKIE_NAME, '', {
        maxAge: 0,
        httpOnly: true,
        secure: isSecure,
        sameSite: 'Lax',
        path: '/'
    });
    res.setHeader('Set-Cookie', cookie);
}

function isAllowedOrigin(origin = '') {
    const needle = String(origin || '').trim();
    if (!needle) return false;
    return CORS_ALLOWED_ORIGINS.includes(needle);
}

function applyCors(req, res, methods = 'GET,POST,PUT,DELETE,OPTIONS') {
    const origin = String((req.headers && req.headers.origin) || '').trim();
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
}

function applySecurityHeaders(res) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
}

function checkRateLimit(key, limit, windowMs) {
    const now = Date.now();
    const bucketKey = String(key || '').trim();
    if (!bucketKey || !limit || !windowMs) return { allowed: true };

    const row = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
    if (now > row.resetAt) {
        row.count = 0;
        row.resetAt = now + windowMs;
    }
    row.count += 1;
    rateBuckets.set(bucketKey, row);

    if (row.count <= limit) return { allowed: true };
    return {
        allowed: false,
        retryAfterMs: Math.max(0, row.resetAt - now)
    };
}

function verifyAdminCredentials(email = '', password = '') {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!ADMIN_EMAILS.includes(normalizedEmail)) return false;
    if (!ADMIN_PASSWORD) return false;
    return normalizedPassword === ADMIN_PASSWORD;
}

function adminAuthConfig() {
    return {
        hasSessionSecret: !!SESSION_SECRET,
        hasAdminPassword: !!ADMIN_PASSWORD,
        adminEmails: ADMIN_EMAILS.slice()
    };
}

module.exports = {
    SESSION_COOKIE_NAME,
    issueAdminSession,
    getSessionUserFromHeaders,
    setAdminSessionCookie,
    clearAdminSessionCookie,
    applyCors,
    applySecurityHeaders,
    checkRateLimit,
    verifyAdminCredentials,
    adminAuthConfig
};

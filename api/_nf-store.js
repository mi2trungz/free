const https = require('https');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';

const DOC_CUSTOMERS = 'settings/nf_customers';
const DOC_COOKIE_POOL = 'settings/nf_cookie_pool';
const DOC_META = 'settings/nf_meta';

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function parseBody(rawBody) {
    if (!rawBody) return {};
    if (typeof rawBody === 'object') return rawBody;
    if (typeof rawBody === 'string') {
        try { return JSON.parse(rawBody); } catch (e) { return {}; }
    }
    return {};
}

function firestorePath(docPath) {
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
}

async function readDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestorePath(docPath),
        method: 'GET'
    });
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    try { return JSON.parse(response.body || '{}'); } catch (e) { return null; }
}

async function patchDoc(docPath, fields) {
    const payload = JSON.stringify({ fields });
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestorePath(docPath),
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);
    return response.statusCode >= 200 && response.statusCode < 300;
}

function toStringValue(v) {
    return { stringValue: String(v || '') };
}

function toTimestampValue(v) {
    return { timestampValue: v || new Date().toISOString() };
}

function toIntegerValue(v) {
    return { integerValue: String(Number(v || 0)) };
}

function toArrayValue(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { arrayValue: {} };
    }
    return { arrayValue: { values } };
}

function safeString(v, fallback = '') {
    return typeof v === 'string' ? v : fallback;
}

function makeCookieId() {
    return `nf_ck_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeCustomerStatus(status) {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'inactive' ? 'inactive' : 'active';
}

function sanitizeCookieStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'disabled' || normalized === 'dead') return normalized;
    return 'active';
}

function sanitizeCustomer(item) {
    const now = new Date().toISOString();
    return {
        code: String(item.code || '').trim().toUpperCase(),
        name: String(item.name || '').trim(),
        warrantyExpiresAt: item.warrantyExpiresAt || '',
        status: sanitizeCustomerStatus(item.status),
        assignedCookieId: String(item.assignedCookieId || '').trim(),
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || now,
        lastLinkedAt: item.lastLinkedAt || ''
    };
}

function sanitizeCookie(item) {
    const now = new Date().toISOString();
    return {
        id: String(item.id || makeCookieId()),
        netflixId: String(item.netflixId || '').trim(),
        secureNetflixId: String(item.secureNetflixId || '').trim(),
        status: sanitizeCookieStatus(item.status),
        assignedCustomerCode: String(item.assignedCustomerCode || '').trim().toUpperCase(),
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || now,
        lastCheckedAt: item.lastCheckedAt || '',
        lastSuccessAt: item.lastSuccessAt || '',
        lastErrorAt: item.lastErrorAt || '',
        lastError: String(item.lastError || '')
    };
}

function buildCustomerMapValue(customer) {
    return {
        mapValue: {
            fields: {
                code: toStringValue(customer.code),
                name: toStringValue(customer.name),
                warrantyExpiresAt: toStringValue(customer.warrantyExpiresAt || ''),
                status: toStringValue(customer.status),
                assignedCookieId: toStringValue(customer.assignedCookieId || ''),
                createdAt: toTimestampValue(customer.createdAt),
                updatedAt: toTimestampValue(customer.updatedAt),
                lastLinkedAt: toStringValue(customer.lastLinkedAt || '')
            }
        }
    };
}

function buildCookieMapValue(cookie) {
    return {
        mapValue: {
            fields: {
                id: toStringValue(cookie.id),
                netflixId: toStringValue(cookie.netflixId),
                secureNetflixId: toStringValue(cookie.secureNetflixId || ''),
                status: toStringValue(cookie.status),
                assignedCustomerCode: toStringValue(cookie.assignedCustomerCode || ''),
                createdAt: toTimestampValue(cookie.createdAt),
                updatedAt: toTimestampValue(cookie.updatedAt),
                lastCheckedAt: toStringValue(cookie.lastCheckedAt || ''),
                lastSuccessAt: toStringValue(cookie.lastSuccessAt || ''),
                lastErrorAt: toStringValue(cookie.lastErrorAt || ''),
                lastError: toStringValue(cookie.lastError || '')
            }
        }
    };
}

function parseCustomerMapValue(value) {
    const fields = (((value || {}).mapValue || {}).fields) || {};
    return sanitizeCustomer({
        code: fields.code && fields.code.stringValue,
        name: fields.name && fields.name.stringValue,
        warrantyExpiresAt: fields.warrantyExpiresAt && fields.warrantyExpiresAt.stringValue,
        status: fields.status && fields.status.stringValue,
        assignedCookieId: fields.assignedCookieId && fields.assignedCookieId.stringValue,
        createdAt: fields.createdAt && (fields.createdAt.timestampValue || fields.createdAt.stringValue),
        updatedAt: fields.updatedAt && (fields.updatedAt.timestampValue || fields.updatedAt.stringValue),
        lastLinkedAt: fields.lastLinkedAt && fields.lastLinkedAt.stringValue
    });
}

function parseCookieMapValue(value) {
    const fields = (((value || {}).mapValue || {}).fields) || {};
    return sanitizeCookie({
        id: fields.id && fields.id.stringValue,
        netflixId: fields.netflixId && fields.netflixId.stringValue,
        secureNetflixId: fields.secureNetflixId && fields.secureNetflixId.stringValue,
        status: fields.status && fields.status.stringValue,
        assignedCustomerCode: fields.assignedCustomerCode && fields.assignedCustomerCode.stringValue,
        createdAt: fields.createdAt && (fields.createdAt.timestampValue || fields.createdAt.stringValue),
        updatedAt: fields.updatedAt && (fields.updatedAt.timestampValue || fields.updatedAt.stringValue),
        lastCheckedAt: fields.lastCheckedAt && fields.lastCheckedAt.stringValue,
        lastSuccessAt: fields.lastSuccessAt && fields.lastSuccessAt.stringValue,
        lastErrorAt: fields.lastErrorAt && fields.lastErrorAt.stringValue,
        lastError: fields.lastError && fields.lastError.stringValue
    });
}

function parseCustomersFromDoc(doc) {
    const fields = (doc && doc.fields) || {};
    const values = (((fields.customers || {}).arrayValue || {}).values) || [];
    return values.map(parseCustomerMapValue).filter((item) => !!item.code);
}

function parseCookiesFromDoc(doc) {
    const fields = (doc && doc.fields) || {};
    const values = (((fields.cookies || {}).arrayValue || {}).values) || [];
    return values.map(parseCookieMapValue).filter((item) => !!item.netflixId);
}

function buildCookieSummary(cookies = []) {
    const total = cookies.length;
    const activeCount = cookies.filter((c) => c.status === 'active').length;
    const disabledCount = cookies.filter((c) => c.status === 'disabled').length;
    const deadCount = cookies.filter((c) => c.status === 'dead').length;
    const assignedCount = cookies.filter((c) => !!c.assignedCustomerCode).length;
    return { total, activeCount, disabledCount, deadCount, assignedCount };
}

async function readCustomers() {
    const doc = await readDoc(DOC_CUSTOMERS);
    return parseCustomersFromDoc(doc);
}

async function readCookies() {
    const doc = await readDoc(DOC_COOKIE_POOL);
    return parseCookiesFromDoc(doc);
}

async function persistCustomers(customers = []) {
    const normalized = customers
        .map(sanitizeCustomer)
        .filter((item) => !!item.code && !!item.name);
    return patchDoc(DOC_CUSTOMERS, {
        customers: toArrayValue(normalized.map(buildCustomerMapValue)),
        updatedAt: toTimestampValue(new Date().toISOString()),
        totalCount: toIntegerValue(normalized.length)
    });
}

async function persistCookies(cookies = []) {
    const normalized = cookies
        .map(sanitizeCookie)
        .filter((item) => !!item.netflixId);
    const summary = buildCookieSummary(normalized);
    return patchDoc(DOC_COOKIE_POOL, {
        cookies: toArrayValue(normalized.map(buildCookieMapValue)),
        updatedAt: toTimestampValue(new Date().toISOString()),
        totalCount: toIntegerValue(summary.total),
        activeCount: toIntegerValue(summary.activeCount),
        assignedCount: toIntegerValue(summary.assignedCount)
    });
}

async function persistMeta(payload = {}) {
    const now = new Date().toISOString();
    return patchDoc(DOC_META, {
        lastUpdatedAt: toTimestampValue(now),
        note: toStringValue(safeString(payload.note || 'NF module update')),
        source: toStringValue(safeString(payload.source || 'api')),
        totalCustomers: toIntegerValue(payload.totalCustomers || 0),
        totalCookies: toIntegerValue(payload.totalCookies || 0)
    });
}

async function persistAll(customers = [], cookies = [], source = 'api') {
    const [okCustomers, okCookies] = await Promise.all([
        persistCustomers(customers),
        persistCookies(cookies)
    ]);
    await persistMeta({
        source,
        totalCustomers: customers.length,
        totalCookies: cookies.length
    });
    return okCustomers && okCookies;
}

function makeCustomerCode(existingCodes = []) {
    const set = new Set(existingCodes.map((code) => String(code || '').toUpperCase()));
    let code = '';
    do {
        code = `NF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    } while (set.has(code));
    return code;
}

function findCustomerByCode(customers = [], code = '') {
    const target = String(code || '').trim().toUpperCase();
    if (!target) return null;
    return customers.find((item) => String(item.code || '').toUpperCase() === target) || null;
}

function findCustomerIndexByCode(customers = [], code = '') {
    const target = String(code || '').trim().toUpperCase();
    if (!target) return -1;
    return customers.findIndex((item) => String(item.code || '').toUpperCase() === target);
}

function maskNetflixId(netflixId = '') {
    const val = String(netflixId || '').trim();
    if (!val) return 'N/A';
    if (val.length <= 6) return `${val.slice(0, 2)}***`;
    return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

function toMillis(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}

function isCustomerWarrantyValid(customer) {
    const expiresAt = toMillis(customer && customer.warrantyExpiresAt);
    if (!expiresAt) return false;
    return expiresAt >= Date.now();
}

function buildWarrantyInfo(customer) {
    const expiresAt = toMillis(customer && customer.warrantyExpiresAt);
    if (!expiresAt) {
        return {
            warrantyValid: false,
            remainingDays: 0
        };
    }
    const diff = expiresAt - Date.now();
    return {
        warrantyValid: diff >= 0,
        remainingDays: diff <= 0 ? 0 : Math.ceil(diff / (1000 * 60 * 60 * 24))
    };
}

function extractNetflixIdsFromCookie(cookieVal) {
    const raw = String(cookieVal || '').trim();
    if (!raw) return { netflixId: '', secureNetflixId: '' };

    let netflixId = '';
    let secureNetflixId = '';

    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const n = parsed.find((item) => item && item.name === 'NetflixId');
                const s = parsed.find((item) => item && item.name === 'SecureNetflixId');
                if (n && n.value) netflixId = String(n.value).trim();
                if (s && s.value) secureNetflixId = String(s.value).trim();
            }
        } catch (e) {
            // ignore
        }
    }

    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const parts = line.split('\t');
        if (parts.length >= 7) {
            const name = String(parts[5] || '').trim();
            const value = String(parts[6] || '').trim();
            if (name === 'NetflixId' && value) netflixId = value;
            if (name === 'SecureNetflixId' && value) secureNetflixId = value;
            continue;
        }
        if (line.includes('NetflixId=')) {
            const n = line.match(/NetflixId=([^;\s]+)/i);
            const s = line.match(/SecureNetflixId=([^;\s]+)/i);
            if (n && n[1]) netflixId = String(n[1]).trim();
            if (s && s[1]) secureNetflixId = String(s[1]).trim();
        }
    }

    if (!netflixId) {
        const n = raw.match(/NetflixId=([^;\s]+)/i);
        if (n && n[1]) netflixId = String(n[1]).trim();
    }
    if (!secureNetflixId) {
        const s = raw.match(/SecureNetflixId=([^;\s]+)/i);
        if (s && s[1]) secureNetflixId = String(s[1]).trim();
    }

    return { netflixId, secureNetflixId };
}

function splitImportLines(content = '') {
    return String(content || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !!line);
}

function isLikelyDeadCookie(errorText = '', statusCode = 0) {
    const msg = String(errorText || '').toLowerCase();
    if (statusCode === 401 || statusCode === 403) return true;
    return /cookie|expired|invalid|unauthor|forbidden|auth|login|sign in|session/i.test(msg);
}

function callNetflixCreateAutoLoginToken(netflixId, secureNetflixId) {
    return new Promise((resolve) => {
        let cookieStr = `NetflixId=${netflixId};`;
        if (secureNetflixId) cookieStr += ` SecureNetflixId=${secureNetflixId};`;

        const payload = JSON.stringify({
            operationName: 'CreateAutoLoginToken',
            variables: { scope: 'WEBVIEW_MOBILE_STREAMING' },
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
            netflixRes.on('data', (d) => { responseData += d; });
            netflixRes.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData || '{}');
                    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
                        const errorMessage = String(parsed.errors[0] && parsed.errors[0].message ? parsed.errors[0].message : 'API Error from Netflix');
                        return resolve({ ok: false, statusCode: 400, error: errorMessage });
                    }
                    const token = parsed && parsed.data && parsed.data.createAutoLoginToken
                        ? parsed.data.createAutoLoginToken
                        : '';
                    if (!token) {
                        return resolve({ ok: false, statusCode: 500, error: 'Token not found in Netflix response' });
                    }
                    return resolve({ ok: true, nftoken: token });
                } catch (e) {
                    return resolve({ ok: false, statusCode: 500, error: 'Failed to parse Netflix response' });
                }
            });
        });

        netflixReq.on('error', (e) => resolve({ ok: false, statusCode: 500, error: e.message || 'Network error' }));
        netflixReq.write(payload);
        netflixReq.end();
    });
}

function buildUrlByDevice(nftoken, device) {
    const token = encodeURIComponent(String(nftoken || '').trim());
    if (device === 'mobile') return `https://netflix.com/unsupported?nftoken=${token}`;
    if (device === 'tv') return `https://netflix.com/unsupported?lock=true&nftoken=${token}`;
    return `https://netflix.com/?nftoken=${token}`;
}

module.exports = {
    DOC_CUSTOMERS,
    DOC_COOKIE_POOL,
    DOC_META,
    parseBody,
    readCustomers,
    readCookies,
    persistCustomers,
    persistCookies,
    persistAll,
    sanitizeCustomer,
    sanitizeCookie,
    sanitizeCustomerStatus,
    sanitizeCookieStatus,
    makeCustomerCode,
    findCustomerByCode,
    findCustomerIndexByCode,
    maskNetflixId,
    buildCookieSummary,
    buildWarrantyInfo,
    isCustomerWarrantyValid,
    extractNetflixIdsFromCookie,
    splitImportLines,
    isLikelyDeadCookie,
    callNetflixCreateAutoLoginToken,
    buildUrlByDevice
};

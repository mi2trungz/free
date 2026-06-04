const https = require('https');
const { parseBody } = require('./_nf-store');
const { adminAuthConfig, applyCors, applySecurityHeaders } = require('./_security');
const {
    extractShareIdFromQuery,
    isValidShareId,
    readShareById,
    updateShareCookie,
    updateShareCookies,
    setShareStatus,
    rotateShareId,
    sanitizeCookieRaw,
    sanitizeShareCookies,
    setShareExpiry,
    isShareExpired
} = require('./_getlink-share-store');
const { evaluateGetlinkCookie } = require('./_getlink-cookie-health');

const FIREBASE_API_KEY = String(process.env.FIREBASE_API_KEY || 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58').trim();
const GETLINK_SHEET_APPS_SCRIPT_URL = String(process.env.GETLINK_SHEET_APPS_SCRIPT_URL || '').trim();
const GETLINK_SHEET_FETCH_LIMIT = Math.max(20, Math.min(5000, Number(process.env.GETLINK_SHEET_FETCH_LIMIT || 50) || 50));
const GETLINK_SHEET_BATCH_SIZE = Math.max(5, Math.min(200, Number(process.env.GETLINK_SHEET_BATCH_SIZE || 20) || 20));
const ALLOWED_SHEET_SLOTS = new Set(['primary', 'backup1', 'backup2']);
const MAX_APPS_SCRIPT_REDIRECTS = 5;

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: Number(res.statusCode || 0), body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function buildAppsScriptInvalidResponseError(statusCode = 0, responseBody = '', contentType = '') {
    const bodyText = String(responseBody || '').trim();
    const typeText = String(contentType || '').trim().toLowerCase();
    const isHtml = typeText.includes('text/html') || /^<!doctype html/i.test(bodyText) || /^<html/i.test(bodyText);
    let message = 'Apps Script tra ve du lieu khong hop le.';

    if (statusCode === 404) {
        message = 'Apps Script URL khong hop le hoac ban chua deploy dung Web App /exec.';
    } else if (statusCode === 401 || statusCode === 403) {
        message = 'Apps Script bi chan quyen. Hay deploy Web App voi quyen truy cap phu hop.';
    } else if (isHtml) {
        message = 'Apps Script dang tra ve HTML thay vi JSON. Hay kiem tra lai URL /exec va deploy Web App.';
    }

    const error = new Error(message);
    error.httpStatus = 502;
    return error;
}

function parseAppsScriptJsonResponse(statusCode = 0, responseBody = '', contentType = '') {
    try {
        return JSON.parse(String(responseBody || '{}'));
    } catch (error) {
        throw buildAppsScriptInvalidResponseError(statusCode, responseBody, contentType);
    }
}

function getJsonFromAbsoluteUrl(rawUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(String(rawUrl || '').trim());
        } catch (error) {
            reject(new Error('GETLINK_SHEET_APPS_SCRIPT_URL is invalid.'));
            return;
        }

        const req = https.request({
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
            method: 'GET'
        }, (res) => {
            const statusCode = Number(res.statusCode || 0);
            const location = String(res.headers.location || '').trim();
            const contentType = String(res.headers['content-type'] || '').trim();

            if (statusCode >= 300 && statusCode < 400 && location) {
                if (redirectCount >= MAX_APPS_SCRIPT_REDIRECTS) {
                    const err = new Error('Apps Script redirect qua nhieu lan.');
                    err.httpStatus = 502;
                    reject(err);
                    return;
                }

                const nextUrl = new URL(location, parsedUrl).toString();
                res.resume();
                getJsonFromAbsoluteUrl(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (statusCode < 200 || statusCode >= 300) {
                    let parsed = null;
                    try {
                        parsed = parseAppsScriptJsonResponse(statusCode, data, contentType);
                    } catch (invalidError) {
                        reject(invalidError);
                        return;
                    }

                    const err = new Error(String(parsed && parsed.error ? parsed.error : 'Apps Script request failed.').trim() || 'Apps Script request failed.');
                    err.httpStatus = 502;
                    reject(err);
                    return;
                }

                let parsed = null;
                try {
                    parsed = parseAppsScriptJsonResponse(statusCode, data, contentType);
                } catch (invalidError) {
                    reject(invalidError);
                    return;
                }

                resolve(parsed);
            });
        });
        req.on('error', (error) => {
            const err = new Error(`Khong ket noi duoc Apps Script: ${error && error.message ? error.message : 'Unknown error'}`);
            err.httpStatus = 502;
            reject(err);
        });
        req.end();
    });
}

function normalizeSheetSlots(input) {
    const source = Array.isArray(input) ? input : [];
    const seen = new Set();
    const slots = [];
    source.forEach((item) => {
        const normalized = String(item || '').trim().toLowerCase();
        if (!ALLOWED_SHEET_SLOTS.has(normalized) || seen.has(normalized)) return;
        seen.add(normalized);
        slots.push(normalized);
    });
    return slots;
}

function normalizeSheetRow(item = {}) {
    const rowNumber = Number(item && item.rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) return null;
    return {
        rowNumber,
        cookie: sanitizeCookieRaw(item && item.cookie ? item.cookie : ''),
        mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim()
    };
}

function isSheetRowEligible(mark = '') {
    const text = String(mark || '').trim();
    return !text;
}

function mapSheetFailReason(reason = '') {
    const normalized = String(reason || '').trim().toLowerCase();
    if (!normalized) return 'token_error';
    if (normalized === 'sbd_blocked') return 'sbd';
    if (normalized === 'missing_account_info') return 'missing_info';
    if (normalized === 'invalid_cookie') return 'invalid_cookie';
    if (normalized === 'dead') return 'dead';
    if (normalized === 'payment_hold') return 'payment_hold';
    if (normalized === 'unknown_plan') return 'unknown_plan';
    return 'token_error';
}

function getNextSheetUsageMark(mark = '') {
    const current = String(mark || '').trim();
    const count = /^\d+$/.test(current) ? Number(current) : 0;
    return String(count + 1);
}

async function callGetlinkSheetScript(action, payload = {}) {
    if (!GETLINK_SHEET_APPS_SCRIPT_URL) {
        const error = new Error('Chua cau hinh GETLINK_SHEET_APPS_SCRIPT_URL tren server.');
        error.httpStatus = 500;
        throw error;
    }

    const url = new URL(GETLINK_SHEET_APPS_SCRIPT_URL);
    url.searchParams.set('action', String(action || '').trim());
    Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
    });

    const response = await getJsonFromAbsoluteUrl(url.toString());
    if (response && response.success === false) {
        const error = new Error(String(response.error || response.message || 'Apps Script request failed.').trim() || 'Apps Script request failed.');
        error.httpStatus = 502;
        throw error;
    }
    return response && typeof response === 'object' ? response : {};
}

async function listGetlinkSheetRows(options = {}) {
    const startRow = Math.max(1, Number(options.startRow || 1) || 1);
    const limit = Math.max(1, Math.min(GETLINK_SHEET_FETCH_LIMIT, Number(options.limit || GETLINK_SHEET_BATCH_SIZE) || GETLINK_SHEET_BATCH_SIZE));
    const response = await callGetlinkSheetScript('pullRows', { startRow, limit });
    const rows = Array.isArray(response.items) ? response.items.map(normalizeSheetRow).filter(Boolean) : [];
    rows.sort((a, b) => a.rowNumber - b.rowNumber);
    return rows;
}

async function updateGetlinkSheetRow(rowNumber, mark) {
    const safeRowNumber = Number(rowNumber);
    if (!Number.isInteger(safeRowNumber) || safeRowNumber <= 0) {
        const error = new Error('Apps Script update rowNumber khong hop le.');
        error.httpStatus = 500;
        throw error;
    }
    await callGetlinkSheetScript('updateRow', {
        rowNumber: safeRowNumber,
        mark: String(mark || '').trim()
    });
}

async function updateGetlinkSheetRows(updates = []) {
    const normalized = Array.isArray(updates)
        ? updates
            .map((item) => ({
                rowNumber: Number(item && item.rowNumber),
                mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim()
            }))
            .filter((item) => Number.isInteger(item.rowNumber) && item.rowNumber > 0)
        : [];

    if (normalized.length === 0) return;

    await callGetlinkSheetScript('updateRows', {
        updates: JSON.stringify(normalized)
    });
}

async function allocateCookiesFromSheetForSlots(slots = []) {
    const targetSlots = normalizeSheetSlots(slots);
    if (targetSlots.length === 0) {
        const error = new Error('Vui long chon it nhat 1 slot cookie.');
        error.httpStatus = 400;
        throw error;
    }

    const assigned = [];
    const skipped = [];
    const seenCookies = new Set();
    let nextStartRow = 1;

    while (assigned.length < targetSlots.length && nextStartRow <= GETLINK_SHEET_FETCH_LIMIT) {
        const rows = await listGetlinkSheetRows({
            startRow: nextStartRow,
            limit: Math.min(GETLINK_SHEET_BATCH_SIZE, GETLINK_SHEET_FETCH_LIMIT - nextStartRow + 1)
        });
        if (rows.length === 0) break;

        const pendingUpdates = [];
        for (const row of rows) {
            if (assigned.length >= targetSlots.length) break;
            if (!row || !row.cookie || !isSheetRowEligible(row.mark)) continue;
            if (seenCookies.has(row.cookie)) continue;
            seenCookies.add(row.cookie);

            const cookieResult = await evaluateGetlinkCookie(row.cookie);
            if (!cookieResult.ok) {
                const failReason = mapSheetFailReason(cookieResult.reason || '');
                pendingUpdates.push({
                    rowNumber: row.rowNumber,
                    mark: failReason
                });
                skipped.push({
                    rowNumber: row.rowNumber,
                    reason: failReason
                });
                continue;
            }

            const slot = targetSlots[assigned.length];
            const nextMark = getNextSheetUsageMark(row.mark);
            pendingUpdates.push({
                rowNumber: row.rowNumber,
                mark: nextMark
            });
            assigned.push({
                slot,
                rowNumber: row.rowNumber,
                cookie: row.cookie,
                previousMark: String(row.mark || '').trim(),
                newMark: nextMark,
                result: {
                    slot,
                    ok: true,
                    error: '',
                    summary: cookieResult.summary || {},
                    accountInfo: cookieResult.accountInfo || null,
                    overloadOutcome: cookieResult.overloadOutcome || '',
                    overloadSignal: cookieResult.overloadSignal || '',
                    overloadMessage: cookieResult.overloadMessage || ''
                }
            });
        }

        await updateGetlinkSheetRows(pendingUpdates);
        nextStartRow = rows[rows.length - 1].rowNumber + 1;
    }

    const filledSlots = new Set(assigned.map((item) => item.slot));
    const unfilledSlots = targetSlots.filter((slot) => !filledSlots.has(slot));
    const message = `Assigned ${assigned.length} cookies, skipped ${skipped.length} failed cookies`;
    return {
        success: true,
        assigned,
        skipped,
        unfilledSlots,
        message
    };
}

function getBearerToken(headers = {}) {
    const raw = String(headers.authorization || headers.Authorization || '').trim();
    if (!raw) return '';
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return String(match && match[1] ? match[1] : '').trim();
}

async function lookupFirebaseUserByIdToken(idToken = '') {
    const token = String(idToken || '').trim();
    if (!token) return { ok: false, statusCode: 401, error: 'Missing bearer token' };
    if (!FIREBASE_API_KEY) return { ok: false, statusCode: 500, error: 'Firebase API key is not configured' };

    const payload = JSON.stringify({ idToken: token });
    const response = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        port: 443,
        path: `/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);

    let parsed = {};
    try {
        parsed = JSON.parse(response.body || '{}');
    } catch (e) {
        return { ok: false, statusCode: 502, error: 'Firebase verify response parse failed' };
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        const firebaseMessage = String(parsed && parsed.error && parsed.error.message ? parsed.error.message : '').trim();
        return {
            ok: false,
            statusCode: 401,
            error: firebaseMessage ? `Firebase token invalid: ${firebaseMessage}` : 'Firebase token invalid'
        };
    }

    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const user = users[0] || null;
    const email = String(user && user.email ? user.email : '').trim().toLowerCase();
    if (!email) return { ok: false, statusCode: 401, error: 'Firebase token has no email' };
    return { ok: true, email };
}

function isAllowedAdminEmail(email = '') {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    const cfg = adminAuthConfig();
    const adminEmails = Array.isArray(cfg && cfg.adminEmails) ? cfg.adminEmails : [];
    if (adminEmails.length === 0) return false;
    return adminEmails.includes(normalized);
}

async function ensureAdmin(req, res) {
    const token = getBearerToken(req.headers || {});
    const lookup = await lookupFirebaseUserByIdToken(token);
    if (!lookup.ok) {
        res.status(lookup.statusCode || 401).json({ error: lookup.error || 'Admin authentication required' });
        return null;
    }
    if (!isAllowedAdminEmail(lookup.email)) {
        res.status(401).json({ error: 'Email is not allowed for /getlink admin' });
        return null;
    }
    return {
        email: lookup.email,
        role: 'admin'
    };
}

function getOrigin(req) {
    const host = String((req.headers && req.headers.host) || '').trim();
    const proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '').trim();
    return proto && host
        ? `${proto}://${host}`
        : (host ? `http://${host}` : 'http://localhost:3005');
}

function toAdminShareDto(record, req) {
    const origin = getOrigin(req);
    const cookies = sanitizeShareCookies(record.cookies || {});
    return {
        id: record.id,
        status: record.status,
        cookieRaw: cookies.primary || '',
        cookies,
        desktopOnly: !!record.desktopOnly,
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
        revokedAt: record.revokedAt || '',
        expiresAt: record.expiresAt || '',
        expired: isShareExpired(record),
        shareUrl: `${origin}/getlink?s=${encodeURIComponent(record.id)}`
    };
}

async function buildCookieCheckResult(slot, cookieRaw) {
    const result = await evaluateGetlinkCookie(cookieRaw);
    return {
        slot,
        ok: !!result.ok,
        error: String(result.error || '').trim(),
        summary: result.summary || {},
        accountInfo: result.accountInfo || null,
        overloadOutcome: result.overloadOutcome || '',
        overloadSignal: result.overloadSignal || '',
        overloadMessage: result.overloadMessage || ''
    };
}

async function resolveCookiesForCheck(shareId, body = {}) {
    const directCookie = sanitizeCookieRaw(body.cookieStr || '');
    if (directCookie) {
        return {
            cookies: sanitizeShareCookies(body.cookies || {}),
            record: null,
            usedDirectCookie: true
        };
    }

    const record = await readShareById(shareId);
    if (!record) {
        const error = new Error('Share link not found');
        error.httpStatus = 404;
        throw error;
    }

    return {
        cookies: sanitizeShareCookies((body && body.cookies) || record.cookies || {}),
        record,
        usedDirectCookie: false
    };
}

module.exports = async function (req, res) {
    applyCors(req, res, 'GET,POST,PUT,OPTIONS');
    applySecurityHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pathname = String((req.url || '').split('?')[0] || '').trim();

        if (pathname === '/api/getlink-admin/session' && req.method === 'GET') {
            const user = await ensureAdmin(req, res);
            if (!user) return;
            return res.status(200).json({ authenticated: true, user });
        }

        if (pathname === '/api/getlink-admin/login' && req.method === 'POST') {
            const body = parseBody(req.body);
            const idToken = String(body.idToken || '').trim();
            const lookup = await lookupFirebaseUserByIdToken(idToken);
            if (!lookup.ok) {
                return res.status(lookup.statusCode || 401).json({ error: lookup.error || 'Firebase verify failed' });
            }
            if (!isAllowedAdminEmail(lookup.email)) {
                return res.status(401).json({ error: 'Email is not allowed for /getlink admin' });
            }
            return res.status(200).json({ success: true, user: { email: lookup.email, role: 'admin' } });
        }

        if (pathname === '/api/getlink-admin/logout' && req.method === 'POST') {
            return res.status(200).json({ success: true });
        }

        const adminUser = await ensureAdmin(req, res);
        if (!adminUser) return;

        if (pathname === '/api/getlink-admin/sheet-cookie-import' && req.method === 'POST') {
            const body = parseBody(req.body);
            const slots = normalizeSheetSlots(body && body.slots);
            const result = await allocateCookiesFromSheetForSlots(slots);
            return res.status(200).json(result);
        }

        if (pathname === '/api/getlink-admin/search' && req.method === 'POST') {
            const body = parseBody(req.body);
            const query = String(body.query || '').trim();
            const shareId = extractShareIdFromQuery(query);
            if (!shareId) return res.status(400).json({ error: 'Invalid share id or URL' });
            const record = await readShareById(shareId);
            if (!record) return res.status(404).json({ error: 'Share link not found' });
            return res.status(200).json({ success: true, share: toAdminShareDto(record, req) });
        }

        const updateMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)$/);
        if (updateMatch && req.method === 'PUT') {
            const shareId = decodeURIComponent(updateMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const body = parseBody(req.body);
            let updated = null;
            if (body && typeof body.cookies === 'object') {
                updated = await updateShareCookies(shareId, sanitizeShareCookies(body.cookies || {}), adminUser.email);
            } else {
                const cookieStr = sanitizeCookieRaw(body.cookieStr || '');
                updated = await updateShareCookie(shareId, cookieStr, adminUser.email);
            }
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const checkCookieMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/check-cookie$/);
        if (checkCookieMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(checkCookieMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const body = parseBody(req.body);
            const slot = String(body.slot || '').trim();
            const { cookies } = await resolveCookiesForCheck(shareId, body);
            const cookieRaw = sanitizeCookieRaw(body.cookieStr || cookies[slot] || '');
            const result = await buildCookieCheckResult(slot, cookieRaw);
            return res.status(200).json({ success: true, result });
        }

        const checkAllMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/check-all$/);
        if (checkAllMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(checkAllMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const body = parseBody(req.body);
            const { cookies } = await resolveCookiesForCheck(shareId, body);
            const results = await Promise.all(['primary', 'backup1', 'backup2'].map((slot) => {
                return buildCookieCheckResult(slot, cookies[slot] || '');
            }));
            return res.status(200).json({ success: true, results });
        }

        const expiryMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/expiry$/);
        if (expiryMatch && req.method === 'PUT') {
            const shareId = decodeURIComponent(expiryMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const body = parseBody(req.body);
            const updated = await setShareExpiry(shareId, {
                expiresAt: body.expiresAt,
                addDays: body.addDays
            }, adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const revokeMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/revoke$/);
        if (revokeMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(revokeMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const updated = await setShareStatus(shareId, 'revoked', adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const restoreMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/restore$/);
        if (restoreMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(restoreMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const updated = await setShareStatus(shareId, 'active', adminUser.email);
            return res.status(200).json({ success: true, share: toAdminShareDto(updated, req) });
        }

        const rotateMatch = pathname.match(/^\/api\/getlink-admin\/shares\/([^/]+)\/rotate-id$/);
        if (rotateMatch && req.method === 'POST') {
            const shareId = decodeURIComponent(rotateMatch[1] || '');
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });
            const rotated = await rotateShareId(shareId, adminUser.email);
            return res.status(200).json({
                success: true,
                oldId: rotated.oldId,
                newId: rotated.newId,
                shareUrl: toAdminShareDto(rotated.share, req).shareUrl,
                share: toAdminShareDto(rotated.share, req)
            });
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};

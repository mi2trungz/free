const https = require('https');
const crypto = require('crypto');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';
const COLL_GETLINK_SHARES = 'settings/getlink_shares/items';
const SHARE_COOKIE_SLOTS = ['primary', 'backup1', 'backup2'];

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

function firestoreDocPath(docPath) {
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
}

function buildShareDocPath(shareId = '') {
    return `${COLL_GETLINK_SHARES}/${encodeURIComponent(String(shareId || '').trim())}`;
}

function toStringValue(value = '') {
    return { stringValue: String(value || '') };
}

function sanitizeShareStatus(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'revoked') return 'revoked';
    return 'active';
}

function parseFirestoreString(valueObj = null) {
    if (!valueObj || typeof valueObj !== 'object') return '';
    if (typeof valueObj.stringValue === 'string') return valueObj.stringValue;
    return '';
}

function sanitizeCookieRaw(value = '') {
    return String(value || '').trim();
}

function sanitizeShareCookies(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    return {
        primary: sanitizeCookieRaw(raw.primary),
        backup1: sanitizeCookieRaw(raw.backup1),
        backup2: sanitizeCookieRaw(raw.backup2)
    };
}

function normalizeSlotName(slot = '') {
    const normalized = String(slot || '').trim().toLowerCase();
    if (normalized === 'primary') return 'primary';
    if (normalized === 'backup1' || normalized === 'backup_1' || normalized === 'secondary') return 'backup1';
    if (normalized === 'backup2' || normalized === 'backup_2' || normalized === 'tertiary') return 'backup2';
    return '';
}

function getCookieListFromRecord(record = {}) {
    const cookies = sanitizeShareCookies(record.cookies || {});
    return [
        { slot: 'primary', cookieRaw: cookies.primary },
        { slot: 'backup1', cookieRaw: cookies.backup1 },
        { slot: 'backup2', cookieRaw: cookies.backup2 }
    ];
}

function mapShareFieldsToRecord(fields = {}) {
    const legacyCookieRaw = sanitizeCookieRaw(parseFirestoreString(fields.cookieRaw));
    const cookies = sanitizeShareCookies({
        primary: parseFirestoreString(fields.cookiePrimaryRaw) || legacyCookieRaw,
        backup1: parseFirestoreString(fields.cookieBackup1Raw),
        backup2: parseFirestoreString(fields.cookieBackup2Raw)
    });
    return {
        id: parseFirestoreString(fields.id),
        cookieRaw: cookies.primary,
        cookies,
        status: sanitizeShareStatus(parseFirestoreString(fields.status)),
        createdAt: parseFirestoreString(fields.createdAt),
        updatedAt: parseFirestoreString(fields.updatedAt),
        revokedAt: parseFirestoreString(fields.revokedAt),
        expiresAt: parseFirestoreString(fields.expiresAt),
        createdBy: parseFirestoreString(fields.createdBy),
        updatedBy: parseFirestoreString(fields.updatedBy),
        rotatedFrom: parseFirestoreString(fields.rotatedFrom)
    };
}

function mapShareRecordToFields(record = {}) {
    const cookies = sanitizeShareCookies(record.cookies || {});
    return {
        id: toStringValue(record.id || ''),
        cookieRaw: toStringValue(cookies.primary || ''),
        cookiePrimaryRaw: toStringValue(cookies.primary || ''),
        cookieBackup1Raw: toStringValue(cookies.backup1 || ''),
        cookieBackup2Raw: toStringValue(cookies.backup2 || ''),
        status: toStringValue(sanitizeShareStatus(record.status)),
        createdAt: toStringValue(record.createdAt || ''),
        updatedAt: toStringValue(record.updatedAt || ''),
        revokedAt: toStringValue(record.revokedAt || ''),
        expiresAt: toStringValue(record.expiresAt || ''),
        createdBy: toStringValue(record.createdBy || ''),
        updatedBy: toStringValue(record.updatedBy || ''),
        rotatedFrom: toStringValue(record.rotatedFrom || '')
    };
}

function parseIsoMillis(value = '') {
    const text = String(value || '').trim();
    if (!text) return 0;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : 0;
}

function isShareExpired(record = null, nowMs = Date.now()) {
    const expiresMs = parseIsoMillis(record && record.expiresAt);
    if (!expiresMs) return false;
    return expiresMs < nowMs;
}

function normalizeExpiryInput(expiresAt = '') {
    const text = String(expiresAt || '').trim();
    if (!text) return '';
    const ms = parseIsoMillis(text);
    if (!ms) {
        const err = new Error('Invalid expiresAt');
        err.httpStatus = 400;
        throw err;
    }
    return new Date(ms).toISOString();
}

async function readDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
        method: 'GET'
    });
    if (response.statusCode === 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
        const err = new Error('Failed to read share doc');
        err.httpStatus = response.statusCode || 500;
        throw err;
    }
    try {
        return JSON.parse(response.body || '{}');
    } catch (e) {
        return null;
    }
}

async function patchDoc(docPath, fields) {
    const payload = JSON.stringify({ fields });
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);
    return response.statusCode >= 200 && response.statusCode < 300;
}

async function deleteDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
        method: 'DELETE'
    });
    return response.statusCode >= 200 && response.statusCode < 300;
}

function isValidShareId(id = '') {
    const normalized = String(id || '').trim();
    return /^[A-Za-z0-9_-]{6,64}$/.test(normalized);
}

function generateRandomShareId() {
    return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

function extractShareIdFromQuery(query = '') {
    const raw = String(query || '').trim();
    if (!raw) return '';
    if (isValidShareId(raw)) return raw;

    try {
        const url = new URL(raw);
        const fromSearch = String(url.searchParams.get('s') || '').trim();
        return isValidShareId(fromSearch) ? fromSearch : '';
    } catch (e) {
        // ignore
    }

    const idx = raw.indexOf('?');
    if (idx >= 0) {
        const params = new URLSearchParams(raw.slice(idx + 1));
        const fromSearch = String(params.get('s') || '').trim();
        return isValidShareId(fromSearch) ? fromSearch : '';
    }

    return '';
}

async function readShareById(shareId = '') {
    const id = String(shareId || '').trim();
    if (!isValidShareId(id)) return null;
    const doc = await readDoc(buildShareDocPath(id));
    if (!doc || !doc.fields) return null;
    const mapped = mapShareFieldsToRecord(doc.fields || {});
    if (!mapped.id) mapped.id = id;
    mapped.cookies = sanitizeShareCookies(mapped.cookies || {});
    mapped.cookieRaw = mapped.cookies.primary || '';
    return mapped;
}

async function saveShareRecord(record = {}) {
    const next = {
        ...record,
        cookies: sanitizeShareCookies(record.cookies || {})
    };
    next.cookieRaw = next.cookies.primary || '';
    const ok = await patchDoc(buildShareDocPath(next.id), mapShareRecordToFields(next));
    if (!ok) {
        const err = new Error('Failed to save share');
        err.httpStatus = 500;
        throw err;
    }
    return next;
}

async function createShare(cookieRaw = '', createdBy = 'guest', expiresAt = '') {
    const finalCookie = sanitizeCookieRaw(cookieRaw);
    const finalExpiresAt = normalizeExpiryInput(expiresAt);

    const now = new Date().toISOString();
    for (let i = 0; i < 12; i += 1) {
        const id = generateRandomShareId();
        const exists = await readShareById(id);
        if (exists) continue;

        const record = {
            id,
            cookieRaw: finalCookie,
            cookies: {
                primary: finalCookie,
                backup1: '',
                backup2: ''
            },
            status: 'active',
            createdAt: now,
            updatedAt: now,
            revokedAt: '',
            expiresAt: finalExpiresAt,
            createdBy: String(createdBy || 'guest').trim(),
            updatedBy: String(createdBy || 'guest').trim(),
            rotatedFrom: ''
        };

        return saveShareRecord(record);
    }

    const err = new Error('Failed to allocate share id');
    err.httpStatus = 500;
    throw err;
}

async function updateShareCookie(shareId = '', cookieRaw = '', actor = 'admin') {
    const nextCookie = sanitizeCookieRaw(cookieRaw);
    return updateShareCookies(shareId, { primary: nextCookie }, actor);
}

async function updateShareCookies(shareId = '', cookiesInput = {}, actor = 'admin') {
    const current = await readShareById(shareId);
    if (!current) {
        const err = new Error('Share link not found');
        err.httpStatus = 404;
        throw err;
    }

    const nextCookies = {
        ...sanitizeShareCookies(current.cookies || {}),
        ...sanitizeShareCookies(cookiesInput || {})
    };

    const next = {
        ...current,
        cookies: nextCookies,
        cookieRaw: nextCookies.primary || '',
        updatedAt: new Date().toISOString(),
        updatedBy: String(actor || 'admin').trim()
    };

    return saveShareRecord(next);
}

async function updateShareCookieSlot(shareId = '', slot = '', cookieRaw = '', actor = 'admin') {
    const normalizedSlot = normalizeSlotName(slot);
    if (!normalizedSlot) {
        const err = new Error('Invalid cookie slot');
        err.httpStatus = 400;
        throw err;
    }
    return updateShareCookies(shareId, { [normalizedSlot]: sanitizeCookieRaw(cookieRaw) }, actor);
}

async function promoteShareCookieSlot(shareId = '', slot = '', actor = 'system') {
    const current = await readShareById(shareId);
    if (!current) {
        const err = new Error('Share link not found');
        err.httpStatus = 404;
        throw err;
    }

    const normalizedSlot = normalizeSlotName(slot);
    if (!normalizedSlot || normalizedSlot === 'primary') return current;

    const cookies = sanitizeShareCookies(current.cookies || {});
    if (!cookies[normalizedSlot]) return current;

    const nextCookies = {
        primary: cookies[normalizedSlot],
        backup1: normalizedSlot === 'backup1' ? cookies.primary : cookies.backup1,
        backup2: normalizedSlot === 'backup2' ? cookies.primary : cookies.backup2
    };

    const next = {
        ...current,
        cookies: nextCookies,
        cookieRaw: nextCookies.primary || '',
        updatedAt: new Date().toISOString(),
        updatedBy: String(actor || 'system').trim()
    };
    return saveShareRecord(next);
}

async function setShareStatus(shareId = '', status = 'active', actor = 'admin') {
    const current = await readShareById(shareId);
    if (!current) {
        const err = new Error('Share link not found');
        err.httpStatus = 404;
        throw err;
    }

    const nextStatus = sanitizeShareStatus(status);
    const now = new Date().toISOString();
    const next = {
        ...current,
        status: nextStatus,
        revokedAt: nextStatus === 'revoked' ? now : '',
        updatedAt: now,
        updatedBy: String(actor || 'admin').trim()
    };

    return saveShareRecord(next);
}

async function rotateShareId(shareId = '', actor = 'admin') {
    const current = await readShareById(shareId);
    if (!current) {
        const err = new Error('Share link not found');
        err.httpStatus = 404;
        throw err;
    }

    let newId = '';
    for (let i = 0; i < 12; i += 1) {
        const candidate = generateRandomShareId();
        const exists = await readShareById(candidate);
        if (!exists) {
            newId = candidate;
            break;
        }
    }

    if (!newId) {
        const err = new Error('Failed to generate new id');
        err.httpStatus = 500;
        throw err;
    }

    const now = new Date().toISOString();
    const next = {
        ...current,
        id: newId,
        updatedAt: now,
        updatedBy: String(actor || 'admin').trim(),
        rotatedFrom: current.id
    };

    await saveShareRecord(next);

    const deleteOldOk = await deleteDoc(buildShareDocPath(current.id));
    if (!deleteOldOk) {
        await saveShareRecord({
            ...current,
            status: 'revoked',
            revokedAt: now,
            updatedAt: now,
            updatedBy: String(actor || 'admin').trim()
        });
    }

    return {
        oldId: current.id,
        newId,
        share: next
    };
}

async function setShareExpiry(shareId = '', options = {}, actor = 'admin') {
    const current = await readShareById(shareId);
    if (!current) {
        const err = new Error('Share link not found');
        err.httpStatus = 404;
        throw err;
    }

    const nowMs = Date.now();
    const addDaysRaw = options && options.addDays !== undefined ? Number(options.addDays) : NaN;
    let nextExpiresAt = '';

    if (options && options.expiresAt !== undefined) {
        nextExpiresAt = normalizeExpiryInput(options.expiresAt);
    } else if (Number.isFinite(addDaysRaw)) {
        if (addDaysRaw <= 0) {
            const err = new Error('addDays must be greater than 0');
            err.httpStatus = 400;
            throw err;
        }
        const currentExpiresMs = parseIsoMillis(current.expiresAt);
        const baseMs = currentExpiresMs > nowMs ? currentExpiresMs : nowMs;
        nextExpiresAt = new Date(baseMs + (addDaysRaw * 24 * 60 * 60 * 1000)).toISOString();
    } else {
        const err = new Error('Missing expiresAt or addDays');
        err.httpStatus = 400;
        throw err;
    }

    const next = {
        ...current,
        expiresAt: nextExpiresAt,
        updatedAt: new Date().toISOString(),
        updatedBy: String(actor || 'admin').trim()
    };

    return saveShareRecord(next);
}

module.exports = {
    COLL_GETLINK_SHARES,
    SHARE_COOKIE_SLOTS,
    isValidShareId,
    extractShareIdFromQuery,
    sanitizeCookieRaw,
    sanitizeShareStatus,
    sanitizeShareCookies,
    normalizeSlotName,
    normalizeExpiryInput,
    isShareExpired,
    readShareById,
    createShare,
    getCookieListFromRecord,
    updateShareCookie,
    updateShareCookies,
    updateShareCookieSlot,
    promoteShareCookieSlot,
    setShareStatus,
    rotateShareId,
    setShareExpiry
};

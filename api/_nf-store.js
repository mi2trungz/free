
const https = require('https');
const {
    callNetflixCreateAutoLoginToken: callNetflixCreateAutoLoginTokenShared,
    isLikelyDeadCookie: isLikelyDeadCookieShared,
    isTokenPermissionDenied
} = require('./_netflix-token-engine');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';

const DOC_CUSTOMERS = 'settings/nf_customers';
const DOC_COOKIE_POOL = 'settings/nf_cookie_pool';
const DOC_META = 'settings/nf_meta';
const DOC_COOKIE_INDEX = 'settings/nf_cookie_index';

const COLL_CUSTOMERS_ITEMS = 'settings/nf_customers/items';
const COLL_COOKIES_ITEMS = 'settings/nf_cookies/items';
const STORAGE_VERSION_V2 = 2;

let storageVersionCache = null;
let ensureStoragePromise = null;

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

function firestoreDocPath(docPath) {
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
}

function firestoreCollectionPath(collectionPath, query = {}) {
    const params = Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    const suffix = params ? `&${params}` : '';
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collectionPath}?key=${FIREBASE_API_KEY}${suffix}`;
}

function buildItemDocPath(collectionPath, id) {
    return `${collectionPath}/${encodeURIComponent(String(id || '').trim())}`;
}

async function readDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
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

function parseFirestoreErrorPayload(response = {}) {
    let parsed = {};
    try { parsed = JSON.parse(response.body || '{}'); } catch (e) { parsed = {}; }
    const err = parsed && parsed.error ? parsed.error : {};
    const statusText = String(err.status || '').trim().toUpperCase();
    const message = String(err.message || '').trim();
    return { statusText, message };
}

function buildListCollectionError(collectionPath = '', response = {}) {
    const statusCode = Number(response.statusCode || 0);
    const parsed = parseFirestoreErrorPayload(response);
    const statusText = parsed.statusText;
    const message = parsed.message;
    const hint = String(message || '').toUpperCase();

    let code = 'FIRESTORE_LIST_FAILED';
    let httpStatus = 500;
    let publicMessage = `Failed to list collection ${collectionPath}`;

    if (statusCode === 429 || statusText === 'RESOURCE_EXHAUSTED' || hint.includes('RESOURCE_EXHAUSTED') || hint.includes('QUOTA')) {
        code = 'QUOTA_EXCEEDED';
        httpStatus = 503;
        publicMessage = 'Firestore read quota exceeded';
    } else if (statusCode === 403 || statusText === 'PERMISSION_DENIED' || hint.includes('PERMISSION_DENIED')) {
        code = 'PERMISSION_DENIED';
        httpStatus = 403;
        publicMessage = 'Permission denied while reading Firestore';
    } else if (
        statusCode === 503
        || statusText === 'UNAVAILABLE'
        || statusText === 'DEADLINE_EXCEEDED'
        || hint.includes('UNAVAILABLE')
        || hint.includes('DEADLINE_EXCEEDED')
    ) {
        code = 'FIRESTORE_UNAVAILABLE';
        httpStatus = 503;
        publicMessage = 'Firestore service is temporarily unavailable';
    }

    const error = new Error(publicMessage);
    error.code = code;
    error.httpStatus = httpStatus;
    error.firestoreStatusCode = statusCode;
    error.firestoreStatus = statusText || '';
    error.firestoreMessage = message || '';
    return error;
}

async function listCollectionDocs(collectionPath, options = {}) {
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 200), 1000));
    const maxDocs = Math.max(0, Number(options.maxDocs || 0));
    const docs = [];
    let pageToken = '';

    do {
        const response = await httpRequest({
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: firestoreCollectionPath(collectionPath, {
                pageSize,
                pageToken: pageToken || undefined
            }),
            method: 'GET'
        });

        if (response.statusCode === 404) return [];
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const listErr = buildListCollectionError(collectionPath, response);
            console.error('[nf-store] listCollectionDocs failed', {
                collectionPath,
                statusCode: listErr.firestoreStatusCode,
                firestoreStatus: listErr.firestoreStatus,
                code: listErr.code
            });
            throw listErr;
        }

        let parsed = {};
        try { parsed = JSON.parse(response.body || '{}'); } catch (e) { parsed = {}; }
        if (Array.isArray(parsed.documents)) {
            docs.push(...parsed.documents);
            if (maxDocs > 0 && docs.length >= maxDocs) {
                return docs.slice(0, maxDocs);
            }
        }
        pageToken = String(parsed.nextPageToken || '').trim();
    } while (pageToken);

    return docs;
}

async function listCollectionDocsPage(collectionPath, options = {}) {
    const targetPage = Math.max(1, Number(options.page || 1));
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 25), 200));
    let pageToken = '';
    let currentPage = 1;

    while (currentPage <= targetPage) {
        const response = await httpRequest({
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: firestoreCollectionPath(collectionPath, {
                pageSize,
                pageToken: pageToken || undefined
            }),
            method: 'GET'
        });

        if (response.statusCode === 404) {
            return {
                documents: [],
                nextPageToken: '',
                hasNextPage: false
            };
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const listErr = buildListCollectionError(collectionPath, response);
            console.error('[nf-store] listCollectionDocsPage failed', {
                collectionPath,
                statusCode: listErr.firestoreStatusCode,
                firestoreStatus: listErr.firestoreStatus,
                code: listErr.code
            });
            throw listErr;
        }

        let parsed = {};
        try { parsed = JSON.parse(response.body || '{}'); } catch (e) { parsed = {}; }
        const documents = Array.isArray(parsed.documents) ? parsed.documents : [];
        const nextToken = String(parsed.nextPageToken || '').trim();

        if (currentPage === targetPage) {
            return {
                documents,
                nextPageToken: nextToken,
                hasNextPage: !!nextToken
            };
        }

        if (!nextToken) {
            return {
                documents: [],
                nextPageToken: '',
                hasNextPage: false
            };
        }

        pageToken = nextToken;
        currentPage += 1;
    }

    return {
        documents: [],
        nextPageToken: '',
        hasNextPage: false
    };
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

function toArrayStringValue(values = []) {
    const normalized = Array.from(new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
    return {
        arrayValue: {
            values: normalized.map((value) => ({ stringValue: value }))
        }
    };
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
    const errorTagged = item && (item.errorTagged === true || item.errorTagged === 'true' || item.errorTagged === 1 || item.errorTagged === '1');
    const sbdTagged = item && (item.sbdTagged === true || item.sbdTagged === 'true' || item.sbdTagged === 1 || item.sbdTagged === '1');
    const unknownTagged = item && (item.unknownTagged === true || item.unknownTagged === 'true' || item.unknownTagged === 1 || item.unknownTagged === '1');
    const holdTagged = item && (item.holdTagged === true || item.holdTagged === 'true' || item.holdTagged === 1 || item.holdTagged === '1');
    const overCapacityTaggedRaw = item && (
        item.overCapacityTagged === true
        || item.overCapacityTagged === 'true'
        || item.overCapacityTagged === 1
        || item.overCapacityTagged === '1'
    );
    const overCapacityUntil = String(item && item.overCapacityUntil ? item.overCapacityUntil : '').trim();
    const overCapacityTagged = overCapacityTaggedRaw && toMillis(overCapacityUntil) > Date.now();
    const hasBlockingTag = errorTagged || sbdTagged || unknownTagged || holdTagged || overCapacityTagged;
    return {
        id: String(item.id || makeCookieId()),
        netflixId: String(item.netflixId || '').trim(),
        secureNetflixId: String(item.secureNetflixId || '').trim(),
        cookieRaw: String(item.cookieRaw || '').trim(),
        note: String(item.note || '').trim(),
        status: sanitizeCookieStatus(item.status),
        errorTagged,
        sbdTagged,
        unknownTagged,
        holdTagged,
        overCapacityTagged,
        overCapacityUntil,
        lastOverCapacityAt: String(item && item.lastOverCapacityAt ? item.lastOverCapacityAt : '').trim(),
        assignedCustomerCode: hasBlockingTag ? '' : String(item.assignedCustomerCode || '').trim().toUpperCase(),
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || now,
        lastCheckedAt: item.lastCheckedAt || '',
        lastSuccessAt: item.lastSuccessAt || '',
        lastErrorAt: item.lastErrorAt || '',
        lastError: String(item.lastError || '')
    };
}

function buildCustomerDocFields(customer) {
    return {
        code: toStringValue(customer.code),
        name: toStringValue(customer.name),
        warrantyExpiresAt: toStringValue(customer.warrantyExpiresAt || ''),
        status: toStringValue(customer.status),
        assignedCookieId: toStringValue(customer.assignedCookieId || ''),
        createdAt: toTimestampValue(customer.createdAt),
        updatedAt: toTimestampValue(customer.updatedAt),
        lastLinkedAt: toStringValue(customer.lastLinkedAt || '')
    };
}

function buildCookieDocFields(cookie) {
    return {
        id: toStringValue(cookie.id),
        netflixId: toStringValue(cookie.netflixId),
        secureNetflixId: toStringValue(cookie.secureNetflixId || ''),
        cookieRaw: toStringValue(cookie.cookieRaw || ''),
        note: toStringValue(cookie.note || ''),
        status: toStringValue(cookie.status),
        errorTagged: { booleanValue: !!cookie.errorTagged },
        sbdTagged: { booleanValue: !!cookie.sbdTagged },
        unknownTagged: { booleanValue: !!cookie.unknownTagged },
        holdTagged: { booleanValue: !!cookie.holdTagged },
        overCapacityTagged: { booleanValue: !!cookie.overCapacityTagged },
        overCapacityUntil: toStringValue(cookie.overCapacityUntil || ''),
        lastOverCapacityAt: toStringValue(cookie.lastOverCapacityAt || ''),
        assignedCustomerCode: toStringValue(cookie.assignedCustomerCode || ''),
        createdAt: toTimestampValue(cookie.createdAt),
        updatedAt: toTimestampValue(cookie.updatedAt),
        lastCheckedAt: toStringValue(cookie.lastCheckedAt || ''),
        lastSuccessAt: toStringValue(cookie.lastSuccessAt || ''),
        lastErrorAt: toStringValue(cookie.lastErrorAt || ''),
        lastError: toStringValue(cookie.lastError || '')
    };
}

function parseCustomerFields(fields = {}) {
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

function parseCookieFields(fields = {}) {
    return sanitizeCookie({
        id: fields.id && fields.id.stringValue,
        netflixId: fields.netflixId && fields.netflixId.stringValue,
        secureNetflixId: fields.secureNetflixId && fields.secureNetflixId.stringValue,
        cookieRaw: fields.cookieRaw && fields.cookieRaw.stringValue,
        note: fields.note && fields.note.stringValue,
        status: fields.status && fields.status.stringValue,
        errorTagged: fields.errorTagged && (
            fields.errorTagged.booleanValue === true || fields.errorTagged.booleanValue === 'true'
        ),
        sbdTagged: fields.sbdTagged && (
            fields.sbdTagged.booleanValue === true || fields.sbdTagged.booleanValue === 'true'
        ),
        unknownTagged: fields.unknownTagged && (
            fields.unknownTagged.booleanValue === true || fields.unknownTagged.booleanValue === 'true'
        ),
        holdTagged: fields.holdTagged && (
            fields.holdTagged.booleanValue === true || fields.holdTagged.booleanValue === 'true'
        ),
        overCapacityTagged: fields.overCapacityTagged && (
            fields.overCapacityTagged.booleanValue === true || fields.overCapacityTagged.booleanValue === 'true'
        ),
        overCapacityUntil: fields.overCapacityUntil && fields.overCapacityUntil.stringValue,
        lastOverCapacityAt: fields.lastOverCapacityAt && fields.lastOverCapacityAt.stringValue,
        assignedCustomerCode: fields.assignedCustomerCode && fields.assignedCustomerCode.stringValue,
        createdAt: fields.createdAt && (fields.createdAt.timestampValue || fields.createdAt.stringValue),
        updatedAt: fields.updatedAt && (fields.updatedAt.timestampValue || fields.updatedAt.stringValue),
        lastCheckedAt: fields.lastCheckedAt && fields.lastCheckedAt.stringValue,
        lastSuccessAt: fields.lastSuccessAt && fields.lastSuccessAt.stringValue,
        lastErrorAt: fields.lastErrorAt && fields.lastErrorAt.stringValue,
        lastError: fields.lastError && fields.lastError.stringValue
    });
}

function parseStorageVersion(metaDoc) {
    const fields = (metaDoc && metaDoc.fields) || {};
    const raw = (fields.storageVersion && (fields.storageVersion.integerValue || fields.storageVersion.stringValue)) || '';
    const version = Number(raw);
    return Number.isFinite(version) ? version : 0;
}

function parseMetaIntegerField(fields = {}, key = '') {
    const raw = fields[key] && (fields[key].integerValue || fields[key].stringValue);
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
}

function parseStringArrayField(fields = {}, key = '') {
    const values = (((fields[key] || {}).arrayValue || {}).values) || [];
    return values
        .map((value) => String((value || {}).stringValue || '').trim())
        .filter(Boolean);
}

async function readMetaStats() {
    const metaDoc = await readDoc(DOC_META);
    const fields = (metaDoc && metaDoc.fields) || {};
    return {
        totalCustomers: parseMetaIntegerField(fields, 'totalCustomers'),
        totalCookies: parseMetaIntegerField(fields, 'totalCookies'),
        activeCount: parseMetaIntegerField(fields, 'activeCount'),
        disabledCount: parseMetaIntegerField(fields, 'disabledCount'),
        deadCount: parseMetaIntegerField(fields, 'deadCount'),
        assignedCount: parseMetaIntegerField(fields, 'assignedCount'),
        unknownCount: parseMetaIntegerField(fields, 'unknownCount'),
        holdCount: parseMetaIntegerField(fields, 'holdCount'),
        overCapacityCount: parseMetaIntegerField(fields, 'overCapacityCount')
    };
}

function emptyCookieCounters() {
    return {
        totalCookies: 0,
        activeCount: 0,
        disabledCount: 0,
        deadCount: 0,
        assignedCount: 0,
        unknownCount: 0,
        holdCount: 0,
        overCapacityCount: 0
    };
}

function addCookieCounters(base = {}, next = {}, scale = 1) {
    const safeScale = Number(scale || 0);
    const output = {
        totalCookies: Number(base.totalCookies || 0),
        activeCount: Number(base.activeCount || 0),
        disabledCount: Number(base.disabledCount || 0),
        deadCount: Number(base.deadCount || 0),
        assignedCount: Number(base.assignedCount || 0),
        unknownCount: Number(base.unknownCount || 0),
        holdCount: Number(base.holdCount || 0),
        overCapacityCount: Number(base.overCapacityCount || 0)
    };
    output.totalCookies += safeScale * Number(next.totalCookies || 0);
    output.activeCount += safeScale * Number(next.activeCount || 0);
    output.disabledCount += safeScale * Number(next.disabledCount || 0);
    output.deadCount += safeScale * Number(next.deadCount || 0);
    output.assignedCount += safeScale * Number(next.assignedCount || 0);
    output.unknownCount += safeScale * Number(next.unknownCount || 0);
    output.holdCount += safeScale * Number(next.holdCount || 0);
    output.overCapacityCount += safeScale * Number(next.overCapacityCount || 0);
    return output;
}

function computeCookieCounters(item) {
    if (!item || !item.id || (!item.netflixId && !item.cookieRaw)) return emptyCookieCounters();
    const status = String(item.status || '').trim().toLowerCase();
    return {
        totalCookies: 1,
        activeCount: status === 'active' ? 1 : 0,
        disabledCount: status === 'disabled' ? 1 : 0,
        deadCount: status === 'dead' ? 1 : 0,
        assignedCount: item.assignedCustomerCode ? 1 : 0,
        unknownCount: item.unknownTagged ? 1 : 0,
        holdCount: item.holdTagged ? 1 : 0,
        overCapacityCount: isCookieOverCapacityActive(item) ? 1 : 0
    };
}

function clampNonNegative(value) {
    return Math.max(0, Number(value || 0));
}

function applyMetaDelta(metaDoc, delta = {}) {
    const fields = (metaDoc && metaDoc.fields) || {};
    const next = {
        totalCustomers: clampNonNegative(parseMetaIntegerField(fields, 'totalCustomers') + Number(delta.totalCustomers || 0)),
        totalCookies: clampNonNegative(parseMetaIntegerField(fields, 'totalCookies') + Number(delta.totalCookies || 0)),
        activeCount: clampNonNegative(parseMetaIntegerField(fields, 'activeCount') + Number(delta.activeCount || 0)),
        disabledCount: clampNonNegative(parseMetaIntegerField(fields, 'disabledCount') + Number(delta.disabledCount || 0)),
        deadCount: clampNonNegative(parseMetaIntegerField(fields, 'deadCount') + Number(delta.deadCount || 0)),
        assignedCount: clampNonNegative(parseMetaIntegerField(fields, 'assignedCount') + Number(delta.assignedCount || 0)),
        unknownCount: clampNonNegative(parseMetaIntegerField(fields, 'unknownCount') + Number(delta.unknownCount || 0)),
        holdCount: clampNonNegative(parseMetaIntegerField(fields, 'holdCount') + Number(delta.holdCount || 0)),
        overCapacityCount: clampNonNegative(parseMetaIntegerField(fields, 'overCapacityCount') + Number(delta.overCapacityCount || 0))
    };
    return {
        totalCustomers: next.totalCustomers,
        totalCookies: next.totalCookies,
        cookieSummary: {
            total: next.totalCookies,
            activeCount: next.activeCount,
            disabledCount: next.disabledCount,
            deadCount: next.deadCount,
            assignedCount: next.assignedCount,
            unknownCount: next.unknownCount,
            holdCount: next.holdCount,
            overCapacityCount: next.overCapacityCount
        }
    };
}

async function persistMetaDelta(payload = {}) {
    const delta = payload && payload.delta ? payload.delta : {};
    const hasDelta = Object.keys(delta).some((key) => Number(delta[key] || 0) !== 0);
    if (!hasDelta && payload.storageVersion === undefined) return true;
    const metaDoc = await readDoc(DOC_META);
    const next = applyMetaDelta(metaDoc, delta);
    return persistMeta({
        source: safeString(payload.source || 'writeDelta'),
        note: safeString(payload.note || 'NF delta update'),
        totalCustomers: next.totalCustomers,
        totalCookies: next.totalCookies,
        cookieSummary: next.cookieSummary,
        storageVersion: payload.storageVersion !== undefined ? payload.storageVersion : STORAGE_VERSION_V2
    });
}

function getCookieIndexBucket(cookie) {
    if (!cookie || !cookie.id) return '';
    if (cookie.status !== 'active') return '';
    if (cookie.errorTagged || cookie.sbdTagged) return '';
    if (isCookieOverCapacityActive(cookie)) return '';
    if (cookie.holdTagged) return 'holdIds';
    if (cookie.unknownTagged) return 'unknownIds';
    return 'normalIds';
}

function buildCookieIndexFromCookies(cookies = []) {
    const normalIds = [];
    const holdIds = [];
    const unknownIds = [];
    const seen = new Set();
    (Array.isArray(cookies) ? cookies : []).forEach((cookie) => {
        if (!cookie || !cookie.id) return;
        if (seen.has(cookie.id)) return;
        seen.add(cookie.id);
        const bucket = getCookieIndexBucket(cookie);
        if (bucket === 'normalIds') normalIds.push(cookie.id);
        else if (bucket === 'holdIds') holdIds.push(cookie.id);
        else if (bucket === 'unknownIds') unknownIds.push(cookie.id);
    });
    return { normalIds, holdIds, unknownIds };
}

async function persistCookieIndex(indexPayload = {}) {
    const now = new Date().toISOString();
    return patchDoc(DOC_COOKIE_INDEX, {
        normalIds: toArrayStringValue(indexPayload.normalIds || []),
        holdIds: toArrayStringValue(indexPayload.holdIds || []),
        unknownIds: toArrayStringValue(indexPayload.unknownIds || []),
        updatedAt: toTimestampValue(indexPayload.updatedAt || now)
    });
}

async function readCookieIndex() {
    const doc = await readDoc(DOC_COOKIE_INDEX);
    const fields = (doc && doc.fields) || {};
    const exists = !!doc;
    return {
        exists,
        normalIds: parseStringArrayField(fields, 'normalIds'),
        holdIds: parseStringArrayField(fields, 'holdIds'),
        unknownIds: parseStringArrayField(fields, 'unknownIds'),
        updatedAt: String((fields.updatedAt && (fields.updatedAt.timestampValue || fields.updatedAt.stringValue)) || '').trim()
    };
}

async function updateCookieIndexDelta(changedCookies = [], deletedIds = []) {
    const normalizedDeleted = new Set((Array.isArray(deletedIds) ? deletedIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean));
    const normalizedChanged = (Array.isArray(changedCookies) ? changedCookies : [])
        .map((item) => sanitizeCookie(item))
        .filter((item) => !!item.id);
    if (normalizedDeleted.size === 0 && normalizedChanged.length === 0) return true;

    const current = await readCookieIndex();
    const merged = {
        normalIds: Array.from(new Set(current.normalIds || [])),
        holdIds: Array.from(new Set(current.holdIds || [])),
        unknownIds: Array.from(new Set(current.unknownIds || []))
    };

    const changedIdSet = new Set(normalizedChanged.map((item) => item.id));
    const removeIdSet = new Set([...normalizedDeleted, ...changedIdSet]);
    const removeFromBucket = (ids = []) => ids.filter((id) => !removeIdSet.has(id));
    merged.normalIds = removeFromBucket(merged.normalIds);
    merged.holdIds = removeFromBucket(merged.holdIds);
    merged.unknownIds = removeFromBucket(merged.unknownIds);

    normalizedChanged.forEach((cookie) => {
        if (normalizedDeleted.has(cookie.id)) return;
        const bucket = getCookieIndexBucket(cookie);
        if (!bucket) return;
        if (bucket === 'normalIds') merged.normalIds.push(cookie.id);
        if (bucket === 'holdIds') merged.holdIds.push(cookie.id);
        if (bucket === 'unknownIds') merged.unknownIds.push(cookie.id);
    });

    return persistCookieIndex(merged);
}

async function rebuildCookieIndex() {
    const cookies = await readCookiesV2();
    const payload = buildCookieIndexFromCookies(cookies);
    await persistCookieIndex(payload);
    return payload;
}

function toCustomerSnapshot(customer = {}) {
    return [
        customer.code || '', customer.name || '', customer.warrantyExpiresAt || '', customer.status || '',
        customer.assignedCookieId || '', customer.createdAt || '', customer.updatedAt || '', customer.lastLinkedAt || ''
    ].join('|');
}

function toCookieSnapshot(cookie = {}) {
    return [
        cookie.id || '', cookie.netflixId || '', cookie.secureNetflixId || '', cookie.cookieRaw || '', cookie.note || '',
        cookie.status || '',
        cookie.errorTagged ? '1' : '0',
        cookie.sbdTagged ? '1' : '0',
        cookie.unknownTagged ? '1' : '0',
        cookie.holdTagged ? '1' : '0',
        cookie.overCapacityTagged ? '1' : '0',
        cookie.overCapacityUntil || '',
        cookie.lastOverCapacityAt || '',
        cookie.assignedCustomerCode || '',
        cookie.createdAt || '', cookie.updatedAt || '', cookie.lastCheckedAt || '', cookie.lastSuccessAt || '',
        cookie.lastErrorAt || '', cookie.lastError || ''
    ].join('|');
}

async function runWithConcurrency(items = [], worker, concurrency = 8) {
    const limit = Math.max(1, Number(concurrency || 1));
    let cursor = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}
async function readCustomersV2() {
    const docs = await listCollectionDocs(COLL_CUSTOMERS_ITEMS);
    return docs
        .map((doc) => parseCustomerFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.code);
}

async function readCookiesV2() {
    const docs = await listCollectionDocs(COLL_COOKIES_ITEMS);
    return docs
        .map((doc) => parseCookieFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.netflixId || !!item.cookieRaw);
}

async function readCustomerByCodeV2(code = '') {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    const doc = await readDoc(buildItemDocPath(COLL_CUSTOMERS_ITEMS, normalized));
    if (!doc || !doc.fields) return null;
    const parsed = parseCustomerFields(doc.fields);
    return parsed && parsed.code ? parsed : null;
}

async function readCookieByIdV2(cookieId = '') {
    const normalized = String(cookieId || '').trim();
    if (!normalized) return null;
    const doc = await readDoc(buildItemDocPath(COLL_COOKIES_ITEMS, normalized));
    if (!doc || !doc.fields) return null;
    const parsed = parseCookieFields(doc.fields);
    return parsed && parsed.id ? parsed : null;
}

async function readCustomersByCodesV2(codes = []) {
    const normalized = Array.from(new Set((Array.isArray(codes) ? codes : [])
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)));
    if (normalized.length === 0) return [];
    const docs = await Promise.all(normalized.map((code) => readDoc(buildItemDocPath(COLL_CUSTOMERS_ITEMS, code))));
    return docs
        .map((doc) => parseCustomerFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.code);
}

async function readCookiesByIdsV2(cookieIds = []) {
    const normalized = Array.from(new Set((Array.isArray(cookieIds) ? cookieIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
    if (normalized.length === 0) return [];
    const docs = await Promise.all(normalized.map((id) => readDoc(buildItemDocPath(COLL_COOKIES_ITEMS, id))));
    return docs
        .map((doc) => parseCookieFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.id);
}

async function readCookieCandidatesForGenerate(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
    const scanMax = Math.max(limit, Math.min(Number(options.scanMax || 800), 2000));
    const docs = await listCollectionDocs(COLL_COOKIES_ITEMS, {
        pageSize: 200,
        maxDocs: scanMax
    });
    const cookies = docs
        .map((doc) => parseCookieFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw));
    return cookies.slice(0, limit);
}

async function readLegacyCustomers() {
    const doc = await readDoc(DOC_CUSTOMERS);
    const fields = (doc && doc.fields) || {};
    const values = (((fields.customers || {}).arrayValue || {}).values) || [];
    return values.map((value) => {
        const mapFields = (((value || {}).mapValue || {}).fields) || {};
        return parseCustomerFields(mapFields);
    }).filter((item) => !!item.code);
}

async function readLegacyCookies() {
    const doc = await readDoc(DOC_COOKIE_POOL);
    const fields = (doc && doc.fields) || {};
    const values = (((fields.cookies || {}).arrayValue || {}).values) || [];
    return values.map((value) => {
        const mapFields = (((value || {}).mapValue || {}).fields) || {};
        return parseCookieFields(mapFields);
    }).filter((item) => !!item.netflixId || !!item.cookieRaw);
}

async function upsertCustomers(customers = []) {
    const normalized = customers.map(sanitizeCustomer).filter((item) => !!item.code && !!item.name);
    await runWithConcurrency(normalized, async (customer) => {
        await patchDoc(buildItemDocPath(COLL_CUSTOMERS_ITEMS, customer.code), buildCustomerDocFields(customer));
    }, 8);
}

async function upsertCookies(cookies = []) {
    const normalized = cookies.map(sanitizeCookie).filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw));
    await runWithConcurrency(normalized, async (cookie) => {
        await patchDoc(buildItemDocPath(COLL_COOKIES_ITEMS, cookie.id), buildCookieDocFields(cookie));
    }, 8);
}

async function deleteCustomersByCodes(codes = []) {
    const normalized = Array.from(new Set((Array.isArray(codes) ? codes : [])
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)));
    await runWithConcurrency(normalized, async (code) => {
        await deleteDoc(buildItemDocPath(COLL_CUSTOMERS_ITEMS, code));
    }, 8);
}

async function deleteCookiesByIds(cookieIds = []) {
    const normalized = Array.from(new Set((Array.isArray(cookieIds) ? cookieIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
    await runWithConcurrency(normalized, async (id) => {
        await deleteDoc(buildItemDocPath(COLL_COOKIES_ITEMS, id));
    }, 8);
}

async function persistMeta(payload = {}) {
    const now = new Date().toISOString();
    const fields = {
        lastUpdatedAt: toTimestampValue(now),
        note: toStringValue(safeString(payload.note || 'NF module update')),
        source: toStringValue(safeString(payload.source || 'api')),
        totalCustomers: toIntegerValue(payload.totalCustomers || 0),
        totalCookies: toIntegerValue(payload.totalCookies || 0)
    };
    if (payload.cookieSummary && typeof payload.cookieSummary === 'object') {
        fields.activeCount = toIntegerValue(payload.cookieSummary.activeCount || 0);
        fields.disabledCount = toIntegerValue(payload.cookieSummary.disabledCount || 0);
        fields.deadCount = toIntegerValue(payload.cookieSummary.deadCount || 0);
        fields.assignedCount = toIntegerValue(payload.cookieSummary.assignedCount || 0);
        fields.unknownCount = toIntegerValue(payload.cookieSummary.unknownCount || 0);
        fields.holdCount = toIntegerValue(payload.cookieSummary.holdCount || 0);
        fields.overCapacityCount = toIntegerValue(payload.cookieSummary.overCapacityCount || 0);
    }
    if (payload.storageVersion !== undefined) {
        fields.storageVersion = toIntegerValue(payload.storageVersion);
    }
    const ok = await patchDoc(DOC_META, fields);
    if (payload.storageVersion !== undefined) {
        storageVersionCache = Number(payload.storageVersion) || null;
    }
    return ok;
}

async function getStorageVersion() {
    if (storageVersionCache !== null) return storageVersionCache;
    const metaDoc = await readDoc(DOC_META);
    storageVersionCache = parseStorageVersion(metaDoc) || 0;
    return storageVersionCache;
}

async function ensureStorageForWrite() {
    const currentVersion = await getStorageVersion();
    if (currentVersion >= STORAGE_VERSION_V2) return;
    if (ensureStoragePromise) {
        await ensureStoragePromise;
        return;
    }

    ensureStoragePromise = (async () => {
        const [v2Customers, v2Cookies] = await Promise.all([readCustomersV2(), readCookiesV2()]);
        if (v2Customers.length > 0 || v2Cookies.length > 0) {
            await persistMeta({
                source: 'nf-store-detect-v2',
                note: 'Detected v2 storage',
                totalCustomers: v2Customers.length,
                totalCookies: v2Cookies.length,
                storageVersion: STORAGE_VERSION_V2
            });
            await rebuildCookieIndex();
            return;
        }

        const [legacyCustomers, legacyCookies] = await Promise.all([readLegacyCustomers(), readLegacyCookies()]);
        if (legacyCustomers.length > 0) await upsertCustomers(legacyCustomers);
        if (legacyCookies.length > 0) await upsertCookies(legacyCookies);

        await persistMeta({
            source: 'nf-store-migration',
            note: 'Migrated legacy nf storage to v2',
            totalCustomers: legacyCustomers.length,
            totalCookies: legacyCookies.length,
            storageVersion: STORAGE_VERSION_V2
        });
        await rebuildCookieIndex();
    })();

    try {
        await ensureStoragePromise;
    } finally {
        ensureStoragePromise = null;
    }
}

function buildCookieSummary(cookies = []) {
    const total = cookies.length;
    const activeCount = cookies.filter((c) => c.status === 'active').length;
    const disabledCount = cookies.filter((c) => c.status === 'disabled').length;
    const deadCount = cookies.filter((c) => c.status === 'dead').length;
    const assignedCount = cookies.filter((c) => !!c.assignedCustomerCode).length;
    const unknownCount = cookies.filter((c) => !!c.unknownTagged).length;
    const holdCount = cookies.filter((c) => !!c.holdTagged).length;
    const overCapacityCount = cookies.filter((c) => isCookieOverCapacityActive(c)).length;
    return { total, activeCount, disabledCount, deadCount, assignedCount, unknownCount, holdCount, overCapacityCount };
}

async function readCustomers() {
    const dataV2 = await readCustomersV2();
    if (dataV2.length > 0) return dataV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return [];

    return readLegacyCustomers();
}

async function readCookies() {
    const dataV2 = await readCookiesV2();
    if (dataV2.length > 0) return dataV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return [];

    return readLegacyCookies();
}

function buildPageMeta(total = 0, page = 1, pageSize = 25, hasNextPage = false) {
    const safeTotal = Math.max(0, Number(total || 0));
    const safePageSize = Math.max(1, Number(pageSize || 25));
    const safePage = Math.max(1, Number(page || 1));
    const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
    const normalizedPage = Math.min(safePage, totalPages);
    const hasPrev = normalizedPage > 1;
    const hasNext = !!hasNextPage || normalizedPage < totalPages;
    return {
        total: safeTotal,
        page: normalizedPage,
        pageSize: safePageSize,
        totalPages,
        hasNext,
        hasPrev
    };
}

async function readCustomersPage(options = {}) {
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 25), 100));
    const pageResult = await listCollectionDocsPage(COLL_CUSTOMERS_ITEMS, { page, pageSize });
    const items = (Array.isArray(pageResult.documents) ? pageResult.documents : [])
        .map((doc) => parseCustomerFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.code);

    const meta = await readMetaStats();
    const pageMeta = buildPageMeta(meta.totalCustomers, page, pageSize, pageResult.hasNextPage);

    if (items.length > 0 || pageMeta.total > 0) {
        return {
            items,
            ...pageMeta
        };
    }

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) {
        return {
            items: [],
            ...pageMeta
        };
    }

    const legacy = await readLegacyCustomers();
    const sorted = legacy
        .slice()
        .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    const start = (page - 1) * pageSize;
    const legacyItems = sorted.slice(start, start + pageSize);
    return {
        items: legacyItems,
        ...buildPageMeta(sorted.length, page, pageSize, start + pageSize < sorted.length)
    };
}

async function readCookiesPage(options = {}) {
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 25), 100));
    const pageResult = await listCollectionDocsPage(COLL_COOKIES_ITEMS, { page, pageSize });
    const items = (Array.isArray(pageResult.documents) ? pageResult.documents : [])
        .map((doc) => parseCookieFields(doc && doc.fields ? doc.fields : {}))
        .filter((item) => !!item.netflixId || !!item.cookieRaw);

    const meta = await readMetaStats();
    const pageMeta = buildPageMeta(meta.totalCookies, page, pageSize, pageResult.hasNextPage);

    if (items.length > 0 || pageMeta.total > 0) {
        return {
            items,
            summary: {
                total: pageMeta.total,
                activeCount: meta.activeCount || 0,
                disabledCount: meta.disabledCount || 0,
                deadCount: meta.deadCount || 0,
                assignedCount: meta.assignedCount || 0,
                unknownCount: meta.unknownCount || 0,
                holdCount: meta.holdCount || 0,
                overCapacityCount: meta.overCapacityCount || 0
            },
            ...pageMeta
        };
    }

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) {
        return {
            items: [],
            summary: {
                total: pageMeta.total,
                activeCount: 0,
                disabledCount: 0,
                deadCount: 0,
                assignedCount: 0,
                unknownCount: 0,
                holdCount: 0,
                overCapacityCount: 0
            },
            ...pageMeta
        };
    }

    const legacy = await readLegacyCookies();
    const start = (page - 1) * pageSize;
    const legacyItems = legacy.slice(start, start + pageSize);
    return {
        items: legacyItems,
        summary: buildCookieSummary(legacy),
        ...buildPageMeta(legacy.length, page, pageSize, start + pageSize < legacy.length)
    };
}

async function readCustomerByCode(code = '') {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    const customerV2 = await readCustomerByCodeV2(normalized);
    if (customerV2) return customerV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return null;
    const legacy = await readLegacyCustomers();
    return legacy.find((item) => item.code === normalized) || null;
}

async function readCookieById(cookieId = '') {
    const normalized = String(cookieId || '').trim();
    if (!normalized) return null;
    const cookieV2 = await readCookieByIdV2(normalized);
    if (cookieV2) return cookieV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return null;
    const legacy = await readLegacyCookies();
    return legacy.find((item) => item.id === normalized) || null;
}

async function readCustomersByCodes(codes = []) {
    const requested = Array.from(new Set((Array.isArray(codes) ? codes : [])
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)));
    if (requested.length === 0) return [];

    const foundV2 = await readCustomersByCodesV2(requested);
    const foundCodes = new Set(foundV2.map((item) => item.code));
    const missing = requested.filter((code) => !foundCodes.has(code));
    if (missing.length === 0) return foundV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return foundV2;
    const legacy = await readLegacyCustomers();
    const legacyMap = new Map(legacy.map((item) => [item.code, item]));
    return [
        ...foundV2,
        ...missing.map((code) => legacyMap.get(code)).filter(Boolean)
    ];
}

async function readCookiesByIds(cookieIds = []) {
    const requested = Array.from(new Set((Array.isArray(cookieIds) ? cookieIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
    if (requested.length === 0) return [];

    const foundV2 = await readCookiesByIdsV2(requested);
    const foundIds = new Set(foundV2.map((item) => item.id));
    const missing = requested.filter((id) => !foundIds.has(id));
    if (missing.length === 0) return foundV2;

    const version = await getStorageVersion();
    if (version >= STORAGE_VERSION_V2) return foundV2;
    const legacy = await readLegacyCookies();
    const legacyMap = new Map(legacy.map((item) => [item.id, item]));
    return [
        ...foundV2,
        ...missing.map((id) => legacyMap.get(id)).filter(Boolean)
    ];
}

async function persistCustomers(customers = []) {
    await ensureStorageForWrite();

    const normalized = customers.map(sanitizeCustomer).filter((item) => !!item.code && !!item.name);
    const existing = await readCustomersV2();
    const existingMap = new Map(existing.map((item) => [item.code, item]));
    const incomingMap = new Map(normalized.map((item) => [item.code, item]));

    const toUpsert = [];
    incomingMap.forEach((nextItem, code) => {
        const prev = existingMap.get(code);
        if (!prev || toCustomerSnapshot(prev) !== toCustomerSnapshot(nextItem)) {
            toUpsert.push(nextItem);
        }
    });

    const toDelete = [];
    existingMap.forEach((_prev, code) => {
        if (!incomingMap.has(code)) toDelete.push(code);
    });

    if (toUpsert.length > 0) await upsertCustomers(toUpsert);
    if (toDelete.length > 0) await deleteCustomersByCodes(toDelete);

    const cookiesSnapshot = await readCookiesV2();
    const cookiesCount = cookiesSnapshot.length;
    await persistMeta({
        source: 'persistCustomers',
        totalCustomers: normalized.length,
        totalCookies: cookiesCount,
        cookieSummary: buildCookieSummary(cookiesSnapshot),
        storageVersion: STORAGE_VERSION_V2
    });
    return true;
}
async function persistCookies(cookies = []) {
    await ensureStorageForWrite();

    const normalized = cookies.map(sanitizeCookie).filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw));
    const existing = await readCookiesV2();
    const existingMap = new Map(existing.map((item) => [item.id, item]));
    const incomingMap = new Map(normalized.map((item) => [item.id, item]));

    const toUpsert = [];
    incomingMap.forEach((nextItem, id) => {
        const prev = existingMap.get(id);
        if (!prev || toCookieSnapshot(prev) !== toCookieSnapshot(nextItem)) {
            toUpsert.push(nextItem);
        }
    });

    const toDelete = [];
    existingMap.forEach((_prev, id) => {
        if (!incomingMap.has(id)) toDelete.push(id);
    });

    if (toUpsert.length > 0) await upsertCookies(toUpsert);
    if (toDelete.length > 0) await deleteCookiesByIds(toDelete);

    const customersCount = (await readCustomersV2()).length;
    await persistMeta({
        source: 'persistCookies',
        totalCustomers: customersCount,
        totalCookies: normalized.length,
        cookieSummary: buildCookieSummary(normalized),
        storageVersion: STORAGE_VERSION_V2
    });
    await rebuildCookieIndex();
    return true;
}

async function persistAll(customers = [], cookies = [], source = 'api') {
    await ensureStorageForWrite();

    const normalizedCustomers = customers.map(sanitizeCustomer).filter((item) => !!item.code && !!item.name);
    const normalizedCookies = cookies.map(sanitizeCookie).filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw));

    const [existingCustomers, existingCookies] = await Promise.all([readCustomersV2(), readCookiesV2()]);
    const existingCustomerMap = new Map(existingCustomers.map((item) => [item.code, item]));
    const existingCookieMap = new Map(existingCookies.map((item) => [item.id, item]));
    const incomingCustomerMap = new Map(normalizedCustomers.map((item) => [item.code, item]));
    const incomingCookieMap = new Map(normalizedCookies.map((item) => [item.id, item]));

    const customerUpserts = [];
    incomingCustomerMap.forEach((nextItem, code) => {
        const prev = existingCustomerMap.get(code);
        if (!prev || toCustomerSnapshot(prev) !== toCustomerSnapshot(nextItem)) customerUpserts.push(nextItem);
    });

    const cookieUpserts = [];
    incomingCookieMap.forEach((nextItem, id) => {
        const prev = existingCookieMap.get(id);
        if (!prev || toCookieSnapshot(prev) !== toCookieSnapshot(nextItem)) cookieUpserts.push(nextItem);
    });

    const customerDeletes = [];
    existingCustomerMap.forEach((_prev, code) => {
        if (!incomingCustomerMap.has(code)) customerDeletes.push(code);
    });

    const cookieDeletes = [];
    existingCookieMap.forEach((_prev, id) => {
        if (!incomingCookieMap.has(id)) cookieDeletes.push(id);
    });

    await Promise.all([
        customerUpserts.length > 0 ? upsertCustomers(customerUpserts) : Promise.resolve(),
        cookieUpserts.length > 0 ? upsertCookies(cookieUpserts) : Promise.resolve(),
        customerDeletes.length > 0 ? deleteCustomersByCodes(customerDeletes) : Promise.resolve(),
        cookieDeletes.length > 0 ? deleteCookiesByIds(cookieDeletes) : Promise.resolve()
    ]);

    await persistMeta({
        source,
        totalCustomers: normalizedCustomers.length,
        totalCookies: normalizedCookies.length,
        cookieSummary: buildCookieSummary(normalizedCookies),
        storageVersion: STORAGE_VERSION_V2
    });
    await rebuildCookieIndex();
    return true;
}

async function writeDelta(payload = {}) {
    await ensureStorageForWrite();

    const upsertCustomersInput = Array.isArray(payload.upsertCustomers) ? payload.upsertCustomers : [];
    const upsertCookiesInput = Array.isArray(payload.upsertCookies) ? payload.upsertCookies : [];
    const deleteCustomerCodesInput = Array.isArray(payload.deleteCustomerCodes) ? payload.deleteCustomerCodes : [];
    const deleteCookieIdsInput = Array.isArray(payload.deleteCookieIds) ? payload.deleteCookieIds : [];

    const normalizedDeleteCustomerCodes = Array.from(new Set(deleteCustomerCodesInput
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)));
    const normalizedDeleteCookieIds = Array.from(new Set(deleteCookieIdsInput
        .map((id) => String(id || '').trim())
        .filter(Boolean)));

    const deleteCustomerSet = new Set(normalizedDeleteCustomerCodes);
    const deleteCookieSet = new Set(normalizedDeleteCookieIds);
    const normalizedCustomers = upsertCustomersInput
        .map(sanitizeCustomer)
        .filter((item) => !!item.code && !!item.name && !deleteCustomerSet.has(item.code));
    const normalizedCookies = upsertCookiesInput
        .map(sanitizeCookie)
        .filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw) && !deleteCookieSet.has(item.id));

    const customerTouchedCodes = Array.from(new Set([
        ...normalizedCustomers.map((item) => item.code),
        ...normalizedDeleteCustomerCodes
    ]));
    const cookieTouchedIds = Array.from(new Set([
        ...normalizedCookies.map((item) => item.id),
        ...normalizedDeleteCookieIds
    ]));

    const [prevCustomers, prevCookies] = await Promise.all([
        customerTouchedCodes.length > 0 ? readCustomersByCodesV2(customerTouchedCodes) : Promise.resolve([]),
        cookieTouchedIds.length > 0 ? readCookiesByIdsV2(cookieTouchedIds) : Promise.resolve([])
    ]);
    const prevCustomerMap = new Map(prevCustomers.map((item) => [item.code, item]));
    const prevCookieMap = new Map(prevCookies.map((item) => [item.id, item]));

    const nextCustomerMap = new Map(prevCustomerMap);
    normalizedCustomers.forEach((item) => nextCustomerMap.set(item.code, item));
    normalizedDeleteCustomerCodes.forEach((code) => nextCustomerMap.delete(code));

    const nextCookieMap = new Map(prevCookieMap);
    normalizedCookies.forEach((item) => nextCookieMap.set(item.id, item));
    normalizedDeleteCookieIds.forEach((id) => nextCookieMap.delete(id));

    let metaDelta = {
        totalCustomers: 0,
        totalCookies: 0,
        activeCount: 0,
        disabledCount: 0,
        deadCount: 0,
        assignedCount: 0,
        unknownCount: 0,
        holdCount: 0,
        overCapacityCount: 0
    };

    customerTouchedCodes.forEach((code) => {
        const had = prevCustomerMap.has(code) ? 1 : 0;
        const has = nextCustomerMap.has(code) ? 1 : 0;
        metaDelta.totalCustomers += (has - had);
    });

    cookieTouchedIds.forEach((id) => {
        const prev = prevCookieMap.get(id) || null;
        const next = nextCookieMap.get(id) || null;
        metaDelta = addCookieCounters(metaDelta, computeCookieCounters(prev), -1);
        metaDelta = addCookieCounters(metaDelta, computeCookieCounters(next), 1);
    });

    await Promise.all([
        normalizedCustomers.length > 0 ? upsertCustomers(normalizedCustomers) : Promise.resolve(),
        normalizedCookies.length > 0 ? upsertCookies(normalizedCookies) : Promise.resolve(),
        normalizedDeleteCustomerCodes.length > 0 ? deleteCustomersByCodes(normalizedDeleteCustomerCodes) : Promise.resolve(),
        normalizedDeleteCookieIds.length > 0 ? deleteCookiesByIds(normalizedDeleteCookieIds) : Promise.resolve()
    ]);

    await persistMetaDelta({
        delta: metaDelta,
        source: safeString(payload.source || 'writeDelta'),
        note: safeString(payload.note || 'NF delta update'),
        storageVersion: STORAGE_VERSION_V2
    });
    await updateCookieIndexDelta(normalizedCookies, normalizedDeleteCookieIds);

    return true;
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

function isCookieOverCapacityActive(cookie = {}, nowMs = Date.now()) {
    if (!cookie || !cookie.overCapacityTagged) return false;
    const untilMs = toMillis(cookie.overCapacityUntil || '');
    return untilMs > nowMs;
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

function parseNetscapeLine(line = '') {
    const parts = String(line || '').split('\t');
    if (parts.length < 7) return null;
    return {
        name: String(parts[5] || '').trim(),
        value: String(parts[6] || '').trim()
    };
}

function splitImportCookieBlocks(content = '') {
    const normalized = String(content || '').replace(/\r/g, '');
    if (!normalized.trim()) return [];

    const chunks = normalized
        .split(/\n\s*\n+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => !!chunk);
    if (chunks.length > 1) return chunks;

    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !!line);
    if (lines.length === 0) return [];

    const hasNetscapeRows = lines.some((line) => !!parseNetscapeLine(line));
    if (!hasNetscapeRows) return lines;

    const blocks = [];
    let currentLines = [];
    let seenNetflixId = false;
    let seenSecureNetflixId = false;
    let lastNetflixId = '';

    function flushCurrent() {
        if (currentLines.length === 0) return;
        blocks.push(currentLines.join('\n'));
        currentLines = [];
        seenNetflixId = false;
        seenSecureNetflixId = false;
        lastNetflixId = '';
    }

    lines.forEach((line) => {
        const parsed = parseNetscapeLine(line);
        if (!parsed) {
            flushCurrent();
            blocks.push(line);
            return;
        }

        const isNewBlockNetflixLine =
            parsed.name === 'NetflixId' &&
            seenNetflixId &&
            seenSecureNetflixId &&
            !!lastNetflixId &&
            !!parsed.value &&
            parsed.value !== lastNetflixId;

        if (isNewBlockNetflixLine) flushCurrent();

        currentLines.push(line);
        if (parsed.name === 'NetflixId' && parsed.value) {
            seenNetflixId = true;
            lastNetflixId = parsed.value;
        }
        if (parsed.name === 'SecureNetflixId' && parsed.value) seenSecureNetflixId = true;
    });

    flushCurrent();
    return blocks;
}

function isLikelyDeadCookie(errorText = '', statusCode = 0) {
    return isLikelyDeadCookieShared(errorText, statusCode);
}

function callNetflixCreateAutoLoginToken(netflixId, secureNetflixId) {
    return callNetflixCreateAutoLoginTokenShared(netflixId, secureNetflixId);
}

function buildUrlByDevice(nftoken, device) {
    const token = encodeURIComponent(String(nftoken || '').trim());
    if (device === 'mobile') return `https://netflix.com/YourAccount?nftoken=${token}`;
    if (device === 'tv') return `https://netflix.com/unsupported?lock=true&nftoken=${token}`;
    return `https://netflix.com/?nftoken=${token}`;
}

module.exports = {
    DOC_CUSTOMERS,
    DOC_COOKIE_POOL,
    DOC_META,
    DOC_COOKIE_INDEX,
    COLL_CUSTOMERS_ITEMS,
    COLL_COOKIES_ITEMS,
    STORAGE_VERSION_V2,
    parseBody,
    readCustomers,
    readCookies,
    readCustomersPage,
    readCookiesPage,
    readCustomerByCode,
    readCookieById,
    readCustomersByCodes,
    readCookiesByIds,
    readCookieCandidatesForGenerate,
    readCookieIndex,
    updateCookieIndexDelta,
    rebuildCookieIndex,
    persistCustomers,
    persistCookies,
    persistAll,
    persistMeta,
    persistMetaDelta,
    writeDelta,
    sanitizeCustomer,
    sanitizeCookie,
    sanitizeCustomerStatus,
    sanitizeCookieStatus,
    makeCustomerCode,
    findCustomerByCode,
    findCustomerIndexByCode,
    maskNetflixId,
    computeCookieCounters,
    buildCookieSummary,
    buildWarrantyInfo,
    isCustomerWarrantyValid,
    isCookieOverCapacityActive,
    extractNetflixIdsFromCookie,
    splitImportLines,
    splitImportCookieBlocks,
    isLikelyDeadCookie,
    isTokenPermissionDenied,
    callNetflixCreateAutoLoginToken,
    buildUrlByDevice
};

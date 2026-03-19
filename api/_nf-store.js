
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

async function listCollectionDocs(collectionPath, options = {}) {
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 200), 1000));
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
            throw new Error(`Failed to list collection ${collectionPath}`);
        }

        let parsed = {};
        try { parsed = JSON.parse(response.body || '{}'); } catch (e) { parsed = {}; }
        if (Array.isArray(parsed.documents)) docs.push(...parsed.documents);
        pageToken = String(parsed.nextPageToken || '').trim();
    } while (pageToken);

    return docs;
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

    const cookiesCount = (await readCookiesV2()).length;
    await persistMeta({
        source: 'persistCustomers',
        totalCustomers: normalized.length,
        totalCookies: cookiesCount,
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
        storageVersion: STORAGE_VERSION_V2
    });
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
        storageVersion: STORAGE_VERSION_V2
    });
    return true;
}

async function writeDelta(payload = {}) {
    await ensureStorageForWrite();

    const upsertCustomersInput = Array.isArray(payload.upsertCustomers) ? payload.upsertCustomers : [];
    const upsertCookiesInput = Array.isArray(payload.upsertCookies) ? payload.upsertCookies : [];
    const deleteCustomerCodesInput = Array.isArray(payload.deleteCustomerCodes) ? payload.deleteCustomerCodes : [];
    const deleteCookieIdsInput = Array.isArray(payload.deleteCookieIds) ? payload.deleteCookieIds : [];

    const normalizedCustomers = upsertCustomersInput.map(sanitizeCustomer).filter((item) => !!item.code && !!item.name);
    const normalizedCookies = upsertCookiesInput.map(sanitizeCookie).filter((item) => !!item.id && (!!item.netflixId || !!item.cookieRaw));

    await Promise.all([
        normalizedCustomers.length > 0 ? upsertCustomers(normalizedCustomers) : Promise.resolve(),
        normalizedCookies.length > 0 ? upsertCookies(normalizedCookies) : Promise.resolve(),
        deleteCustomerCodesInput.length > 0 ? deleteCustomersByCodes(deleteCustomerCodesInput) : Promise.resolve(),
        deleteCookieIdsInput.length > 0 ? deleteCookiesByIds(deleteCookieIdsInput) : Promise.resolve()
    ]);

    const [customers, cookies] = await Promise.all([readCustomersV2(), readCookiesV2()]);
    await persistMeta({
        source: safeString(payload.source || 'writeDelta'),
        note: safeString(payload.note || 'NF delta update'),
        totalCustomers: customers.length,
        totalCookies: cookies.length,
        storageVersion: STORAGE_VERSION_V2
    });

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
    COLL_CUSTOMERS_ITEMS,
    COLL_COOKIES_ITEMS,
    STORAGE_VERSION_V2,
    parseBody,
    readCustomers,
    readCookies,
    persistCustomers,
    persistCookies,
    persistAll,
    persistMeta,
    writeDelta,
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
    isCookieOverCapacityActive,
    extractNetflixIdsFromCookie,
    splitImportLines,
    splitImportCookieBlocks,
    isLikelyDeadCookie,
    isTokenPermissionDenied,
    callNetflixCreateAutoLoginToken,
    buildUrlByDevice
};

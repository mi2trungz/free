import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    writeBatch,
    deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { NF_FIREBASE_CONFIG, NF_ADMIN_EMAILS, hasFirebaseConfig } from './firebase-config.js';

const CUSTOMER_COL = 'nf_customer_items';
const COOKIE_COL = 'nf_cookie_items';
const LEGACY_CUSTOMER_DOC = { col: 'settings', id: 'nf_customers' };
const LEGACY_COOKIE_DOC = { col: 'settings', id: 'nf_cookie_pool' };

let firebaseApp = null;
let auth = null;
let db = null;
let initPromise = null;
let bootstrapped = false;

function ensureConfigured() {
    if (!hasFirebaseConfig()) {
        throw new Error('Thiếu cấu hình Firebase client (NF_FIREBASE_CONFIG).');
    }
}

async function ensureInit() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        ensureConfigured();
        firebaseApp = initializeApp(NF_FIREBASE_CONFIG);
        auth = getAuth(firebaseApp);
        await setPersistence(auth, browserLocalPersistence);
        db = getFirestore(firebaseApp);
    })();
    return initPromise;
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function sanitizeCustomerStatus(status = '') {
    return String(status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function sanitizeCookieStatus(status = '') {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'disabled' || normalized === 'dead') return normalized;
    return 'active';
}

function maskNetflixId(netflixId = '') {
    const val = String(netflixId || '').trim();
    if (!val) return 'N/A';
    if (val.length <= 6) return `${val.slice(0, 2)}***`;
    return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

function toMillis(value = '') {
    const m = new Date(value || '').getTime();
    return Number.isFinite(m) ? m : 0;
}

function makeId(prefix = 'nf') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildWarrantyInfo(customer) {
    const expiresAt = toMillis(customer && customer.warrantyExpiresAt);
    if (!expiresAt) return { warrantyValid: false, remainingDays: 0 };
    const diff = expiresAt - Date.now();
    return {
        warrantyValid: diff >= 0,
        remainingDays: diff <= 0 ? 0 : Math.ceil(diff / (1000 * 60 * 60 * 24))
    };
}

function sanitizeCustomer(item = {}) {
    const now = new Date().toISOString();
    return {
        code: normalizeCode(item.code || ''),
        name: String(item.name || '').trim(),
        warrantyExpiresAt: String(item.warrantyExpiresAt || '').trim(),
        status: sanitizeCustomerStatus(item.status),
        assignedCookieId: String(item.assignedCookieId || '').trim(),
        createdAt: String(item.createdAt || now),
        updatedAt: String(item.updatedAt || now),
        lastLinkedAt: String(item.lastLinkedAt || '')
    };
}

function sanitizeCookie(item = {}) {
    const now = new Date().toISOString();
    const errorTagged = item.errorTagged === true || item.errorTagged === 'true' || item.errorTagged === 1 || item.errorTagged === '1';
    const sbdTagged = item.sbdTagged === true || item.sbdTagged === 'true' || item.sbdTagged === 1 || item.sbdTagged === '1';
    return {
        id: String(item.id || makeId('nf_ck')),
        netflixId: String(item.netflixId || '').trim(),
        secureNetflixId: String(item.secureNetflixId || '').trim(),
        cookieRaw: String(item.cookieRaw || '').trim(),
        note: String(item.note || '').trim(),
        status: sanitizeCookieStatus(item.status),
        errorTagged,
        sbdTagged,
        assignedCustomerCode: (errorTagged || sbdTagged) ? '' : normalizeCode(item.assignedCustomerCode || ''),
        createdAt: String(item.createdAt || now),
        updatedAt: String(item.updatedAt || now),
        lastCheckedAt: String(item.lastCheckedAt || ''),
        lastSuccessAt: String(item.lastSuccessAt || ''),
        lastErrorAt: String(item.lastErrorAt || ''),
        lastError: String(item.lastError || '')
    };
}

function parseCookieIds(body = {}) {
    const ids = [];
    const seen = new Set();
    function pushId(v) {
        const id = String(v || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    }
    if (Array.isArray(body.cookieIds)) body.cookieIds.forEach(pushId);
    if (body.cookieId !== undefined) pushId(body.cookieId);
    return ids;
}

function parseNetscapeLine(line = '') {
    const text = String(line || '').trim();
    if (!text) return null;

    const tabParts = text.split('\t');
    if (tabParts.length >= 7) {
        return { name: String(tabParts[5] || '').trim(), value: String(tabParts[6] || '').trim() };
    }

    const netscapeLikeMatch = text.match(/^(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(\d+)\s+([^\s]+)\s+(.+)$/i);
    if (!netscapeLikeMatch) return null;
    return { name: String(netscapeLikeMatch[6] || '').trim(), value: String(netscapeLikeMatch[7] || '').trim() };
}

function splitImportCookieBlocks(content = '') {
    const normalized = String(content || '').replace(/\r/g, '');
    if (!normalized.trim()) return [];

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const hasNetscapeRows = lines.some((line) => !!parseNetscapeLine(line));
    if (!hasNetscapeRows) {
        const chunks = normalized.split(/\n\s*\n+/).map((chunk) => chunk.trim()).filter(Boolean);
        if (chunks.length > 1) return chunks;
        return lines;
    }

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
            parsed.name === 'NetflixId'
            && seenNetflixId
            && seenSecureNetflixId
            && !!lastNetflixId
            && !!parsed.value
            && parsed.value !== lastNetflixId;

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

function normalizeCookieExtractionInput(cookieVal = '') {
    let raw = String(cookieVal || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        raw = raw.slice(1, -1).trim();
    }
    return raw;
}

function looksLikeRawNetflixId(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/[;\n]/.test(text)) return false;
    if (/^(?:NetflixId|SecureNetflixId)\s*=/i.test(text)) return false;
    if (/^ct(?:%3D|=)/i.test(text)) return true;
    if (/^v(?:%3D|=)\d+/i.test(text)) return true;
    return /^[A-Za-z0-9._~%\-]{80,}$/.test(text);
}

function extractNetflixIdsFromCookie(cookieVal = '') {
    const raw = normalizeCookieExtractionInput(cookieVal);
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
        const line = String(lines[i] || '').trim();
        if (!line) continue;

        const parsedLine = parseNetscapeLine(line);
        if (parsedLine) {
            if (parsedLine.name === 'NetflixId' && parsedLine.value) netflixId = parsedLine.value;
            if (parsedLine.name === 'SecureNetflixId' && parsedLine.value) secureNetflixId = parsedLine.value;
            continue;
        }

        const n = line.match(/(?:^|;|\s)NetflixId=([^;\s]+)/i);
        const s = line.match(/(?:^|;|\s)SecureNetflixId=([^;\s]+)/i);
        if (n && n[1]) netflixId = String(n[1]).trim();
        if (s && s[1]) secureNetflixId = String(s[1]).trim();
    }

    if (!netflixId) {
        const m = raw.match(/(?:^|;|\s)NetflixId=([^;\s]+)/i);
        if (m && m[1]) netflixId = String(m[1]).trim();
    }
    if (!secureNetflixId) {
        const m = raw.match(/(?:^|;|\s)SecureNetflixId=([^;\s]+)/i);
        if (m && m[1]) secureNetflixId = String(m[1]).trim();
    }
    if (!netflixId && looksLikeRawNetflixId(raw)) {
        netflixId = raw;
    }

    return { netflixId: String(netflixId || '').trim(), secureNetflixId: String(secureNetflixId || '').trim() };
}

function ensureAdminAuth() {
    const user = auth && auth.currentUser;
    if (!user) throw new Error('Unauthorized');
    const email = String(user.email || '').trim().toLowerCase();
    if (NF_ADMIN_EMAILS.length > 0 && !NF_ADMIN_EMAILS.includes(email)) {
        throw new Error('Unauthorized');
    }
    return user;
}

async function readAllCustomersRaw() {
    await ensureInit();
    const snap = await getDocs(collection(db, CUSTOMER_COL));
    const out = [];
    snap.forEach((d) => out.push(sanitizeCustomer({ ...(d.data() || {}), code: d.id })));
    return out;
}

async function readAllCookiesRaw() {
    await ensureInit();
    const snap = await getDocs(collection(db, COOKIE_COL));
    const out = [];
    snap.forEach((d) => out.push(sanitizeCookie({ ...(d.data() || {}), id: d.id })));
    return out;
}

async function ensureBootstrapped() {
    if (bootstrapped) return;
    await ensureInit();

    const [customersSnap, cookiesSnap] = await Promise.all([
        getDocs(collection(db, CUSTOMER_COL)),
        getDocs(collection(db, COOKIE_COL))
    ]);

    if (customersSnap.empty) {
        try {
            const legacyCustomers = await getDoc(doc(db, LEGACY_CUSTOMER_DOC.col, LEGACY_CUSTOMER_DOC.id));
            const list = Array.isArray(((legacyCustomers.data() || {}).customers)) ? legacyCustomers.data().customers : [];
            if (list.length > 0) {
                const batch = writeBatch(db);
                list.forEach((item) => {
                    const val = sanitizeCustomer(item || {});
                    if (!val.code || !val.name) return;
                    batch.set(doc(db, CUSTOMER_COL, val.code), val);
                });
                await batch.commit();
            }
        } catch (e) {
            // Ignore legacy bootstrap permission/data errors to avoid blocking /nf runtime.
        }
    }

    if (cookiesSnap.empty) {
        try {
            const legacyCookies = await getDoc(doc(db, LEGACY_COOKIE_DOC.col, LEGACY_COOKIE_DOC.id));
            const list = Array.isArray(((legacyCookies.data() || {}).cookies)) ? legacyCookies.data().cookies : [];
            if (list.length > 0) {
                const batch = writeBatch(db);
                list.forEach((item) => {
                    const val = sanitizeCookie(item || {});
                    if (!val.id) return;
                    batch.set(doc(db, COOKIE_COL, val.id), val);
                });
                await batch.commit();
            }
        } catch (e) {
            // Ignore legacy bootstrap permission/data errors to avoid blocking /nf runtime.
        }
    }

    bootstrapped = true;
}

function customerPublicDto(customer = {}) {
    const warranty = buildWarrantyInfo(customer);
    return {
        code: customer.code,
        name: customer.name,
        status: customer.status,
        warrantyExpiresAt: customer.warrantyExpiresAt || '',
        warrantyValid: warranty.warrantyValid,
        remainingDays: warranty.remainingDays,
        assignedCookieId: customer.assignedCookieId || '',
        createdAt: customer.createdAt || '',
        updatedAt: customer.updatedAt || '',
        lastLinkedAt: customer.lastLinkedAt || ''
    };
}

function cookiePublicDto(cookie = {}) {
    return {
        id: cookie.id,
        status: cookie.status,
        errorTagged: !!cookie.errorTagged,
        sbdTagged: !!cookie.sbdTagged,
        assignedCustomerCode: cookie.assignedCustomerCode || '',
        cookieRaw: cookie.cookieRaw || '',
        hasCookieRaw: !!String(cookie.cookieRaw || '').trim(),
        note: cookie.note || '',
        netflixIdMasked: maskNetflixId(cookie.netflixId),
        createdAt: cookie.createdAt || '',
        updatedAt: cookie.updatedAt || '',
        lastCheckedAt: cookie.lastCheckedAt || '',
        lastSuccessAt: cookie.lastSuccessAt || '',
        lastErrorAt: cookie.lastErrorAt || '',
        lastError: cookie.lastError || ''
    };
}

function sortCustomers(customers = []) {
    return customers.slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

function buildCookieSummary(cookies = []) {
    const total = cookies.length;
    const activeCount = cookies.filter((c) => c.status === 'active').length;
    const disabledCount = cookies.filter((c) => c.status === 'disabled').length;
    const deadCount = cookies.filter((c) => c.status === 'dead').length;
    const assignedCount = cookies.filter((c) => !!c.assignedCustomerCode).length;
    return { total, activeCount, disabledCount, deadCount, assignedCount };
}

function makeCustomerCode(existingCodes = []) {
    const set = new Set(existingCodes.map((code) => normalizeCode(code)));
    let code = '';
    do {
        code = `NF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    } while (set.has(code));
    return code;
}

async function handleAdminRoute(url = '', method = 'GET', body = {}) {
    if (url === '/api/admin/session' && method === 'GET') {
        await ensureInit();
        const user = auth.currentUser;
        const email = String((user && user.email) || '').trim().toLowerCase();
        const isAllowed = !!user && (NF_ADMIN_EMAILS.length === 0 || NF_ADMIN_EMAILS.includes(email));
        return {
            authenticated: isAllowed,
            user: isAllowed ? { email, role: 'admin' } : null,
            configured: true
        };
    }

    if (url === '/api/admin/login' && method === 'POST') {
        await ensureInit();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!email || !password) throw new Error('Email hoac mat khau khong hop le.');
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const loggedEmail = String((cred.user && cred.user.email) || '').trim().toLowerCase();
        if (NF_ADMIN_EMAILS.length > 0 && !NF_ADMIN_EMAILS.includes(loggedEmail)) {
            await signOut(auth);
            throw new Error('Email khong co quyen admin.');
        }
        return { success: true, user: { email: loggedEmail, role: 'admin' } };
    }

    if (url === '/api/admin/logout' && method === 'POST') {
        await ensureInit();
        await signOut(auth);
        return { success: true };
    }

    return null;
}

async function handleCustomersRoute(method = 'GET', body = {}) {
    ensureAdminAuth();
    await ensureBootstrapped();

    const customers = await readAllCustomersRaw();

    if (method === 'GET') {
        const sorted = sortCustomers(customers);
        return {
            total: sorted.length,
            customers: sorted.map(customerPublicDto)
        };
    }

    if (method === 'POST') {
        const name = String(body.name || '').trim();
        const warrantyExpiresAt = String(body.warrantyExpiresAt || '').trim();
        if (!name) throw new Error('Missing customer name');
        if (!warrantyExpiresAt) throw new Error('Missing warrantyExpiresAt');

        const now = new Date().toISOString();
        const code = makeCustomerCode(customers.map((c) => c.code));
        const next = sanitizeCustomer({
            code,
            name,
            warrantyExpiresAt,
            status: 'active',
            assignedCookieId: '',
            createdAt: now,
            updatedAt: now,
            lastLinkedAt: ''
        });

        await setDoc(doc(db, CUSTOMER_COL, next.code), next);
        return { success: true, customer: customerPublicDto(next) };
    }

    if (method === 'PUT') {
        const code = normalizeCode(body.code || '');
        if (!code) throw new Error('Missing customer code');

        const idx = customers.findIndex((item) => item.code === code);
        if (idx < 0) throw new Error('Customer not found');

        const newCode = normalizeCode(body.newCode || '');
        const nextCode = newCode || code;
        if (!nextCode) throw new Error('Customer code cannot be empty');
        if (nextCode !== code && customers.some((item) => item.code === nextCode)) {
            throw new Error('Customer code already exists');
        }

        const current = customers[idx];
        const updated = sanitizeCustomer({
            ...current,
            code: nextCode,
            name: body.name !== undefined ? String(body.name || '').trim() : current.name,
            warrantyExpiresAt: body.warrantyExpiresAt !== undefined ? String(body.warrantyExpiresAt || '').trim() : current.warrantyExpiresAt,
            status: body.status !== undefined ? sanitizeCustomerStatus(body.status) : current.status,
            updatedAt: new Date().toISOString()
        });

        if (!updated.name) throw new Error('Customer name cannot be empty');
        if (!updated.warrantyExpiresAt) throw new Error('warrantyExpiresAt cannot be empty');

        const batch = writeBatch(db);
        batch.set(doc(db, CUSTOMER_COL, updated.code), updated);
        if (nextCode !== code) {
            batch.delete(doc(db, CUSTOMER_COL, code));
            const cookies = await readAllCookiesRaw();
            cookies.forEach((cookie) => {
                if (normalizeCode(cookie.assignedCustomerCode || '') !== code) return;
                const nextCookie = sanitizeCookie({ ...cookie, assignedCustomerCode: nextCode, updatedAt: new Date().toISOString() });
                batch.set(doc(db, COOKIE_COL, nextCookie.id), nextCookie);
            });
        }
        await batch.commit();
        return { success: true, customer: customerPublicDto(updated) };
    }

    if (method === 'DELETE') {
        const code = normalizeCode(body.code || '');
        if (!code) throw new Error('Missing customer code');
        const exists = customers.some((item) => item.code === code);
        if (!exists) throw new Error('Customer not found');

        const cookies = await readAllCookiesRaw();
        const now = new Date().toISOString();
        const batch = writeBatch(db);
        batch.delete(doc(db, CUSTOMER_COL, code));
        cookies.forEach((cookie) => {
            if (normalizeCode(cookie.assignedCustomerCode || '') !== code) return;
            const nextCookie = sanitizeCookie({ ...cookie, assignedCustomerCode: '', updatedAt: now });
            batch.set(doc(db, COOKIE_COL, nextCookie.id), nextCookie);
        });
        await batch.commit();
        return { success: true };
    }

    throw new Error('Method not allowed');
}

async function handleCookiesImport(body = {}) {
    ensureAdminAuth();
    await ensureBootstrapped();

    const content = String(body.content || '').trim();
    if (!content) throw new Error('Missing import content');

    const blocks = splitImportCookieBlocks(content);
    if (blocks.length === 0) throw new Error('No cookie found in import content');

    const currentPool = await readAllCookiesRaw();
    const existingKeySet = new Set(currentPool.map((item) => `${item.netflixId}|${item.secureNetflixId || ''}`));

    const now = new Date().toISOString();
    const added = [];
    let skipped = 0;
    let invalid = 0;

    blocks.forEach((block) => {
        const ids = extractNetflixIdsFromCookie(block);
        if (!ids.netflixId) {
            invalid += 1;
            return;
        }
        const key = `${ids.netflixId}|${ids.secureNetflixId || ''}`;
        if (existingKeySet.has(key)) {
            skipped += 1;
            return;
        }
        existingKeySet.add(key);
        added.push(sanitizeCookie({
            id: makeId('nf_ck'),
            netflixId: ids.netflixId,
            secureNetflixId: ids.secureNetflixId || '',
            cookieRaw: block,
            status: 'active',
            assignedCustomerCode: '',
            createdAt: now,
            updatedAt: now,
            lastCheckedAt: '',
            lastSuccessAt: '',
            lastErrorAt: '',
            lastError: ''
        }));
    });

    if (added.length > 0) {
        const batch = writeBatch(db);
        added.forEach((item) => batch.set(doc(db, COOKIE_COL, item.id), item));
        await batch.commit();
    }

    return {
        success: true,
        addedCount: added.length,
        skippedCount: skipped,
        invalidCount: invalid
    };
}

async function handleCookiesRoute(url = '', method = 'GET', body = {}) {
    ensureAdminAuth();
    await ensureBootstrapped();

    const queryStart = url.indexOf('?');
    const queryStr = queryStart >= 0 ? url.slice(queryStart + 1) : '';
    const queryObj = new URLSearchParams(queryStr);
    const pathOnly = queryStart >= 0 ? url.slice(0, queryStart) : url;

    if (pathOnly === '/api/nf-cookies/import' && method === 'POST') {
        return handleCookiesImport(body);
    }

    const cookies = await readAllCookiesRaw();

    if (method === 'GET') {
        const mode = String(queryObj.get('mode') || '').trim().toLowerCase();
        if (mode === 'raw') {
            const cookieId = String(queryObj.get('cookieId') || '').trim();
            if (!cookieId) throw new Error('Missing cookieId');
            const target = cookies.find((item) => item.id === cookieId);
            if (!target) throw new Error('Cookie not found');
            return {
                cookieId: target.id,
                cookieRaw: target.cookieRaw || '',
                netflixIdMasked: maskNetflixId(target.netflixId),
                updatedAt: target.updatedAt || ''
            };
        }
        const summary = buildCookieSummary(cookies);
        return {
            ...summary,
            cookies: cookies.map(cookiePublicDto)
        };
    }

    if (method === 'PUT') {
        const cookieIds = parseCookieIds(body);
        if (cookieIds.length === 0) throw new Error('Missing cookieId');

        const targetSet = new Set(cookieIds);
        const now = new Date().toISOString();
        const existingById = new Map(cookies.map((item) => [item.id, item]));
        const missing = cookieIds.filter((id) => !existingById.has(id));
        if (missing.length > 0) throw new Error('Cookie not found');

        const hasErrorTagUpdate = body.errorTagged !== undefined;
        const hasSbdTagUpdate = body.sbdTagged !== undefined;
        const hasNoteUpdate = body.note !== undefined;
        const cookieRawInput = body.cookieRaw !== undefined ? String(body.cookieRaw || '').trim() : '';
        const hasCookieRawUpdate = cookieRawInput.length > 0;

        let parsedIds = null;
        if (hasCookieRawUpdate) {
            if (cookieIds.length !== 1) throw new Error('cookieRaw only supports single cookie update');
            const parsedBlocks = splitImportCookieBlocks(cookieRawInput);
            if (parsedBlocks.length !== 1) throw new Error('cookieRaw must contain exactly 1 cookie block');
            const normalizedCookieRaw = String(parsedBlocks[0] || '').trim();
            parsedIds = extractNetflixIdsFromCookie(normalizedCookieRaw);
            if (!parsedIds || !parsedIds.netflixId) throw new Error('cookieRaw missing NetflixId');
            parsedIds.cookieRaw = normalizedCookieRaw;
        }

        const batch = writeBatch(db);
        let shouldUnassignAny = false;

        cookieIds.forEach((id) => {
            const current = existingById.get(id);
            const nextStatus = body.status !== undefined ? sanitizeCookieStatus(body.status) : current.status;
            const nextErrorTagged = hasErrorTagUpdate ? !!body.errorTagged : !!current.errorTagged;
            const nextSbdTagged = hasSbdTagUpdate ? !!body.sbdTagged : !!current.sbdTagged;
            const nextNote = hasNoteUpdate ? String(body.note ?? '').trim() : String(current.note || '');
            const shouldUnassign = !!body.unassign || nextStatus !== 'active' || nextErrorTagged || nextSbdTagged;
            if (shouldUnassign) shouldUnassignAny = true;

            const nextCookie = hasCookieRawUpdate
                ? sanitizeCookie({
                    ...current,
                    netflixId: parsedIds.netflixId,
                    secureNetflixId: parsedIds.secureNetflixId || '',
                    cookieRaw: parsedIds.cookieRaw,
                    note: nextNote,
                    status: 'active',
                    errorTagged: nextErrorTagged,
                    sbdTagged: nextSbdTagged,
                    assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                    updatedAt: now,
                    lastCheckedAt: '',
                    lastSuccessAt: '',
                    lastErrorAt: '',
                    lastError: ''
                })
                : sanitizeCookie({
                    ...current,
                    status: nextStatus,
                    errorTagged: nextErrorTagged,
                    sbdTagged: nextSbdTagged,
                    note: nextNote,
                    assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                    updatedAt: now,
                    lastError: body.lastError !== undefined ? String(body.lastError || '') : current.lastError
                });

            batch.set(doc(db, COOKIE_COL, nextCookie.id), nextCookie);
        });

        if (shouldUnassignAny) {
            const customers = await readAllCustomersRaw();
            customers.forEach((customer) => {
                if (!targetSet.has(String(customer.assignedCookieId || '').trim())) return;
                const nextCustomer = sanitizeCustomer({ ...customer, assignedCookieId: '', updatedAt: now });
                batch.set(doc(db, CUSTOMER_COL, nextCustomer.code), nextCustomer);
            });
        }

        await batch.commit();
        return { success: true, affectedCount: cookieIds.length };
    }

    if (method === 'DELETE') {
        const cookieIds = parseCookieIds(body);
        if (cookieIds.length === 0) throw new Error('Missing cookieId');

        const existingById = new Map(cookies.map((item) => [item.id, item]));
        const missing = cookieIds.filter((id) => !existingById.has(id));
        if (missing.length > 0) throw new Error('Cookie not found');

        const batch = writeBatch(db);
        cookieIds.forEach((id) => batch.delete(doc(db, COOKIE_COL, id)));

        const targetSet = new Set(cookieIds);
        const customers = await readAllCustomersRaw();
        const now = new Date().toISOString();
        customers.forEach((customer) => {
            if (!targetSet.has(String(customer.assignedCookieId || '').trim())) return;
            const nextCustomer = sanitizeCustomer({ ...customer, assignedCookieId: '', updatedAt: now });
            batch.set(doc(db, CUSTOMER_COL, nextCustomer.code), nextCustomer);
        });

        await batch.commit();
        return { success: true, affectedCount: cookieIds.length };
    }

    throw new Error('Method not allowed');
}

export async function firebaseApiRequest(url = '', method = 'GET', body = null) {
    const normalizedUrl = String(url || '');
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const payload = body || {};

    if (!normalizedUrl.startsWith('/api/')) return null;

    const adminData = await handleAdminRoute(normalizedUrl, normalizedMethod, payload);
    if (adminData) return adminData;

    if (normalizedUrl.startsWith('/api/nf-customers')) {
        return handleCustomersRoute(normalizedMethod, payload);
    }

    if (normalizedUrl.startsWith('/api/nf-cookies/check')) {
        return null;
    }

    if (normalizedUrl.startsWith('/api/nf-cookies')) {
        return handleCookiesRoute(normalizedUrl, normalizedMethod, payload);
    }

    return null;
}

export async function firebaseImportCookies(content = '') {
    await ensureInit();
    return handleCookiesImport({ content });
}

export async function firebaseAdminLogin(email = '', password = '') {
    await ensureInit();
    return handleAdminRoute('/api/admin/login', 'POST', { email, password });
}

export async function firebaseAdminLogout() {
    await ensureInit();
    return handleAdminRoute('/api/admin/logout', 'POST', {});
}

export async function firebaseAdminSession() {
    await ensureInit();
    return handleAdminRoute('/api/admin/session', 'GET', {});
}

export async function onFirebaseAdminAuthChanged(handler) {
    await ensureInit();
    return onAuthStateChanged(auth, async () => {
        const session = await firebaseAdminSession();
        handler(session);
    });
}

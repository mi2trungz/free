const {
    parseBody,
    readCookiesPage,
    readCookiesByIds,
    readCustomersByCodes,
    writeDelta,
    sanitizeCookie,
    sanitizeCookieStatus,
    maskNetflixId,
    extractNetflixIdsFromCookie,
    splitImportCookieBlocks
} = require('../_nf-store');
const { getOrSet, invalidateMany } = require('../_response-cache');

const COOKIES_CACHE_NS = 'nf_cookies_get';
const COOKIES_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parsePagination(req) {
    try {
        const parsed = new URL(String((req && req.url) || ''), 'http://localhost');
        const page = Math.max(1, Number(parsed.searchParams.get('page') || DEFAULT_PAGE));
        const pageSize = Math.max(1, Math.min(Number(parsed.searchParams.get('pageSize') || DEFAULT_PAGE_SIZE), 100));
        return { page, pageSize };
    } catch (e) {
        return { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE };
    }
}

function cookiePublicDto(cookie) {
    return {
        id: cookie.id,
        status: cookie.status,
        errorTagged: !!cookie.errorTagged,
        sbdTagged: !!cookie.sbdTagged,
        unknownTagged: !!cookie.unknownTagged,
        holdTagged: !!cookie.holdTagged,
        iosTagged: !!cookie.iosTagged,
        overCapacityTagged: !!cookie.overCapacityTagged,
        overCapacityUntil: cookie.overCapacityUntil || '',
        lastOverCapacityAt: cookie.lastOverCapacityAt || '',
        assignedCustomerCode: cookie.assignedCustomerCode || '',
        cookieRaw: cookie.cookieRaw || '',
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

function parseCookieIds(body = {}) {
    const ids = [];
    const seen = new Set();

    function pushId(value) {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    }

    if (Array.isArray(body.cookieIds)) {
        body.cookieIds.forEach(pushId);
    }
    if (body.cookieId !== undefined) {
        pushId(body.cookieId);
    }

    return ids;
}

function findMissingCookieIds(cookies = [], cookieIds = []) {
    const existing = new Set(cookies.map((item) => item.id));
    return cookieIds.filter((id) => !existing.has(id));
}

function invalidateCookieRelatedCaches() {
    invalidateMany(['nf_cookies_get', 'nf_customers_get', 'nf_customer_lookup']);
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const { page, pageSize } = parsePagination(req);
            const cacheKey = `p=${page}|s=${pageSize}`;
            const { value } = await getOrSet(
                COOKIES_CACHE_NS,
                cacheKey,
                async () => {
                    const paged = await readCookiesPage({ page, pageSize });
                    const items = (paged.items || []).map(cookiePublicDto);
                    return {
                        summary: paged.summary || {
                            total: paged.total || 0,
                            activeCount: 0,
                            disabledCount: 0,
                            deadCount: 0,
                            assignedCount: 0,
                            unknownCount: 0,
                            holdCount: 0,
                            iosCount: 0,
                            overCapacityCount: 0
                        },
                        items,
                        cookies: items,
                        total: paged.total || 0,
                        page: paged.page || page,
                        pageSize: paged.pageSize || pageSize,
                        totalPages: paged.totalPages || 1,
                        hasNext: !!paged.hasNext,
                        hasPrev: !!paged.hasPrev
                    };
                },
                COOKIES_CACHE_TTL_MS
            );
            return res.status(200).json(value);
        }

        const body = parseBody(req.body);

        if (req.method === 'PUT') {
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) return res.status(400).json({ error: 'Missing cookieId' });

            const cookies = await readCookiesByIds(cookieIds);
            const missingIds = findMissingCookieIds(cookies, cookieIds);
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const targetIdSet = new Set(cookieIds);
            const now = new Date().toISOString();

            const cookieRawInput = body.cookieRaw !== undefined ? String(body.cookieRaw || '').trim() : '';
            const hasCookieRawUpdate = cookieRawInput.length > 0;
            const hasErrorTagUpdate = body.errorTagged !== undefined;
            const hasSbdTagUpdate = body.sbdTagged !== undefined;
            const hasUnknownTagUpdate = body.unknownTagged !== undefined;
            const hasHoldTagUpdate = body.holdTagged !== undefined;
            const hasIosTagUpdate = body.iosTagged !== undefined;
            const hasOverCapacityTagUpdate = body.overCapacityTagged !== undefined;
            const hasOverCapacityUntilUpdate = body.overCapacityUntil !== undefined;
            const hasLastOverCapacityAtUpdate = body.lastOverCapacityAt !== undefined;
            const hasNoteUpdate = body.note !== undefined;
            let parsedCookieIds = null;
            if (hasCookieRawUpdate) {
                if (cookieIds.length !== 1) {
                    return res.status(400).json({ error: 'cookieRaw only supports single cookie update' });
                }
                const parsedBlocks = splitImportCookieBlocks(cookieRawInput);
                if (parsedBlocks.length !== 1) {
                    return res.status(400).json({ error: 'cookieRaw must contain exactly 1 cookie block' });
                }
                const normalizedCookieRaw = String(parsedBlocks[0] || '').trim();
                parsedCookieIds = extractNetflixIdsFromCookie(normalizedCookieRaw);
                if (!parsedCookieIds || !parsedCookieIds.netflixId) {
                    return res.status(400).json({ error: 'cookieRaw missing NetflixId' });
                }
                parsedCookieIds.cookieRaw = normalizedCookieRaw;
            }

            let shouldUnassignAny = false;
            const updatedCookies = [];
            const impactedCustomerCodes = new Set();

            cookies.forEach((current) => {
                if (!targetIdSet.has(current.id)) return;

                const nextStatus = body.status !== undefined ? sanitizeCookieStatus(body.status) : current.status;
                const nextErrorTagged = hasErrorTagUpdate ? !!body.errorTagged : !!current.errorTagged;
                const nextSbdTagged = hasSbdTagUpdate ? !!body.sbdTagged : !!current.sbdTagged;
                const nextUnknownTagged = hasUnknownTagUpdate ? !!body.unknownTagged : !!current.unknownTagged;
                const nextHoldTagged = hasHoldTagUpdate ? !!body.holdTagged : !!current.holdTagged;
                const nextIosTagged = hasIosTagUpdate ? !!body.iosTagged : !!current.iosTagged;
                const nextOverCapacityTagged = hasOverCapacityTagUpdate ? !!body.overCapacityTagged : !!current.overCapacityTagged;
                let nextOverCapacityUntil = hasOverCapacityUntilUpdate
                    ? String(body.overCapacityUntil || '').trim()
                    : String(current.overCapacityUntil || '').trim();
                if (hasOverCapacityTagUpdate && !nextOverCapacityTagged) nextOverCapacityUntil = '';
                const nextOverCapacityUntilTs = Date.parse(nextOverCapacityUntil || '');
                const isOverCapacityActive = nextOverCapacityTagged
                    && Number.isFinite(nextOverCapacityUntilTs)
                    && nextOverCapacityUntilTs > Date.now();
                const nextLastOverCapacityAt = hasLastOverCapacityAtUpdate
                    ? String(body.lastOverCapacityAt || '').trim()
                    : (nextOverCapacityTagged ? (String(current.lastOverCapacityAt || '').trim() || now) : String(current.lastOverCapacityAt || '').trim());
                const nextNote = hasNoteUpdate ? String(body.note ?? '').trim() : String(current.note || '');
                const shouldUnassign = !!body.unassign
                    || nextStatus !== 'active'
                    || nextErrorTagged
                    || nextSbdTagged
                    || nextUnknownTagged
                    || nextHoldTagged
                    || nextIosTagged
                    || isOverCapacityActive;

                if (String(current.assignedCustomerCode || '').trim()) {
                    impactedCustomerCodes.add(String(current.assignedCustomerCode || '').trim().toUpperCase());
                }
                if (shouldUnassign) shouldUnassignAny = true;

                if (hasCookieRawUpdate) {
                    updatedCookies.push(sanitizeCookie({
                        ...current,
                        netflixId: parsedCookieIds.netflixId,
                        secureNetflixId: parsedCookieIds.secureNetflixId || '',
                        cookieRaw: parsedCookieIds.cookieRaw,
                        note: nextNote,
                        status: 'active',
                        errorTagged: nextErrorTagged,
                        sbdTagged: nextSbdTagged,
                        unknownTagged: nextUnknownTagged,
                        holdTagged: nextHoldTagged,
                        iosTagged: nextIosTagged,
                        overCapacityTagged: nextOverCapacityTagged,
                        overCapacityUntil: nextOverCapacityUntil,
                        lastOverCapacityAt: nextLastOverCapacityAt,
                        assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                        updatedAt: now,
                        lastCheckedAt: '',
                        lastSuccessAt: '',
                        lastErrorAt: '',
                        lastError: ''
                    }));
                    return;
                }

                updatedCookies.push(sanitizeCookie({
                    ...current,
                    status: nextStatus,
                    errorTagged: nextErrorTagged,
                    sbdTagged: nextSbdTagged,
                    unknownTagged: nextUnknownTagged,
                    holdTagged: nextHoldTagged,
                    iosTagged: nextIosTagged,
                    overCapacityTagged: nextOverCapacityTagged,
                    overCapacityUntil: nextOverCapacityUntil,
                    lastOverCapacityAt: nextLastOverCapacityAt,
                    note: nextNote,
                    assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                    updatedAt: now,
                    lastError: body.lastError !== undefined ? String(body.lastError || '') : current.lastError
                }));
            });

            if (!shouldUnassignAny) {
                const ok = await writeDelta({
                    source: 'nf-cookies-put',
                    upsertCookies: updatedCookies
                });
                if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
                invalidateCookieRelatedCaches();
                return res.status(200).json({ success: true, affectedCount: cookieIds.length });
            }

            const changedCustomers = [];
            const candidates = await readCustomersByCodes(Array.from(impactedCustomerCodes));
            const targetIdSetStr = new Set(cookieIds.map((id) => String(id)));
            candidates.forEach((customer) => {
                if (!targetIdSetStr.has(String(customer.assignedCookieId || '').trim())) return;
                changedCustomers.push({
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                });
            });

            const ok = await writeDelta({
                source: 'nf-cookies-put',
                upsertCookies: updatedCookies,
                upsertCustomers: changedCustomers
            });
            if (!ok) return res.status(500).json({ error: 'Failed to update cookie' });
            invalidateCookieRelatedCaches();
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        if (req.method === 'DELETE') {
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) return res.status(400).json({ error: 'Missing cookieId' });

            const cookies = await readCookiesByIds(cookieIds);
            const missingIds = findMissingCookieIds(cookies, cookieIds);
            if (missingIds.length > 0) {
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const now = new Date().toISOString();
            const targetIdSet = new Set(cookieIds.map((id) => String(id).trim()));
            const impactedCodes = new Set(cookies
                .map((cookie) => String(cookie.assignedCustomerCode || '').trim().toUpperCase())
                .filter(Boolean));

            const customers = await readCustomersByCodes(Array.from(impactedCodes));
            const changedCustomers = [];
            customers.forEach((customer) => {
                if (!targetIdSet.has(String(customer.assignedCookieId || '').trim())) return;
                changedCustomers.push({
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                });
            });

            const ok = await writeDelta({
                source: 'nf-cookies-delete',
                deleteCookieIds: cookieIds,
                upsertCustomers: changedCustomers
            });
            if (!ok) return res.status(500).json({ error: 'Failed to delete cookie' });
            invalidateCookieRelatedCaches();
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        const status = Math.max(400, Math.min(599, Number(e && e.httpStatus ? e.httpStatus : 500)));
        const payload = { error: (e && e.message) || 'Internal server error' };
        if (e && e.code) payload.code = e.code;
        return res.status(status).json(payload);
    }
};

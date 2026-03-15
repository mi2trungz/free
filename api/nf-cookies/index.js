const {
    parseBody,
    readCookies,
    readCookiesByIds,
    ensureCookieItemsBootstrapped,
    readCustomers,
    persistCustomers,
    upsertCookiesBulk,
    deleteCookiesByIds,
    sanitizeCookie,
    sanitizeCookieStatus,
    maskNetflixId,
    buildCookieSummary,
    extractNetflixIdsFromCookie,
    splitImportCookieBlocks
} = require('../_nf-store');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cookiePublicDto(cookie) {
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

function parseCookieIds(body = {}) {
    const ids = [];
    const seen = new Set();

    function pushId(value) {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    }

    if (Array.isArray(body.cookieIds)) body.cookieIds.forEach(pushId);
    if (body.cookieId !== undefined) pushId(body.cookieId);
    return ids;
}

function buildMissingCookieIds(existing = [], cookieIds = []) {
    const set = new Set((existing || []).map((item) => item.id));
    return cookieIds.filter((id) => !set.has(id));
}

async function loadTargetCookies(cookieIds = []) {
    const direct = await readCookiesByIds(cookieIds);
    if (direct.length === cookieIds.length) return direct;
    const missing = buildMissingCookieIds(direct, cookieIds);
    if (missing.length === 0) return direct;

    // Phase 1 compat: fallback read from legacy pool doc through readCookies().
    const all = await readCookies();
    const byId = new Map(all.map((item) => [item.id, item]));
    const merged = cookieIds.map((id) => byId.get(id)).filter(Boolean);
    return merged;
}

function createPerfTracker(method = 'GET') {
    const start = Date.now();
    const marks = { method };
    return {
        mark(name) {
            marks[name] = Date.now() - start;
        },
        done(statusCode = 200, error = '') {
            const totalMs = Date.now() - start;
            const payload = { ...marks, statusCode, totalMs };
            if (error) payload.error = String(error);
            const line = `[nf-cookies] ${JSON.stringify(payload)}`;
            if (totalMs > 1000) {
                console.warn(`${line} SLOW_REQUEST`);
            } else {
                console.log(line);
            }
        }
    };
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    const perf = createPerfTracker(req.method);

    try {
        if (req.method === 'GET') {
            const mode = String((req.query && req.query.mode) || '').trim().toLowerCase();
            const cookieId = String((req.query && req.query.cookieId) || '').trim();

            perf.mark('parseMs');
            if (mode === 'raw') {
                if (!cookieId) {
                    perf.done(400, 'Missing cookieId');
                    return res.status(400).json({ error: 'Missing cookieId' });
                }

                const cookies = await loadTargetCookies([cookieId]);
                perf.mark('readMs');
                const target = cookies[0];
                if (!target) {
                    perf.done(404, 'Cookie not found');
                    return res.status(404).json({ error: 'Cookie not found' });
                }
                perf.done(200);
                return res.status(200).json({
                    cookieId: target.id,
                    cookieRaw: target.cookieRaw || '',
                    netflixIdMasked: maskNetflixId(target.netflixId),
                    updatedAt: target.updatedAt || ''
                });
            }

            const cookies = await readCookies();
            perf.mark('readMs');
            const summary = buildCookieSummary(cookies);
            perf.done(200);
            return res.status(200).json({
                ...summary,
                cookies: cookies.map(cookiePublicDto)
            });
        }

        const body = parseBody(req.body);
        perf.mark('parseMs');

        if (req.method === 'PUT') {
            await ensureCookieItemsBootstrapped();
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) {
                perf.done(400, 'Missing cookieId');
                return res.status(400).json({ error: 'Missing cookieId' });
            }

            const currentCookies = await loadTargetCookies(cookieIds);
            perf.mark('readMs');
            const missingIds = buildMissingCookieIds(currentCookies, cookieIds);
            if (missingIds.length > 0) {
                perf.done(404, 'Cookie not found');
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const targetIdSet = new Set(cookieIds);
            const now = new Date().toISOString();
            const cookieRawInput = body.cookieRaw !== undefined ? String(body.cookieRaw || '').trim() : '';
            const hasCookieRawUpdate = cookieRawInput.length > 0;
            const hasErrorTagUpdate = body.errorTagged !== undefined;
            const hasSbdTagUpdate = body.sbdTagged !== undefined;
            const hasNoteUpdate = body.note !== undefined;

            let parsedCookieIds = null;
            if (hasCookieRawUpdate) {
                if (cookieIds.length !== 1) {
                    perf.done(400, 'cookieRaw only supports single cookie update');
                    return res.status(400).json({ error: 'cookieRaw only supports single cookie update' });
                }
                const parsedBlocks = splitImportCookieBlocks(cookieRawInput);
                if (parsedBlocks.length !== 1) {
                    perf.done(400, 'cookieRaw must contain exactly 1 cookie block');
                    return res.status(400).json({ error: 'cookieRaw must contain exactly 1 cookie block' });
                }
                const normalizedCookieRaw = String(parsedBlocks[0] || '').trim();
                parsedCookieIds = extractNetflixIdsFromCookie(normalizedCookieRaw);
                if (!parsedCookieIds || !parsedCookieIds.netflixId) {
                    perf.done(400, 'cookieRaw missing NetflixId');
                    return res.status(400).json({ error: 'cookieRaw missing NetflixId' });
                }
                parsedCookieIds.cookieRaw = normalizedCookieRaw;
            }

            let shouldUnassignAny = false;
            const nextCookies = currentCookies.map((current) => {
                if (!targetIdSet.has(current.id)) return current;
                const nextStatus = body.status !== undefined ? sanitizeCookieStatus(body.status) : current.status;
                const nextErrorTagged = hasErrorTagUpdate ? !!body.errorTagged : !!current.errorTagged;
                const nextSbdTagged = hasSbdTagUpdate ? !!body.sbdTagged : !!current.sbdTagged;
                const nextNote = hasNoteUpdate ? String(body.note ?? '').trim() : String(current.note || '');
                const shouldUnassign = !!body.unassign || nextStatus !== 'active' || nextErrorTagged || nextSbdTagged;
                if (shouldUnassign) shouldUnassignAny = true;

                if (hasCookieRawUpdate) {
                    return sanitizeCookie({
                        ...current,
                        netflixId: parsedCookieIds.netflixId,
                        secureNetflixId: parsedCookieIds.secureNetflixId || '',
                        cookieRaw: parsedCookieIds.cookieRaw,
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
                    });
                }

                return sanitizeCookie({
                    ...current,
                    status: nextStatus,
                    errorTagged: nextErrorTagged,
                    sbdTagged: nextSbdTagged,
                    note: nextNote,
                    assignedCustomerCode: shouldUnassign ? '' : current.assignedCustomerCode,
                    updatedAt: now,
                    lastError: body.lastError !== undefined ? String(body.lastError || '') : current.lastError
                });
            });

            const okUpsert = await upsertCookiesBulk(nextCookies);
            perf.mark('writeMs');
            if (!okUpsert) {
                perf.done(500, 'Failed to update cookie');
                return res.status(500).json({ error: 'Failed to update cookie' });
            }

            if (shouldUnassignAny) {
                const customers = await readCustomers();
                const nextCustomers = customers.map((customer) => {
                    if (!targetIdSet.has(customer.assignedCookieId || '')) return customer;
                    return {
                        ...customer,
                        assignedCookieId: '',
                        updatedAt: now
                    };
                });
                const okCustomers = await persistCustomers(nextCustomers);
                perf.mark('customerSyncMs');
                if (!okCustomers) {
                    perf.done(500, 'Failed to sync customers');
                    return res.status(500).json({ error: 'Failed to update cookie' });
                }
            }

            perf.done(200);
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        if (req.method === 'DELETE') {
            await ensureCookieItemsBootstrapped();
            const cookieIds = parseCookieIds(body);
            if (cookieIds.length === 0) {
                perf.done(400, 'Missing cookieId');
                return res.status(400).json({ error: 'Missing cookieId' });
            }

            const currentCookies = await loadTargetCookies(cookieIds);
            perf.mark('readMs');
            const missingIds = buildMissingCookieIds(currentCookies, cookieIds);
            if (missingIds.length > 0) {
                perf.done(404, 'Cookie not found');
                return res.status(404).json({ error: 'Cookie not found', missingIds });
            }

            const okDelete = await deleteCookiesByIds(cookieIds);
            perf.mark('writeMs');
            if (!okDelete) {
                perf.done(500, 'Failed to delete cookie');
                return res.status(500).json({ error: 'Failed to delete cookie' });
            }

            const now = new Date().toISOString();
            const targetIdSet = new Set(cookieIds);
            const customers = await readCustomers();
            const nextCustomers = customers.map((customer) => {
                if (!targetIdSet.has(customer.assignedCookieId || '')) return customer;
                return {
                    ...customer,
                    assignedCookieId: '',
                    updatedAt: now
                };
            });
            const okCustomers = await persistCustomers(nextCustomers);
            perf.mark('customerSyncMs');
            if (!okCustomers) {
                perf.done(500, 'Failed to sync customers');
                return res.status(500).json({ error: 'Failed to delete cookie' });
            }

            perf.done(200);
            return res.status(200).json({ success: true, affectedCount: cookieIds.length });
        }

        perf.done(405, 'Method not allowed');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        perf.done(500, e && e.message ? e.message : 'Internal server error');
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};

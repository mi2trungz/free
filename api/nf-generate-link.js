const {
    parseBody,
    readCustomerByCode,
    readCookieById,
    readCookieIndex,
    readCookiesByIds,
    readCookieCandidatesForGenerate,
    writeDelta,
    isCustomerWarrantyValid,
    isCookieOverCapacityActive,
    buildUrlByDevice,
    extractNetflixIdsFromCookie,
    sanitizeCookie,
    sanitizeCustomer
} = require('./_nf-store');
const { invalidateMany } = require('./_response-cache');
const { requestNetflixToken } = require('./_netflix-token-engine');

const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'tv']);

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function markCookieDead(cookie, errorMessage = '') {
    const now = new Date().toISOString();
    return {
        ...cookie,
        status: 'dead',
        lastCheckedAt: now,
        lastErrorAt: now,
        updatedAt: now,
        lastError: String(errorMessage || 'Cookie DIE'),
        assignedCustomerCode: ''
    };
}

function resolveEffectiveCookieIds(cookie = {}) {
    const storedNetflixId = String(cookie.netflixId || '').trim();
    const storedSecureNetflixId = String(cookie.secureNetflixId || '').trim();
    const parsed = extractNetflixIdsFromCookie(cookie.cookieRaw || '');
    const parsedNetflixId = String(parsed.netflixId || '').trim();
    const parsedSecureNetflixId = String(parsed.secureNetflixId || '').trim();

    const hasInvalidStoredNetflixId = !!storedNetflixId && /\s/.test(storedNetflixId);
    const hasInvalidStoredSecureNetflixId = !!storedSecureNetflixId && /\s/.test(storedSecureNetflixId);

    const netflixId = hasInvalidStoredNetflixId
        ? (parsedNetflixId || '')
        : (storedNetflixId || parsedNetflixId || '');
    const secureNetflixId = hasInvalidStoredSecureNetflixId
        ? (parsedSecureNetflixId || '')
        : (storedSecureNetflixId || parsedSecureNetflixId || '');

    return { netflixId, secureNetflixId };
}

function isUnknownPlan(planValue = '') {
    const text = String(planValue || '').trim().toLowerCase();
    if (!text) return true;
    return /unknow|unknown|n\/a/.test(text);
}

function isPaymentHoldYes(value = '') {
    const text = String(value || '').trim().toLowerCase();
    return text === 'yes' || text === 'true' || text === '1';
}

function evaluateCookieAccountTags(accountInfo = null) {
    const safe = accountInfo || {};
    const unknownTagged = isUnknownPlan(safe.plan);
    const holdTagged = isPaymentHoldYes(safe.on_payment_hold);
    return {
        unknownTagged,
        holdTagged
    };
}

function invalidateGenerateCaches() {
    invalidateMany(['nf_cookies_get', 'nf_customers_get', 'nf_customer_lookup']);
}

function buildPrioritizedCookieIdsFromIndex(indexDoc = {}, limit = 220, options = {}) {
    const maxTake = Math.max(limit, Math.min(limit * 4, 1200));
    const ids = [];
    const seen = new Set();
    const preferIos = !!options.preferIos;
    const groups = preferIos
        ? [
            Array.isArray(indexDoc.iosIds) ? indexDoc.iosIds : [],
            Array.isArray(indexDoc.normalIds) ? indexDoc.normalIds : [],
            Array.isArray(indexDoc.holdIds) ? indexDoc.holdIds : [],
            Array.isArray(indexDoc.unknownIds) ? indexDoc.unknownIds : []
        ]
        : [
            Array.isArray(indexDoc.normalIds) ? indexDoc.normalIds : [],
            Array.isArray(indexDoc.holdIds) ? indexDoc.holdIds : [],
            Array.isArray(indexDoc.unknownIds) ? indexDoc.unknownIds : []
        ];
    for (let g = 0; g < groups.length; g += 1) {
        const group = groups[g];
        for (let i = 0; i < group.length; i += 1) {
            const id = String(group[i] || '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
            if (ids.length >= maxTake) return ids;
        }
    }
    return ids;
}

function toSortableMillis(value = '') {
    const ms = new Date(String(value || '').trim()).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function resolveCookieNewnessMillis(cookie = {}) {
    const createdMs = toSortableMillis(cookie.createdAt || '');
    if (createdMs > 0) return createdMs;
    return toSortableMillis(cookie.updatedAt || '');
}

function sortBucketByNewestFirst(bucket = []) {
    return (Array.isArray(bucket) ? bucket : [])
        .map((cookie, index) => ({
            cookie,
            index,
            newnessMs: resolveCookieNewnessMillis(cookie)
        }))
        .sort((a, b) => {
            if (b.newnessMs !== a.newnessMs) return b.newnessMs - a.newnessMs;
            return a.index - b.index;
        })
        .map((item) => item.cookie);
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const customerCode = String(body.customerCode || '').trim().toUpperCase();
        const device = String(body.device || 'desktop').trim().toLowerCase();
        const mobileOs = String(body.mobileOs || 'android').trim().toLowerCase();
        if (!customerCode) return res.status(400).json({ error: 'Missing customerCode' });
        if (!ALLOWED_DEVICES.has(device)) return res.status(400).json({ error: 'Invalid device' });
        const isMobileFlow = device === 'mobile';
        const isIosRequest = isMobileFlow && mobileOs === 'ios';

        const customer = await readCustomerByCode(customerCode);
        if (!customer) return res.status(404).json({ error: 'Mã khách hàng không tồn tại.' });
        if (customer.status === 'inactive') return res.status(403).json({ error: 'Mã khách hàng đang tạm khóa.' });
        if (!isCustomerWarrantyValid(customer)) return res.status(403).json({ error: 'Mã khách hàng đã hết thời gian bảo hành.' });

        const now = new Date().toISOString();
        const customerNext = sanitizeCustomer({ ...customer });
        const cookieUpserts = new Map();
        let customerMutated = false;
        let hasPermissionDeniedCookie = false;

        function queueCookie(cookiePayload) {
            const sanitized = sanitizeCookie(cookiePayload);
            cookieUpserts.set(sanitized.id, sanitized);
            return sanitized;
        }

        function queueCustomerUpdate(payload = {}) {
            const next = sanitizeCustomer({
                ...customerNext,
                ...payload,
                updatedAt: payload.updatedAt || now
            });
            Object.assign(customerNext, next);
            customerMutated = true;
            return next;
        }

        async function persistDelta(source = 'nf-generate-link') {
            const upsertCookies = Array.from(cookieUpserts.values());
            const upsertCustomers = customerMutated ? [sanitizeCustomer(customerNext)] : [];
            if (upsertCookies.length === 0 && upsertCustomers.length === 0) return true;
            const ok = await writeDelta({ source, upsertCookies, upsertCustomers });
            if (ok) invalidateGenerateCaches();
            return ok;
        }

        async function finalizeSuccess(cookie, nftoken, reusedCookie) {
            const updatedCookie = queueCookie({
                ...cookie,
                status: 'active',
                assignedCustomerCode: customerNext.code,
                unknownTagged: false,
                holdTagged: false,
                overCapacityTagged: false,
                overCapacityUntil: '',
                lastOverCapacityAt: '',
                lastCheckedAt: now,
                lastSuccessAt: now,
                lastErrorAt: '',
                lastError: '',
                updatedAt: now
            });
            queueCustomerUpdate({
                assignedCookieId: updatedCookie.id,
                lastLinkedAt: now,
                updatedAt: now
            });

            const ok = await persistDelta('nf-generate-link-success');
            if (!ok) return res.status(500).json({ error: 'Failed to persist generated link state' });
            return res.status(200).json({
                success: true,
                customer: {
                    code: customerNext.code,
                    name: customerNext.name
                },
                cookieId: updatedCookie.id,
                reusedCookie: !!reusedCookie,
                device,
                url: buildUrlByDevice(nftoken, device)
            });
        }

        function unassignCurrentCustomerCookie() {
            if (!customerNext.assignedCookieId) return;
            queueCustomerUpdate({
                assignedCookieId: '',
                updatedAt: now
            });
        }

        async function tryCookie(cookie, reusedCookie) {
            const ids = resolveEffectiveCookieIds(cookie);
            if (!ids.netflixId) {
                queueCookie(markCookieDead(cookie, 'Cookie không có NetflixId hợp lệ.'));
                if (customerNext.assignedCookieId === cookie.id) {
                    unassignCurrentCustomerCookie();
                }
                return null;
            }

            const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');
            if (tokenResult.outcome === 'ok' && tokenResult.nftoken) {
                if (!tokenResult.accountInfo) {
                    queueCookie({
                        ...cookie,
                        status: 'active',
                        assignedCustomerCode: '',
                        unknownTagged: false,
                        holdTagged: false,
                        lastCheckedAt: now,
                        lastErrorAt: now,
                        lastError: 'Cookie LIVE nhưng không lấy được account info.',
                        updatedAt: now
                    });
                    if (customerNext.assignedCookieId === cookie.id) {
                        unassignCurrentCustomerCookie();
                    }
                    return null;
                }

                const tags = evaluateCookieAccountTags(tokenResult.accountInfo);
                if (tags.unknownTagged || tags.holdTagged) {
                    const tagMessage = [];
                    if (tags.unknownTagged) tagMessage.push('UNKNOW');
                    if (tags.holdTagged) tagMessage.push('HOLD');
                    queueCookie({
                        ...cookie,
                        status: 'active',
                        assignedCustomerCode: '',
                        unknownTagged: tags.unknownTagged,
                        holdTagged: tags.holdTagged,
                        lastCheckedAt: now,
                        lastErrorAt: now,
                        lastError: `Cookie LIVE nhưng bị tag ${tagMessage.join('+')}.`,
                        updatedAt: now
                    });
                    if (customerNext.assignedCookieId === cookie.id) {
                        unassignCurrentCustomerCookie();
                    }
                    return null;
                }

                return finalizeSuccess(cookie, tokenResult.nftoken, reusedCookie);
            }

            const reason = tokenResult.error || 'Cookie error';
            if (tokenResult.outcome === 'sbd_blocked') {
                hasPermissionDeniedCookie = true;
                queueCookie({
                    ...cookie,
                    status: 'active',
                    sbdTagged: true,
                    unknownTagged: false,
                    holdTagged: false,
                    assignedCustomerCode: '',
                    lastCheckedAt: now,
                    lastErrorAt: now,
                    lastError: reason,
                    updatedAt: now
                });
                if (customerNext.assignedCookieId === cookie.id) {
                    unassignCurrentCustomerCookie();
                }
                return null;
            }

            if (tokenResult.outcome === 'dead') {
                const deadCookie = markCookieDead(cookie, reason);
                deadCookie.unknownTagged = false;
                deadCookie.holdTagged = false;
                queueCookie(deadCookie);
                if (customerNext.assignedCookieId === cookie.id) {
                    unassignCurrentCustomerCookie();
                }
                return null;
            }

            queueCookie({
                ...cookie,
                status: 'active',
                unknownTagged: false,
                holdTagged: false,
                lastCheckedAt: now,
                lastErrorAt: now,
                lastError: reason,
                updatedAt: now
            });
            return null;
        }

        const assignedCookieId = String(customerNext.assignedCookieId || '').trim();
        if (assignedCookieId) {
            const assignedCookie = await readCookieById(assignedCookieId);
            if (assignedCookie) {
                if (
                    assignedCookie.errorTagged
                    || assignedCookie.sbdTagged
                    || assignedCookie.status === 'dead'
                    || isCookieOverCapacityActive(assignedCookie)
                    || (isIosRequest && !assignedCookie.iosTagged)
                    || (!isIosRequest && !!assignedCookie.iosTagged)
                ) {
                    unassignCurrentCustomerCookie();
                } else {
                    const lockedByOther = assignedCookie.assignedCustomerCode && assignedCookie.assignedCustomerCode !== customerNext.code;
                    if (lockedByOther) {
                        unassignCurrentCustomerCookie();
                    } else {
                        const assignedResult = await tryCookie(assignedCookie, true);
                        if (assignedResult) return assignedResult;
                    }
                }
            } else {
                unassignCurrentCustomerCookie();
            }
        }

        let candidates = [];
        let shouldFallbackScan = false;
        try {
            const indexDoc = await readCookieIndex();
            const candidateIds = buildPrioritizedCookieIdsFromIndex(indexDoc, 220, { preferIos: isIosRequest });
            if (candidateIds.length > 0) {
                const maxRead = Math.max(220, Math.min(candidateIds.length, 420));
                candidates = await readCookiesByIds(candidateIds.slice(0, maxRead));
            } else if (!indexDoc.exists) {
                shouldFallbackScan = true;
            }
        } catch (e) {
            shouldFallbackScan = true;
        }

        if (shouldFallbackScan || candidates.length === 0) {
            candidates = await readCookieCandidatesForGenerate({
                limit: 220,
                scanMax: 700
            });
        }

        const iosBucket = [];
        const normalBucket = [];
        const holdBucket = [];
        const unknownBucket = [];

        for (let i = 0; i < candidates.length; i += 1) {
            const cookie = candidates[i];
            if (!cookie || !cookie.id) continue;
            if (cookie.errorTagged) continue;
            if (cookie.sbdTagged) continue;
            if (cookie.status !== 'active') continue;
            if (isCookieOverCapacityActive(cookie)) continue;
            if (cookie.assignedCustomerCode && cookie.assignedCustomerCode !== customerNext.code) continue;
            if (cookie.id === assignedCookieId) continue;
            if (!isIosRequest && cookie.iosTagged) continue;

            if (cookie.iosTagged) iosBucket.push(cookie);
            else if (cookie.holdTagged) holdBucket.push(cookie);
            else if (cookie.unknownTagged) unknownBucket.push(cookie);
            else normalBucket.push(cookie);
        }

        const prioritizedBuckets = isIosRequest
            ? [
                sortBucketByNewestFirst(iosBucket),
                sortBucketByNewestFirst(normalBucket),
                sortBucketByNewestFirst(holdBucket),
                sortBucketByNewestFirst(unknownBucket)
            ]
            : [
                sortBucketByNewestFirst(normalBucket),
                sortBucketByNewestFirst(holdBucket),
                sortBucketByNewestFirst(unknownBucket)
            ];
        for (let b = 0; b < prioritizedBuckets.length; b += 1) {
            const bucket = prioritizedBuckets[b];
            for (let j = 0; j < bucket.length; j += 1) {
                const attemptResult = await tryCookie(bucket[j], false);
                if (attemptResult) return attemptResult;
            }
        }

        if (cookieUpserts.size > 0 || customerMutated) {
            await persistDelta('nf-generate-link-no-live');
        }

        if (hasPermissionDeniedCookie) {
            return res.status(503).json({
                error: 'Cookie LIVE nhưng bị Netflix chặn tạo token tự động. Vui lòng thay cookie khác.'
            });
        }

        return res.status(503).json({ error: 'Không còn cookie LIVE khả dụng trong danh sách.' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};


const {
    parseBody,
    readCustomers,
    readCookies,
    persistAll,
    findCustomerByCode,
    isCustomerWarrantyValid,
    buildUrlByDevice,
    extractNetflixIdsFromCookie
} = require('./_nf-store');
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

    // Ưu tiên field đã lưu; chỉ fallback khi thiếu hoặc có dấu hiệu bất thường.
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

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const customerCode = String(body.customerCode || '').trim().toUpperCase();
        const device = String(body.device || 'desktop').trim().toLowerCase();
        if (!customerCode) return res.status(400).json({ error: 'Missing customerCode' });
        if (!ALLOWED_DEVICES.has(device)) return res.status(400).json({ error: 'Invalid device' });

        const [customers, cookies] = await Promise.all([readCustomers(), readCookies()]);
        const customer = findCustomerByCode(customers, customerCode);
        if (!customer) return res.status(404).json({ error: 'Mã khách hàng không tồn tại.' });
        if (customer.status === 'inactive') return res.status(403).json({ error: 'Mã khách hàng đang tạm khóa.' });
        if (!isCustomerWarrantyValid(customer)) return res.status(403).json({ error: 'Mã khách hàng đã hết thời gian bảo hành.' });

        const now = new Date().toISOString();
        const customerIndex = customers.findIndex((item) => item.code === customer.code);
        let mutated = false;
        let hasPermissionDeniedCookie = false;

        function unassignCustomerCurrentCookie() {
            if (!customers[customerIndex].assignedCookieId) return;
            customers[customerIndex] = {
                ...customers[customerIndex],
                assignedCookieId: '',
                updatedAt: now
            };
            mutated = true;
        }

        async function finalizeSuccess(cookieIndex, nftoken, reusedCookie) {
            const currentCookie = cookies[cookieIndex];
            cookies[cookieIndex] = {
                ...currentCookie,
                status: 'active',
                assignedCustomerCode: customers[customerIndex].code,
                unknownTagged: false,
                holdTagged: false,
                lastCheckedAt: now,
                lastSuccessAt: now,
                lastErrorAt: '',
                lastError: '',
                updatedAt: now
            };
            customers[customerIndex] = {
                ...customers[customerIndex],
                assignedCookieId: currentCookie.id,
                lastLinkedAt: now,
                updatedAt: now
            };
            mutated = true;
            await persistAll(customers, cookies, 'nf-generate-link-success');
            return res.status(200).json({
                success: true,
                customer: {
                    code: customers[customerIndex].code,
                    name: customers[customerIndex].name
                },
                cookieId: currentCookie.id,
                reusedCookie: !!reusedCookie,
                device,
                url: buildUrlByDevice(nftoken, device)
            });
        }

        async function tryCookieAtIndex(cookieIndex, reusedCookie) {
            const cookie = cookies[cookieIndex];
            const ids = resolveEffectiveCookieIds(cookie);
            if (!ids.netflixId) {
                cookies[cookieIndex] = markCookieDead(cookies[cookieIndex], 'Cookie không có NetflixId hợp lệ.');
                if (customers[customerIndex].assignedCookieId === cookies[cookieIndex].id) {
                    unassignCustomerCurrentCookie();
                }
                mutated = true;
                return null;
            }

            const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');

            if (tokenResult.outcome === 'ok' && tokenResult.nftoken) {
                if (!tokenResult.accountInfo) {
                    cookies[cookieIndex] = {
                        ...cookies[cookieIndex],
                        status: 'active',
                        assignedCustomerCode: '',
                        unknownTagged: false,
                        holdTagged: false,
                        lastCheckedAt: now,
                        lastErrorAt: now,
                        lastError: 'Cookie LIVE nhung khong lay duoc account info.',
                        updatedAt: now
                    };
                    if (customers[customerIndex].assignedCookieId === cookies[cookieIndex].id) {
                        unassignCustomerCurrentCookie();
                    }
                    mutated = true;
                    return null;
                }

                const tags = evaluateCookieAccountTags(tokenResult.accountInfo);
                if (tags.unknownTagged || tags.holdTagged) {
                    const tagMessage = [];
                    if (tags.unknownTagged) tagMessage.push('UNKNOW');
                    if (tags.holdTagged) tagMessage.push('HOLD');
                    cookies[cookieIndex] = {
                        ...cookies[cookieIndex],
                        status: 'active',
                        assignedCustomerCode: '',
                        unknownTagged: tags.unknownTagged,
                        holdTagged: tags.holdTagged,
                        lastCheckedAt: now,
                        lastErrorAt: now,
                        lastError: `Cookie LIVE nhung bi tag ${tagMessage.join('+')}.`,
                        updatedAt: now
                    };
                    if (customers[customerIndex].assignedCookieId === cookies[cookieIndex].id) {
                        unassignCustomerCurrentCookie();
                    }
                    mutated = true;
                    return null;
                }

                return finalizeSuccess(cookieIndex, tokenResult.nftoken, reusedCookie);
            }

            const reason = tokenResult.error || 'Cookie error';

            if (tokenResult.outcome === 'sbd_blocked') {
                hasPermissionDeniedCookie = true;
                cookies[cookieIndex] = {
                    ...cookies[cookieIndex],
                    status: 'active',
                    sbdTagged: true,
                    unknownTagged: false,
                    holdTagged: false,
                    assignedCustomerCode: '',
                    lastCheckedAt: now,
                    lastErrorAt: now,
                    lastError: reason,
                    updatedAt: now
                };
                if (customers[customerIndex].assignedCookieId === cookies[cookieIndex].id) {
                    unassignCustomerCurrentCookie();
                }
                mutated = true;
                return null;
            }

            if (tokenResult.outcome === 'dead') {
                cookies[cookieIndex] = markCookieDead(cookies[cookieIndex], reason);
                cookies[cookieIndex].unknownTagged = false;
                cookies[cookieIndex].holdTagged = false;
                if (customers[customerIndex].assignedCookieId === cookies[cookieIndex].id) {
                    unassignCustomerCurrentCookie();
                }
                mutated = true;
                return null;
            }

            cookies[cookieIndex] = {
                ...cookies[cookieIndex],
                status: 'active',
                unknownTagged: false,
                holdTagged: false,
                lastCheckedAt: now,
                lastErrorAt: now,
                lastError: reason,
                updatedAt: now
            };
            mutated = true;
            return null;
        }

        const assignedCookieId = customers[customerIndex].assignedCookieId || '';
        if (assignedCookieId) {
            const assignedIdx = cookies.findIndex((item) => item.id === assignedCookieId);
            if (assignedIdx >= 0) {
                const assignedCookie = cookies[assignedIdx];
                if (assignedCookie.errorTagged || assignedCookie.sbdTagged || assignedCookie.unknownTagged || assignedCookie.holdTagged) {
                    unassignCustomerCurrentCookie();
                } else {
                const lockedByOther = assignedCookie.assignedCustomerCode && assignedCookie.assignedCustomerCode !== customers[customerIndex].code;
                if (lockedByOther) {
                    unassignCustomerCurrentCookie();
                } else {
                    const assignedResult = await tryCookieAtIndex(assignedIdx, true);
                    if (assignedResult) return assignedResult;
                }
                }
            } else {
                unassignCustomerCurrentCookie();
            }
        }

        for (let i = 0; i < cookies.length; i += 1) {
            const cookie = cookies[i];
            if (cookie.errorTagged) continue;
            if (cookie.sbdTagged) continue;
            if (cookie.unknownTagged) continue;
            if (cookie.holdTagged) continue;
            if (cookie.status !== 'active') continue;
            if (cookie.assignedCustomerCode && cookie.assignedCustomerCode !== customers[customerIndex].code) continue;
            if (cookie.id === assignedCookieId) continue;

            const attemptResult = await tryCookieAtIndex(i, false);
            if (attemptResult) return attemptResult;
        }

        if (mutated) {
            await persistAll(customers, cookies, 'nf-generate-link-no-live');
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

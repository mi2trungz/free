const { extractNetflixIdsFromCookie } = require('./_nf-store');
const { requestNetflixToken, detectPlaybackOverCapacity } = require('./_netflix-token-engine');

const COOKIE_CHECK_CACHE_TTL_MS = 45 * 1000;
const cookieCheckCache = new Map();

function sanitizeCookieRaw(value = '') {
    return String(value || '').trim();
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

function summarizeCookieCheck(accountInfo = null) {
    const info = accountInfo && typeof accountInfo === 'object' ? accountInfo : {};
    return {
        plan: String(info.plan || '').trim(),
        country: String(info.country || '').trim(),
        paymentHold: String(info.on_payment_hold || '').trim(),
        profiles: String(info.profiles || '').trim(),
        maxStreams: String(info.max_streams || '').trim(),
        videoQuality: String(info.video_quality || '').trim()
    };
}

function cloneCookieCheckResult(result) {
    return result ? JSON.parse(JSON.stringify(result)) : result;
}

function getCookieCheckCacheKey(cookieRaw = '') {
    return sanitizeCookieRaw(cookieRaw);
}

function readCachedCookieCheck(cookieRaw = '') {
    const key = getCookieCheckCacheKey(cookieRaw);
    if (!key) return null;
    const cached = cookieCheckCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        cookieCheckCache.delete(key);
        return null;
    }
    return cloneCookieCheckResult(cached.result);
}

function writeCachedCookieCheck(cookieRaw = '', result = null) {
    const key = getCookieCheckCacheKey(cookieRaw);
    if (!key || !result) return;
    cookieCheckCache.set(key, {
        expiresAt: Date.now() + COOKIE_CHECK_CACHE_TTL_MS,
        result: cloneCookieCheckResult(result)
    });
}

async function evaluateGetlinkCookie(cookieRaw = '') {
    const finalCookie = sanitizeCookieRaw(cookieRaw);
    if (!finalCookie) {
        return {
            ok: false,
            reason: 'missing_cookie',
            error: 'Cookie trong.',
            accountInfo: null,
            summary: summarizeCookieCheck(null)
        };
    }

    const cached = readCachedCookieCheck(finalCookie);
    if (cached) return cached;

    const ids = extractNetflixIdsFromCookie(finalCookie);
    if (!ids.netflixId) {
        const result = {
            ok: false,
            reason: 'invalid_cookie',
            error: 'Khong tim thay NetflixId hop le trong cookie.',
            accountInfo: null,
            summary: summarizeCookieCheck(null)
        };
        writeCachedCookieCheck(finalCookie, result);
        return result;
    }

    const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');
    const accountInfo = tokenResult.accountInfo || null;
    const summary = summarizeCookieCheck(accountInfo);

    if (!(tokenResult.outcome === 'ok' && tokenResult.nftoken)) {
        const result = {
            ok: false,
            reason: tokenResult.outcome || 'token_error',
            error: String(tokenResult.error || 'Khong tao duoc link tu cookie.').trim(),
            accountInfo,
            summary
        };
        writeCachedCookieCheck(finalCookie, result);
        return result;
    }

    if (!accountInfo) {
        const result = {
            ok: false,
            reason: 'missing_account_info',
            error: 'Khong lay duoc thong tin tai khoan tu cookie.',
            accountInfo: null,
            summary
        };
        writeCachedCookieCheck(finalCookie, result);
        return result;
    }

    if (isPaymentHoldYes(accountInfo.on_payment_hold)) {
        const result = {
            ok: false,
            reason: 'payment_hold',
            error: 'Cookie dang bi payment hold = yes.',
            accountInfo,
            summary
        };
        writeCachedCookieCheck(finalCookie, result);
        return result;
    }

    if (isUnknownPlan(accountInfo.plan)) {
        const result = {
            ok: false,
            reason: 'unknown_plan',
            error: 'Cookie co plan = unknow/unknown.',
            accountInfo,
            summary
        };
        writeCachedCookieCheck(finalCookie, result);
        return result;
    }

    const overcap = detectPlaybackOverCapacity(accountInfo);
    const result = {
        ok: true,
        reason: 'ok',
        error: '',
        nftoken: tokenResult.nftoken || '',
        accountInfo,
        summary,
        overloadOutcome: overcap.overloaded ? 'overloaded' : 'live_ok',
        overloadSignal: overcap.signal || '',
        overloadMessage: overcap.overloaded
            ? 'Cookie LIVE nhung co dau hieu qua tai nguoi dung.'
            : 'Cookie LIVE va khong co dau hieu qua tai.'
    };
    writeCachedCookieCheck(finalCookie, result);
    return result;
}

module.exports = {
    evaluateGetlinkCookie,
    isPaymentHoldYes,
    isUnknownPlan
};

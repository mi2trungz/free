const { extractNetflixIdsFromCookie } = require('./_nf-store');
const { requestNetflixToken, detectPlaybackOverCapacity } = require('./_netflix-token-engine');

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

    const ids = extractNetflixIdsFromCookie(finalCookie);
    if (!ids.netflixId) {
        return {
            ok: false,
            reason: 'invalid_cookie',
            error: 'Khong tim thay NetflixId hop le trong cookie.',
            accountInfo: null,
            summary: summarizeCookieCheck(null)
        };
    }

    const tokenResult = await requestNetflixToken(ids.netflixId, ids.secureNetflixId || '');
    const accountInfo = tokenResult.accountInfo || null;
    const summary = summarizeCookieCheck(accountInfo);

    if (!(tokenResult.outcome === 'ok' && tokenResult.nftoken)) {
        return {
            ok: false,
            reason: tokenResult.outcome || 'token_error',
            error: String(tokenResult.error || 'Khong tao duoc link tu cookie.').trim(),
            accountInfo,
            summary
        };
    }

    if (!accountInfo) {
        return {
            ok: false,
            reason: 'missing_account_info',
            error: 'Khong lay duoc thong tin tai khoan tu cookie.',
            accountInfo: null,
            summary
        };
    }

    if (isPaymentHoldYes(accountInfo.on_payment_hold)) {
        return {
            ok: false,
            reason: 'payment_hold',
            error: 'Cookie dang bi payment hold = yes.',
            accountInfo,
            summary
        };
    }

    if (isUnknownPlan(accountInfo.plan)) {
        return {
            ok: false,
            reason: 'unknown_plan',
            error: 'Cookie co plan = unknow/unknown.',
            accountInfo,
            summary
        };
    }

    const overcap = detectPlaybackOverCapacity(accountInfo);
    return {
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
}

module.exports = {
    evaluateGetlinkCookie,
    isPaymentHoldYes,
    isUnknownPlan
};

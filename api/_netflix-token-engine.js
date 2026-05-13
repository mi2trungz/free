const https = require('https');

const tokenCache = new Map();
const TOKEN_CACHE_TTL_OK_MS = 25 * 1000;
const TOKEN_CACHE_TTL_QUOTA_MS = 8 * 1000;
const TOKEN_CACHE_TTL_ERROR_MS = 5 * 1000;

function isTokenPermissionDenied(errorText = '') {
    return /detailedaccessdeniedexception|access denied by sbd|permission_denied/i.test(String(errorText || ''));
}

function isQuotaError(errorText = '', statusCode = 0) {
    const msg = String(errorText || '').toLowerCase();
    if (statusCode === 429) return true;
    return /quota|resource_exhausted|too many requests|rate limit|exceeded/i.test(msg);
}

function isLikelyDeadCookie(errorText = '', statusCode = 0) {
    const msg = String(errorText || '').toLowerCase();
    if (statusCode === 401 || statusCode === 403) return true;
    return /cookie|expired|invalid|unauthor|forbidden|auth|login|sign in|session/i.test(msg);
}

function pickPlaybackFeatureResponse(accountInfo = null) {
    const features = accountInfo && accountInfo.pacsFeatures && Array.isArray(accountInfo.pacsFeatures.featureResponses)
        ? accountInfo.pacsFeatures.featureResponses
        : [];
    return features.find((item) => String(item && item.featureName ? item.featureName : '').toUpperCase() === 'CAN_PLAYBACK') || null;
}

function detectPlaybackOverCapacity(accountInfo = null) {
    if (!accountInfo || typeof accountInfo !== 'object') {
        return { overloaded: false, signal: 'missing_account_info' };
    }

    const playbackFeature = pickPlaybackFeatureResponse(accountInfo);
    if (playbackFeature) {
        const classification = String(playbackFeature.responseClassification || '').trim().toUpperCase();
        const pacsCode = String(playbackFeature.pacsDetail && playbackFeature.pacsDetail.pacsDetailCode
            ? playbackFeature.pacsDetail.pacsDetailCode
            : '').trim().toLowerCase();
        const pacsExperience = String(playbackFeature.pacsDetail && playbackFeature.pacsDetail.pacsExperience
            ? playbackFeature.pacsDetail.pacsExperience
            : '').trim().toLowerCase();
        const playbackBlocked = classification && classification !== 'ALLOWED';
        const strongCodeSignal = /(too[_\s-]?many|concurr|simultan|stream|capacity|limit|device)/i.test(pacsCode);
        const strongExpSignal = /(too[_\s-]?many|concurr|simultan|stream|capacity|limit|device)/i.test(pacsExperience);
        if (playbackBlocked && (strongCodeSignal || strongExpSignal)) {
            return { overloaded: true, signal: 'pacs_playback_blocked' };
        }
    }

    const flattened = JSON.stringify(accountInfo).toLowerCase();
    if (
        /too many (devices|users|streams)|maximum number of streams|simultaneous streams|concurrent streams|account is in use|over capacity|capacity exceeded/i.test(flattened)
    ) {
        return { overloaded: true, signal: 'account_info_message' };
    }

    return { overloaded: false, signal: 'no_overload_signal' };
}

function callNfCheckerApi(netflixId) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            content: `NetflixId=${netflixId}`,
            mode: 'fullinfo'
        });

        const req = https.request('https://nfchecker.firet.io/api/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data || '{}');
                    if (parsed.status === 'success' && parsed.token_result && parsed.token_result.status === 'Success') {
                        return resolve({
                            ok: true,
                            nftoken: parsed.token_result.token,
                            accountInfo: parsed.account_info || null
                        });
                    }
                    return resolve({ ok: false, error: parsed.message || 'nfchecker failed' });
                } catch (e) {
                    return resolve({ ok: false, error: 'nfchecker parse error' });
                }
            });
        });

        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.write(payload);
        req.end();
    });
}

function callNfCheckerAccountInfo(netflixId) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            content: `NetflixId=${netflixId}`,
            mode: 'fullinfo'
        });

        const req = https.request('https://nfchecker.firet.io/api/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data || '{}');
                    if (parsed && parsed.account_info) {
                        return resolve({ ok: true, accountInfo: parsed.account_info });
                    }
                    return resolve({ ok: false, error: parsed.message || 'Missing account info' });
                } catch (e) {
                    return resolve({ ok: false, error: 'nfchecker parse error' });
                }
            });
        });

        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.write(payload);
        req.end();
    });
}

function callNetflixCreateAutoLoginToken(netflixId, secureNetflixId) {
    return new Promise((resolve) => {
        let cookieStr = `NetflixId=${netflixId};`;
        if (secureNetflixId) cookieStr += ` SecureNetflixId=${secureNetflixId};`;

        const payload = JSON.stringify({
            operationName: 'CreateAutoLoginToken',
            variables: { scope: 'WEBVIEW_MOBILE_STREAMING' },
            extensions: {
                persistedQuery: {
                    version: 102,
                    id: '76e97129-f4b5-41a0-a73c-12e674896849'
                }
            }
        });

        const options = {
            hostname: 'android13.prod.ftl.netflix.com',
            port: 443,
            path: '/graphql',
            method: 'POST',
            headers: {
                'User-Agent': 'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Cookie: cookieStr,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const netflixReq = https.request(options, (netflixRes) => {
            let responseData = '';
            netflixRes.on('data', (d) => { responseData += d; });
            netflixRes.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData || '{}');
                    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
                        const errorMessage = String(parsed.errors[0] && parsed.errors[0].message ? parsed.errors[0].message : 'API Error from Netflix');
                        return resolve({ ok: false, statusCode: 400, error: errorMessage });
                    }
                    const token = parsed && parsed.data && parsed.data.createAutoLoginToken
                        ? parsed.data.createAutoLoginToken
                        : '';
                    if (!token) {
                        return resolve({ ok: false, statusCode: 500, error: 'Token not found in Netflix response' });
                    }
                    return resolve({ ok: true, nftoken: token });
                } catch (e) {
                    return resolve({ ok: false, statusCode: 500, error: 'Failed to parse Netflix response' });
                }
            });
        });

        netflixReq.on('error', (e) => resolve({ ok: false, statusCode: 500, error: e.message || 'Network error' }));
        netflixReq.write(payload);
        netflixReq.end();
    });
}

function classifyNetflixTokenResult(result = {}) {
    if (result.ok && result.nftoken) {
        return {
            outcome: 'ok',
            nftoken: result.nftoken,
            statusCode: result.statusCode || 200,
            error: ''
        };
    }

    const errorText = String(result.error || '').trim();
    const statusCode = Number(result.statusCode || 0);
    if (isTokenPermissionDenied(errorText)) {
        return { outcome: 'sbd_blocked', nftoken: '', statusCode, error: errorText };
    }
    if (isLikelyDeadCookie(errorText, statusCode)) {
        return { outcome: 'dead', nftoken: '', statusCode, error: errorText };
    }
    return { outcome: 'error', nftoken: '', statusCode, error: errorText || 'Unknown token error' };
}

function getTokenCacheKey(netflixId = '', secureNetflixId = '') {
    return `${String(netflixId || '').trim()}|${String(secureNetflixId || '').trim()}`;
}

function getCachedTokenResult(key = '') {
    const cached = tokenCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        tokenCache.delete(key);
        return null;
    }
    return cached.value;
}

function getResultTtlMs(result = {}) {
    if (result && result.outcome === 'ok' && result.nftoken) return TOKEN_CACHE_TTL_OK_MS;
    if (isQuotaError(result && result.error, Number(result && result.statusCode))) return TOKEN_CACHE_TTL_QUOTA_MS;
    return TOKEN_CACHE_TTL_ERROR_MS;
}

function setCachedTokenResult(key = '', result = {}) {
    const ttlMs = getResultTtlMs(result);
    tokenCache.set(key, {
        value: result,
        expiresAt: Date.now() + Math.max(0, ttlMs)
    });
}

async function requestNetflixToken(netflixId, secureNetflixId) {
    const cacheKey = getTokenCacheKey(netflixId, secureNetflixId);
    const cached = getCachedTokenResult(cacheKey);
    if (cached) return cached;

    const raw = await callNetflixCreateAutoLoginToken(netflixId, secureNetflixId || '');
    const result = classifyNetflixTokenResult(raw);

    if (result.outcome === 'ok' && result.nftoken) {
        const infoResult = await callNfCheckerAccountInfo(netflixId);
        const enriched = {
            ...result,
            accountInfo: infoResult.ok ? (infoResult.accountInfo || null) : null
        };
        setCachedTokenResult(cacheKey, enriched);
        return enriched;
    }

    if (isQuotaError(result.error, result.statusCode)) {
        setCachedTokenResult(cacheKey, result);
        return result;
    }

    if (result.outcome === 'sbd_blocked' || (result.outcome === 'dead' && !secureNetflixId)) {
        const fallback = await callNfCheckerApi(netflixId);
        if (fallback.ok && fallback.nftoken) {
            const fallbackResult = {
                outcome: 'ok',
                nftoken: fallback.nftoken,
                statusCode: 200,
                error: '',
                source: 'nfchecker_fallback',
                accountInfo: fallback.accountInfo || null
            };
            setCachedTokenResult(cacheKey, fallbackResult);
            return fallbackResult;
        }
    }

    setCachedTokenResult(cacheKey, result);
    return result;
}

module.exports = {
    isTokenPermissionDenied,
    isLikelyDeadCookie,
    detectPlaybackOverCapacity,
    callNetflixCreateAutoLoginToken,
    classifyNetflixTokenResult,
    requestNetflixToken,
    isQuotaError
};

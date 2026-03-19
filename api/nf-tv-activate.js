const {
    parseBody,
    readCustomers,
    readCookies,
    persistCookies,
    findCustomerByCode,
    isCustomerWarrantyValid,
    extractNetflixIdsFromCookie,
    buildApiErrorPayload
} = require('./_nf-store');

const TV8_URL = 'https://www.netflix.com/tv8';
const DEFAULT_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 2000;
const ALLOWED_OUTCOMES = new Set(['submitted', 'manual_required', 'failed']);

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function normalizeTvCode(value = '') {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function parseTimeoutMs() {
    const raw = Number(process.env.NF_TV_ACTIVATE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(raw, 120000);
}

function resolveEffectiveCookieIds(cookie = {}) {
    const storedNetflixId = String(cookie.netflixId || '').trim();
    const storedSecureNetflixId = String(cookie.secureNetflixId || '').trim();
    const parsed = extractNetflixIdsFromCookie(cookie.cookieRaw || '');
    const parsedNetflixId = String(parsed.netflixId || '').trim();
    const parsedSecureNetflixId = String(parsed.secureNetflixId || '').trim();

    const netflixId = storedNetflixId || parsedNetflixId || '';
    const secureNetflixId = storedSecureNetflixId || parsedSecureNetflixId || '';
    return { netflixId, secureNetflixId };
}

function canUseCookie(cookie = {}, customerCode = '') {
    if (!cookie) return false;
    if (cookie.status !== 'active') return false;
    if (cookie.errorTagged || cookie.sbdTagged) return false;
    if (cookie.unknownTagged || cookie.holdTagged) return false;
    const assigned = normalizeCode(cookie.assignedCustomerCode || '');
    if (assigned && assigned !== customerCode) return false;
    const ids = resolveEffectiveCookieIds(cookie);
    return !!ids.netflixId;
}

async function loadPlaywrightChromium() {
    try {
        const pwCore = require('playwright-core');
        if (pwCore && pwCore.chromium) return pwCore.chromium;
    } catch (e) {
        // ignore
    }
    try {
        const pw = require('playwright');
        if (pw && pw.chromium) return pw.chromium;
    } catch (e) {
        // ignore
    }
    return null;
}

async function connectBrowser(chromium, wsEndpoint) {
    try {
        return await chromium.connectOverCDP(wsEndpoint);
    } catch (e) {
        return chromium.connect(wsEndpoint);
    }
}

async function hasChallengeOrLogin(page) {
    const currentUrl = String(page.url() || '').toLowerCase();
    if (currentUrl.includes('/login')) return true;
    const html = String(await page.content()).toLowerCase();
    if (html.includes('captcha')) return true;
    if (html.includes('sign in')) return true;
    if (html.includes('đăng nhập')) return true;
    return false;
}

async function findFirstVisible(page, selectors = []) {
    for (const selector of selectors) {
        const node = page.locator(selector).first();
        try {
            if (await node.count() > 0 && await node.isVisible()) return node;
        } catch (e) {
            // ignore and continue
        }
    }
    return null;
}

async function submitTvCode(page, tvCode) {
    const inputSelectors = [
        'input[name="code"]',
        'input[data-uia*="code"]',
        'input[id*="code"]',
        'input[type="text"][maxlength="8"]'
    ];
    const submitSelectors = [
        'button[type="submit"]',
        'button[data-uia*="submit"]',
        'form button'
    ];

    const input = await findFirstVisible(page, inputSelectors);
    if (!input) {
        if (await hasChallengeOrLogin(page)) {
            return { outcome: 'manual_required', message: 'Netflix yeu cau dang nhap/captcha.' };
        }
        return { outcome: 'retry', message: 'Chua tim thay o nhap ma TV.' };
    }

    await input.fill(tvCode);
    const submitBtn = await findFirstVisible(page, submitSelectors);
    if (!submitBtn) {
        return { outcome: 'retry', message: 'Chua tim thay nut xac nhan ma TV.' };
    }

    try {
        await Promise.allSettled([
            submitBtn.click({ timeout: 5000 }),
            page.waitForLoadState('networkidle', { timeout: 8000 })
        ]);
    } catch (e) {
        // ignore
    }

    await page.waitForTimeout(1200);
    const html = String(await page.content()).toLowerCase();
    if (html.includes('invalid code') || html.includes('mã không hợp lệ') || html.includes('incorrect code')) {
        return { outcome: 'failed', message: 'Ma TV khong hop le hoac da het han.' };
    }
    if (await hasChallengeOrLogin(page)) {
        return { outcome: 'manual_required', message: 'Netflix yeu cau xac minh bo sung.' };
    }
    return { outcome: 'submitted', message: 'Da submit ma TV thanh cong.' };
}

async function runTvActivation(cookie, tvCode) {
    const wsEndpoint = String(process.env.BROWSERLESS_WS_ENDPOINT || '').trim();
    if (!wsEndpoint) {
        return { outcome: 'manual_required', message: 'Chua cau hinh BROWSERLESS_WS_ENDPOINT.' };
    }

    const chromium = await loadPlaywrightChromium();
    if (!chromium) {
        return { outcome: 'manual_required', message: 'Thieu Playwright runtime tren server.' };
    }

    const timeoutMs = parseTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    const ids = resolveEffectiveCookieIds(cookie);
    let browser;
    let context;

    try {
        browser = await connectBrowser(chromium, wsEndpoint);
        context = await browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
        });

        const nowUnix = Math.floor(Date.now() / 1000) + 3600;
        const cookies = [
            {
                name: 'NetflixId',
                value: ids.netflixId,
                domain: '.netflix.com',
                path: '/',
                httpOnly: true,
                secure: true,
                expires: nowUnix
            }
        ];
        if (ids.secureNetflixId) {
            cookies.push({
                name: 'SecureNetflixId',
                value: ids.secureNetflixId,
                domain: '.netflix.com',
                path: '/',
                httpOnly: true,
                secure: true,
                expires: nowUnix
            });
        }
        await context.addCookies(cookies);

        const page = await context.newPage();
        while (Date.now() < deadline) {
            try {
                await page.goto(TV8_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
                const result = await submitTvCode(page, tvCode);
                if (result.outcome !== 'retry') return result;
            } catch (error) {
                const message = String((error && error.message) || '').toLowerCase();
                if (message.includes('timeout')) {
                    // retry until deadline
                } else if (message.includes('captcha') || message.includes('challenge')) {
                    return { outcome: 'manual_required', message: 'Netflix yeu cau xac minh bo sung.' };
                } else {
                    // retry
                }
            }
            await page.waitForTimeout(RETRY_DELAY_MS);
        }

        return { outcome: 'manual_required', message: 'Het thoi gian cho worker auto-submit.' };
    } catch (error) {
        return { outcome: 'failed', message: 'Worker gap loi he thong khi xu ly ma TV.' };
    } finally {
        try {
            if (context) await context.close();
        } catch (e) {
            // ignore
        }
        try {
            if (browser) await browser.close();
        } catch (e) {
            // ignore
        }
    }
}

function pickCandidateCookie(cookies = [], customer, requestedCookieId = '') {
    const customerCode = normalizeCode(customer.code || '');
    const requestedId = String(requestedCookieId || '').trim();
    const assignedCookieId = String(customer.assignedCookieId || '').trim();

    if (requestedId) {
        const requested = cookies.find((item) => item.id === requestedId);
        if (requested && canUseCookie(requested, customerCode)) return requested;
        return null;
    }

    if (assignedCookieId) {
        const assigned = cookies.find((item) => item.id === assignedCookieId);
        if (assigned && canUseCookie(assigned, customerCode)) return assigned;
    }

    for (const cookie of cookies) {
        if (canUseCookie(cookie, customerCode)) return cookie;
    }
    return null;
}

function toResponseStatus(outcome) {
    if (outcome === 'submitted') return 200;
    if (outcome === 'manual_required') return 200;
    return 500;
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const customerCode = normalizeCode(body.customerCode || '');
        const tvCode = normalizeTvCode(body.tvCode || '');
        const requestedCookieId = String(body.cookieId || '').trim();

        if (!customerCode) {
            return res.status(400).json({ success: false, outcome: 'failed', message: 'Missing customerCode' });
        }
        if (!/^\d{8}$/.test(tvCode)) {
            return res.status(400).json({ success: false, outcome: 'failed', message: 'Mã TV phải gồm đúng 8 số.' });
        }

        const [customers, cookies] = await Promise.all([readCustomers(), readCookies()]);
        const customer = findCustomerByCode(customers, customerCode);
        if (!customer) {
            return res.status(404).json({ success: false, outcome: 'failed', message: 'Mã khách hàng không tồn tại.' });
        }
        if (customer.status === 'inactive') {
            return res.status(403).json({ success: false, outcome: 'failed', message: 'Mã khách hàng đang tạm khóa.' });
        }
        if (!isCustomerWarrantyValid(customer)) {
            return res.status(403).json({ success: false, outcome: 'failed', message: 'Mã khách hàng đã hết thời gian bảo hành.' });
        }

        const cookie = pickCandidateCookie(cookies, customer, requestedCookieId);
        if (!cookie) {
            return res.status(503).json({ success: false, outcome: 'failed', message: 'Không có cookie hợp lệ để submit mã TV.' });
        }

        const now = new Date().toISOString();
        const workerResult = await runTvActivation(cookie, tvCode);
        const outcome = ALLOWED_OUTCOMES.has(workerResult.outcome) ? workerResult.outcome : 'failed';
        const message = String(workerResult.message || '').trim() || 'Worker không trả về trạng thái hợp lệ.';

        const cookieIndex = cookies.findIndex((item) => item.id === cookie.id);
        if (cookieIndex >= 0) {
            cookies[cookieIndex] = {
                ...cookies[cookieIndex],
                lastCheckedAt: now,
                lastSuccessAt: outcome === 'submitted' ? now : cookies[cookieIndex].lastSuccessAt || '',
                lastErrorAt: outcome === 'submitted' ? '' : now,
                lastError: outcome === 'submitted' ? '' : message,
                updatedAt: now
            };
            await persistCookies(cookies);
        }

        return res.status(toResponseStatus(outcome)).json({
            success: outcome === 'submitted',
            outcome,
            message
        });
    } catch (e) {
        const payload = buildApiErrorPayload(e, 'Internal server error');
        return res.status(500).json({
            success: false,
            outcome: 'failed',
            message: payload.error,
            ...(payload.debug ? { debug: payload.debug } : {})
        });
    }
};

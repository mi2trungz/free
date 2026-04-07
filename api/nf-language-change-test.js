const { parseBody, extractNetflixIdsFromCookie } = require('./_nf-store');

const LANGUAGE_SETTINGS_URL = 'https://www.netflix.com/settings/language';
const DEFAULT_TIMEOUT_MS = 90000;
const TARGET_LANGUAGE_DEFAULT = 'Tiếng Việt';
const OUTCOMES = new Set(['success', 'manual_required', 'layout_changed', 'failed']);

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildResponse(success, outcome, stage, message, extra = {}) {
    return {
        success: !!success,
        outcome: OUTCOMES.has(outcome) ? outcome : 'failed',
        stage: String(stage || 'verify').trim() || 'verify',
        message: String(message || '').trim() || 'Unknown worker state.',
        ...extra
    };
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

function getTimeoutMs() {
    const raw = Number(process.env.NF_LANGUAGE_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(raw, 180000);
}

async function safelyWaitForNetworkIdle(page, timeout = 10000) {
    try {
        await page.waitForLoadState('networkidle', { timeout });
    } catch (e) {
        // ignore
    }
}

async function hasManualChallenge(page) {
    const currentUrl = String(page.url() || '').toLowerCase();
    if (currentUrl.includes('/login')) return true;
    if (currentUrl.includes('/signup')) return true;

    let html = '';
    try {
        html = String(await page.content()).toLowerCase();
    } catch (e) {
        html = '';
    }

    return html.includes('captcha')
        || html.includes('challenge')
        || html.includes('sign in')
        || html.includes('đăng nhập')
        || html.includes('session expired');
}

async function openLanguagePage(page, loginUrl) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await safelyWaitForNetworkIdle(page, 12000);
    await page.waitForTimeout(1200);
    if (await hasManualChallenge(page)) {
        return buildResponse(false, 'manual_required', 'login_url', 'Netflix yeu cau dang nhap hoac xac minh them.', {
            finalUrl: String(page.url() || '')
        });
    }

    await page.goto(LANGUAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await safelyWaitForNetworkIdle(page, 12000);
    await page.waitForTimeout(800);
    if (await hasManualChallenge(page)) {
        return buildResponse(false, 'manual_required', 'language_page', 'Khong vao duoc trang doi ngon ngu, Netflix yeu cau xac minh them.', {
            finalUrl: String(page.url() || '')
        });
    }

    return null;
}

async function findLanguageDropdown(page) {
    const dropdown = page.locator('select[data-uia="language-settings-page+display-language-dropdown+combobox"]').first();
    const count = await dropdown.count();
    if (!count) return null;
    try {
        await dropdown.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
        // select can still be usable even if not visibly expanded
    }
    return dropdown;
}

async function selectVietnamese(dropdown, targetLanguage) {
    const optionValues = await dropdown.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
        value: String(node.value || '').trim(),
        text: String(node.textContent || '').trim()
    })));

    const directMatch = optionValues.find((item) => item.value === targetLanguage);
    if (!directMatch) {
        return buildResponse(false, 'failed', 'select_language', `Khong tim thay option[value="${targetLanguage}"] trong dropdown ngon ngu.`);
    }

    await dropdown.selectOption({ value: targetLanguage });
    return { selectedValue: targetLanguage };
}

async function saveLanguage(page, targetLanguage) {
    const saveBtn = page.locator('button[data-uia="language-settings-page+save-button"]').first();
    if (!await saveBtn.count()) {
        return buildResponse(false, 'layout_changed', 'save', 'Khong tim thay nut luu theo data-uia.');
    }

    await Promise.allSettled([
        saveBtn.click({ timeout: 10000 }),
        page.waitForLoadState('domcontentloaded', { timeout: 15000 })
    ]);
    await safelyWaitForNetworkIdle(page, 15000);
    await page.waitForTimeout(1200);

    if (await hasManualChallenge(page)) {
        return buildResponse(false, 'manual_required', 'save', 'Netflix yeu cau xac minh them sau khi bam luu.', {
            finalUrl: String(page.url() || '')
        });
    }

    await page.goto(LANGUAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await safelyWaitForNetworkIdle(page, 12000);
    const verifyDropdown = await findLanguageDropdown(page);
    if (!verifyDropdown) {
        return buildResponse(false, 'layout_changed', 'verify', 'Khong tim thay dropdown ngon ngu khi xac minh lai.', {
            finalUrl: String(page.url() || '')
        });
    }

    const currentValue = String(await verifyDropdown.inputValue()).trim();
    const currentText = await verifyDropdown.locator('option:checked').first().textContent().catch(() => '');
    const normalizedText = String(currentText || '').trim();
    const selectedOptionValue = await verifyDropdown.locator('option:checked').first().getAttribute('value').catch(() => '');
    const normalizedSelectedOptionValue = String(selectedOptionValue || '').trim();

    if (currentValue !== targetLanguage && normalizedSelectedOptionValue !== targetLanguage) {
        return buildResponse(false, 'failed', 'verify', `Da bam luu nhung dropdown chua giu value="${targetLanguage}".`, {
            finalUrl: String(page.url() || ''),
            selectedLanguage: normalizedSelectedOptionValue || normalizedText || currentValue || ''
        });
    }

    return buildResponse(true, 'success', 'verify', `Da doi ngon ngu sang "${targetLanguage}" thanh cong.`, {
        finalUrl: String(page.url() || ''),
        selectedLanguage: normalizedSelectedOptionValue || normalizedText || currentValue || targetLanguage
    });
}

async function runLanguageChange({ cookieStr, loginUrl, targetLanguage }) {
    const wsEndpoint = String(process.env.BROWSERLESS_WS_ENDPOINT || '').trim();
    if (!wsEndpoint) {
        return buildResponse(false, 'failed', 'login_url', 'Chua cau hinh BROWSERLESS_WS_ENDPOINT.');
    }

    const chromium = await loadPlaywrightChromium();
    if (!chromium) {
        return buildResponse(false, 'failed', 'login_url', 'Thieu Playwright runtime tren server.');
    }

    const ids = extractNetflixIdsFromCookie(cookieStr || '');
    if (!ids.netflixId) {
        return buildResponse(false, 'failed', 'create_link', 'Khong tim thay NetflixId hop le trong cookie.');
    }

    let browser;
    let context;
    try {
        browser = await connectBrowser(chromium, wsEndpoint);
        context = await browser.newContext({
            viewport: { width: 1440, height: 960 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
        });

        const expires = Math.floor(Date.now() / 1000) + 3600;
        const cookies = [{
            name: 'NetflixId',
            value: ids.netflixId,
            domain: '.netflix.com',
            path: '/',
            httpOnly: true,
            secure: true,
            expires
        }];
        if (ids.secureNetflixId) {
            cookies.push({
                name: 'SecureNetflixId',
                value: ids.secureNetflixId,
                domain: '.netflix.com',
                path: '/',
                httpOnly: true,
                secure: true,
                expires
            });
        }
        await context.addCookies(cookies);

        const page = await context.newPage();
        page.setDefaultTimeout(getTimeoutMs());

        const openResult = await openLanguagePage(page, loginUrl);
        if (openResult) return openResult;

        const dropdown = await findLanguageDropdown(page);
        if (!dropdown) {
            return buildResponse(false, 'layout_changed', 'language_page', 'Khong tim thay dropdown doi ngon ngu theo data-uia.', {
                finalUrl: String(page.url() || '')
            });
        }

        const selectResult = await selectVietnamese(dropdown, targetLanguage);
        if (selectResult && selectResult.success === false) {
            return {
                ...selectResult,
                finalUrl: String(page.url() || '')
            };
        }

        return await saveLanguage(page, targetLanguage);
    } catch (error) {
        return buildResponse(false, 'failed', 'verify', error && error.message ? error.message : 'Worker gap loi he thong.');
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

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = parseBody(req.body);
        const cookieStr = String(body.cookieStr || '').trim();
        const loginUrl = String(body.loginUrl || '').trim();
        const targetLanguage = String(body.targetLanguage || TARGET_LANGUAGE_DEFAULT).trim() || TARGET_LANGUAGE_DEFAULT;

        if (!cookieStr) {
            return res.status(400).json(buildResponse(false, 'failed', 'create_link', 'Missing cookieStr'));
        }
        if (!loginUrl) {
            return res.status(400).json(buildResponse(false, 'failed', 'login_url', 'Missing loginUrl'));
        }

        const result = await runLanguageChange({ cookieStr, loginUrl, targetLanguage });
        return res.status(200).json(result);
    } catch (e) {
        return res.status(500).json(buildResponse(false, 'failed', 'verify', e.message || 'Internal server error'));
    }
};


const TV8_MANUAL_URL = 'https://www.netflix.com/tv8';
const UNSUPPORTED_URL = 'https://www.netflix.com/unsupported';
const SUPPORT_FANPAGE_URL = 'https://www.facebook.com/trada3k.vn/';
const TV_REDIRECT_DELAY_MS = 4000;
const GETLINK_ADMIN_AUTH_STORAGE_KEY = 'getlink_admin_auth_v1';

let busy = false;
let mobileGeneratedLink = '';
let tvGeneratedLoginLink = '';
let tvFlowBusy = false;
let adminAuthenticated = false;
let adminIdToken = '';
let adminRefreshToken = '';
let adminEmail = '';
let runtimeCookie = '';
let currentAdminShare = null;
let guestGuardActive = true;
let pendingDeviceConfirm = '';
let deviceConfirmReadyAt = 0;
let deviceConfirmTimer = null;
let pendingMobileOsDevice = '';
let cookieHealthBlocked = false;
let cookieHealthReason = '';

function el(id) {
    return document.getElementById(id);
}

function setStateClass(target, mode = 'idle') {
    if (!target) return;
    target.classList.remove('state-idle', 'state-loading', 'state-success', 'state-warning', 'state-error');
    if (mode === 'loading') target.classList.add('state-loading');
    else if (mode === 'success') target.classList.add('state-success');
    else if (mode === 'warning') target.classList.add('state-warning');
    else if (mode === 'error') target.classList.add('state-error');
    else target.classList.add('state-idle');
}

function setLookupState(text, mode = 'idle') {
    const node = el('lookupState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setShareState(text, mode = 'idle') {
    const node = el('shareState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setTvCodeState(text, mode = 'idle') {
    const node = el('tvCodeState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setAdminAuthState(text, mode = 'idle') {
    const node = el('adminAuthState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setAdminSearchState(text, mode = 'idle') {
    const node = el('adminSearchState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setAdminRuntimeCookieState(text, mode = 'idle') {
    const node = el('adminRuntimeCookieState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function normalizeCookie(value = '') {
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

function parseBlockedReasonFromError(error) {
    const status = Number(error && error.httpStatus ? error.httpStatus : 0);
    const text = String(error && error.message ? error.message : '').toLowerCase();
    if (status === 403 || /sbd|access denied/.test(text)) return 'sbd';
    if (status === 401 || /dead|het han|expired|invalid|cookie loi|unauthor|forbidden/.test(text)) return 'dead';
    return 'error';
}

function applyCookieBlockedState(reason = '', detail = '') {
    const normalizedReason = String(reason || '').trim() || 'error';
    const detailText = String(detail || '').trim();
    cookieHealthBlocked = true;
    cookieHealthReason = normalizedReason;
    setDeviceButtonsEnabled(false);
    setAdminRuntimeCookieState(`Cookie runtime bi chan: ${normalizedReason}.`, 'warning');
    setLookupState(
        `Tai khoan da loi, hay lien he admin de duoc bao hanh. ${detailText}`.trim(),
        'error'
    );
}

function clearCookieBlockedState() {
    cookieHealthBlocked = false;
    cookieHealthReason = '';
}

async function checkRuntimeCookieHealth() {
    const cookie = getRuntimeCookie();
    if (!cookie) {
        return {
            ok: false,
            blockedReason: 'missing_cookie',
            detailMessage: 'Khong co cookie hop le.'
        };
    }

    try {
        const data = await apiRequest('/api/nf-cookie-to-link', 'POST', {
            cookieStr: cookie,
            device: 'mobile'
        });
        const account = data && data.accountInfo ? data.accountInfo : null;
        if (account && isPaymentHoldYes(account.on_payment_hold)) {
            return {
                ok: false,
                blockedReason: 'hold',
                detailMessage: 'Tai khoan dang bi HOLD (on_payment_hold=yes).'
            };
        }
        if (account && isUnknownPlan(account.plan)) {
            return {
                ok: false,
                blockedReason: 'unknown',
                detailMessage: 'Goi cuoc dang UNKNOWN.'
            };
        }
        return {
            ok: true,
            blockedReason: '',
            detailMessage: ''
        };
    } catch (error) {
        const reason = parseBlockedReasonFromError(error);
        if (reason === 'sbd') {
            return {
                ok: false,
                blockedReason: 'sbd',
                detailMessage: 'Cookie bi chan SBD.'
            };
        }
        if (reason === 'dead') {
            return {
                ok: false,
                blockedReason: 'dead',
                detailMessage: 'Cookie da dead hoac het han.'
            };
        }
        return {
            ok: false,
            blockedReason: 'error',
            detailMessage: String(error && error.message ? error.message : 'Khong the kiem tra cookie.')
        };
    }
}

function toBase64Url(value = '') {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(value = '') {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return '';
    const pad = normalized.length % 4;
    const padded = normalized + (pad === 0 ? '' : '='.repeat(4 - pad));
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function setGuestGuard(active, text = '') {
    guestGuardActive = !!active;
    const guard = el('guestGuard');
    const guardText = el('guestGuardText');
    if (guard) guard.classList.toggle('hidden', !guestGuardActive);
    if (guardText && text) guardText.textContent = String(text).trim();
    setDeviceButtonsEnabled(!guestGuardActive && !!runtimeCookie);
}

function setDeviceButtonsEnabled(enabled) {
    const buttons = Array.from(document.querySelectorAll('.btn-device'));
    const finalEnabled = !!enabled && !!runtimeCookie && !busy && !guestGuardActive && !cookieHealthBlocked;
    buttons.forEach((btn) => {
        btn.disabled = !finalEnabled;
    });
}

function setButtonBusy(button, isBusy, busyLabel = 'Dang xu ly...') {
    if (!button) return;
    if (isBusy) {
        if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent || '';
        button.textContent = busyLabel;
        button.disabled = true;
        return;
    }
    if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
    }
    button.disabled = false;
}

function showLookupLoadingOverlay(message = 'Xin vui long cho trong giay lat') {
    const overlay = el('lookupLoadingOverlay');
    const text = el('lookupLoadingText');
    if (text) text.textContent = String(message || 'Xin vui long cho trong giay lat');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
}

function hideLookupLoadingOverlay() {
    const overlay = el('lookupLoadingOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

async function apiRequest(path, method = 'GET', body) {
    const requestPath = String(path || '').trim();
    const isAdminRoute = /^\/api\/getlink-admin(?:\/|$)/.test(requestPath);
    const headers = { 'Content-Type': 'application/json' };
    if (isAdminRoute && adminIdToken) {
        headers.Authorization = `Bearer ${adminIdToken}`;
    }

    const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (isAdminRoute && Number(response.status || 0) === 401) {
            clearAdminAuthState();
        }
        const err = new Error(String(data.error || 'Request failed'));
        err.httpStatus = Number(response.status || 0);
        throw err;
    }
    return data;
}

function saveAdminAuthToStorage() {
    try {
        const payload = JSON.stringify({
            idToken: adminIdToken || '',
            refreshToken: adminRefreshToken || '',
            email: adminEmail || ''
        });
        window.localStorage.setItem(GETLINK_ADMIN_AUTH_STORAGE_KEY, payload);
    } catch (error) {
        // ignore storage failures
    }
}

function loadAdminAuthFromStorage() {
    try {
        const raw = window.localStorage.getItem(GETLINK_ADMIN_AUTH_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        adminIdToken = String(parsed && parsed.idToken ? parsed.idToken : '').trim();
        adminRefreshToken = String(parsed && parsed.refreshToken ? parsed.refreshToken : '').trim();
        adminEmail = String(parsed && parsed.email ? parsed.email : '').trim().toLowerCase();
    } catch (error) {
        adminIdToken = '';
        adminRefreshToken = '';
        adminEmail = '';
    }
}

function clearAdminAuthState() {
    adminAuthenticated = false;
    adminIdToken = '';
    adminRefreshToken = '';
    adminEmail = '';
    try {
        window.localStorage.removeItem(GETLINK_ADMIN_AUTH_STORAGE_KEY);
    } catch (error) {
        // ignore storage failures
    }
}

function setAdminAuthTokens(idToken = '', refreshToken = '', email = '') {
    adminIdToken = String(idToken || '').trim();
    adminRefreshToken = String(refreshToken || '').trim();
    adminEmail = String(email || '').trim().toLowerCase();
    saveAdminAuthToStorage();
}

function getFirebaseApiKey() {
    const cfg = typeof window !== 'undefined' && window.NF_FIREBASE_CONFIG && typeof window.NF_FIREBASE_CONFIG === 'object'
        ? window.NF_FIREBASE_CONFIG
        : null;
    return String(cfg && cfg.apiKey ? cfg.apiKey : '').trim();
}

function getAllowedAdminEmailsFromRuntime() {
    const list = Array.isArray(window && window.NF_ADMIN_EMAILS) ? window.NF_ADMIN_EMAILS : [];
    return list.map((item) => String(item || '').trim().toLowerCase()).filter((item) => !!item);
}

function mapFirebaseSignInError(message = '') {
    const code = String(message || '').trim().toUpperCase();
    if (!code) return 'Dang nhap Firebase that bai.';
    if (code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('INVALID_PASSWORD') || code.includes('EMAIL_NOT_FOUND')) {
        return 'Sai email hoac mat khau Firebase.';
    }
    if (code.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
        return 'Dang nhap qua nhieu lan. Thu lai sau.';
    }
    if (code.includes('USER_DISABLED')) {
        return 'Tai khoan Firebase da bi vo hieu hoa.';
    }
    return `Dang nhap Firebase that bai: ${code}`;
}

async function signInWithFirebasePassword(email, password) {
    const apiKey = getFirebaseApiKey();
    if (!apiKey) {
        throw new Error('Thieu NF_FIREBASE_CONFIG.apiKey tren /getlink.');
    }
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: String(email || '').trim(),
                password: String(password || ''),
                returnSecureToken: true
            })
        }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const firebaseError = String(data && data.error && data.error.message ? data.error.message : '').trim();
        throw new Error(mapFirebaseSignInError(firebaseError));
    }
    const idToken = String(data && data.idToken ? data.idToken : '').trim();
    const refreshToken = String(data && data.refreshToken ? data.refreshToken : '').trim();
    const loggedEmail = String(data && data.email ? data.email : email).trim().toLowerCase();
    if (!idToken) throw new Error('Firebase khong tra ve idToken.');
    return { idToken, refreshToken, email: loggedEmail };
}

function openDeferredTabAndNavigate() {
    const popupWindow = window.open('about:blank', '_blank');
    if (!popupWindow) return { popupWindow: null, wasBlocked: true };

    try {
        popupWindow.document.title = 'Get Link';
        popupWindow.document.body.style.margin = '0';
        popupWindow.document.body.style.fontFamily = 'Arial, sans-serif';
        popupWindow.document.body.style.background = '#0b0f1c';
        popupWindow.document.body.style.color = '#ffffff';
        popupWindow.document.body.style.display = 'flex';
        popupWindow.document.body.style.alignItems = 'center';
        popupWindow.document.body.style.justifyContent = 'center';
        popupWindow.document.body.innerHTML = '<div>Dang tao link Netflix...</div>';
    } catch (error) {
        // ignore
    }

    return { popupWindow, wasBlocked: false };
}

function getRuntimeCookie() {
    return normalizeCookie(runtimeCookie);
}

function syncAdminCookieInput() {
    const input = el('adminRuntimeCookieInput');
    if (!input) return;
    const cur = getRuntimeCookie();
    if (input.value !== cur) input.value = cur;
}

function getAdminRuntimeCookieInputValue() {
    const input = el('adminRuntimeCookieInput');
    if (!input) return '';
    return normalizeCookie(input.value || '');
}

function updateReadyState() {
    const hasCookie = !!getRuntimeCookie();
    if (hasCookie && cookieHealthBlocked) {
        setDeviceButtonsEnabled(false);
        return;
    }
    setDeviceButtonsEnabled(hasCookie && !guestGuardActive);
    if (!hasCookie) {
        setLookupState('Vui long mo dung link duoc cap de bat dau su dung.', 'warning');
    }
}

function setRuntimeCookie(rawCookie, options = {}) {
    const next = normalizeCookie(rawCookie);
    const source = String(options.source || 'unknown').trim();
    const silent = !!options.silent;

    runtimeCookie = next;
    clearCookieBlockedState();
    syncAdminCookieInput();

    if (next) {
        setGuestGuard(false);
        if (!silent) {
            if (source === 'share-id') {
                setLookupState('Da tai cookie tu share link. Hay chon thiet bi de tiep tuc.', 'success');
            } else if (source === 'cookie-link') {
                setLookupState('Da giai ma cookie tu link chia se. Hay chon thiet bi de tiep tuc.', 'success');
            } else if (source === 'admin') {
                setLookupState('Admin da ap dung cookie cho phien hien tai.', 'success');
            }
        }
        setAdminRuntimeCookieState(`Cookie runtime da san sang (${next.length} ky tu).`, 'success');
        updateReadyState();
        return;
    }

    setGuestGuard(true, 'Hay mo dung link /getlink?s=... hoac /getlink?c=... de tiep tuc.');
    setAdminRuntimeCookieState('Chua co cookie runtime.', 'warning');
    setLookupState('Khong co cookie hop le. Chi co the tiep tuc bang link duoc cap.', 'warning');
    updateReadyState();
}

async function copyText(text, successText = 'Da sao chep.') {
    try {
        await navigator.clipboard.writeText(String(text || ''));
        setLookupState(successText, 'success');
        return true;
    } catch (error) {
        setLookupState('Khong copy duoc. Hay copy thu cong.', 'warning');
        return false;
    }
}

function openSupportModal() {
    const modal = el('supportModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeSupportModal() {
    const modal = el('supportModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openMobileLinkModal(url, mobileOs = 'android') {
    const modal = el('mobileLinkModal');
    const output = el('mobileLinkOutput');
    const step1 = el('mobileGuideStep1');
    const step2 = el('mobileGuideStep2');
    const step3 = el('mobileGuideStep3');
    const step3Row = el('mobileGuideStep3Row');

    mobileGeneratedLink = String(url || '').trim();
    if (!modal || !output) return;
    output.value = mobileGeneratedLink;

    if (String(mobileOs).toLowerCase() === 'ios') {
        if (step1) step1.textContent = 'Buoc 1: Sao chep duong link dang nhap phia tren';
        if (step2) step2.textContent = 'Buoc 2: Dan vao Safari va truy cap';
        if (step3) step3.textContent = 'Buoc 3: Truy cap tiep trang netflix.com/unsupported';
        if (step3Row) step3Row.classList.remove('hidden');
    } else {
        if (step1) step1.textContent = 'Buoc 1: Sao chep duong link dang nhap phia tren';
        if (step2) step2.textContent = 'Buoc 2: Dan vao trinh duyet mac dinh tren dien thoai va truy cap';
        if (step3) step3.textContent = 'Buoc 3: Truy cap tiep trang netflix.com/unsupported';
        if (step3Row) step3Row.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeMobileLinkModal() {
    const modal = el('mobileLinkModal');
    const output = el('mobileLinkOutput');
    if (output) output.value = '';
    mobileGeneratedLink = '';
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}
function openTvGuideModal() {
    const modal = el('tvGuideModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeTvGuideModal() {
    const modal = el('tvGuideModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openTvCodeModal() {
    const modal = el('tvCodeModal');
    const input = el('tvCodeInput');
    const manualLoginLink = el('tvManualLoginLink');
    tvFlowBusy = false;
    tvGeneratedLoginLink = '';
    setTvCodeState('Nhap dung 8 so roi bam xac nhan. He thong se mo link dang nhap truoc, sau do tu chuyen sang netflix.com/tv8.', 'idle');
    if (input) input.value = '';
    if (manualLoginLink) {
        manualLoginLink.setAttribute('href', '#');
        manualLoginLink.setAttribute('aria-disabled', 'true');
    }
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeTvCodeModal() {
    const modal = el('tvCodeModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openDeviceConfirmModal(device = '') {
    const normalized = String(device || '').trim();
    if (!normalized) return;
    pendingDeviceConfirm = normalized;
    const modal = el('deviceConfirmModal');
    const title = el('deviceConfirmTitle');
    const hint = el('deviceConfirmHint');
    const countdown = el('deviceConfirmCountdown');
    const okBtn = el('deviceConfirmOkBtn');

    const labels = {
        desktop: 'May tinh',
        mobile: 'Dien thoai',
        tablet: 'May tinh bang',
        tv: 'TV'
    };
    const label = labels[normalized] || normalized;

    if (title) title.textContent = `Ban co chac chan dang dung ${label} khong?`;
    if (hint) hint.textContent = 'Vui long xac nhan dung thiet bi de tiep tuc.';
    if (countdown) {
        countdown.textContent = 'Vui long cho 3 giay de xac nhan.';
        setStateClass(countdown, 'warning');
    }
    if (okBtn) okBtn.disabled = true;

    const waitMs = 3000;
    deviceConfirmReadyAt = Date.now() + waitMs;

    if (deviceConfirmTimer) {
        window.clearInterval(deviceConfirmTimer);
        deviceConfirmTimer = null;
    }

    deviceConfirmTimer = window.setInterval(() => {
        const remainMs = Math.max(0, deviceConfirmReadyAt - Date.now());
        const remainSec = Math.ceil(remainMs / 1000);
        if (countdown) {
            if (remainMs > 0) {
                countdown.textContent = `Vui long cho ${remainSec} giay de xac nhan.`;
                setStateClass(countdown, 'warning');
            } else {
                countdown.textContent = 'Ban co the bam Co de tiep tuc.';
                setStateClass(countdown, 'success');
            }
        }
        if (okBtn) okBtn.disabled = remainMs > 0;
        if (remainMs <= 0) {
            window.clearInterval(deviceConfirmTimer);
            deviceConfirmTimer = null;
        }
    }, 150);

    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeDeviceConfirmModal() {
    const modal = el('deviceConfirmModal');
    if (deviceConfirmTimer) {
        window.clearInterval(deviceConfirmTimer);
        deviceConfirmTimer = null;
    }
    pendingDeviceConfirm = '';
    deviceConfirmReadyAt = 0;
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openMobileOsModal(deviceType = 'mobile') {
    pendingMobileOsDevice = String(deviceType || 'mobile').trim() || 'mobile';
    const modal = el('mobileOsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeMobileOsModal() {
    const modal = el('mobileOsModal');
    pendingMobileOsDevice = '';
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

async function generateDeviceLink(device, mobileOs = 'android') {
    const cookie = getRuntimeCookie();
    if (!cookie) {
        setLookupState('Khong co cookie hop le de tao link.', 'warning');
        setGuestGuard(true, 'Hay mo dung link /getlink?s=... hoac /getlink?c=... de tiep tuc.');
        return;
    }

    const frontendDevice = String(device || '').trim();
    if (!frontendDevice) return;

    setLookupState('Dang kiem tra tinh trang cookie...', 'loading');
    const health = await checkRuntimeCookieHealth();
    if (!health.ok) {
        applyCookieBlockedState(health.blockedReason, health.detailMessage);
        return;
    }
    clearCookieBlockedState();

    const apiDevice = frontendDevice === 'desktop' ? 'desktop' : 'mobile';
    const button = document.querySelector(`.btn-device[data-device="${frontendDevice}"]`);

    busy = true;
    setButtonBusy(button, true, 'Dang tao link...');
    setDeviceButtonsEnabled(false);
    setLookupState('Dang kiem tra cookie LIVE va tao link...', 'loading');
    showLookupLoadingOverlay('Xin vui long cho trong giay lat');

    const shouldAutoOpen = apiDevice === 'desktop';
    let deferredPopup = null;
    if (shouldAutoOpen) {
        const deferred = openDeferredTabAndNavigate();
        deferredPopup = deferred.popupWindow;
        if (deferred.wasBlocked) {
            setLookupState('Trinh duyet chan tab moi, se mo trong tab hien tai.', 'warning');
        }
    }

    try {
        const data = await apiRequest('/api/nf-cookie-to-link', 'POST', { cookieStr: cookie, device: apiDevice, mobileOs });
        if (!data || !data.url) throw new Error('Khong tao duoc link.');

        if (shouldAutoOpen) {
            if (deferredPopup && !deferredPopup.closed) deferredPopup.location.href = data.url;
            else window.location.href = data.url;
            setLookupState('Da tao link thanh cong. Dang mo Netflix...', 'success');
        } else {
            openMobileLinkModal(data.url, mobileOs);
            const typeLabel = frontendDevice === 'tablet' ? 'tablet' : 'dien thoai';
            setLookupState(`Tao link ${typeLabel} thanh cong. Hay sao chep link va lam theo huong dan.`, 'success');
        }
    } catch (error) {
        if (deferredPopup && !deferredPopup.closed) {
            try { deferredPopup.close(); } catch (closeError) { }
        }
        setLookupState(error.message || 'Khong tao duoc link.', 'error');
    } finally {
        hideLookupLoadingOverlay();
        busy = false;
        setButtonBusy(button, false);
        updateReadyState();
    }
}

function handleConfirmedDevice(device) {
    const normalized = String(device || '').trim();
    if (!normalized) return;

    if (normalized === 'tv') {
        openTvGuideModal();
        return;
    }

    if (normalized === 'mobile' || normalized === 'tablet') {
        openMobileOsModal(normalized);
        return;
    }

    generateDeviceLink('desktop', 'android');
}

async function submitTvCodeFlow() {
    const cookie = getRuntimeCookie();
    if (!cookie) {
        setLookupState('Khong co cookie hop le de tao link TV.', 'warning');
        closeTvCodeModal();
        return;
    }
    if (tvFlowBusy) return;

    const health = await checkRuntimeCookieHealth();
    if (!health.ok) {
        applyCookieBlockedState(health.blockedReason, health.detailMessage);
        closeTvCodeModal();
        return;
    }
    clearCookieBlockedState();

    const input = el('tvCodeInput');
    const submitBtn = el('tvCodeSubmitBtn');
    const manualLoginLink = el('tvManualLoginLink');
    const raw = String(input && input.value || '');
    const tvCode = raw.replace(/\D/g, '').slice(0, 8);
    if (!/^\d{8}$/.test(tvCode)) {
        setTvCodeState('Ma TV phai dung 8 so.', 'warning');
        return;
    }

    if (input) input.value = tvCode;
    tvFlowBusy = true;
    setButtonBusy(submitBtn, true, 'Dang tao link...');
    setTvCodeState('Dang tao link dang nhap TV...', 'loading');

    try {
        const linkData = await apiRequest('/api/nf-cookie-to-link', 'POST', { cookieStr: cookie, device: 'mobile' });
        tvGeneratedLoginLink = String(linkData.url || '').trim();
        if (!tvGeneratedLoginLink) throw new Error('Khong tao duoc link dang nhap.');

        if (manualLoginLink) {
            manualLoginLink.setAttribute('href', tvGeneratedLoginLink);
            manualLoginLink.removeAttribute('aria-disabled');
        }

        const popup = window.open('about:blank', '_blank');
        if (!popup) {
            setTvCodeState('Trinh duyet dang chan popup. Hay bam "Mo link dang nhap" roi bam "Mo netflix.com/tv8".', 'warning');
            return;
        }

        popup.location.href = tvGeneratedLoginLink;
        setTvCodeState(`Da mo link dang nhap. Sau ${Math.round(TV_REDIRECT_DELAY_MS / 1000)} giay se tu chuyen sang netflix.com/tv8 de nhap ma TV.`, 'success');
        setLookupState('Da mo link dang nhap TV. Sap chuyen sang netflix.com/tv8...', 'success');

        window.setTimeout(() => {
            if (popup.closed) return;
            popup.location.href = `${TV8_MANUAL_URL}?code=${encodeURIComponent(tvCode)}`;
        }, TV_REDIRECT_DELAY_MS);
    } catch (error) {
        setTvCodeState(error.message || 'Khong tao duoc link TV.', 'error');
        setLookupState(error.message || 'Khong tao duoc link TV.', 'error');
    } finally {
        tvFlowBusy = false;
        setButtonBusy(submitBtn, false);
    }
}

function renderShareUrl(url = '') {
    const output = el('shareLinkOutput');
    const openBtn = el('openShareLinkBtn');
    const finalUrl = String(url || '').trim();
    if (output) output.value = finalUrl;
    if (openBtn) openBtn.setAttribute('href', finalUrl || '#');
}

async function autoCopyShareLinkOrWarn(url = '') {
    const link = String(url || '').trim();
    if (!link) return false;
    try {
        await navigator.clipboard.writeText(link);
        setShareState('Da tao va tu dong sao chep link.', 'success');
        return true;
    } catch (error) {
        setShareState('Da tao link, nhung khong tu copy duoc. Hay bam Copy.', 'warning');
        return false;
    }
}

async function generateShareIdLink() {
    const cookie = getRuntimeCookie();
    if (!cookie) {
        renderShareUrl('');
        setShareState('Chua co cookie runtime de tao link chia se.', 'warning');
        return;
    }

    const btn = el('generateShareLinkBtn');
    setButtonBusy(btn, true, 'Dang tao...');
    try {
        const data = await apiRequest('/api/getlink-shares', 'POST', { cookieStr: cookie });
        const shareUrl = String(data.shareUrl || '').trim();
        renderShareUrl(shareUrl);
        await autoCopyShareLinkOrWarn(shareUrl);
    } catch (error) {
        renderShareUrl('');
        setShareState(error.message || 'Khong tao duoc link chia se.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function generateCookieEmbeddedShareLink() {
    const inputCookie = getAdminRuntimeCookieInputValue();
    const runtimeCookieValue = getRuntimeCookie();
    const cookie = inputCookie || runtimeCookieValue;
    if (!cookie) {
        renderShareUrl('');
        setShareState('Chua co cookie runtime de tao link chia se.', 'warning');
        return;
    }

    if (inputCookie && inputCookie !== runtimeCookieValue) {
        setRuntimeCookie(inputCookie, { source: 'admin', silent: true });
    }

    const btn = el('generateCookieShareLinkBtn');
    setButtonBusy(btn, true, 'Dang tao...');
    try {
        const encodedCookie = toBase64Url(cookie);
        const shareUrl = `${window.location.origin}/getlink?c=${encodeURIComponent(encodedCookie)}`;
        renderShareUrl(shareUrl);
        await autoCopyShareLinkOrWarn(shareUrl);
    } catch (error) {
        renderShareUrl('');
        setShareState(error.message || 'Khong tao duoc link cookie.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function runEntryCookieHealthCheck() {
    const cookie = getRuntimeCookie();
    if (!cookie) return;
    setLookupState('Dang kiem tra tinh trang cookie tu link...', 'loading');
    const health = await checkRuntimeCookieHealth();
    if (!health.ok) {
        applyCookieBlockedState(health.blockedReason, health.detailMessage);
        return;
    }
    clearCookieBlockedState();
    setLookupState('Cookie hop le. Hay chon thiet bi de tiep tuc.', 'success');
    updateReadyState();
}

async function applyCookieFromQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const shareId = String(params.get('s') || '').trim();
    const encodedCookie = String(params.get('c') || '').trim();

    if (shareId) {
        try {
            const data = await apiRequest(`/api/getlink-shares/${encodeURIComponent(shareId)}`, 'GET');
            const cookieStr = normalizeCookie(data.cookieStr || '');
            if (!cookieStr) {
                setLookupState('Link chia se khong co cookie hop le.', 'warning');
                return;
            }
            setRuntimeCookie(cookieStr, { source: 'share-id' });
            await runEntryCookieHealthCheck();
            return;
        } catch (error) {
            setLookupState(error.message || 'Khong tai duoc cookie tu link chia se.', 'warning');
            return;
        }
    }

    if (encodedCookie) {
        try {
            const cookieStr = normalizeCookie(fromBase64Url(encodedCookie));
            if (!cookieStr) {
                setLookupState('Link cookie khong hop le.', 'warning');
                return;
            }
            setRuntimeCookie(cookieStr, { source: 'cookie-link' });
            await runEntryCookieHealthCheck();
            return;
        } catch (error) {
            setLookupState('Khong giai ma duoc cookie trong link chia se.', 'warning');
            return;
        }
    }
}
function renderAdminWorkspace() {
    const authBox = el('adminAuthBox');
    const workspace = el('adminWorkspace');
    const identity = el('adminIdentity');
    const fab = el('nfAdminFab');
    const inlineCookiePanel = el('adminInlineCookiePanel');

    if (fab) {
        fab.classList.toggle('is-admin', adminAuthenticated);
        fab.title = adminAuthenticated ? 'Tai khoan admin da dang nhap' : 'Dang nhap admin';
        fab.setAttribute('aria-label', adminAuthenticated ? 'Tai khoan admin da dang nhap' : 'Dang nhap admin');
    }

    if (identity) identity.textContent = adminAuthenticated ? 'Dang nhap admin.' : 'Chua dang nhap admin';
    if (authBox) authBox.classList.toggle('hidden', adminAuthenticated);
    if (workspace) workspace.classList.toggle('hidden', !adminAuthenticated);
    if (inlineCookiePanel) inlineCookiePanel.classList.toggle('hidden', !adminAuthenticated);
    if (adminAuthenticated) syncAdminCookieInput();
}

function renderAdminShare(share = null) {
    currentAdminShare = share;
    const card = el('adminShareResult');
    if (!card) return;

    if (!share) {
        card.classList.add('hidden');
        return;
    }

    const idInput = el('adminShareId');
    const statusInput = el('adminShareStatus');
    const urlInput = el('adminShareUrl');
    const updatedInput = el('adminShareUpdatedAt');
    const cookieInput = el('adminShareCookieInput');

    if (idInput) idInput.value = String(share.id || '');
    if (statusInput) statusInput.value = `Trang thai: ${String(share.status || 'active')}`;
    if (urlInput) urlInput.value = String(share.shareUrl || '');
    if (updatedInput) updatedInput.value = `Cap nhat: ${String(share.updatedAt || '-')}`;
    if (cookieInput) cookieInput.value = String(share.cookieRaw || '');

    card.classList.remove('hidden');
}

async function loadAdminSession() {
    if (!adminIdToken) {
        clearAdminAuthState();
        setAdminAuthState('Dang xuat.', 'idle');
        renderAdminWorkspace();
        return;
    }

    try {
        const data = await apiRequest('/api/getlink-admin/session', 'GET');
        adminAuthenticated = !!(data && data.authenticated);
        if (adminAuthenticated && data.user && data.user.email) {
            adminEmail = String(data.user.email || '').trim().toLowerCase();
            saveAdminAuthToStorage();
            setAdminAuthState(`Dang nhap admin: ${data.user.email}`, 'success');
        } else {
            clearAdminAuthState();
            setAdminAuthState('Dang xuat.', 'idle');
        }
    } catch (error) {
        clearAdminAuthState();
        setAdminAuthState('Phien admin het han. Vui long dang nhap lai.', 'warning');
    }
    renderAdminWorkspace();
}

async function adminLogin() {
    const email = String(el('adminEmailInput') && el('adminEmailInput').value || '').trim();
    const password = String(el('adminPasswordInput') && el('adminPasswordInput').value || '');
    if (!email || !password) {
        setAdminAuthState('Vui long nhap email va mat khau admin.', 'warning');
        return;
    }

    const btn = el('adminLoginBtn');
    setButtonBusy(btn, true, 'Dang nhap...');
    try {
        const firebaseSession = await signInWithFirebasePassword(email, password);
        const allowedAdminEmails = getAllowedAdminEmailsFromRuntime();
        if (allowedAdminEmails.length > 0 && !allowedAdminEmails.includes(firebaseSession.email)) {
            throw new Error('Email nay khong nam trong NF_ADMIN_EMAILS.');
        }

        await apiRequest('/api/getlink-admin/login', 'POST', { idToken: firebaseSession.idToken });
        setAdminAuthTokens(firebaseSession.idToken, firebaseSession.refreshToken, firebaseSession.email);

        const session = await apiRequest('/api/getlink-admin/session', 'GET');
        if (!session || !session.authenticated) {
            throw new Error('Khong xac minh duoc phien admin tu backend.');
        }

        adminAuthenticated = true;
        const userEmail = String(session.user && session.user.email || firebaseSession.email || email);
        adminEmail = String(userEmail || '').trim().toLowerCase();
        saveAdminAuthToStorage();
        setAdminAuthState(`Dang nhap admin: ${userEmail}`, 'success');
        renderAdminWorkspace();
        setAdminSearchState('Khong tu dong load. Nhap ID/link roi bam Tim link.', 'idle');
    } catch (error) {
        clearAdminAuthState();
        const msg = String(error && error.message ? error.message : '').trim();
        if (!msg) {
            setAdminAuthState('Dang nhap that bai.', 'error');
        } else {
            setAdminAuthState(msg, 'error');
        }
        renderAdminWorkspace();
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminLogout() {
    const btn = el('adminLogoutBtn');
    setButtonBusy(btn, true, 'Dang xuat...');
    try {
        await apiRequest('/api/getlink-admin/logout', 'POST');
    } catch (error) {
        // ignore
    } finally {
        clearAdminAuthState();
        renderAdminShare(null);
        setAdminAuthState('Dang xuat.', 'idle');
        renderAdminWorkspace();
        setButtonBusy(btn, false);
    }
}

async function adminSearchShare() {
    if (!adminAuthenticated) {
        setAdminSearchState('Ban chua dang nhap admin.', 'warning');
        return;
    }

    const input = el('adminShareSearchInput');
    const query = String(input && input.value || '').trim();
    if (!query) {
        setAdminSearchState('Nhap share ID hoac link de tim.', 'warning');
        renderAdminShare(null);
        return;
    }

    const btn = el('adminShareSearchBtn');
    setButtonBusy(btn, true, 'Dang tim...');
    setAdminSearchState('Dang tim link chia se...', 'loading');
    try {
        const data = await apiRequest('/api/getlink-admin/search', 'POST', { query });
        renderAdminShare(data.share || null);
        setAdminSearchState('Da tim thay link. Ban co the sua/thu hoi/phuc hoi/doi ID.', 'success');
    } catch (error) {
        renderAdminShare(null);
        setAdminSearchState(error.message || 'Khong tim thay link.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminSaveCookie() {
    if (!currentAdminShare || !currentAdminShare.id) return;
    const cookieRaw = normalizeCookie(el('adminShareCookieInput') && el('adminShareCookieInput').value || '');
    if (!cookieRaw) {
        setAdminSearchState('Cookie khong duoc de trong.', 'warning');
        return;
    }

    const btn = el('adminSaveCookieBtn');
    setButtonBusy(btn, true, 'Dang luu...');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}`, 'PUT', { cookieStr: cookieRaw });
        renderAdminShare(data.share || null);
        setRuntimeCookie(cookieRaw, { source: 'admin', silent: true });
        setAdminRuntimeCookieState('Da cap nhat cookie runtime tu share vua luu.', 'success');
        setAdminSearchState('Da cap nhat cookie cho link.', 'success');
    } catch (error) {
        setAdminSearchState(error.message || 'Khong cap nhat duoc cookie.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminRotateId() {
    if (!currentAdminShare || !currentAdminShare.id) return;

    const btn = el('adminRotateIdBtn');
    setButtonBusy(btn, true, 'Dang doi ID...');
    try {
        const oldId = currentAdminShare.id;
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(oldId)}/rotate-id`, 'POST');
        renderAdminShare(data.share || null);
        if (el('adminShareSearchInput')) el('adminShareSearchInput').value = String(data.newId || '');
        setAdminSearchState(`Da doi ID ngau nhien. ID cu (${oldId}) khong con dung duoc.`, 'success');
    } catch (error) {
        setAdminSearchState(error.message || 'Khong doi duoc ID.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminSetStatus(action = 'revoke') {
    if (!currentAdminShare || !currentAdminShare.id) return;
    const isRevoke = action === 'revoke';
    const btn = el(isRevoke ? 'adminRevokeBtn' : 'adminRestoreBtn');
    setButtonBusy(btn, true, isRevoke ? 'Dang thu hoi...' : 'Dang phuc hoi...');

    try {
        const data = await apiRequest(
            `/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}/${isRevoke ? 'revoke' : 'restore'}`,
            'POST'
        );
        renderAdminShare(data.share || null);
        setAdminSearchState(isRevoke ? 'Da thu hoi link chia se.' : 'Da phuc hoi link chia se.', 'success');
    } catch (error) {
        setAdminSearchState(error.message || 'Cap nhat trang thai that bai.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

function openAdminModal() {
    const modal = el('nfAdminModal');
    if (!modal) return;
    syncAdminCookieInput();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeAdminModal() {
    const modal = el('nfAdminModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function bindEvents() {
    const supportBtn = el('supportWarrantyBtn');
    if (supportBtn) supportBtn.addEventListener('click', openSupportModal);

    const supportCloseBtn = el('supportModalCloseBtn');
    if (supportCloseBtn) supportCloseBtn.addEventListener('click', closeSupportModal);

    const supportModal = el('supportModal');
    if (supportModal) {
        supportModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeSupport === '1') closeSupportModal();
        });
    }

    const supportLink = el('supportFanpageLink');
    if (supportLink) supportLink.setAttribute('href', SUPPORT_FANPAGE_URL);

    const deviceButtons = Array.from(document.querySelectorAll('.btn-device'));
    deviceButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const device = String(button.dataset.device || '').trim();
            if (!device) return;
            openDeviceConfirmModal(device);
        });
    });

    const deviceConfirmModal = el('deviceConfirmModal');
    if (deviceConfirmModal) {
        deviceConfirmModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeDeviceConfirm === '1') closeDeviceConfirmModal();
        });
    }

    const deviceConfirmCloseBtn = el('deviceConfirmCloseBtn');
    if (deviceConfirmCloseBtn) deviceConfirmCloseBtn.addEventListener('click', closeDeviceConfirmModal);

    const deviceConfirmCancelBtn = el('deviceConfirmCancelBtn');
    if (deviceConfirmCancelBtn) deviceConfirmCancelBtn.addEventListener('click', closeDeviceConfirmModal);

    const deviceConfirmOkBtn = el('deviceConfirmOkBtn');
    if (deviceConfirmOkBtn) {
        deviceConfirmOkBtn.addEventListener('click', () => {
            if (Date.now() < deviceConfirmReadyAt) return;
            const device = pendingDeviceConfirm;
            closeDeviceConfirmModal();
            handleConfirmedDevice(device);
        });
    }
    const mobileOsModal = el('mobileOsModal');
    if (mobileOsModal) {
        mobileOsModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeMobileOs === '1') closeMobileOsModal();
        });
    }

    const mobileOsCloseBtn = el('mobileOsCloseBtn');
    if (mobileOsCloseBtn) mobileOsCloseBtn.addEventListener('click', closeMobileOsModal);

    const mobileOsAndroidBtn = el('mobileOsAndroidBtn');
    if (mobileOsAndroidBtn) {
        mobileOsAndroidBtn.addEventListener('click', () => {
            const nextDevice = pendingMobileOsDevice || 'mobile';
            closeMobileOsModal();
            generateDeviceLink(nextDevice, 'android');
        });
    }

    const mobileOsIosBtn = el('mobileOsIosBtn');
    if (mobileOsIosBtn) {
        mobileOsIosBtn.addEventListener('click', () => {
            const nextDevice = pendingMobileOsDevice || 'mobile';
            closeMobileOsModal();
            generateDeviceLink(nextDevice, 'ios');
        });
    }

    const mobileLinkModal = el('mobileLinkModal');
    if (mobileLinkModal) {
        mobileLinkModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeMobileLink === '1') closeMobileLinkModal();
        });
    }

    const mobileLinkCloseBtn = el('mobileLinkCloseBtn');
    if (mobileLinkCloseBtn) mobileLinkCloseBtn.addEventListener('click', closeMobileLinkModal);

    const copyMobileLinkBtn = el('copyMobileLinkBtn');
    if (copyMobileLinkBtn) {
        copyMobileLinkBtn.addEventListener('click', async () => {
            const link = String(el('mobileLinkOutput') && el('mobileLinkOutput').value || mobileGeneratedLink || '').trim();
            if (!link) {
                setLookupState('Chua co link mobile de sao chep.', 'warning');
                return;
            }
            await copyText(link, 'Da sao chep link dang nhap mobile.');
        });
    }

    const copyUnsupportedLinkBtn = el('copyUnsupportedLinkBtn');
    if (copyUnsupportedLinkBtn) {
        copyUnsupportedLinkBtn.addEventListener('click', async () => {
            await copyText(UNSUPPORTED_URL, 'Da sao chep netflix.com/unsupported.');
        });
    }

    const tvGuideModal = el('tvGuideModal');
    if (tvGuideModal) {
        tvGuideModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeTvGuide === '1') closeTvGuideModal();
        });
    }

    const tvGuideCloseBtn = el('tvGuideCloseBtn');
    if (tvGuideCloseBtn) tvGuideCloseBtn.addEventListener('click', closeTvGuideModal);

    const tvGuideStartBtn = el('tvGuideStartBtn');
    if (tvGuideStartBtn) {
        tvGuideStartBtn.addEventListener('click', () => {
            closeTvGuideModal();
            openTvCodeModal();
        });
    }

    const tvCodeModal = el('tvCodeModal');
    if (tvCodeModal) {
        tvCodeModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeTvCode === '1') closeTvCodeModal();
        });
    }

    const tvCodeInput = el('tvCodeInput');
    if (tvCodeInput) {
        tvCodeInput.addEventListener('input', () => {
            const digits = String(tvCodeInput.value || '').replace(/\D/g, '').slice(0, 8);
            if (digits !== tvCodeInput.value) tvCodeInput.value = digits;
        });
        tvCodeInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submitTvCodeFlow();
        });
    }

    const tvCodeSubmitBtn = el('tvCodeSubmitBtn');
    if (tvCodeSubmitBtn) tvCodeSubmitBtn.addEventListener('click', submitTvCodeFlow);

    const tvCodeCloseBtn = el('tvCodeCloseBtn');
    if (tvCodeCloseBtn) tvCodeCloseBtn.addEventListener('click', closeTvCodeModal);

    const tvManualLink = el('tvManualLink');
    if (tvManualLink) tvManualLink.setAttribute('href', TV8_MANUAL_URL);

    const tvManualLoginLink = el('tvManualLoginLink');
    if (tvManualLoginLink) {
        tvManualLoginLink.setAttribute('href', '#');
        tvManualLoginLink.setAttribute('aria-disabled', 'true');
    }

    const adminFab = el('nfAdminFab');
    if (adminFab) adminFab.addEventListener('click', openAdminModal);

    const closeAdminBtn = el('closeAdminBtn');
    if (closeAdminBtn) closeAdminBtn.addEventListener('click', closeAdminModal);

    const adminModal = el('nfAdminModal');
    if (adminModal) {
        adminModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeAdmin === '1') closeAdminModal();
        });
    }

    const adminLoginBtn = el('adminLoginBtn');
    if (adminLoginBtn) adminLoginBtn.addEventListener('click', adminLogin);

    const adminLogoutBtn = el('adminLogoutBtn');
    if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', adminLogout);

    const adminApplyRuntimeCookieBtn = el('adminApplyRuntimeCookieBtn');
    if (adminApplyRuntimeCookieBtn) {
        adminApplyRuntimeCookieBtn.addEventListener('click', () => {
            const cookieRaw = normalizeCookie(el('adminRuntimeCookieInput') && el('adminRuntimeCookieInput').value || '');
            if (!cookieRaw) {
                setAdminRuntimeCookieState('Cookie runtime khong duoc de trong.', 'warning');
                return;
            }
            setRuntimeCookie(cookieRaw, { source: 'admin' });
            setAdminRuntimeCookieState('Da ap dung cookie runtime cho phien hien tai.', 'success');
        });
    }

    const adminClearRuntimeCookieBtn = el('adminClearRuntimeCookieBtn');
    if (adminClearRuntimeCookieBtn) {
        adminClearRuntimeCookieBtn.addEventListener('click', () => {
            setRuntimeCookie('', { source: 'admin', silent: true });
            setAdminRuntimeCookieState('Da xoa cookie runtime cua phien hien tai.', 'warning');
            setGuestGuard(true, 'Hay mo dung link /getlink?s=... hoac /getlink?c=... de tiep tuc.');
        });
    }

    const generateShareLinkBtn = el('generateShareLinkBtn');
    if (generateShareLinkBtn) generateShareLinkBtn.addEventListener('click', generateShareIdLink);

    const generateCookieShareLinkBtn = el('generateCookieShareLinkBtn');
    if (generateCookieShareLinkBtn) generateCookieShareLinkBtn.addEventListener('click', generateCookieEmbeddedShareLink);

    const copyShareLinkBtn = el('copyShareLinkBtn');
    if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener('click', async () => {
            const url = String(el('shareLinkOutput') && el('shareLinkOutput').value || '').trim();
            if (!url) {
                setShareState('Chua co link chia se de sao chep.', 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(url);
                setShareState('Da sao chep link chia se.', 'success');
            } catch (error) {
                setShareState('Khong copy duoc. Hay copy thu cong.', 'warning');
            }
        });
    }

    const adminShareSearchBtn = el('adminShareSearchBtn');
    if (adminShareSearchBtn) adminShareSearchBtn.addEventListener('click', adminSearchShare);

    const adminShareSearchInput = el('adminShareSearchInput');
    if (adminShareSearchInput) {
        adminShareSearchInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            adminSearchShare();
        });
    }

    const adminSaveCookieBtn = el('adminSaveCookieBtn');
    if (adminSaveCookieBtn) adminSaveCookieBtn.addEventListener('click', adminSaveCookie);

    const adminRotateIdBtn = el('adminRotateIdBtn');
    if (adminRotateIdBtn) adminRotateIdBtn.addEventListener('click', adminRotateId);

    const adminCopyUrlBtn = el('adminCopyUrlBtn');
    if (adminCopyUrlBtn) {
        adminCopyUrlBtn.addEventListener('click', async () => {
            const shareUrl = String(el('adminShareUrl') && el('adminShareUrl').value || '').trim();
            if (!shareUrl) {
                setAdminSearchState('Chua co URL de copy.', 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(shareUrl);
                setAdminSearchState('Da copy URL share.', 'success');
            } catch (error) {
                setAdminSearchState('Khong copy duoc URL.', 'warning');
            }
        });
    }

    const adminRevokeBtn = el('adminRevokeBtn');
    if (adminRevokeBtn) adminRevokeBtn.addEventListener('click', () => adminSetStatus('revoke'));

    const adminRestoreBtn = el('adminRestoreBtn');
    if (adminRestoreBtn) adminRestoreBtn.addEventListener('click', () => adminSetStatus('restore'));

    const adminUseShareCookieBtn = el('adminUseShareCookieBtn');
    if (adminUseShareCookieBtn) {
        adminUseShareCookieBtn.addEventListener('click', () => {
            const cookieRaw = normalizeCookie(el('adminShareCookieInput') && el('adminShareCookieInput').value || '');
            if (!cookieRaw) {
                setAdminSearchState('Khong co cookie de ap dung.', 'warning');
                return;
            }
            setRuntimeCookie(cookieRaw, { source: 'admin' });
            setAdminRuntimeCookieState('Da ap dung cookie tu share nay vao runtime.', 'success');
        });
    }

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        const deviceConfirmModalNode = el('deviceConfirmModal');
        if (deviceConfirmModalNode && !deviceConfirmModalNode.classList.contains('hidden')) {
            closeDeviceConfirmModal();
            return;
        }

        const mobileOsModalNode = el('mobileOsModal');
        if (mobileOsModalNode && !mobileOsModalNode.classList.contains('hidden')) {
            closeMobileOsModal();
            return;
        }

        const tvCodeModalNode = el('tvCodeModal');
        if (tvCodeModalNode && !tvCodeModalNode.classList.contains('hidden')) {
            closeTvCodeModal();
            return;
        }

        const tvGuideModalNode = el('tvGuideModal');
        if (tvGuideModalNode && !tvGuideModalNode.classList.contains('hidden')) {
            closeTvGuideModal();
            return;
        }

        const mobileModalNode = el('mobileLinkModal');
        if (mobileModalNode && !mobileModalNode.classList.contains('hidden')) {
            closeMobileLinkModal();
            return;
        }

        const supportModalNode = el('supportModal');
        if (supportModalNode && !supportModalNode.classList.contains('hidden')) {
            closeSupportModal();
            return;
        }

        closeAdminModal();
    });
}

async function bootstrap() {
    loadAdminAuthFromStorage();
    bindEvents();
    renderAdminWorkspace();
    await Promise.all([loadAdminSession(), applyCookieFromQuery()]);
    syncAdminCookieInput();
    if (!getRuntimeCookie()) {
        setGuestGuard(true, 'Hay mo dung link /getlink?s=... hoac /getlink?c=... de tiep tuc.');
    }
    updateReadyState();
    setShareState('Chi admin moi tao link chia se.', 'idle');
}

bootstrap();

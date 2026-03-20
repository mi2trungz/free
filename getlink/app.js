const TV8_MANUAL_URL = 'https://www.netflix.com/tv8';
const UNSUPPORTED_URL = 'https://www.netflix.com/unsupported';
const SUPPORT_FANPAGE_URL = 'https://www.facebook.com/trada3k.vn/';
const TV_REDIRECT_DELAY_MS = 4000;

let busy = false;
let mobileGeneratedLink = '';
let tvGeneratedLoginLink = '';
let tvFlowBusy = false;
let currentAdminShare = null;
let adminAuthenticated = false;

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
    const state = el('lookupState');
    if (!state) return;
    state.textContent = String(text || '').trim();
    setStateClass(state, mode);
}

function setShareState(text, mode = 'idle') {
    const state = el('shareState');
    if (!state) return;
    state.textContent = String(text || '').trim();
    setStateClass(state, mode);
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

function normalizeCookie(value = '') {
    return String(value || '').trim();
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

function setDeviceButtonsEnabled(enabled) {
    const buttons = Array.from(document.querySelectorAll('.btn-device'));
    buttons.forEach((button) => {
        button.disabled = !enabled || busy;
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
    const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(String(data.error || 'Request failed'));
    }
    return data;
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

function getCookieInputValue() {
    return normalizeCookie(el('cookieInput') && el('cookieInput').value);
}

function updateReadyState() {
    const cookie = getCookieInputValue();
    const ready = !!cookie && !busy;
    setDeviceButtonsEnabled(ready);
    if (!cookie) setLookupState('Vui long nhap cookie, sau do chon thiet bi.', 'idle');
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

function openMobileLinkModal(url) {
    const modal = el('mobileLinkModal');
    const output = el('mobileLinkOutput');
    mobileGeneratedLink = String(url || '').trim();
    if (!modal || !output) return;
    output.value = mobileGeneratedLink;
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

async function generateDeviceLink(device) {
    const cookie = getCookieInputValue();
    if (!cookie) {
        setLookupState('Vui long nhap cookie truoc.', 'warning');
        return;
    }

    const button = document.querySelector(`.btn-device[data-device="${device}"]`);
    busy = true;
    setButtonBusy(button, true, 'Dang tao link...');
    setDeviceButtonsEnabled(false);
    setLookupState('Dang kiem tra cookie LIVE va tao link...', 'loading');
    showLookupLoadingOverlay('Xin vui long cho trong giay lat');

    const shouldAutoOpen = device === 'desktop';
    let deferredPopup = null;
    if (shouldAutoOpen) {
        const deferred = openDeferredTabAndNavigate();
        deferredPopup = deferred.popupWindow;
        if (deferred.wasBlocked) {
            setLookupState('Trinh duyet chan tab moi, se mo trong tab hien tai.', 'warning');
        }
    }

    try {
        const data = await apiRequest('/api/nf-cookie-to-link', 'POST', { cookieStr: cookie, device });
        if (!data || !data.url) throw new Error('Khong tao duoc link.');

        if (shouldAutoOpen) {
            if (deferredPopup && !deferredPopup.closed) deferredPopup.location.href = data.url;
            else window.location.href = data.url;
            setLookupState('Da tao link thanh cong. Dang mo Netflix...', 'success');
        } else {
            openMobileLinkModal(data.url);
            setLookupState('Tao link thanh cong. Hay sao chep link va lam theo huong dan.', 'success');
        }
    } catch (error) {
        if (deferredPopup && !deferredPopup.closed) {
            try { deferredPopup.close(); } catch (closeError) { /* ignore */ }
        }
        setLookupState(error.message || 'Khong tao duoc link.', 'error');
    } finally {
        hideLookupLoadingOverlay();
        busy = false;
        setButtonBusy(button, false);
        updateReadyState();
    }
}

async function submitTvCodeFlow() {
    const cookie = getCookieInputValue();
    if (!cookie) {
        setLookupState('Vui long nhap cookie truoc.', 'warning');
        closeTvCodeModal();
        return;
    }
    if (tvFlowBusy) return;

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
    const cookie = getCookieInputValue();
    if (!cookie) {
        renderShareUrl('');
        setShareState('Chua co cookie de tao link chia se.', 'warning');
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
    const cookie = getCookieInputValue();
    if (!cookie) {
        renderShareUrl('');
        setShareState('Chua co cookie de tao link chia se.', 'warning');
        return;
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
            const input = el('cookieInput');
            if (input) input.value = cookieStr;
            setLookupState('Da tu dien cookie tu link chia se. Chon thiet bi de tao link.', 'success');
            return;
        } catch (error) {
            setLookupState(error.message || 'Khong tai duoc cookie tu link chia se.', 'warning');
            return;
        }
    }

    if (!encodedCookie) return;

    try {
        const cookieStr = normalizeCookie(fromBase64Url(encodedCookie));
        if (!cookieStr) {
            setLookupState('Link cookie khong hop le.', 'warning');
            return;
        }
        const input = el('cookieInput');
        if (input) input.value = cookieStr;
        setLookupState('Da tu dien cookie tu link chia se cookie. Chon thiet bi de tao link.', 'success');
    } catch (error) {
        setLookupState('Khong giai ma duoc cookie trong link chia se.', 'warning');
    }
}

function parseShareIdFromQueryText(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (/^[A-Za-z0-9_-]{6,64}$/.test(raw)) return raw;

    try {
        const url = new URL(raw);
        const fromParam = String(url.searchParams.get('s') || '').trim();
        if (/^[A-Za-z0-9_-]{6,64}$/.test(fromParam)) return fromParam;
    } catch (error) {
        // ignore
    }

    const idx = raw.indexOf('?');
    if (idx >= 0) {
        const params = new URLSearchParams(raw.slice(idx + 1));
        const fromParam = String(params.get('s') || '').trim();
        if (/^[A-Za-z0-9_-]{6,64}$/.test(fromParam)) return fromParam;
    }

    return '';
}

function renderAdminWorkspace() {
    const workspace = el('adminWorkspace');
    const authBox = el('adminAuthBox');
    const creatorBox = el('shareCreatorBox');
    if (!workspace || !authBox) return;

    workspace.classList.toggle('hidden', !adminAuthenticated);
    authBox.classList.toggle('hidden', adminAuthenticated);
    if (creatorBox) creatorBox.classList.toggle('hidden', !adminAuthenticated);
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
    try {
        const data = await apiRequest('/api/getlink-admin/session', 'GET');
        adminAuthenticated = !!(data && data.authenticated);
        if (adminAuthenticated && data.user && data.user.email) {
            setAdminAuthState(`Dang nhap admin: ${data.user.email}`, 'success');
        } else {
            setAdminAuthState('Dang xuat.', 'idle');
        }
    } catch (error) {
        adminAuthenticated = false;
        setAdminAuthState('Khong kiem tra duoc phien admin.', 'warning');
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
        const data = await apiRequest('/api/getlink-admin/login', 'POST', { email, password });
        adminAuthenticated = true;
        const userEmail = String(data.user && data.user.email || email);
        setAdminAuthState(`Dang nhap admin: ${userEmail}`, 'success');
        renderAdminWorkspace();
        setAdminSearchState('Khong tu dong load. Nhap ID/link roi bam Tim link.', 'idle');
    } catch (error) {
        adminAuthenticated = false;
        setAdminAuthState(error.message || 'Dang nhap that bai.', 'error');
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
        adminAuthenticated = false;
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

function bindEvents() {
    const cookieInput = el('cookieInput');
    if (cookieInput) cookieInput.addEventListener('input', updateReadyState);

    const clearCookieBtn = el('clearCookieBtn');
    if (clearCookieBtn) {
        clearCookieBtn.addEventListener('click', () => {
            if (cookieInput) cookieInput.value = '';
            renderShareUrl('');
            setShareState('Da xoa cookie.', 'idle');
            updateReadyState();
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

    const deviceButtons = Array.from(document.querySelectorAll('.btn-device'));
    deviceButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const device = String(button.dataset.device || 'desktop').trim();
            if (device === 'tv') {
                openTvGuideModal();
                return;
            }
            generateDeviceLink(device);
        });
    });

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

    const adminLoginBtn = el('adminLoginBtn');
    if (adminLoginBtn) adminLoginBtn.addEventListener('click', adminLogin);

    const adminLogoutBtn = el('adminLogoutBtn');
    if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', adminLogout);

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

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

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
        }
    });
}

async function bootstrap() {
    bindEvents();
    renderAdminWorkspace();
    await Promise.all([loadAdminSession(), applyCookieFromQuery()]);
    updateReadyState();
    setShareState('Chi admin moi tao link chia se.', 'idle');
}

bootstrap();

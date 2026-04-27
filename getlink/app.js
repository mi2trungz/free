
const UNSUPPORTED_URL = 'https://www.netflix.com/unsupported';
const SUPPORT_FANPAGE_URL = 'https://www.facebook.com/trada3k.vn/';
const GETLINK_ADMIN_AUTH_STORAGE_KEY = 'getlink_admin_auth_v1';

let busy = false;
let mobileGeneratedLink = '';
let adminAuthenticated = false;
let adminIdToken = '';
let adminRefreshToken = '';
let adminEmail = '';
let adminSessionResolved = false;
let adminTokenRefreshPromise = null;
let adminActiveTab = 'search';
let adminTabManuallySelected = false;
let runtimeCookie = '';
let runtimeShareDesktopOnly = false;
let currentAdminShare = null;
let createdAdminShare = null;
let pendingShareIdFromUrl = '';
let autoLoadedAdminShareId = '';
let guestGuardActive = true;
let pendingDeviceConfirm = '';
let deviceConfirmReadyAt = 0;
let deviceConfirmTimer = null;
let pendingMobileOsDevice = '';
let cookieHealthBlocked = false;
let cookieHealthReason = '';
let disclaimerVisible = false;
let disclaimerDismissed = false;
let disclaimerReadyAt = 0;
let disclaimerTimer = null;
let disclaimerEligibilityResolved = false;
let isInlineEditMode = false;
let overloadFixReadyAt = 0;
let overloadFixTimer = null;
let overloadFixBusy = false;
let entryAlertState = null;
const SHARE_COOKIE_SLOTS = [
    { key: 'primary', label: 'Cookie chính', viewInputId: 'currentShareCookiePrimaryDisplay', viewStateId: 'currentShareCookiePrimaryState', viewCheckBtnId: 'viewCheckPrimaryCookieBtn', viewUseBtnId: 'viewUsePrimaryCookieBtn' },
    { key: 'backup1', label: 'Cookie phụ 1', viewInputId: 'currentShareCookieBackup1Display', viewStateId: 'currentShareCookieBackup1State', viewCheckBtnId: 'viewCheckBackup1CookieBtn', viewUseBtnId: 'viewUseBackup1CookieBtn' },
    { key: 'backup2', label: 'Cookie phụ 2', viewInputId: 'currentShareCookieBackup2Display', viewStateId: 'currentShareCookieBackup2State', viewCheckBtnId: 'viewCheckBackup2CookieBtn', viewUseBtnId: 'viewUseBackup2CookieBtn' }
];
const CREATED_SHARE_COOKIE_SLOTS = [
    { key: 'primary', label: 'Cookie chính', viewInputId: 'creatorShareCookiePrimaryInput', viewStateId: 'creatorShareCookiePrimaryState', viewCheckBtnId: 'creatorCheckPrimaryCookieBtn', viewUseBtnId: 'creatorUsePrimaryCookieBtn' },
    { key: 'backup1', label: 'Cookie phụ 1', viewInputId: 'creatorShareCookieBackup1Input', viewStateId: 'creatorShareCookieBackup1State', viewCheckBtnId: 'creatorCheckBackup1CookieBtn', viewUseBtnId: 'creatorUseBackup1CookieBtn' },
    { key: 'backup2', label: 'Cookie phụ 2', viewInputId: 'creatorShareCookieBackup2Input', viewStateId: 'creatorShareCookieBackup2State', viewCheckBtnId: 'creatorCheckBackup2CookieBtn', viewUseBtnId: 'creatorUseBackup2CookieBtn' }
];

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
    const normalized = String(text || '').trim();
    node.textContent = normalized;
    node.classList.toggle('hidden', !normalized);
    setStateClass(node, mode);
}

function resetEntryAlertState() {
    entryAlertState = null;
}

function setEntryAlertState(payload = null) {
    entryAlertState = payload && typeof payload === 'object' ? { ...payload } : null;
}

function getDefaultSupportModalContent() {
    return {
        eyebrow: 'Hỗ trợ / Bảo hành',
        title: 'Cần hỗ trợ tài khoản Netflix?',
        message: 'Vui lòng nhắn tin qua fanpage để được hỗ trợ bảo hành nhanh nhất.',
        showBh247: false
    };
}

function renderSupportModalContent(payload = null) {
    const content = payload && typeof payload === 'object' ? payload : getDefaultSupportModalContent();
    const eyebrow = el('supportModalEyebrow');
    const title = el('supportModalTitle');
    const message = el('supportModalMessage');
    const bh247 = el('supportModalBh247');
    const fanpageLink = el('supportFanpageLink');
    if (eyebrow) eyebrow.textContent = String(content.eyebrow || 'Hỗ trợ / Bảo hành').trim();
    if (title) title.textContent = String(content.title || 'Cần hỗ trợ tài khoản Netflix?').trim();
    if (message) message.textContent = String(content.message || '').trim();
    if (bh247) bh247.classList.toggle('hidden', !content.showBh247);
    if (fanpageLink) {
        fanpageLink.href = SUPPORT_FANPAGE_URL;
        fanpageLink.textContent = 'Truy cập fanpage TRÀ ĐÁ 3K';
    }
}

function showEntryAlertPopup(payload = {}) {
    if (!canShowPromotionalPopups()) return;
    openSupportModal({
        eyebrow: 'Thông báo / Hỗ trợ',
        title: String(payload.title || 'Cần hỗ trợ tài khoản Netflix?').trim(),
        message: String(payload.message || 'Vui lòng nhắn tin qua fanpage để được hỗ trợ bảo hành nhanh nhất.').trim(),
        showBh247: !!payload.showBh247
    });
}

function hideEntryAlertPopup() {
    renderSupportModalContent(getDefaultSupportModalContent());
    closeSupportModal();
}

function setShareState(text, mode = 'idle') {
    const node = el('shareState');
    if (!node) return;
    const normalized = String(text || '').trim();
    node.textContent = normalized;
    node.classList.toggle('hidden', !normalized);
    setStateClass(node, mode);
}

function setDisclaimerState(text, mode = 'idle') {
    const node = el('disclaimerCountdown');
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

function setAdminCookieInfoState(text, mode = 'idle') {
    const node = el('adminCookieInfoState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setCreatorCookieInfoState(text, mode = 'idle') {
    const node = el('creatorCookieInfoState') || el('adminCookieInfoState');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function setShareCreateExpiryState(text, mode = 'idle') {
    const node = el('shareCreateExpiryState');
    if (!node) return;
    const normalized = String(text || '').trim();
    node.textContent = normalized;
    node.classList.toggle('hidden', !normalized);
    setStateClass(node, mode);
}

function setOverloadFixState(text, mode = 'idle') {
    const node = el('overloadFixCountdown');
    if (!node) return;
    node.textContent = String(text || '').trim();
    setStateClass(node, mode);
}

function isAdminImmediate() {
    return !!adminAuthenticated;
}

function shouldBypassPromotionalPopups() {
    return !!adminAuthenticated;
}

function canShowPromotionalPopups() {
    return adminSessionResolved && !shouldBypassPromotionalPopups();
}

function getCookiesFromSlotInputs(slots = []) {
    const cookies = {};
    slots.forEach((slot) => {
        cookies[slot.key] = normalizeCookie(el(slot.viewInputId) && el(slot.viewInputId).value || '');
    });
    return cookies;
}

function setCookiesToSlotInputs(slots = [], cookies = {}) {
    const normalized = cookies && typeof cookies === 'object' ? cookies : {};
    slots.forEach((slot) => {
        const input = el(slot.viewInputId);
        if (input) input.value = String(normalized[slot.key] || '').trim();
    });
}

function getCurrentShareEditableCookies() {
    return getCookiesFromSlotInputs(SHARE_COOKIE_SLOTS);
}

function getCreatedShareEditableCookies() {
    return getCookiesFromSlotInputs(CREATED_SHARE_COOKIE_SLOTS);
}

function setShareCookieViewOutputs(cookies = {}) {
    setCookiesToSlotInputs(SHARE_COOKIE_SLOTS, cookies);
}

function setCreatedShareCookieOutputs(cookies = {}) {
    setCookiesToSlotInputs(CREATED_SHARE_COOKIE_SLOTS, cookies);
}

function setSlotStateForConfig(slotConfigs, slotKey, text = 'Chưa check', ok = null) {
    const slot = slotConfigs.find((item) => item.key === slotKey);
    if (!slot) return;
    const node = el(slot.viewStateId);
    if (!node) return;
    node.textContent = String(text || '').trim();
    node.style.color = ok === true ? '#86efac' : (ok === false ? '#fca5a5' : '#9cb5e8');
}

function setShareCookieSlotState(slotKey, text = 'Chưa check', ok = null) {
    setSlotStateForConfig(SHARE_COOKIE_SLOTS, slotKey, text, ok);
}

function setCreatedShareCookieSlotState(slotKey, text = 'Chưa check', ok = null) {
    setSlotStateForConfig(CREATED_SHARE_COOKIE_SLOTS, slotKey, text, ok);
}

function resetShareCookieSlotStates() {
    SHARE_COOKIE_SLOTS.forEach((slot) => setShareCookieSlotState(slot.key, 'Chưa check', null));
}

function resetCreatedShareCookieSlotStates() {
    CREATED_SHARE_COOKIE_SLOTS.forEach((slot) => setCreatedShareCookieSlotState(slot.key, 'Chưa check', null));
}

function renderCookieCheckCardsTo(contentId, results = [], slotConfigs = SHARE_COOKIE_SLOTS) {
    const content = el(contentId);
    if (!content) return;
    const cards = Array.isArray(results) ? results : [];
    if (cards.length === 0) {
        content.innerHTML = '<p class="admin-cookie-info-placeholder">Chưa có dữ liệu cookie info.</p>';
        return;
    }

    const getBadgeTone = (field, value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (field === 'plan' && normalized === 'premium') return 'good';
        if (field === 'hold') {
            if (normalized === 'no') return 'good';
            if (normalized === 'yes') return 'bad';
        }
        if (field === 'max_streams') {
            if (normalized === '4') return 'good';
            if (normalized) return 'bad';
        }
        return '';
    };

    content.innerHTML = `<div class="cookie-check-grid">${
        cards.map((item) => {
            const label = slotConfigs.find((slot) => slot.key === item.slot)?.label || String(item.slot || '');
            const summary = item.summary || {};
            const statusText = item.ok ? 'PASS' : 'FAIL';
            const errorText = String(item.error || '').trim();
            const planValue = String(summary.plan || '-').trim() || '-';
            const holdValue = String(summary.paymentHold || '-').trim() || '-';
            const maxStreamsValue = String(summary.max_streams || '-').trim() || '-';
            const countryValue = String(summary.country || '-').trim() || '-';
            const profilesValue = String(summary.profiles || '-').trim() || '-';
            return `
                <article class="cookie-check-card ${item.ok ? 'good' : 'bad'}">
                    <h4>${escapeHtml(label)} - ${escapeHtml(statusText)}</h4>
                    <div class="cookie-check-fields">
                        <div class="cookie-check-field">
                            <span class="cookie-check-label">Plan</span>
                            <span class="cookie-check-badge ${getBadgeTone('plan', planValue)}">${escapeHtml(planValue)}</span>
                        </div>
                        <div class="cookie-check-field">
                            <span class="cookie-check-label">Hold</span>
                            <span class="cookie-check-badge ${getBadgeTone('hold', holdValue)}">${escapeHtml(holdValue)}</span>
                        </div>
                        <div class="cookie-check-field">
                            <span class="cookie-check-label">Max stream</span>
                            <span class="cookie-check-badge ${getBadgeTone('max_streams', maxStreamsValue)}">${escapeHtml(maxStreamsValue)}</span>
                        </div>
                        <div class="cookie-check-field">
                            <span class="cookie-check-label">Country</span>
                            <span class="cookie-check-value">${escapeHtml(countryValue)}</span>
                        </div>
                        <div class="cookie-check-field">
                            <span class="cookie-check-label">Profiles</span>
                            <span class="cookie-check-value">${escapeHtml(profilesValue)}</span>
                        </div>
                    </div>
                    <p class="cookie-check-note">${escapeHtml(errorText || (item.ok ? 'Cookie dùng được.' : 'Cookie không dùng được.'))}</p>
                </article>
            `;
        }).join('')
    }</div>`;
}

function renderCookieCheckCards(results = []) {
    renderCookieCheckCardsTo('adminCookieInfoContent', results, SHARE_COOKIE_SLOTS);
}

function renderCreatorCookieCheckCards(results = []) {
    renderCookieCheckCardsTo('creatorCookieInfoContent', results, CREATED_SHARE_COOKIE_SLOTS);
    renderCookieCheckCardsTo('adminCookieInfoContent', results, CREATED_SHARE_COOKIE_SLOTS);
}

function isViewingPendingShare() {
    return !!String(pendingShareIdFromUrl || '').trim();
}

function normalizeAdminTab(value = '') {
    return String(value || '').trim().toLowerCase() === 'create' ? 'create' : 'search';
}

function getAdminTabFromContext() {
    if (isViewingPendingShare() || (currentAdminShare && currentAdminShare.id)) return 'search';
    return 'create';
}

function ensureAdminTabFromContext(options = {}) {
    const force = !!options.force;
    if (!force && adminTabManuallySelected) return;
    adminActiveTab = normalizeAdminTab(getAdminTabFromContext());
}

function setAdminTab(tab, options = {}) {
    adminActiveTab = normalizeAdminTab(tab);
    if (options && options.manual) adminTabManuallySelected = true;
    if (options && options.resetManual) adminTabManuallySelected = false;
    if (!options || options.render !== false) renderAdminWorkspace();
}

function getShareCookiesForCurrentMode() {
    if (isInlineEditMode) return getCurrentShareEditableCookies();
    const share = currentAdminShare || {};
    return share && share.cookies ? share.cookies : { primary: share.cookieRaw || '', backup1: '', backup2: '' };
}

function setInlineEditMode(nextMode) {
    isInlineEditMode = !!nextMode;
    const editBtn = el('editCurrentShareBtn');
    const viewCheckAllBtn = el('viewCheckAllShareCookiesBtn');
    const saveBtn = el('saveCurrentShareBtn');
    const cancelBtn = el('cancelCurrentShareEditBtn');
    const expiryInput = el('currentShareExpiryInput');
    if (editBtn) editBtn.classList.toggle('hidden', isInlineEditMode);
    if (saveBtn) saveBtn.classList.toggle('hidden', !isInlineEditMode);
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !isInlineEditMode);
    if (expiryInput) expiryInput.disabled = !isInlineEditMode;
    SHARE_COOKIE_SLOTS.forEach((slot) => {
        const input = el(slot.viewInputId);
        if (input) input.readOnly = !isInlineEditMode;
    });
}

function renderCurrentShareSummary(share = null) {
    const summaryBox = el('currentShareSummaryBox');
    if (!summaryBox) return;
    if (!share || !isViewingPendingShare() || !adminAuthenticated) {
        summaryBox.classList.add('hidden');
        return;
    }

    const expired = !!(share && (share.expired || isShareExpiredClient(share)));
    const status = String(share.status || 'active');
    let statusLabel = 'Đang hoạt động';
    if (status !== 'active') statusLabel = 'Đã khóa / Thu hồi';
    else if (expired) statusLabel = 'Đã hết hạn';

    const cookies = share.cookies || { primary: share.cookieRaw || '', backup1: '', backup2: '' };
    const idInput = el('currentShareIdDisplay');
    const statusInput = el('currentShareStatusDisplay');
    const expiryInput = el('currentShareExpiryInput');
    const updatedInput = el('currentShareUpdatedDisplay');
    const urlInput = el('currentShareUrlDisplay');
    if (idInput) idInput.value = String(share.id || '-');
    if (statusInput) statusInput.value = statusLabel;
    if (expiryInput) expiryInput.value = toDatetimeLocalFromIso(share.expiresAt);
    if (updatedInput) updatedInput.value = formatDateTime(share.updatedAt);
    if (urlInput) urlInput.value = String(share.shareUrl || '');
    setShareCookieViewOutputs(cookies);
    summaryBox.classList.remove('hidden');
}

function renderCreatedShareEditor(share = null) {
    const section = el('shareCreateCookieSection');
    if (!section) return;
    if (!share || !share.id || !adminAuthenticated || isViewingPendingShare()) {
        section.classList.add('hidden');
        return;
    }
    setCreatedShareCookieOutputs(share.cookies || { primary: share.cookieRaw || '', backup1: '', backup2: '' });
    section.classList.remove('hidden');
}

function resetCreatedShareComposer(options = {}) {
    const keepExpiryInputs = !!options.keepExpiryInputs;
    createdAdminShare = null;
    renderCreatedShareEditor(null);
    renderShareUrl('');
    setCreatedShareCookieOutputs({ primary: '', backup1: '', backup2: '' });
    resetCreatedShareCookieSlotStates();
    renderCreatorCookieCheckCards([]);
    if (!keepExpiryInputs) {
        const quickDaysInput = el('shareCreateQuickDaysInput');
        const dateInput = el('shareCreateDateInput');
        const timeInput = el('shareCreateTimeInput');
        const desktopOnlyInput = el('shareDesktopOnlyInput');
        if (quickDaysInput) quickDaysInput.value = '';
        if (dateInput) dateInput.value = '';
        if (timeInput) timeInput.value = '';
        if (desktopOnlyInput) desktopOnlyInput.checked = false;
    }
    setShareState('', 'idle');
    setShareCreateExpiryState('', 'idle');
    setCreatorCookieInfoState('Tạo hoặc cập nhật cookie rồi bấm check để xem kết quả ngay tại đây.', 'idle');
}

async function runCookieChecksForShare(
    shareId,
    cookies = {},
    slotConfigs = SHARE_COOKIE_SLOTS,
    setSlotState = setShareCookieSlotState,
    options = {}
) {
    const renderCards = typeof options.renderCards === 'function' ? options.renderCards : renderCookieCheckCards;
    const setInfoState = typeof options.setInfoState === 'function' ? options.setInfoState : setAdminCookieInfoState;
    const normalized = {
        primary: normalizeCookie(cookies.primary || ''),
        backup1: normalizeCookie(cookies.backup1 || ''),
        backup2: normalizeCookie(cookies.backup2 || '')
    };
    const slotMap = new Map(slotConfigs.map((slot) => [slot.key, slot]));
    const keysToCheck = slotConfigs
        .map((slot) => slot.key)
        .filter((key) => normalized[key]);

    for (const slot of slotConfigs) {
        const cookieStr = normalized[slot.key] || '';
        if (!cookieStr) {
            setSlotState(slot.key, 'Để trống', null);
        }
    }

    if (keysToCheck.length === 0) {
        renderCards([]);
        setInfoState('Chưa có cookie nào để check.', 'idle');
        return [];
    }

    let results = [];
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(shareId)}/check-all`, 'POST', {
            cookies: normalized
        });
        const apiResults = Array.isArray(data.results) ? data.results : [];
        results = apiResults.filter((item) => slotMap.has(item && item.slot));
        for (const result of results) {
            setSlotState(result.slot, result.ok ? 'PASS' : 'FAIL', !!result.ok);
        }
    } catch (error) {
        results = keysToCheck.map((key) => ({
            slot: key,
            ok: false,
            error: error.message || 'Check cookie thất bại.',
            summary: {}
        }));
        for (const key of keysToCheck) {
            setSlotState(key, 'FAIL', false);
        }
    }

    for (const key of keysToCheck) {
        if (results.some((item) => item.slot === key)) continue;
        results.push({
            slot: key,
            ok: false,
            error: 'Không check được cookie.',
            summary: {}
        });
        setSlotState(key, 'FAIL', false);
    }

    renderCards(results);
    setInfoState('Đã check xong các cookie đã nhập.', results.every((item) => item.ok) ? 'success' : 'warning');
    return results;
}

function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isNo(value) {
    return String(value || '').trim().toLowerCase() === 'no';
}

function renderCookieInfoPlaceholder(text = 'Chua co du lieu cookie info.') {
    const content = el('adminCookieInfoContent');
    if (!content) return;
    content.innerHTML = `<p class="admin-cookie-info-placeholder">${escapeHtml(text)}</p>`;
}

function renderCookieInfoError(message = 'Khong kiem tra duoc cookie.', meta = {}) {
    const content = el('adminCookieInfoContent');
    if (!content) return;
    const overloadMessage = String(meta.overloadMessage || '').trim();
    const signal = String(meta.overloadSignal || '').trim();
    const finalMessage = String(message || 'Khong kiem tra duoc cookie.').trim();

    const extra = overloadMessage
        ? `<div class="admin-info-grid"><strong>Overload:</strong><span>${escapeHtml(overloadMessage)}</span></div>`
        : '';
    const signalHtml = signal
        ? `<div class="admin-info-grid"><strong>Signal:</strong><span>${escapeHtml(signal)}</span></div>`
        : '';

    content.innerHTML = `
        <div class="admin-info-highlight-grid">
            <div class="admin-info-chip bad">
                <strong>Trang thai</strong>
                <span>Khong LIVE / Loi</span>
            </div>
        </div>
        <div class="admin-info-grid">
            <strong>Chi tiet:</strong>
            <span>${escapeHtml(finalMessage)}</span>
        </div>
        ${extra}
        ${signalHtml}
    `;
    setAdminCookieInfoState('Cookie dang loi hoac khong LIVE, nhung link van duoc tao neu tao link thanh cong.', 'warning');
}

function renderCookieInfoSuccess(accountInfo, meta = {}) {
    const content = el('adminCookieInfoContent');
    if (!content) return;
    const info = accountInfo && typeof accountInfo === 'object' ? accountInfo : {};

    const statusText = info.ok ? 'Hoat dong' : 'Khong hoat dong';
    const statusClass = info.ok ? 'good' : 'bad';
    const paymentHoldText = String(info.on_payment_hold || 'No');
    const paymentHoldClass = isNo(paymentHoldText) ? 'good' : 'bad';

    const topFields = [
        { label: 'Trang thai', value: statusText, tone: statusClass },
        { label: 'Goi cuoc', value: `${String(info.plan || 'Khong ro')} ${info.premium ? '(Premium)' : ''}`.trim() },
        { label: 'Payment Hold', value: paymentHoldText, tone: paymentHoldClass },
        { label: 'Quoc gia', value: info.country || 'N/A' },
        { label: 'Man hinh', value: `${info.max_streams || '?'} man` },
        { label: 'Chat luong', value: info.video_quality || 'N/A' }
    ];

    const chipsHtml = topFields.map((item) => `
        <div class="admin-info-chip ${item.tone ? item.tone : ''}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.value)}</span>
        </div>
    `).join('');

    const overloadMessage = String(meta.overloadMessage || '').trim();
    const overloadSignal = String(meta.overloadSignal || '').trim();
    const overloadRow = overloadMessage
        ? `
            <strong>Overload:</strong><span>${escapeHtml(overloadMessage)}</span>
            <strong>Signal:</strong><span>${escapeHtml(overloadSignal || '-')}</span>
        `
        : '';

    content.innerHTML = `
        <div class="admin-info-highlight-grid">${chipsHtml}</div>
        <div class="admin-info-grid">
            <strong>Gia goi:</strong><span>${escapeHtml(info.plan_price || 'N/A')}</span>
            <strong>Ngay lap:</strong><span>${escapeHtml(info.member_since || 'N/A')}</span>
            <strong>Thanh toan:</strong><span>${escapeHtml(info.payment_method || 'N/A')}</span>
            <strong>Phone:</strong><span>${escapeHtml(info.phone || 'N/A')} (Verified: ${escapeHtml(info.phone_verified || 'No')})</span>
            <strong>Email:</strong><span>${escapeHtml(String(info.email || 'N/A').replace(/\\x40/g, '@'))} (Verified: ${escapeHtml(info.email_verified || 'No')})</span>
            <strong>Thanh vien phu:</strong><span>${escapeHtml(info.extra_member || 'No')}</span>
            <strong>Profiles:</strong><span>${escapeHtml(info.profiles || '?')}</span>
            <strong>Gia han toi:</strong><span>${escapeHtml(info.next_billing || 'N/A')}</span>
            ${overloadRow}
        </div>
    `;

    if (info.ok) {
        setAdminCookieInfoState('Cookie LIVE. Da cap nhat bang thong tin ben phai.', 'success');
    } else {
        setAdminCookieInfoState('Cookie da duoc check nhung trang thai khong LIVE.', 'warning');
    }
}

async function checkCookieForShareInfo(cookie = '') {
    const cookieStr = normalizeCookie(cookie);
    if (!cookieStr) {
        return {
            ok: false,
            error: 'Cookie rong, khong the kiem tra.'
        };
    }
    try {
        const data = await apiRequest('/api/nf-cookie-to-link', 'POST', {
            cookieStr,
            device: 'desktop'
        });
        return {
            ok: true,
            accountInfo: data && data.accountInfo ? data.accountInfo : null,
            overloadOutcome: String(data && data.overloadOutcome ? data.overloadOutcome : '').trim(),
            overloadSignal: String(data && data.overloadSignal ? data.overloadSignal : '').trim(),
            overloadMessage: String(data && data.overloadMessage ? data.overloadMessage : '').trim()
        };
    } catch (error) {
        return {
            ok: false,
            error: String(error && error.message ? error.message : 'Khong kiem tra duoc cookie.').trim()
        };
    }
}

function normalizeCookie(value = '') {
    return String(value || '').trim();
}

function parseDateMs(value = '') {
    const text = String(value || '').trim();
    if (!text) return 0;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : 0;
}

function isShareExpiredClient(share = null) {
    return parseDateMs(share && share.expiresAt) < Date.now() && !!parseDateMs(share && share.expiresAt);
}

function formatDateTime(value = '') {
    const ms = parseDateMs(value);
    if (!ms) return 'Khong gioi han';
    return new Date(ms).toLocaleString('vi-VN');
}

function parseCreateExpiryInput(dateValue = '', timeValue = '') {
    const rawDate = String(dateValue || '').trim();
    const rawTime = String(timeValue || '').trim();
    if (!rawDate && !rawTime) {
        return { ok: true, iso: '', label: 'không giới hạn' };
    }
    if (!rawDate && rawTime) {
        return { ok: false, error: 'Bạn cần nhập ngày trước khi nhập giờ.' };
    }

    const dateMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (!dateMatch) {
        return { ok: false, error: 'Ngày phải theo dạng dd/mm hoặc dd/mm/yyyy.' };
    }

    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = dateMatch[3] ? Number(dateMatch[3]) : new Date().getFullYear();
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
        return { ok: false, error: 'Ngày không hợp lệ.' };
    }

    let hours = 0;
    let minutes = 0;
    if (rawTime) {
        const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
            return { ok: false, error: 'Giờ phải theo dạng HH:mm.' };
        }
        hours = Number(timeMatch[1]);
        minutes = Number(timeMatch[2]);
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return { ok: false, error: 'Giờ không hợp lệ.' };
        }
    }

    const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (
        localDate.getFullYear() !== year ||
        localDate.getMonth() !== month - 1 ||
        localDate.getDate() !== day ||
        localDate.getHours() !== hours ||
        localDate.getMinutes() !== minutes
    ) {
        return { ok: false, error: 'Ngày giờ không hợp lệ.' };
    }

    const pad = (num) => String(num).padStart(2, '0');
    const label = `${pad(day)}/${pad(month)}/${year} ${pad(hours)}:${pad(minutes)}`;
    return {
        ok: true,
        iso: localDate.toISOString(),
        label
    };
}

function parseQuickDaysExpiryInput(daysValue = '') {
    const raw = String(daysValue || '').trim();
    if (!raw) return { ok: true, iso: '', label: '', usingQuickDays: false };
    if (!/^\d+$/.test(raw)) {
        return { ok: false, error: 'Hạn lẹ phải là số ngày nguyên dương.' };
    }
    const days = Number(raw);
    if (!Number.isInteger(days) || days <= 0) {
        return { ok: false, error: 'Hạn lẹ phải lớn hơn 0 ngày.' };
    }
    const expiresAtMs = Date.now() + days * 24 * 60 * 60 * 1000;
    return {
        ok: true,
        iso: new Date(expiresAtMs).toISOString(),
        label: `${days} ngày`,
        usingQuickDays: true
    };
}

function toDatetimeLocalFromIso(value = '') {
    const ms = parseDateMs(value);
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalToIso(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString();
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
    setEntryAlertState({
        type: 'cookie',
        reason: normalizedReason,
        message: detailText
    });
    setDeviceButtonsEnabled(false);
    setLookupState(
        `Tài khoản đã lỗi, hãy liên hệ admin để được bảo hành. ${detailText}`.trim(),
        'error'
    );
    setGuestGuard(true, detailText || 'Cookie của link hiện đang lỗi. Vui lòng nhắn fanpage để được hỗ trợ bảo hành.', {
        title: 'Cookie hiện đang lỗi',
        kind: 'cookie'
    });
    showEntryAlertPopup(getEntryAlertPopupContent());
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
            detailMessage: 'Không có cookie hợp lệ.'
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
                detailMessage: 'Tài khoản đang bị HOLD (on_payment_hold=yes).'
            };
        }
        if (account && isUnknownPlan(account.plan)) {
            return {
                ok: false,
                blockedReason: 'unknown',
                detailMessage: 'Gói cước đang UNKNOWN.'
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
                detailMessage: 'Cookie bị chặn SBD.'
            };
        }
        if (reason === 'dead') {
            return {
                ok: false,
                blockedReason: 'dead',
                detailMessage: 'Cookie đã dead hoặc hết hạn.'
            };
        }
        return {
            ok: false,
            blockedReason: 'error',
            detailMessage: String(error && error.message ? error.message : 'Không thể kiểm tra cookie.')
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
    const options = arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
    guestGuardActive = !!active;
    const guard = el('guestGuard');
    const guardTitle = guard ? guard.querySelector('h3') : null;
    const guardText = el('guestGuardText');
    if (guard) guard.classList.toggle('hidden', !guestGuardActive);
    if (guardTitle) {
        const title = options.title
            || (options.kind === 'cookie' ? 'Cookie hiện đang lỗi' : 'Không tìm thấy link hợp lệ');
        guardTitle.textContent = String(title || '').trim();
    }
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
    async function sendRequest() {
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
        return { response, data };
    }

    let result = await sendRequest();
    let sessionExpiredHandled = false;
    if (!result.response.ok && isAdminRoute && Number(result.response.status || 0) === 401) {
        const refreshed = await refreshAdminIdToken().catch(() => false);
        if (refreshed) {
            result = await sendRequest();
        } else {
            handleAdminSessionExpired();
            sessionExpiredHandled = true;
        }
    }

    if (!result.response.ok) {
        if (isAdminRoute && Number(result.response.status || 0) === 401 && !sessionExpiredHandled) {
            handleAdminSessionExpired();
        }
        const err = new Error(String(result.data.error || 'Request failed'));
        err.httpStatus = Number(result.response.status || 0);
        throw err;
    }
    return result.data;
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

function mapFirebaseRefreshError(message = '') {
    const code = String(message || '').trim().toUpperCase();
    if (!code) return 'Gia han phien admin that bai.';
    if (code.includes('TOKEN_EXPIRED') || code.includes('INVALID_REFRESH_TOKEN') || code.includes('USER_DISABLED') || code.includes('USER_NOT_FOUND')) {
        return 'Phien admin het han. Vui long dang nhap lai.';
    }
    return `Gia han phien admin that bai: ${code}`;
}

function handleAdminSessionExpired(message = 'Phien admin het han. Vui long dang nhap lai.') {
    clearAdminAuthState();
    adminSessionResolved = true;
    renderAdminShare(null);
    resetCreatedShareComposer();
    autoLoadedAdminShareId = '';
    setAdminAuthState(message, 'warning');
    setAdminSearchState('Vui long dang nhap lai de tiep tuc.', 'warning');
    renderAdminWorkspace();
}

async function refreshAdminIdToken() {
    if (!adminRefreshToken) return false;
    if (adminTokenRefreshPromise) return adminTokenRefreshPromise;

    adminTokenRefreshPromise = (async () => {
        const apiKey = getFirebaseApiKey();
        if (!apiKey) throw new Error('Thieu NF_FIREBASE_CONFIG.apiKey tren /getlink.');

        const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(adminRefreshToken)}`
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const firebaseError = String(data && data.error && data.error.message ? data.error.message : '').trim();
            throw new Error(mapFirebaseRefreshError(firebaseError));
        }

        const nextIdToken = String(data && data.id_token ? data.id_token : '').trim();
        const nextRefreshToken = String(data && data.refresh_token ? data.refresh_token : adminRefreshToken).trim();
        if (!nextIdToken) throw new Error('Firebase khong tra ve id_token khi gia han phien.');

        adminIdToken = nextIdToken;
        adminRefreshToken = nextRefreshToken;
        saveAdminAuthToStorage();
        return true;
    })();

    try {
        return await adminTokenRefreshPromise;
    } finally {
        adminTokenRefreshPromise = null;
    }
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
        popupWindow.document.body.innerHTML = '<div>Đang tạo link Netflix...</div>';
    } catch (error) {
        // ignore
    }

    return { popupWindow, wasBlocked: false };
}

function getRuntimeCookie() {
    return normalizeCookie(runtimeCookie);
}

function isRuntimeShareDesktopOnly() {
    return runtimeShareDesktopOnly === true;
}

function setRuntimeShareDesktopOnly(value) {
    runtimeShareDesktopOnly = value === true;
}

function syncAdminCookieInput() {
    return '';
}

function getAdminRuntimeCookieInputValue() {
    return '';
}

function updateReadyState() {
    const hasCookie = !!getRuntimeCookie();
    if (hasCookie && cookieHealthBlocked) {
        setDeviceButtonsEnabled(false);
        return;
    }
    if (disclaimerVisible) {
        setDeviceButtonsEnabled(false);
        return;
    }
    setDeviceButtonsEnabled(hasCookie && !guestGuardActive);
    if (!hasCookie && !entryAlertState && !pendingShareIdFromUrl) {
        setLookupState('', 'idle');
    }
}

function setRuntimeCookie(rawCookie, options = {}) {
    const next = normalizeCookie(rawCookie);
    const source = String(options.source || 'unknown').trim();
    const silent = !!options.silent;

    runtimeCookie = next;
    clearCookieBlockedState();
    if (next) {
        resetEntryAlertState();
        renderSupportModalContent(getDefaultSupportModalContent());
    }

    if (next) {
        setGuestGuard(false);
        if (!silent) {
            if (source === 'share-id') {
                setLookupState('Đã tải cookie từ share link. Hãy chọn thiết bị để tiếp tục.', 'success');
            } else if (source === 'cookie-link') {
                setLookupState('Đã giải mã cookie từ link chia sẻ. Hãy chọn thiết bị để tiếp tục.', 'success');
            } else if (source === 'admin') {
                setLookupState('Admin da ap dung cookie cho phien hien tai.', 'success');
            }
        }
        updateReadyState();
        return;
    }

    if (!entryAlertState) {
        setGuestGuard(true, 'Hãy mở đúng link /getlink?s=... hoặc /getlink?c=... để tiếp tục.', {
            title: 'Không tìm thấy link hợp lệ',
            kind: 'link'
        });
        setLookupState('Không có cookie hợp lệ. Chỉ có thể tiếp tục bằng link được cấp.', 'warning');
    }
    updateReadyState();
}

function getDesktopOnlyBlockedMessage() {
    return 'GÓI NETFLIX TẶNG KÈM CHỈ CÓ THỂ XEM ĐƯỢC TRÊN MÁY TÍNH';
}

function showDesktopOnlyBlockedPopup() {
    const message = getDesktopOnlyBlockedMessage();
    setLookupState(message, 'warning');
    openSupportModal({
        eyebrow: 'Thông báo',
        title: 'Thông báo',
        message,
        showBh247: false
    });
}

function getEntryAlertPopupContent() {
    const state = entryAlertState && typeof entryAlertState === 'object' ? entryAlertState : null;
    if (!state) return getDefaultSupportModalContent();
    const message = String(state.message || '').trim() || 'Vui lòng nhắn tin qua fanpage để được hỗ trợ bảo hành nhanh nhất.';
    if (state.type === 'cookie') {
        const titleMap = {
            sbd: 'Cookie bị SBD',
            dead: 'Cookie đã lỗi',
            hold: 'Tài khoản đang bị hold',
            unknown: 'Cookie đang lỗi',
            share_no_live_cookie: 'Link đã hết cookie hợp lệ',
            error: 'Cookie đang lỗi'
        };
        return {
            eyebrow: 'Thông báo / Hỗ trợ',
            title: titleMap[state.reason] || 'Cookie đang lỗi',
            message,
            showBh247: true
        };
    }
    const titleMap = {
        share_not_found: 'Link không tồn tại',
        share_revoked: 'Link đã bị thu hồi',
        share_expired: 'Link đã hết hạn',
        invalid_cookie_link: 'Link cookie không hợp lệ',
        invalid_share_link: 'Link không hợp lệ'
    };
    return {
        eyebrow: 'Thông báo / Hỗ trợ',
        title: titleMap[state.reason] || 'Link không hợp lệ',
        message,
        showBh247: false
    };
}

function classifyShareEntryError(error) {
    const status = Number(error && error.httpStatus ? error.httpStatus : 0);
    const rawMessage = String(error && error.message ? error.message : '').trim();
    const normalized = rawMessage.toLowerCase();
    if (status === 404 || normalized.includes('not found')) {
        return {
            type: 'link',
            reason: 'share_not_found',
            lookupMessage: 'Link chia sẻ không tồn tại hoặc đã bị xóa.',
            guardTitle: 'Không tìm thấy link hợp lệ',
            guardMessage: 'Link bạn mở không còn tồn tại. Vui lòng liên hệ admin để nhận link mới.'
        };
    }
    if (status === 410 && normalized.includes('revoked')) {
        return {
            type: 'link',
            reason: 'share_revoked',
            lookupMessage: 'Link chia sẻ này đã bị thu hồi.',
            guardTitle: 'Link đã bị thu hồi',
            guardMessage: 'Link này đã bị thu hồi. Vui lòng liên hệ admin để nhận link mới.'
        };
    }
    if (status === 410 && normalized.includes('expired')) {
        return {
            type: 'link',
            reason: 'share_expired',
            lookupMessage: 'Link chia sẻ này đã hết hạn.',
            guardTitle: 'Link đã hết hạn',
            guardMessage: 'Link này đã hết hạn sử dụng. Vui lòng liên hệ admin để được cấp lại link.'
        };
    }
    if (status === 410 && (normalized.includes('het cookie hop le') || normalized.includes('hết cookie hợp lệ'))) {
        return {
            type: 'cookie',
            reason: 'share_no_live_cookie',
            lookupMessage: 'Link này đã hết cookie hợp lệ. Vui lòng liên hệ admin để được bảo hành.',
            guardTitle: 'Link đã hết cookie hợp lệ',
            guardMessage: 'Link này vẫn tồn tại nhưng hiện không còn cookie dùng được. Vui lòng nhắn fanpage để được hỗ trợ bảo hành.'
        };
    }
    return {
        type: 'link',
        reason: 'invalid_share_link',
        lookupMessage: rawMessage || 'Không tải được cookie từ link chia sẻ.',
        guardTitle: 'Không tìm thấy link hợp lệ',
        guardMessage: rawMessage || 'Hãy mở đúng link /getlink?s=... hoặc /getlink?c=... để tiếp tục.'
    };
}

function shouldShowOverloadFix() {
    return !!String(pendingShareIdFromUrl || '').trim();
}

function updateOverloadFixVisibility() {
    const button = el('overloadFixBtn');
    if (!button) return;
    const visible = shouldShowOverloadFix();
    button.classList.toggle('hidden', !visible);
    button.disabled = !visible || overloadFixBusy;
}

async function copyText(text, successText = 'Đã sao chép.') {
    try {
        await navigator.clipboard.writeText(String(text || ''));
        setLookupState(successText, 'success');
        return true;
    } catch (error) {
        setLookupState('Không copy được. Hãy copy thủ công.', 'warning');
        return false;
    }
}

function openSupportModal(payload = null) {
    const modal = el('supportModal');
    if (!modal) return;
    renderSupportModalContent(payload);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeSupportModal() {
    const modal = el('supportModal');
    if (!modal) return;
    renderSupportModalContent(getDefaultSupportModalContent());
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
        if (step1) step1.textContent = 'Bước 1: Sao chép đường link đăng nhập phía trên';
        if (step2) step2.textContent = 'Bước 2: Dán vào Safari và truy cập';
        if (step3) step3.textContent = 'Bước 3: Truy cập tiếp trang netflix.com/unsupported';
        if (step3Row) step3Row.classList.remove('hidden');
    } else {
        if (step1) step1.textContent = 'Bước 1: Sao chép đường link đăng nhập phía trên';
        if (step2) step2.textContent = 'Bước 2: Dán vào trình duyệt mặc định trên điện thoại và truy cập';
        if (step3) step3.textContent = 'Bước 3: Truy cập tiếp trang netflix.com/unsupported';
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

function openDisclaimerModal() {
    if (!canShowPromotionalPopups() || disclaimerDismissed) return;

    disclaimerVisible = true;
    const modal = el('disclaimerModal');
    const dismissBtn = el('disclaimerDismissBtn');
    const waitMs = 2000;
    disclaimerReadyAt = Date.now() + waitMs;

    if (dismissBtn) dismissBtn.disabled = true;
    setDisclaimerState('Vui lòng chờ 2 giây để bỏ qua popup.', 'warning');

    if (disclaimerTimer) {
        window.clearInterval(disclaimerTimer);
        disclaimerTimer = null;
    }

    disclaimerTimer = window.setInterval(() => {
        const remainMs = Math.max(0, disclaimerReadyAt - Date.now());
        const remainSec = Math.ceil(remainMs / 1000);
        if (remainMs > 0) {
            setDisclaimerState(`Vui lòng chờ ${remainSec} giây để bỏ qua popup.`, 'warning');
            if (dismissBtn) dismissBtn.disabled = true;
            return;
        }

        if (dismissBtn) dismissBtn.disabled = false;
        setDisclaimerState('Bạn có thể bấm Bỏ qua để tiếp tục.', 'success');
        window.clearInterval(disclaimerTimer);
        disclaimerTimer = null;
    }, 150);

    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeDisclaimerModal(force = false) {
    if (!force && Date.now() < disclaimerReadyAt) return false;

    const modal = el('disclaimerModal');
    const dismissBtn = el('disclaimerDismissBtn');

    if (disclaimerTimer) {
        window.clearInterval(disclaimerTimer);
        disclaimerTimer = null;
    }

    disclaimerVisible = false;
    disclaimerDismissed = force ? disclaimerDismissed : true;
    disclaimerReadyAt = 0;

    if (dismissBtn) dismissBtn.disabled = false;
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    return true;
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
        desktop: 'Máy tính',
        mobile: 'Điện thoại',
        tablet: 'Máy tính bảng',
        tv: 'TV'
    };
    const label = labels[normalized] || normalized;

    if (title) title.textContent = `Bạn có chắc chắn đang dùng ${label} không?`;
    if (hint) hint.textContent = 'Vui lòng xác nhận đúng thiết bị để tiếp tục.';
    if (deviceConfirmTimer) {
        window.clearInterval(deviceConfirmTimer);
        deviceConfirmTimer = null;
    }

    const waitMs = isAdminImmediate() ? 0 : 3000;
    deviceConfirmReadyAt = Date.now() + waitMs;

    if (waitMs <= 0) {
        if (countdown) {
            countdown.textContent = 'Bạn có thể bấm Có để tiếp tục.';
            setStateClass(countdown, 'success');
        }
        if (okBtn) okBtn.disabled = false;
    } else {
        if (countdown) {
            countdown.textContent = 'Vui lòng chờ 3 giây để xác nhận.';
            setStateClass(countdown, 'warning');
        }
        if (okBtn) okBtn.disabled = true;

        deviceConfirmTimer = window.setInterval(() => {
            const remainMs = Math.max(0, deviceConfirmReadyAt - Date.now());
            const remainSec = Math.ceil(remainMs / 1000);
            if (countdown) {
                if (remainMs > 0) {
                    countdown.textContent = `Vui lòng chờ ${remainSec} giây để xác nhận.`;
                    setStateClass(countdown, 'warning');
                } else {
                    countdown.textContent = 'Bạn có thể bấm Có để tiếp tục.';
                    setStateClass(countdown, 'success');
                }
            }
            if (okBtn) okBtn.disabled = remainMs > 0;
            if (remainMs <= 0) {
                window.clearInterval(deviceConfirmTimer);
                deviceConfirmTimer = null;
            }
        }, 150);
    }

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

function openOverloadFixModal() {
    if (!shouldShowOverloadFix() || overloadFixBusy) return;
    const modal = el('overloadFixModal');
    const confirmBtn = el('overloadFixConfirmBtn');
    if (overloadFixTimer) {
        window.clearInterval(overloadFixTimer);
        overloadFixTimer = null;
    }
    if (confirmBtn) {
        setButtonBusy(confirmBtn, false);
    }

    const waitMs = isAdminImmediate() ? 0 : 10000;
    overloadFixReadyAt = Date.now() + waitMs;

    if (waitMs <= 0) {
        setOverloadFixState('Bạn có thể bấm Đồng ý rồi sử dụng.', 'success');
        if (confirmBtn) confirmBtn.disabled = false;
    } else {
        setOverloadFixState('Vui lòng chờ 10 giây để xác nhận.', 'warning');
        if (confirmBtn) confirmBtn.disabled = true;

        overloadFixTimer = window.setInterval(() => {
            const remainMs = Math.max(0, overloadFixReadyAt - Date.now());
            const remainSec = Math.ceil(remainMs / 1000);
            if (remainMs > 0) {
                setOverloadFixState(`Vui lòng chờ ${remainSec} giây để xác nhận.`, 'warning');
                if (confirmBtn) confirmBtn.disabled = true;
                return;
            }

            setOverloadFixState('Bạn có thể bấm Đồng ý rồi sử dụng.', 'success');
            if (confirmBtn) confirmBtn.disabled = false;
            window.clearInterval(overloadFixTimer);
            overloadFixTimer = null;
        }, 150);
    }

    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeOverloadFixModal(force = false) {
    if (!force && overloadFixBusy) return;
    const modal = el('overloadFixModal');
    if (overloadFixTimer) {
        window.clearInterval(overloadFixTimer);
        overloadFixTimer = null;
    }
    overloadFixReadyAt = 0;
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openOverloadFixSuccessModal() {
    const modal = el('overloadFixSuccessModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeOverloadFixSuccessModal() {
    const modal = el('overloadFixSuccessModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
    window.location.reload();
}

function syncAdminImmediateModals() {
    const deviceConfirmModal = el('deviceConfirmModal');
    if (deviceConfirmModal && !deviceConfirmModal.classList.contains('hidden') && pendingDeviceConfirm) {
        openDeviceConfirmModal(pendingDeviceConfirm);
    }

    const overloadFixModal = el('overloadFixModal');
    if (overloadFixModal && !overloadFixModal.classList.contains('hidden') && shouldShowOverloadFix()) {
        openOverloadFixModal();
    }
}

function normalizeOverloadFixErrorMessage(error) {
    const rawMessage = String(error && error.message ? error.message : '').trim();
    if (!rawMessage) return 'Không thể sửa lỗi quá tải lúc này.';

    const normalized = rawMessage.toLowerCase();
    if (normalized.includes('het cookie du phong')
        || normalized.includes('hết cookie dự phòng')
        || normalized.includes('khong du cookie du phong')
        || normalized.includes('không đủ cookie dự phòng')) {
        return 'Link này đã hết cookie dự phòng. Vui lòng bấm CẦN HỖ TRỢ / BẢO HÀNH để được hỗ trợ.';
    }

    return rawMessage;
}

async function rotateOverloadShareCookie() {
    const shareId = String(pendingShareIdFromUrl || '').trim();
    if (!shareId) {
        setLookupState('Chỉ dùng được tính năng này khi mở bằng link share hợp lệ.', 'warning');
        return;
    }
    if (overloadFixBusy || Date.now() < overloadFixReadyAt) return;

    const triggerBtn = el('overloadFixBtn');
    const confirmBtn = el('overloadFixConfirmBtn');
    overloadFixBusy = true;
    updateOverloadFixVisibility();
    setButtonBusy(triggerBtn, true, 'Đang sửa lỗi...');
    setButtonBusy(confirmBtn, true, 'Đang sửa lỗi...');
    setOverloadFixState('Đang đổi cookie chính, vui lòng chờ...', 'loading');

    try {
        const data = await apiRequest(`/api/getlink-shares/${encodeURIComponent(shareId)}/rotate-cookie`, 'POST');
        const nextCookie = normalizeCookie(data.cookieStr || '');
        if (nextCookie) {
            setRuntimeCookie(nextCookie, { source: 'share-id', silent: true });
        } else {
            runtimeCookie = '';
        }
        closeOverloadFixModal(true);
        setLookupState('Đã sửa lỗi thành công, hãy chọn lại thiết bị để sử dụng.', 'success');
        openOverloadFixSuccessModal();
    } catch (error) {
        const message = normalizeOverloadFixErrorMessage(error);
        setLookupState(message, 'error');
        setOverloadFixState(message, 'error');
    } finally {
        overloadFixBusy = false;
        setButtonBusy(triggerBtn, false);
        setButtonBusy(confirmBtn, false);
        updateOverloadFixVisibility();
    }
}

async function generateDeviceLink(device, mobileOs = 'android') {
    const cookie = getRuntimeCookie();
    if (!cookie) {
        setLookupState('Không có cookie hợp lệ để tạo link.', 'warning');
        setGuestGuard(true, 'Hãy mở đúng link /getlink?s=... hoặc /getlink?c=... để tiếp tục.');
        return;
    }

    const frontendDevice = String(device || '').trim();
    if (!frontendDevice) return;

    setLookupState('Đang kiểm tra tình trạng cookie...', 'loading');
    const health = await checkRuntimeCookieHealth();
    if (!health.ok) {
        applyCookieBlockedState(health.blockedReason, health.detailMessage);
        return;
    }
    clearCookieBlockedState();

    const apiDevice = frontendDevice === 'desktop' ? 'desktop' : 'mobile';
    const button = document.querySelector(`.btn-device[data-device="${frontendDevice}"]`);

    busy = true;
    setButtonBusy(button, true, 'Đang tạo link...');
    setDeviceButtonsEnabled(false);
    setLookupState('Đang kiểm tra cookie LIVE và tạo link...', 'loading');
    showLookupLoadingOverlay('Xin vui lòng chờ trong giây lát');

    const shouldAutoOpen = apiDevice === 'desktop';
    let deferredPopup = null;
    if (shouldAutoOpen) {
        const deferred = openDeferredTabAndNavigate();
        deferredPopup = deferred.popupWindow;
        if (deferred.wasBlocked) {
            setLookupState('Trình duyệt chặn tab mới, sẽ mở trong tab hiện tại.', 'warning');
        }
    }

    try {
        const data = await apiRequest('/api/nf-cookie-to-link', 'POST', { cookieStr: cookie, device: apiDevice, mobileOs });
        if (!data || !data.url) throw new Error('Không tạo được link.');

        if (shouldAutoOpen) {
            if (deferredPopup && !deferredPopup.closed) deferredPopup.location.href = data.url;
            else window.location.href = data.url;
            setLookupState('Đã tạo link thành công. Đang mở Netflix...', 'success');
        } else {
            openMobileLinkModal(data.url, mobileOs);
            const typeLabel = frontendDevice === 'tablet' ? 'tablet' : 'điện thoại';
            setLookupState(`Tạo link ${typeLabel} thành công. Hãy sao chép link và làm theo hướng dẫn.`, 'success');
        }
    } catch (error) {
        if (deferredPopup && !deferredPopup.closed) {
            try { deferredPopup.close(); } catch (closeError) { }
        }
        setLookupState(error.message || 'Không tạo được link.', 'error');
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

    if (isRuntimeShareDesktopOnly() && normalized !== 'desktop') {
        showDesktopOnlyBlockedPopup();
        return;
    }

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
    const quickDaysValue = String(el('shareCreateQuickDaysInput') && el('shareCreateQuickDaysInput').value || '').trim();
    const rawDateValue = String(el('shareCreateDateInput') && el('shareCreateDateInput').value || '').trim();
    const rawTimeValue = String(el('shareCreateTimeInput') && el('shareCreateTimeInput').value || '').trim();
    const desktopOnly = !!(el('shareDesktopOnlyInput') && el('shareDesktopOnlyInput').checked);
    const quickDaysParse = parseQuickDaysExpiryInput(quickDaysValue);
    if (!quickDaysParse.ok) {
        setShareState(quickDaysParse.error || 'Hạn lẹ không hợp lệ.', 'warning');
        setShareCreateExpiryState(quickDaysParse.error || 'Hạn lẹ không hợp lệ. Hãy nhập lại.', 'warning');
        return;
    }
    const expiryParse = quickDaysParse.usingQuickDays
        ? quickDaysParse
        : parseCreateExpiryInput(rawDateValue, rawTimeValue);
    if (!expiryParse.ok) {
        setShareState(expiryParse.error || 'Hạn của link không hợp lệ.', 'warning');
        setShareCreateExpiryState(expiryParse.error || 'Hạn của link không hợp lệ. Hãy nhập lại.', 'warning');
        return;
    }
    const expiresAt = expiryParse.iso;

    const btn = el('generateShareLinkBtn');
    setButtonBusy(btn, true, 'Đang tạo...');
    setCreatorCookieInfoState('Đang chờ dữ liệu cookie của link ID.', 'idle');
    setShareCreateExpiryState(
        expiresAt
            ? (quickDaysParse.usingQuickDays
                ? `Đang tạo link ID server với hạn lẹ ${expiryParse.label}, hết hạn lúc ${formatDateTime(expiresAt)}...`
                : `Đang tạo link ID server có hạn đến ${expiryParse.label}...`)
            : 'Đang tạo link ID server không giới hạn...',
        'loading'
    );
    try {
        const data = await apiRequest('/api/getlink-shares', 'POST', {
            expiresAt,
            desktopOnly
        });
        const shareUrl = String(data.shareUrl || '').trim();
        createdAdminShare = data.share || null;
        renderShareUrl(shareUrl);
        await autoCopyShareLinkOrWarn(shareUrl);
        renderAdminShare(null);
        setAdminTab('create', { resetManual: true });
        renderCreatedShareEditor(createdAdminShare);
        resetShareCookieSlotStates();
        resetCreatedShareCookieSlotStates();
        if (data && data.expiresAt) {
            setShareState(`Đã tạo link ID server có hạn đến ${formatDateTime(data.expiresAt)}.`, 'success');
            setShareCreateExpiryState('', 'idle');
        } else {
            setShareState('Đã tạo link ID server không giới hạn.', 'success');
            setShareCreateExpiryState('', 'idle');
        }
        renderCreatorCookieCheckCards([]);
        setCreatorCookieInfoState('Tạo hoặc cập nhật cookie rồi bấm check để xem kết quả ngay tại đây.', 'idle');
    } catch (error) {
        resetCreatedShareComposer({ keepExpiryInputs: true });
        setShareState(error.message || 'Không tạo được link chia sẻ.', 'error');
        setShareCreateExpiryState(error.message || 'Không tạo được link ID server.', 'error');
    }
    setButtonBusy(btn, false);
}

async function runEntryCookieHealthCheck() {
    const cookie = getRuntimeCookie();
    if (!cookie) return;
    setLookupState('Đang kiểm tra tình trạng cookie từ link...', 'loading');
    const health = await checkRuntimeCookieHealth();
    if (!health.ok) {
        applyCookieBlockedState(health.blockedReason, health.detailMessage);
        return;
    }
    clearCookieBlockedState();
    resetEntryAlertState();
    setLookupState('Cookie hợp lệ. Hãy chọn thiết bị để tiếp tục.', 'success');
    updateReadyState();
}

async function applyCookieFromQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const shareId = String(params.get('s') || '').trim();
    const encodedCookie = String(params.get('c') || '').trim();

    if (shareId) {
        setRuntimeShareDesktopOnly(false);
        pendingShareIdFromUrl = shareId;
        showLookupLoadingOverlay('Đang kiểm tra cookie của link ID, vui lòng chờ...');
        setLookupState('Đang thử cookie phù hợp từ link ID...', 'loading');
        try {
            const data = await apiRequest(`/api/getlink-shares/${encodeURIComponent(shareId)}`, 'GET');
            const cookieStr = normalizeCookie(data.cookieStr || '');
            setRuntimeShareDesktopOnly(!!(data.desktopOnly || (data.share && data.share.desktopOnly)));
            if (!cookieStr) {
                hideLookupLoadingOverlay();
                const entryError = {
                    type: 'cookie',
                    reason: 'share_no_live_cookie',
                    message: 'Link này đã hết cookie hợp lệ. Vui lòng liên hệ admin để được bảo hành.'
                };
                setEntryAlertState(entryError);
                setGuestGuard(true, 'Link này vẫn tồn tại nhưng hiện không còn cookie dùng được. Vui lòng nhắn fanpage để được hỗ trợ bảo hành.', {
                    title: 'Link đã hết cookie hợp lệ',
                    kind: 'cookie'
                });
                setLookupState(entryError.message, 'warning');
                showEntryAlertPopup(getEntryAlertPopupContent());
                return;
            }
            setRuntimeCookie(cookieStr, { source: 'share-id' });
            await runEntryCookieHealthCheck();
            hideLookupLoadingOverlay();
            return;
        } catch (error) {
            hideLookupLoadingOverlay();
            const mappedError = classifyShareEntryError(error);
            setEntryAlertState({
                type: mappedError.type,
                reason: mappedError.reason,
                message: mappedError.lookupMessage
            });
            setGuestGuard(true, mappedError.guardMessage, {
                title: mappedError.guardTitle,
                kind: mappedError.type
            });
            setLookupState(mappedError.lookupMessage, mappedError.type === 'cookie' ? 'error' : 'warning');
            showEntryAlertPopup(getEntryAlertPopupContent());
            return;
        }
    }

    if (encodedCookie) {
        setRuntimeShareDesktopOnly(false);
        try {
            const cookieStr = normalizeCookie(fromBase64Url(encodedCookie));
            if (!cookieStr) {
                setEntryAlertState({
                    type: 'link',
                    reason: 'invalid_cookie_link',
                    message: 'Link cookie không hợp lệ.'
                });
                setGuestGuard(true, 'Link cookie không hợp lệ. Hãy mở lại link được cấp để tiếp tục.', {
                    title: 'Link cookie không hợp lệ',
                    kind: 'link'
                });
                setLookupState('Link cookie không hợp lệ.', 'warning');
                showEntryAlertPopup(getEntryAlertPopupContent());
                return;
            }
            setRuntimeCookie(cookieStr, { source: 'cookie-link' });
            await runEntryCookieHealthCheck();
            return;
        } catch (error) {
            setEntryAlertState({
                type: 'link',
                reason: 'invalid_cookie_link',
                message: 'Không giải mã được cookie trong link chia sẻ.'
            });
            setGuestGuard(true, 'Không giải mã được cookie trong link chia sẻ. Hãy mở lại đúng link được cấp.', {
                title: 'Link cookie không hợp lệ',
                kind: 'link'
            });
            setLookupState('Không giải mã được cookie trong link chia sẻ.', 'warning');
            showEntryAlertPopup(getEntryAlertPopupContent());
            return;
        }
    }
}
function renderAdminWorkspace() {
    const authBox = el('adminAuthBox');
    const workspace = el('adminWorkspace');
    const identity = el('adminIdentity');
    const fab = el('nfAdminFab');
    const inlineLayout = el('adminInlineLayout');
    const adminTabBar = el('adminTabBar');
    const adminTabSearchBtn = el('adminTabSearchBtn');
    const adminTabCreateBtn = el('adminTabCreateBtn');
    const shareCreatorBox = el('shareCreatorBox');
    const cookieInfoPanel = el('adminCookieInfoPanel');
    const cookieInfoTitle = el('adminCookieInfoTitle');
    const currentShareSummaryBox = el('currentShareSummaryBox');
    ensureAdminTabFromContext();
    const activeTab = normalizeAdminTab(adminActiveTab);

    if (fab) {
        fab.classList.toggle('is-admin', adminAuthenticated);
        fab.title = adminAuthenticated ? 'Tai khoan admin da dang nhap' : 'Dang nhap admin';
        fab.setAttribute('aria-label', adminAuthenticated ? 'Tai khoan admin da dang nhap' : 'Dang nhap admin');
    }

    if (identity) identity.textContent = adminAuthenticated ? 'Dang nhap admin.' : 'Chua dang nhap admin';
    if (authBox) authBox.classList.toggle('hidden', adminAuthenticated);
    if (workspace) workspace.classList.toggle('hidden', !adminAuthenticated);
    if (inlineLayout) inlineLayout.classList.toggle('hidden', !adminAuthenticated);
    if (adminTabBar) adminTabBar.classList.toggle('hidden', !adminAuthenticated);
    if (adminTabSearchBtn) {
        adminTabSearchBtn.classList.toggle('is-active', adminAuthenticated && activeTab === 'search');
        adminTabSearchBtn.setAttribute('aria-selected', adminAuthenticated && activeTab === 'search' ? 'true' : 'false');
    }
    if (adminTabCreateBtn) {
        adminTabCreateBtn.classList.toggle('is-active', adminAuthenticated && activeTab === 'create');
        adminTabCreateBtn.setAttribute('aria-selected', adminAuthenticated && activeTab === 'create' ? 'true' : 'false');
    }
    if (inlineLayout) inlineLayout.classList.toggle('admin-tab-create', adminAuthenticated && activeTab === 'create');
    if (shareCreatorBox) shareCreatorBox.classList.toggle('hidden', !adminAuthenticated || activeTab !== 'create');
    if (cookieInfoPanel) cookieInfoPanel.classList.toggle('hidden', !adminAuthenticated);
    if (currentShareSummaryBox) currentShareSummaryBox.classList.toggle('hidden', !adminAuthenticated || activeTab !== 'search' || !currentAdminShare);
    if (cookieInfoTitle) cookieInfoTitle.textContent = activeTab === 'create' ? 'Kết quả check cookie link mới' : 'Thông tin cookie của link ID';
    if (adminAuthenticated && !cookieHealthBlocked) {
        if (activeTab === 'create') {
            setCreatorCookieInfoState('Tạo hoặc cập nhật cookie rồi bấm check để xem kết quả ngay tại đây.', 'idle');
        } else {
            setAdminCookieInfoState('Tạo hoặc tìm link ID rồi check từng cookie hay check toàn bộ.', 'idle');
        }
    }
    if (!adminAuthenticated) {
        adminActiveTab = 'search';
        adminTabManuallySelected = false;
        isInlineEditMode = false;
        createdAdminShare = null;
        renderCookieCheckCards([]);
        renderCreatorCookieCheckCards([]);
        setCreatorCookieInfoState('Tạo hoặc cập nhật cookie rồi bấm check để xem kết quả ngay tại đây.', 'idle');
        setShareCookieViewOutputs({ primary: '', backup1: '', backup2: '' });
        setCreatedShareCookieOutputs({ primary: '', backup1: '', backup2: '' });
        resetShareCookieSlotStates();
        resetCreatedShareCookieSlotStates();
    }
    if (shouldBypassPromotionalPopups()) {
        closeSupportModal();
    }
    if (shouldBypassPromotionalPopups() && disclaimerVisible) {
        closeDisclaimerModal(true);
    }
    if (disclaimerEligibilityResolved && canShowPromotionalPopups() && !disclaimerDismissed) {
        openDisclaimerModal();
    }
    syncAdminImmediateModals();
    setInlineEditMode(isInlineEditMode && !!currentAdminShare && activeTab === 'search');
    renderCurrentShareSummary(currentAdminShare);
    renderCreatedShareEditor(createdAdminShare);
    updateReadyState();
    updateOverloadFixVisibility();
}

function renderAdminShare(share = null) {
    currentAdminShare = share;
    const card = el('adminShareResult');
    const summaryBox = el('currentShareSummaryBox');
    if (!card) return;

    if (!share) {
        card.classList.add('hidden');
        if (summaryBox) summaryBox.classList.add('hidden');
        isInlineEditMode = false;
        setShareCookieViewOutputs({ primary: '', backup1: '', backup2: '' });
        resetShareCookieSlotStates();
        return;
    }

    adminActiveTab = 'search';
    adminTabManuallySelected = false;

    const idInput = el('adminShareId');
    const statusInput = el('adminShareStatus');
    const urlInput = el('adminShareUrl');
    const updatedInput = el('adminShareUpdatedAt');
    const expiryDisplayInput = el('adminShareExpiryDisplay');
    const expiryInput = el('adminShareExpiryInput');
    const expired = !!(share && (share.expired || isShareExpiredClient(share)));
    const status = String(share.status || 'active');
    let statusLabel = 'Dang hoat dong';
    if (status !== 'active') statusLabel = 'Da khoa / Thu hoi';
    else if (expired) statusLabel = 'Da het han';

    if (idInput) idInput.value = String(share.id || '');
    if (statusInput) statusInput.value = `Trang thai: ${statusLabel}`;
    if (urlInput) urlInput.value = String(share.shareUrl || '');
    if (updatedInput) updatedInput.value = `Cap nhat: ${String(share.updatedAt || '-')}`;
    if (expiryDisplayInput) expiryDisplayInput.value = `Han hien tai: ${formatDateTime(share.expiresAt)}`;
    if (expiryInput) expiryInput.value = toDatetimeLocalFromIso(share.expiresAt);
    const shareCookies = share.cookies || { primary: share.cookieRaw || '', backup1: '', backup2: '' };
    setShareCookieViewOutputs(shareCookies);
    resetShareCookieSlotStates();
    renderCurrentShareSummary(share);
    setInlineEditMode(isInlineEditMode && isViewingPendingShare());

    card.classList.remove('hidden');
}

async function adminSaveExpiry(payload = null, options = {}) {
    if (!currentAdminShare || !currentAdminShare.id) return;

    let body = payload;
    if (!body) {
        const rawValue = String(el('adminShareExpiryInput') && el('adminShareExpiryInput').value || '').trim();
        const expiresAt = datetimeLocalToIso(rawValue);
        if (!expiresAt) {
            setAdminSearchState('Nhap han hop le truoc khi luu.', 'warning');
            return;
        }
        body = { expiresAt };
    }

    const btn = options.button || el('adminSaveExpiryBtn');
    setButtonBusy(btn, true, options.busyLabel || 'Dang luu han...');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}/expiry`, 'PUT', body);
        renderAdminShare(data.share || null);
        setAdminSearchState('Da cap nhat han cho link.', 'success');
    } catch (error) {
        setAdminSearchState(error.message || 'Khong cap nhat duoc han cho link.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function loadAdminShareFromPendingUrl(options = {}) {
    const force = !!options.force;
    const shareId = String(pendingShareIdFromUrl || '').trim();
    if (!adminAuthenticated || !shareId) return;
    if (!force && autoLoadedAdminShareId === shareId) return;

    const input = el('adminShareSearchInput');
    if (input) input.value = shareId;

    setAdminSearchState(`Dang tu dong nap link ID: ${shareId}...`, 'loading');

    try {
        const data = await apiRequest('/api/getlink-admin/search', 'POST', { query: shareId });
        renderAdminShare(data.share || null);
        setAdminTab('search', { resetManual: true });
        autoLoadedAdminShareId = shareId;
        setAdminSearchState('Da tu dong nap link ID tu URL. Ban co the sua cookie ngay.', 'success');
    } catch (error) {
        renderAdminShare(null);
        autoLoadedAdminShareId = '';
        setAdminSearchState(error.message || 'Khong tu dong nap duoc link ID tu URL.', 'error');
    }
}

async function loadAdminSession() {
    if (!adminIdToken) {
        clearAdminAuthState();
        setAdminAuthState('Dang xuat.', 'idle');
        adminSessionResolved = true;
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
    adminSessionResolved = true;
    renderAdminWorkspace();
    if (adminAuthenticated) {
        await loadAdminShareFromPendingUrl();
    }
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

        adminSessionResolved = true;
        adminAuthenticated = true;
        const userEmail = String(session.user && session.user.email || firebaseSession.email || email);
        adminEmail = String(userEmail || '').trim().toLowerCase();
        saveAdminAuthToStorage();
        setAdminAuthState(`Dang nhap admin: ${userEmail}`, 'success');
        renderAdminWorkspace();
        setAdminSearchState('Khong tu dong load. Nhap ID/link roi bam Tim link.', 'idle');
        await loadAdminShareFromPendingUrl({ force: true });
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
        adminSessionResolved = true;
        renderAdminShare(null);
        resetCreatedShareComposer();
        autoLoadedAdminShareId = '';
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
        setAdminTab('search', { resetManual: true });
        setAdminSearchState('Da tim thay link. Ban co the sua/thu hoi/phuc hoi/doi ID.', 'success');
    } catch (error) {
        renderAdminShare(null);
        setAdminSearchState(error.message || 'Khong tim thay link.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminSaveCookies() {
    if (!currentAdminShare || !currentAdminShare.id) return;
    const cookies = getCurrentShareEditableCookies();
    const expiryValue = String(el('currentShareExpiryInput') && el('currentShareExpiryInput').value || '').trim();
    const expiresAt = datetimeLocalToIso(expiryValue);
    if (expiryValue && !expiresAt) {
        setAdminSearchState('Hạn của link không hợp lệ.', 'warning');
        return;
    }

    const btn = el('saveCurrentShareBtn');
    setButtonBusy(btn, true, 'Đang lưu...');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}`, 'PUT', { cookies });
        if (expiresAt && expiresAt !== String(currentAdminShare.expiresAt || '').trim()) {
            const expiryData = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}/expiry`, 'PUT', { expiresAt });
            data.share = expiryData.share || data.share;
        }
        isInlineEditMode = false;
        renderAdminShare(data.share || null);
        if (cookies.primary) {
            setRuntimeCookie(cookies.primary, { source: 'admin', silent: true });
        }
        await runCookieChecksForShare(
            (data.share && data.share.id) || currentAdminShare.id,
            cookies,
            SHARE_COOKIE_SLOTS,
            setShareCookieSlotState,
            { renderCards: renderCookieCheckCards, setInfoState: setAdminCookieInfoState }
        );
        setAdminSearchState('Đã cập nhật cookie và tự động check toàn bộ.', 'success');
    } catch (error) {
        setAdminSearchState(error.message || 'Không cập nhật được cookie.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function saveCreatedShareCookies() {
    if (!createdAdminShare || !createdAdminShare.id) {
        setShareState('Hãy tạo link ID server trước khi lưu cookie.', 'warning');
        return;
    }
    const cookies = getCreatedShareEditableCookies();
    const btn = el('saveCreatedShareCookiesBtn');
    setButtonBusy(btn, true, 'Đang lưu...');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(createdAdminShare.id)}`, 'PUT', { cookies });
        createdAdminShare = data.share || createdAdminShare;
        renderCreatedShareEditor(createdAdminShare);
        if (cookies.primary) {
            setRuntimeCookie(cookies.primary, { source: 'admin', silent: true });
        }
        await runCookieChecksForShare(
            createdAdminShare.id,
            cookies,
            CREATED_SHARE_COOKIE_SLOTS,
            setCreatedShareCookieSlotState,
            { renderCards: renderCreatorCookieCheckCards, setInfoState: setCreatorCookieInfoState }
        );
        const link = String(el('shareLinkOutput') && el('shareLinkOutput').value || createdAdminShare.shareUrl || '').trim();
        const copied = await autoCopyShareLinkOrWarn(link);
        setShareState(
            copied
                ? 'Đã lưu cookie, auto-check xong và tự động sao chép lại link ID server.'
                : 'Đã lưu cookie và auto-check xong, nhưng không tự copy lại được. Hãy bấm Sao chép.',
            copied ? 'success' : 'warning'
        );
    } catch (error) {
        setShareState(error.message || 'Không lưu được cookie cho link mới.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function adminCheckCookieSlot(slotKey) {
    if (!currentAdminShare || !currentAdminShare.id) return;
    const slot = SHARE_COOKIE_SLOTS.find((item) => item.key === slotKey);
    if (!slot) return;
    const button = el(slot.viewCheckBtnId);
    const cookies = getShareCookiesForCurrentMode();
    if (!cookies[slotKey]) {
        setShareCookieSlotState(slotKey, 'Để trống', null);
        renderCookieCheckCards([]);
        setAdminCookieInfoState('Ô cookie này đang để trống.', 'idle');
        return;
    }
    setButtonBusy(button, true, 'Đang check...');
    setAdminCookieInfoState(`Đang check ${slot.label.toLowerCase()}...`, 'loading');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(currentAdminShare.id)}/check-cookie`, 'POST', {
            slot: slotKey,
            cookieStr: cookies[slotKey] || '',
            cookies
        });
        const result = data.result || {};
        setShareCookieSlotState(slotKey, result.ok ? 'PASS' : 'FAIL', !!result.ok);
        renderCookieCheckCards([result]);
        setAdminCookieInfoState(`Đã check ${slot.label.toLowerCase()}.`, result.ok ? 'success' : 'warning');
    } catch (error) {
        setShareCookieSlotState(slotKey, 'FAIL', false);
        setAdminCookieInfoState(error.message || 'Check cookie thất bại.', 'error');
    } finally {
        setButtonBusy(button, false);
    }
}

async function adminCheckAllShareCookies() {
    if (!currentAdminShare || !currentAdminShare.id) return;
    const btn = el('viewCheckAllShareCookiesBtn');
    const cookies = getShareCookiesForCurrentMode();
    setButtonBusy(btn, true, 'Đang check...');
    setAdminCookieInfoState('Đang check toàn bộ cookie của link...', 'loading');
    try {
        await runCookieChecksForShare(currentAdminShare.id, cookies, SHARE_COOKIE_SLOTS, setShareCookieSlotState);
    } catch (error) {
        setAdminCookieInfoState(error.message || 'Check toàn bộ cookie thất bại.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

async function creatorCheckCookieSlot(slotKey) {
    if (!createdAdminShare || !createdAdminShare.id) {
        setShareState('Hãy tạo link ID server trước khi check cookie.', 'warning');
        return;
    }
    const slot = CREATED_SHARE_COOKIE_SLOTS.find((item) => item.key === slotKey);
    if (!slot) return;
    const button = el(slot.viewCheckBtnId);
    const cookies = getCreatedShareEditableCookies();
    if (!cookies[slotKey]) {
        setCreatedShareCookieSlotState(slotKey, 'Để trống', null);
        renderCreatorCookieCheckCards([]);
        setCreatorCookieInfoState('Ô cookie này đang để trống.', 'idle');
        return;
    }
    setButtonBusy(button, true, 'Đang check...');
    setCreatorCookieInfoState(`Đang check ${slot.label.toLowerCase()}...`, 'loading');
    try {
        const data = await apiRequest(`/api/getlink-admin/shares/${encodeURIComponent(createdAdminShare.id)}/check-cookie`, 'POST', {
            slot: slotKey,
            cookieStr: cookies[slotKey] || '',
            cookies
        });
        const result = data.result || {};
        setCreatedShareCookieSlotState(slotKey, result.ok ? 'PASS' : 'FAIL', !!result.ok);
        renderCreatorCookieCheckCards([result]);
        setCreatorCookieInfoState(`Đã check ${slot.label.toLowerCase()}.`, result.ok ? 'success' : 'warning');
    } catch (error) {
        setCreatedShareCookieSlotState(slotKey, 'FAIL', false);
        setCreatorCookieInfoState(error.message || 'Check cookie thất bại.', 'error');
    } finally {
        setButtonBusy(button, false);
    }
}

async function creatorCheckAllShareCookies() {
    if (!createdAdminShare || !createdAdminShare.id) {
        setShareState('Hãy tạo link ID server trước khi check cookie.', 'warning');
        return;
    }
    const btn = el('creatorCheckAllShareCookiesBtn');
    const cookies = getCreatedShareEditableCookies();
    setButtonBusy(btn, true, 'Đang check...');
    setCreatorCookieInfoState('Đang check toàn bộ cookie của link mới...', 'loading');
    try {
        await runCookieChecksForShare(
            createdAdminShare.id,
            cookies,
            CREATED_SHARE_COOKIE_SLOTS,
            setCreatedShareCookieSlotState,
            { renderCards: renderCreatorCookieCheckCards, setInfoState: setCreatorCookieInfoState }
        );
    } catch (error) {
        setCreatorCookieInfoState(error.message || 'Check toàn bộ cookie thất bại.', 'error');
    } finally {
        setButtonBusy(btn, false);
    }
}

function useShareCookieSlotForRuntime(slotKey) {
    const cookies = getShareCookiesForCurrentMode();
    const cookieRaw = normalizeCookie(cookies[slotKey] || '');
    if (!cookieRaw) {
        setAdminSearchState('Không có cookie để áp dụng.', 'warning');
        return;
    }
    setRuntimeCookie(cookieRaw, { source: 'admin' });
    setAdminSearchState(`Đã áp dụng ${slotKey === 'primary' ? 'cookie chính' : (slotKey === 'backup1' ? 'cookie phụ 1' : 'cookie phụ 2')} vào runtime.`, 'success');
}

function useCreatedShareCookieSlotForRuntime(slotKey) {
    const cookies = getCreatedShareEditableCookies();
    const cookieRaw = normalizeCookie(cookies[slotKey] || '');
    if (!cookieRaw) {
        setShareState('Không có cookie để áp dụng.', 'warning');
        return;
    }
    setRuntimeCookie(cookieRaw, { source: 'admin' });
    setShareState(`Đã áp dụng ${slotKey === 'primary' ? 'cookie chính' : (slotKey === 'backup1' ? 'cookie phụ 1' : 'cookie phụ 2')} vào runtime.`, 'success');
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
    const adminTabButtons = Array.from(document.querySelectorAll('[data-admin-tab]'));
    adminTabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const nextTab = normalizeAdminTab(button.dataset.adminTab || 'search');
            setAdminTab(nextTab, { manual: true });
        });
    });

    const supportBtn = el('supportWarrantyBtn');
    if (supportBtn) supportBtn.addEventListener('click', () => openSupportModal(getDefaultSupportModalContent()));

    const overloadFixBtn = el('overloadFixBtn');
    if (overloadFixBtn) overloadFixBtn.addEventListener('click', openOverloadFixModal);

    const disclaimerDismissBtn = el('disclaimerDismissBtn');
    if (disclaimerDismissBtn) {
        disclaimerDismissBtn.addEventListener('click', () => {
            if (!closeDisclaimerModal()) return;
            updateReadyState();
        });
    }

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
            if (device === 'tv') {
                handleConfirmedDevice(device);
                return;
            }
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

    const overloadFixModal = el('overloadFixModal');
    if (overloadFixModal) {
        overloadFixModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeOverloadFix === '1') closeOverloadFixModal();
        });
    }

    const overloadFixCloseBtn = el('overloadFixCloseBtn');
    if (overloadFixCloseBtn) overloadFixCloseBtn.addEventListener('click', () => closeOverloadFixModal());

    const overloadFixCancelBtn = el('overloadFixCancelBtn');
    if (overloadFixCancelBtn) overloadFixCancelBtn.addEventListener('click', () => closeOverloadFixModal());

    const overloadFixConfirmBtn = el('overloadFixConfirmBtn');
    if (overloadFixConfirmBtn) overloadFixConfirmBtn.addEventListener('click', rotateOverloadShareCookie);

    const overloadFixSuccessModal = el('overloadFixSuccessModal');
    if (overloadFixSuccessModal) {
        overloadFixSuccessModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeOverloadFixSuccess === '1') closeOverloadFixSuccessModal();
        });
    }

    const overloadFixSuccessCloseBtn = el('overloadFixSuccessCloseBtn');
    if (overloadFixSuccessCloseBtn) overloadFixSuccessCloseBtn.addEventListener('click', closeOverloadFixSuccessModal);

    const overloadFixSuccessOkBtn = el('overloadFixSuccessOkBtn');
    if (overloadFixSuccessOkBtn) overloadFixSuccessOkBtn.addEventListener('click', closeOverloadFixSuccessModal);

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
                setLookupState('Chưa có link mobile để sao chép.', 'warning');
                return;
            }
            await copyText(link, 'Đã sao chép link đăng nhập mobile.');
        });
    }

    const copyUnsupportedLinkBtn = el('copyUnsupportedLinkBtn');
    if (copyUnsupportedLinkBtn) {
        copyUnsupportedLinkBtn.addEventListener('click', async () => {
            await copyText(UNSUPPORTED_URL, 'Đã sao chép netflix.com/unsupported.');
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

    const tvGuideDesktopLoginBtn = el('tvGuideDesktopLoginBtn');
    if (tvGuideDesktopLoginBtn) {
        tvGuideDesktopLoginBtn.addEventListener('click', () => {
            generateDeviceLink('desktop', 'android');
        });
    }

    const tvGuideStartBtn = el('tvGuideStartBtn');
    if (tvGuideStartBtn) {
        tvGuideStartBtn.addEventListener('click', () => {
            closeTvGuideModal();
        });
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

    const generateShareLinkBtn = el('generateShareLinkBtn');
    if (generateShareLinkBtn) generateShareLinkBtn.addEventListener('click', generateShareIdLink);

    const shareCreateQuickDaysInput = el('shareCreateQuickDaysInput');
    if (shareCreateQuickDaysInput) {
        shareCreateQuickDaysInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            generateShareIdLink();
        });
    }

    const shareCreateDateInput = el('shareCreateDateInput');
    if (shareCreateDateInput) {
        shareCreateDateInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            generateShareIdLink();
        });
    }

    const shareCreateTimeInput = el('shareCreateTimeInput');
    if (shareCreateTimeInput) {
        shareCreateTimeInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            generateShareIdLink();
        });
    }

    const copyShareLinkBtn = el('copyShareLinkBtn');
    if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener('click', async () => {
            const url = String(el('shareLinkOutput') && el('shareLinkOutput').value || '').trim();
            if (!url) {
                setShareState('Chưa có link chia sẻ để sao chép.', 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(url);
                setShareState('Đã sao chép link chia sẻ.', 'success');
            } catch (error) {
                setShareState('Không copy được. Hãy copy thủ công.', 'warning');
            }
        });
    }

    const saveCreatedShareCookiesBtn = el('saveCreatedShareCookiesBtn');
    if (saveCreatedShareCookiesBtn) saveCreatedShareCookiesBtn.addEventListener('click', saveCreatedShareCookies);

    const creatorCheckAllShareCookiesBtn = el('creatorCheckAllShareCookiesBtn');
    if (creatorCheckAllShareCookiesBtn) creatorCheckAllShareCookiesBtn.addEventListener('click', creatorCheckAllShareCookies);

    const createAnotherShareBtn = el('createAnotherShareBtn');
    if (createAnotherShareBtn) {
        createAnotherShareBtn.addEventListener('click', () => {
            resetCreatedShareComposer();
            setAdminTab('create', { manual: true, render: false });
            renderAdminWorkspace();
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

    const saveCurrentShareBtn = el('saveCurrentShareBtn');
    if (saveCurrentShareBtn) saveCurrentShareBtn.addEventListener('click', adminSaveCookies);

    const viewCheckAllShareCookiesBtn = el('viewCheckAllShareCookiesBtn');
    if (viewCheckAllShareCookiesBtn) viewCheckAllShareCookiesBtn.addEventListener('click', adminCheckAllShareCookies);

    const editCurrentShareBtn = el('editCurrentShareBtn');
    if (editCurrentShareBtn) {
        editCurrentShareBtn.addEventListener('click', () => {
            if (!currentAdminShare) return;
            isInlineEditMode = true;
            setShareCookieViewOutputs(currentAdminShare.cookies || { primary: currentAdminShare.cookieRaw || '', backup1: '', backup2: '' });
            setInlineEditMode(true);
        });
    }

    const cancelCurrentShareEditBtn = el('cancelCurrentShareEditBtn');
    if (cancelCurrentShareEditBtn) {
        cancelCurrentShareEditBtn.addEventListener('click', async () => {
            isInlineEditMode = false;
            if (!currentAdminShare || !currentAdminShare.id) {
                setInlineEditMode(false);
                return;
            }
            try {
                const data = await apiRequest('/api/getlink-admin/search', 'POST', { query: currentAdminShare.id });
                renderAdminShare(data.share || null);
                setAdminSearchState('Đã hủy chỉnh sửa và nạp lại dữ liệu link.', 'idle');
            } catch (error) {
                setAdminSearchState(error.message || 'Không nạp lại được dữ liệu link.', 'error');
            }
        });
    }

    SHARE_COOKIE_SLOTS.forEach((slot) => {
        const viewCheckBtn = el(slot.viewCheckBtnId);
        if (viewCheckBtn) viewCheckBtn.addEventListener('click', () => adminCheckCookieSlot(slot.key));
        const viewUseBtn = el(slot.viewUseBtnId);
        if (viewUseBtn) viewUseBtn.addEventListener('click', () => useShareCookieSlotForRuntime(slot.key));
    });

    CREATED_SHARE_COOKIE_SLOTS.forEach((slot) => {
        const viewCheckBtn = el(slot.viewCheckBtnId);
        if (viewCheckBtn) viewCheckBtn.addEventListener('click', () => creatorCheckCookieSlot(slot.key));
        const viewUseBtn = el(slot.viewUseBtnId);
        if (viewUseBtn) viewUseBtn.addEventListener('click', () => useCreatedShareCookieSlotForRuntime(slot.key));
        const input = el(slot.viewInputId);
        if (input) {
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                saveCreatedShareCookies();
            });
        }
    });

    const adminSaveExpiryBtn = el('adminSaveExpiryBtn');
    if (adminSaveExpiryBtn) adminSaveExpiryBtn.addEventListener('click', () => adminSaveExpiry());

    const adminClearExpiryBtn = el('adminClearExpiryBtn');
    if (adminClearExpiryBtn) {
        adminClearExpiryBtn.addEventListener('click', () => {
            const input = el('adminShareExpiryInput');
            if (input) input.value = '';
            setAdminSearchState('Da lam moi o nhap han. Chua thay doi du lieu tren server.', 'idle');
        });
    }

    const expiryQuickButtons = Array.from(document.querySelectorAll('.admin-expiry-quick-btn'));
    expiryQuickButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const addDays = Number(button.dataset.addDays || 0);
            if (!addDays || !currentAdminShare || !currentAdminShare.id) {
                setAdminSearchState('Hay tim 1 link truoc khi them han.', 'warning');
                return;
            }
            adminSaveExpiry({ addDays }, { button, busyLabel: `Dang +${addDays} ngay...` });
        });
    });

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
            const cookieRaw = normalizeCookie(el('currentShareCookiePrimaryDisplay') && el('currentShareCookiePrimaryDisplay').value || '');
            if (!cookieRaw) {
                setAdminSearchState('Không có cookie để áp dụng.', 'warning');
                return;
            }
            setRuntimeCookie(cookieRaw, { source: 'admin' });
            setAdminRuntimeCookieState('Đã áp dụng cookie chính của share này vào runtime.', 'success');
        });
    }

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        const disclaimerModalNode = el('disclaimerModal');
        if (disclaimerModalNode && !disclaimerModalNode.classList.contains('hidden')) {
            if (Date.now() >= disclaimerReadyAt) {
                closeDisclaimerModal();
                updateReadyState();
            }
            return;
        }

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

        const overloadFixModalNode = el('overloadFixModal');
        if (overloadFixModalNode && !overloadFixModalNode.classList.contains('hidden')) {
            closeOverloadFixModal();
            return;
        }

        const overloadFixSuccessModalNode = el('overloadFixSuccessModal');
        if (overloadFixSuccessModalNode && !overloadFixSuccessModalNode.classList.contains('hidden')) {
            closeOverloadFixSuccessModal();
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
    await loadAdminSession();
    await applyCookieFromQuery();
    if (adminAuthenticated) {
        await loadAdminShareFromPendingUrl();
    }
    disclaimerEligibilityResolved = true;
    if (canShowPromotionalPopups() && !disclaimerDismissed) {
        openDisclaimerModal();
    }
    syncAdminCookieInput();
    if (!getRuntimeCookie() && !entryAlertState) {
        setGuestGuard(true, 'Hãy mở đúng link /getlink?s=... hoặc /getlink?c=... để tiếp tục.', {
            title: 'Không tìm thấy link hợp lệ',
            kind: 'link'
        });
    }
    updateOverloadFixVisibility();
    updateReadyState();
    setShareState('', 'idle');
    setShareCreateExpiryState('', 'idle');
}

bootstrap();

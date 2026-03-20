import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const ADMIN_EMAIL = 'cungbocap306@gmail.com';
const SUPPORT_FANPAGE_URL = 'https://www.facebook.com/trada3k.vn/';
const LOOKUP_REASON_EXPIRED = 'expired';
const TV8_MANUAL_URL = 'https://www.netflix.com/tv8';
const TV_REDIRECT_DELAY_MS = 4000;

const firebaseConfig = {
    apiKey: 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58',
    authDomain: 'trada3k-c402a.firebaseapp.com',
    projectId: 'trada3k-c402a',
    storageBucket: 'trada3k-c402a.firebasestorage.app',
    messagingSenderId: '1047457871868',
    appId: '1:1047457871868:web:f1d9ec6316d6847bca2479',
    measurementId: 'G-YYHGR91MG6'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentLookupCode = '';
let currentLookupEligible = false;
let customersCache = [];
let cookiesCache = [];
let cookiesSummary = null;
let selectedCookieIds = new Set();
let activeTab = 'customers';
let toastTimer = null;
let runtimeBlocked = false;
let rawEditorCookieId = '';
let rawEditorInitialRaw = '';
let rawEditorMode = 'edit';
let mobileGeneratedLink = '';
let tvGeneratedLoginLink = '';
let tvFlowBusy = false;
let lookupLoadingCounter = 0;
let headerFilterPopupContext = null;
let tagPickerContext = null;
let rowActionMenuContext = null;
let rowLongPressTimer = null;
let rowLongPressPointerId = null;
let lookupDebounceTimer = null;
let lookupRequestInFlight = false;
let adminCustomersLoaded = false;
let adminCookiesLoaded = false;
const ADMIN_PAGE_SIZE = 25;
const XLSX_ESM_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
const DEVICE_CONFIRM_DELAY_MS = 2000;
const customersPageState = { page: 1, pageSize: ADMIN_PAGE_SIZE, total: 0, totalPages: 1, hasNext: false, hasPrev: false, search: '' };
const cookiesPageState = { page: 1, pageSize: ADMIN_PAGE_SIZE, total: 0, totalPages: 1, hasNext: false, hasPrev: false };
let customerSearchLocalQuery = '';
let customerSearchServerQuery = '';
let customerSearchDebounceTimer = null;
let xlsxModulePromise = null;
let pendingConfirmDevice = '';
let deviceConfirmReadyAt = 0;
let deviceConfirmCountdownTimer = null;

const tableViewState = {
    cookies: {
        filters: {
            cookie: { search: '', value: '' },
            status: { search: '', value: '' },
            assigned: { search: '', value: '' },
            check: { search: '', value: '' },
            note: { search: '', value: '' }
        },
        sort: { column: 'check', direction: 'desc' }
    },
    customers: {
        filters: {
            code: { search: '', value: '' },
            name: { search: '', value: '' },
            warranty: { search: '', value: '' },
            cookie: { search: '', value: '' },
            status: { search: '', value: '' }
        },
        sort: { column: 'code', direction: 'asc' }
    }
};

const COOKIE_TAG_DEFS = [
    { key: 'errorTagged', label: 'ERROR', onAction: 'error-on', offAction: 'error-off' },
    { key: 'sbdTagged', label: 'SBD', onAction: 'sbd-on', offAction: 'sbd-off' },
    { key: 'unknownTagged', label: 'UNKNOW', onAction: 'unknown-on', offAction: 'unknown-off' },
    { key: 'holdTagged', label: 'HOLD', onAction: 'hold-on', offAction: 'hold-off' }
];

function el(id) {
    return document.getElementById(id);
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateTime(iso = '') {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('vi-VN');
}

function toIsoFromDatetimeLocal(localValue = '') {
    const value = String(localValue || '').trim();
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
}

function toDatetimeLocalFromIso(iso = '') {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() - tzOffset);
    return localDate.toISOString().slice(0, 16);
}

function toMillis(iso = '') {
    if (!iso) return 0;
    const val = new Date(iso).getTime();
    return Number.isFinite(val) ? val : 0;
}

function buildOverCapacityUntilIso(durationMs = 60 * 60 * 1000) {
    return new Date(Date.now() + Math.max(60 * 1000, Number(durationMs || 0))).toISOString();
}

function getCustomerNameMap() {
    const map = new Map();
    if (!Array.isArray(customersCache)) return map;
    customersCache.forEach((customer) => {
        const code = normalizeCode(customer.code || '');
        if (!code) return;
        map.set(code, String(customer.name || '').trim());
    });
    return map;
}

function normalizeFilterText(value = '') {
    return String(value || '').trim().toLowerCase();
}

function normalizeSearchText(value = '') {
    return String(value || '').trim().toLowerCase();
}

function getCookieColumnDisplay(cookie = {}, column = '', customerNameMap = new Map()) {
    const assignedCode = normalizeCode(cookie.assignedCustomerCode || '');
    const assignedName = String(customerNameMap.get(assignedCode) || '').trim();
    if (column === 'cookie') return `${cookie.netflixIdMasked || ''} ${cookie.id || ''}`.trim();
    if (column === 'status') {
        const tags = [];
        if (cookie.errorTagged) tags.push('ERROR');
        if (cookie.sbdTagged) tags.push('SBD');
        if (cookie.unknownTagged) tags.push('UNKNOW');
        if (cookie.holdTagged) tags.push('HOLD');
        if (cookie.overCapacityTagged) tags.push('QUA TAI');
        return `${cookie.status || 'active'} ${tags.join(' ')}`.trim();
    }
    if (column === 'assigned') return `${assignedCode} ${assignedName}`.trim();
    if (column === 'check') return `${formatDateTime(cookie.lastCheckedAt || cookie.updatedAt)} ${cookie.lastError || ''}`.trim();
    if (column === 'note') return String(cookie.note || '').trim();
    return '';
}

function getCustomerColumnDisplay(customer = {}, column = '') {
    if (column === 'code') return String(customer.code || '').trim();
    if (column === 'name') return String(customer.name || '').trim();
    if (column === 'warranty') {
        const remain = Number(customer.remainingDays || 0);
        const suffix = customer.warrantyValid ? `Con ${remain} ngay` : 'Het han';
        return `${formatDateTime(customer.warrantyExpiresAt)} ${suffix}`.trim();
    }
    if (column === 'cookie') return String(customer.assignedCookieId || '').trim();
    if (column === 'status') return String(customer.status || 'active').trim();
    return '';
}

function recordMatchesColumnFilter(displayValue = '', filter = {}) {
    const val = normalizeFilterText(displayValue);
    const searchNeedle = normalizeFilterText(filter.search || '');
    const valueNeedle = normalizeFilterText(filter.value || '');
    if (searchNeedle && !val.includes(searchNeedle)) return false;
    if (valueNeedle && val !== valueNeedle) return false;
    return true;
}

function applyCookieFiltersAndSort(cookies = []) {
    const customerNameMap = getCustomerNameMap();
    const filters = tableViewState.cookies.filters || {};
    const sort = tableViewState.cookies.sort || { column: 'check', direction: 'desc' };

    const filtered = (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
        const columns = ['cookie', 'status', 'assigned', 'check', 'note'];
        return columns.every((column) => {
            const filter = filters[column] || {};
            const display = getCookieColumnDisplay(cookie, column, customerNameMap);
            return recordMatchesColumnFilter(display, filter);
        });
    });

    const sorted = filtered.slice();
    sorted.sort((a, b) => {
        const dir = sort.direction === 'asc' ? 1 : -1;
        if (sort.column === 'check') {
            const aCheck = toMillis(a.lastCheckedAt || a.updatedAt || '');
            const bCheck = toMillis(b.lastCheckedAt || b.updatedAt || '');
            return (aCheck - bCheck) * dir;
        }
        const aVal = normalizeFilterText(getCookieColumnDisplay(a, sort.column, customerNameMap));
        const bVal = normalizeFilterText(getCookieColumnDisplay(b, sort.column, customerNameMap));
        return aVal.localeCompare(bVal) * dir;
    });
    return sorted;
}

function applyCustomerFiltersAndSort(customers = []) {
    const filters = tableViewState.customers.filters || {};
    const sort = tableViewState.customers.sort || { column: 'code', direction: 'asc' };
    const filtered = (Array.isArray(customers) ? customers : []).filter((customer) => {
        const columns = ['code', 'name', 'warranty', 'cookie', 'status'];
        return columns.every((column) => recordMatchesColumnFilter(getCustomerColumnDisplay(customer, column), filters[column] || {}));
    });

    const sorted = filtered.slice();
    sorted.sort((a, b) => {
        const dir = sort.direction === 'asc' ? 1 : -1;
        const aVal = normalizeFilterText(getCustomerColumnDisplay(a, sort.column));
        const bVal = normalizeFilterText(getCustomerColumnDisplay(b, sort.column));
        return aVal.localeCompare(bVal) * dir;
    });
    return sorted;
}

function applyCustomerQuickSearch(customers = [], searchQuery = '') {
    const needle = normalizeSearchText(searchQuery);
    if (!needle) return Array.isArray(customers) ? customers : [];
    return (Array.isArray(customers) ? customers : []).filter((customer) => {
        const code = normalizeSearchText(customer && customer.code);
        const name = normalizeSearchText(customer && customer.name);
        return code.includes(needle) || name.includes(needle);
    });
}

function getVisibleCookieIds() {
    return applyCookieFiltersAndSort(cookiesCache).map((item) => item.id);
}

function resetCookieFilters() {
    Object.keys(tableViewState.cookies.filters || {}).forEach((column) => {
        tableViewState.cookies.filters[column] = { search: '', value: '' };
    });
    tableViewState.cookies.sort = { column: 'check', direction: 'desc' };
}

function resetCustomerFilters() {
    Object.keys(tableViewState.customers.filters || {}).forEach((column) => {
        tableViewState.customers.filters[column] = { search: '', value: '' };
    });
    tableViewState.customers.sort = { column: 'code', direction: 'asc' };
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
    if (mode === 'success') {
        state.textContent = '';
        setStateClass(state, 'idle');
        return;
    }
    state.textContent = text || '';
    setStateClass(state, mode);
}

function showLookupLoadingOverlay(message = 'Xin vui lòng chờ trong giây lát') {
    const overlay = el('lookupLoadingOverlay');
    const text = el('lookupLoadingText');
    lookupLoadingCounter += 1;
    if (text) text.textContent = String(message || 'Xin vui lòng chờ trong giây lát');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
}

function hideLookupLoadingOverlay() {
    const overlay = el('lookupLoadingOverlay');
    lookupLoadingCounter = Math.max(0, lookupLoadingCounter - 1);
    if (!overlay || lookupLoadingCounter > 0) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

function setCookieCheckState(text, mode = 'idle') {
    const state = el('cookieCheckState');
    if (!state) return;
    state.textContent = text || '';
    setStateClass(state, mode);
}

function syncCookieSelection() {
    if (!Array.isArray(cookiesCache) || cookiesCache.length === 0) {
        selectedCookieIds = new Set();
        return;
    }
    const validIds = new Set(cookiesCache.map((item) => item.id));
    selectedCookieIds = new Set(Array.from(selectedCookieIds).filter((id) => validIds.has(id)));
}

function getSelectedCookieIds() {
    if (!Array.isArray(cookiesCache) || cookiesCache.length === 0) return [];
    return cookiesCache
        .map((cookie) => cookie.id)
        .filter((id) => selectedCookieIds.has(id));
}

function updateCookieSelectionUi() {
    const visibleIds = getVisibleCookieIds();
    const visibleIdSet = new Set(visibleIds);
    const total = visibleIds.length;
    const selectedCount = getSelectedCookieIds().filter((id) => visibleIdSet.has(id)).length;
    const selectedGlobalCount = getSelectedCookieIds().length;
    const bulkBar = el('cookieBulkBar');
    const count = el('cookieSelectedCount');
    const selectAll = el('cookiesSelectAll');
    const toggleSelectAllBtn = el('toggleSelectAllCookiesBtn');

    if (count) count.textContent = String(selectedGlobalCount);
    if (bulkBar) bulkBar.classList.toggle('hidden', selectedGlobalCount === 0);
    if (selectAll) {
        selectAll.disabled = total === 0;
        selectAll.checked = total > 0 && selectedCount === total;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < total;
    }
    if (toggleSelectAllBtn) {
        toggleSelectAllBtn.disabled = total === 0;
        toggleSelectAllBtn.textContent = total > 0 && selectedCount === total ? 'Bo chon het bo loc' : 'Chon het bo loc';
    }
}

function setControlRuntimeDisabled(disabled) {
    runtimeBlocked = disabled;
    const lookupBtn = el('lookupBtn');
    const codeInput = el('customerCodeInput');
    const adminLoginBtn = el('adminLoginBtn');

    if (lookupBtn) lookupBtn.disabled = disabled;
    if (codeInput) codeInput.disabled = disabled;
    if (adminLoginBtn) adminLoginBtn.disabled = disabled;
    if (disabled) {
        setDeviceButtonsEnabled(false);
        setDeviceSectionVisible(false);
        setExpiredSectionVisible(false);
    }
}

function applyRuntimeGuard() {
    const guard = el('runtimeGuard');
    const guardText = el('runtimeGuardText');
    const isFileMode = window.location.protocol === 'file:';
    if (!guard || !guardText) return;

    if (isFileMode) {
        guard.classList.remove('hidden');
        guardText.textContent = 'Bạn đang mở bằng file://. Hãy chạy qua server: http://localhost:3005/nf';
        setControlRuntimeDisabled(true);
        setLookupState('Cần mở đúng qua server để sử dụng API.', 'warning');
        return;
    }

    guard.classList.add('hidden');
    setControlRuntimeDisabled(false);
}

function toast(message, kind = '') {
    const box = el('toast');
    if (!box) return;
    box.textContent = message;
    box.className = `toast ${kind}`.trim();
    box.classList.remove('hidden');
    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }
    toastTimer = setTimeout(() => {
        box.classList.add('hidden');
    }, 2400);
}

async function apiRequest(url, method = 'GET', body = null) {
    const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Yeu cau that bai');
    return data;
}

function setButtonBusy(button, busy, busyText = 'Dang xu ly...') {
    if (!button) return;
    if (busy) {
        if (!button.dataset.originalText) button.dataset.originalText = button.textContent || '';
        button.textContent = busyText;
        button.disabled = true;
        return;
    }
    if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
    }
    button.disabled = false;
}

function setDeviceButtonsEnabled(enabled) {
    const buttons = document.querySelectorAll('.btn-device');
    buttons.forEach((btn) => {
        btn.disabled = !enabled || runtimeBlocked;
    });
}

function setDeviceSectionVisible(visible) {
    const section = el('deviceSection');
    if (!section) return;
    section.classList.toggle('hidden', !visible);
    if (!visible) closeDeviceConfirmModal();
    if (!visible) closeSupportModal();
    if (!visible) closeTvGuideModal();
    if (!visible) closeMobileLinkModal();
    if (!visible) closeTvCodeModal();
}

function setExpiredSectionVisible(visible) {
    const section = el('expiredSection');
    if (!section) return;
    section.classList.toggle('hidden', !visible);
    if (!visible) closeRenewModal();
}

function isExpiredLookupPayload(payload) {
    if (!payload || payload.eligible) return false;
    const reason = String(payload.reason || '').trim().toLowerCase();
    if (reason === LOOKUP_REASON_EXPIRED) return true;
    const message = String(payload.message || '').toLowerCase();
    return message.includes('hết hạn') || message.includes('het han');
}

function openSupportModal() {
    if (!currentLookupEligible) return;
    const section = el('deviceSection');
    const modal = el('supportModal');
    if (!section || !modal || section.classList.contains('hidden')) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeSupportModal() {
    const modal = el('supportModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openRenewModal() {
    const section = el('expiredSection');
    const modal = el('renewModal');
    if (!section || !modal || section.classList.contains('hidden')) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeRenewModal() {
    const modal = el('renewModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openTvGuideModal() {
    if (!currentLookupCode || !currentLookupEligible) return;
    const section = el('deviceSection');
    const modal = el('tvGuideModal');
    if (!section || !modal || section.classList.contains('hidden')) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeTvGuideModal() {
    const modal = el('tvGuideModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openMobileLinkModal(url = '') {
    const modal = el('mobileLinkModal');
    const output = el('mobileLinkOutput');
    if (!modal || !output) return;
    mobileGeneratedLink = String(url || '').trim();
    output.value = mobileGeneratedLink;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeMobileLinkModal() {
    const modal = el('mobileLinkModal');
    const output = el('mobileLinkOutput');
    if (!modal || !output) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    output.value = '';
    mobileGeneratedLink = '';
}

function setTvCodeState(text, mode = 'idle') {
    const state = el('tvCodeState');
    if (!state) return;
    state.textContent = text || '';
    setStateClass(state, mode);
}

function openTvCodeModal() {
    if (!currentLookupCode || !currentLookupEligible) return;
    const section = el('deviceSection');
    const modal = el('tvCodeModal');
    const input = el('tvCodeInput');
    if (!section || !modal || !input || section.classList.contains('hidden')) return;
    tvFlowBusy = false;
    tvGeneratedLoginLink = '';
    input.value = '';
    setTvCodeState('Nhập đúng 8 số rồi bấm xác nhận. Hệ thống sẽ mở link đăng nhập trước, sau đó tự chuyển sang netflix.com/tv8.', 'idle');
    const manualLoginLink = el('tvManualLoginLink');
    if (manualLoginLink) {
        manualLoginLink.setAttribute('href', '#');
        manualLoginLink.setAttribute('aria-disabled', 'true');
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
}

function closeTvCodeModal() {
    if (tvFlowBusy) return;
    const modal = el('tvCodeModal');
    const input = el('tvCodeInput');
    if (!modal || !input) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    input.value = '';
}

function getDeviceLabel(device = '') {
    if (device === 'desktop') return 'Máy tính';
    if (device === 'mobile') return 'Điện thoại';
    if (device === 'tv') return 'TV';
    return 'thiết bị này';
}

function stopDeviceConfirmCountdown() {
    if (deviceConfirmCountdownTimer) {
        clearInterval(deviceConfirmCountdownTimer);
        deviceConfirmCountdownTimer = null;
    }
}

function refreshDeviceConfirmUi() {
    const countdown = el('deviceConfirmCountdown');
    const okBtn = el('deviceConfirmOkBtn');
    const remainingMs = Math.max(0, deviceConfirmReadyAt - Date.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const ready = remainingMs <= 0;
    if (okBtn) okBtn.disabled = !ready;
    if (countdown) {
        if (ready) {
            countdown.textContent = 'Bạn có thể bấm "Có" để tiếp tục.';
            setStateClass(countdown, 'success');
        } else {
            countdown.textContent = `Vui lòng chờ ${remainingSeconds} giây để xác nhận.`;
            setStateClass(countdown, 'warning');
        }
    }
    if (ready) stopDeviceConfirmCountdown();
}

function openDeviceConfirmModal(device = '') {
    const modal = el('deviceConfirmModal');
    const title = el('deviceConfirmTitle');
    const hint = el('deviceConfirmHint');
    if (!modal || !title || !hint) return;
    pendingConfirmDevice = String(device || '').trim();
    const deviceLabel = getDeviceLabel(pendingConfirmDevice);
    title.textContent = `Bạn có chắc chắn đang dùng ${deviceLabel} không?`;
    hint.textContent = 'Vui lòng xác nhận đúng thiết bị để tránh lỗi đăng nhập.';
    deviceConfirmReadyAt = Date.now() + DEVICE_CONFIRM_DELAY_MS;
    stopDeviceConfirmCountdown();
    refreshDeviceConfirmUi();
    deviceConfirmCountdownTimer = window.setInterval(refreshDeviceConfirmUi, 150);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeDeviceConfirmModal() {
    const modal = el('deviceConfirmModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    pendingConfirmDevice = '';
    deviceConfirmReadyAt = 0;
    stopDeviceConfirmCountdown();
}

function proceedDeviceAction(device = '') {
    const normalized = String(device || '').trim();
    if (!normalized) return;
    if (normalized === 'tv') {
        openTvGuideModal();
        return;
    }
    generateDeviceLink(normalized);
}

async function submitTvCodeFlow() {
    if (runtimeBlocked || tvFlowBusy) return;
    if (!currentLookupCode || !currentLookupEligible) {
        setTvCodeState('Mã khách chưa đủ điều kiện sử dụng.', 'warning');
        return;
    }

    const input = el('tvCodeInput');
    const submitBtn = el('tvCodeSubmitBtn');
    const raw = String((input && input.value) || '');
    const tvCode = raw.replace(/\D/g, '').slice(0, 8);
    if (!/^\d{8}$/.test(tvCode)) {
        setTvCodeState('Mã TV phải gồm đúng 8 số.', 'warning');
        return;
    }

    if (input) input.value = tvCode;
    showLookupLoadingOverlay('Xin vui lòng chờ trong giây lát');
    tvFlowBusy = true;
    setButtonBusy(submitBtn, true, 'Đang xử lý...');
    setTvCodeState('Đang tạo link đăng nhập...', 'loading');

    try {
        const linkData = await apiRequest('/api/nf-generate-link', 'POST', {
            customerCode: currentLookupCode,
            device: 'mobile'
        });
        if (!linkData || !linkData.url) throw new Error('Không tạo được link đăng nhập.');

        tvGeneratedLoginLink = String(linkData.url || '').trim();
        const manualLoginLink = el('tvManualLoginLink');
        if (manualLoginLink) {
            manualLoginLink.setAttribute('href', tvGeneratedLoginLink || '#');
            manualLoginLink.removeAttribute('aria-disabled');
        }

        const popup = window.open('about:blank', '_blank');
        if (!popup || popup.closed) {
            setTvCodeState('Trình duyệt đang chặn popup. Hãy bấm "Mở link đăng nhập" rồi tiếp tục bấm "Mở netflix.com/tv8".', 'warning');
            setLookupState('Trình duyệt chặn popup. Vui lòng mở thủ công 2 link trong popup TV.', 'warning');
            return;
        }

        popup.location.href = tvGeneratedLoginLink;
        setTvCodeState(`Đã mở link đăng nhập. Sau ${Math.round(TV_REDIRECT_DELAY_MS / 1000)} giây sẽ tự chuyển sang netflix.com/tv8 để bạn nhập mã TV.`, 'success');
        setLookupState('Đã mở link đăng nhập TV. Sắp chuyển sang netflix.com/tv8...', 'success');

        window.setTimeout(() => {
            if (popup && !popup.closed) popup.location.href = TV8_MANUAL_URL;
        }, TV_REDIRECT_DELAY_MS);
    } catch (error) {
        setTvCodeState(`${error.message || 'Xử lý mã TV thất bại.'} Bạn có thể mở thủ công link đăng nhập rồi vào ${TV8_MANUAL_URL}.`, 'error');
        setLookupState(error.message || 'Không tạo được link TV.', 'error');
    } finally {
        tvFlowBusy = false;
        hideLookupLoadingOverlay();
        setButtonBusy(submitBtn, false);
    }
}

function resetLookupResult() {
    currentLookupCode = '';
    currentLookupEligible = false;
    setDeviceButtonsEnabled(false);
    setDeviceSectionVisible(false);
    setExpiredSectionVisible(false);
    const infoCard = el('customerInfoCard');
    if (infoCard) infoCard.classList.add('hidden');
}

function renderLookupResult(payload) {
    const infoCard = el('customerInfoCard');
    const codeText = el('customerCodeText');
    const nameText = el('customerNameText');
    if (!payload || !payload.customer) {
        resetLookupResult();
        return;
    }

    currentLookupCode = normalizeCode(payload.customer.code || '');
    currentLookupEligible = !!payload.eligible;

    if (codeText) codeText.textContent = currentLookupCode || '-';
    if (nameText) nameText.textContent = payload.customer.name || '-';
    if (infoCard) infoCard.classList.remove('hidden');
    const expired = isExpiredLookupPayload(payload);
    setExpiredSectionVisible(expired);
    setDeviceSectionVisible(currentLookupEligible && !expired);
    setDeviceButtonsEnabled(currentLookupEligible && !expired);

    if (currentLookupEligible) {
        setLookupState('Hãy chọn thiết bị bạn đang dùng để tiến hành sử dụng Netflix', 'success');
        return;
    } else {
        setLookupState(payload.message || 'Mã chưa đủ điều kiện sử dụng.', 'warning');
    }
}

function renderLookupResultV2(payload) {
    const infoCard = el('customerInfoCard');
    const codeText = el('customerCodeText');
    const nameText = el('customerNameText');
    if (!payload || !payload.customer) {
        resetLookupResult();
        return;
    }

    currentLookupCode = normalizeCode(payload.customer.code || '');
    currentLookupEligible = !!payload.eligible;

    if (codeText) codeText.textContent = currentLookupCode || '-';
    if (nameText) nameText.textContent = payload.customer.name || '-';
    if (infoCard) infoCard.classList.remove('hidden');

    const expired = isExpiredLookupPayload(payload);
    setExpiredSectionVisible(expired);
    setDeviceSectionVisible(currentLookupEligible && !expired);
    setDeviceButtonsEnabled(currentLookupEligible && !expired);

    if (currentLookupEligible) {
        setLookupState('Hãy chọn thiết bị bạn đang dùng để tiến hành sử dụng Netflix', 'success');
        return;
    }

    if (expired) {
        setLookupState('GÓI NETFLIX CỦA BẠN ĐÃ HẾT HẠN.', 'warning');
        return;
    }

    setLookupState(payload.message || 'Mã chưa đủ điều kiện sử dụng.', 'warning');
}

async function lookupCustomerCode() {
    if (runtimeBlocked) return;
    if (lookupRequestInFlight) return;
    const input = el('customerCodeInput');
    const code = normalizeCode(input && input.value);
    if (!code) {
        resetLookupResult();
        setLookupState('Vui lòng nhập mã khách hàng.', 'warning');
        return;
    }

    const lookupBtn = el('lookupBtn');
    lookupRequestInFlight = true;
    setButtonBusy(lookupBtn, true, 'Đang kiểm tra...');
    setLookupState('Đang kiểm tra mã khách hàng...', 'loading');

    try {
        const data = await apiRequest('/api/nf-customer-lookup', 'POST', { customerCode: code });
        renderLookupResultV2(data);
    } catch (error) {
        resetLookupResult();
        setLookupState(error.message || 'Không kiểm tra được mã.', 'error');
    } finally {
        lookupRequestInFlight = false;
        setButtonBusy(lookupBtn, false);
    }
}

function scheduleLookupCustomerCode(delayMs = 1200) {
    if (lookupDebounceTimer) {
        clearTimeout(lookupDebounceTimer);
        lookupDebounceTimer = null;
    }
    lookupDebounceTimer = window.setTimeout(() => {
        lookupDebounceTimer = null;
        lookupCustomerCode();
    }, Math.max(0, Number(delayMs || 0)));
}
async function generateDeviceLinkLegacy(device) {
    if (runtimeBlocked) return;
    if (!currentLookupCode) {
        toast('Vui lòng kiểm tra mã trước.', 'warn');
        return;
    }
    if (!currentLookupEligible) {
        toast('Mã khách hàng chưa đủ điều kiện.', 'warn');
        return;
    }

    const clickedButton = document.querySelector(`.btn-device[data-device="${device}"]`);
    setButtonBusy(clickedButton, true, 'Đang tạo link...');
    setDeviceButtonsEnabled(false);
    setLookupState('Đang kiểm tra cookie LIVE và tạo link...', 'loading');

    const popup = window.open('about:blank', '_blank');
    if (popup) {
        try {
            popup.document.title = 'NF';
            popup.document.body.style.margin = '0';
            popup.document.body.style.fontFamily = 'Arial, sans-serif';
            popup.document.body.style.background = '#0b0f1c';
            popup.document.body.style.color = '#ffffff';
            popup.document.body.style.display = 'flex';
            popup.document.body.style.alignItems = 'center';
            popup.document.body.style.justifyContent = 'center';
            popup.document.body.innerHTML = '<div>Đang tạo link Netflix...</div>';
        } catch (e) {
            // ignore
        }
    }

    try {
        const data = await apiRequest('/api/nf-generate-link', 'POST', {
            customerCode: currentLookupCode,
            device
        });
        if (!data.url) throw new Error('Không tạo được link');

        if (popup && !popup.closed) popup.location.href = data.url;
        else window.open(data.url, '_blank');
        setLookupState('Đã tạo link thành công. Đang mở Netflix...', 'success');
    } catch (error) {
        if (popup && !popup.closed) {
            try { popup.close(); } catch (e) { /* ignore */ }
        }
        setLookupState(error.message || 'Không tạo được link.', 'error');
    } finally {
        setButtonBusy(clickedButton, false);
        setDeviceButtonsEnabled(currentLookupEligible);
    }
}

function openDeferredTabAndNavigate(options = {}) {
    const loadingTitle = options.loadingTitle || 'Dang tao link Netflix...';
    const loadingSubtitle = options.loadingSubtitle || 'Vui long cho trong giay lat.';
    const popupWindow = window.open('about:blank', '_blank');
    if (!popupWindow) {
        return { popupWindow: null, wasBlocked: true };
    }

    try {
        popupWindow.document.title = 'NF';
        popupWindow.document.body.style.margin = '0';
        popupWindow.document.body.style.fontFamily = 'Arial, sans-serif';
        popupWindow.document.body.style.background = '#0b0f1c';
        popupWindow.document.body.style.color = '#ffffff';
        popupWindow.document.body.style.display = 'flex';
        popupWindow.document.body.style.alignItems = 'center';
        popupWindow.document.body.style.justifyContent = 'center';
        popupWindow.document.body.innerHTML = `<div style="text-align:center;"><div style="font-size:18px;font-weight:700;margin-bottom:8px;">${loadingTitle}</div><div style="font-size:14px;opacity:.86;">${loadingSubtitle}</div></div>`;
    } catch (e) {
        // Ignore if browser restricts writing to about:blank.
    }

    return { popupWindow, wasBlocked: false };
}

async function generateDeviceLink(device) {
    if (runtimeBlocked) return;
    if (!currentLookupCode) {
        toast('Vui lòng kiểm tra mã trước.', 'warn');
        return;
    }
    if (!currentLookupEligible) {
        toast('Mã khách hàng chưa đủ điều kiện.', 'warn');
        return;
    }

    const clickedButton = document.querySelector(`.btn-device[data-device="${device}"]`);
    setButtonBusy(clickedButton, true, 'Đang tạo link...');
    setDeviceButtonsEnabled(false);
    setLookupState('Đang kiểm tra cookie LIVE và tạo link...', 'loading');

    showLookupLoadingOverlay('Xin vui lòng chờ trong giây lát');
    const shouldAutoOpen = device === 'desktop';
    let deferredPopup = null;

    if (shouldAutoOpen) {
        const { popupWindow, wasBlocked } = openDeferredTabAndNavigate({
            loadingTitle: 'Dang tao link Netflix...',
            loadingSubtitle: 'Vui long cho trong giay lat.'
        });
        deferredPopup = popupWindow;
        if (wasBlocked) {
            setLookupState('Trình duyệt chặn tab mới, đang mở trong tab hiện tại.', 'warning');
            toast('Popup bị chặn. Đang mở trong tab hiện tại.', 'warn');
        }
    }

    try {
        const data = await apiRequest('/api/nf-generate-link', 'POST', {
            customerCode: currentLookupCode,
            device
        });
        if (!data.url) throw new Error('Không tạo được link');

        if (shouldAutoOpen) {
            if (deferredPopup && !deferredPopup.closed) {
                deferredPopup.location.href = data.url;
                setLookupState('Đã tạo link thành công. Đang mở Netflix...', 'success');
            } else {
                window.location.href = data.url;
            }
        } else {
            openMobileLinkModal(data.url);
            setLookupState('Tạo link điện thoại thành công. Hãy sao chép link và làm theo hướng dẫn.', 'success');
        }
    } catch (error) {
        if (deferredPopup && !deferredPopup.closed) {
            try { deferredPopup.close(); } catch (e) { /* ignore */ }
        }
        setLookupState(error.message || 'Không tạo được link.', 'error');
    } finally {
        hideLookupLoadingOverlay();
        setButtonBusy(clickedButton, false);
        setDeviceButtonsEnabled(currentLookupEligible);
    }
}

function getStatusPillClass(status = '') {
    if (status === 'dead') return 'pill pill-dead';
    if (status === 'disabled' || status === 'inactive') return 'pill pill-disabled';
    return 'pill pill-active';
}

function formatWarrantyCell(customer) {
    const expires = formatDateTime(customer.warrantyExpiresAt);
    const remain = Number(customer.remainingDays || 0);
    const suffix = customer.warrantyValid ? `Con ${remain} ngay` : 'Het han';
    return `${expires}<br><span class="${customer.warrantyValid ? 'ok' : 'bad'}">${suffix}</span>`;
}

function renderCustomersTable() {
    const tbody = el('customersTableBody');
    if (!tbody) return;
    if (!Array.isArray(customersCache) || customersCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" data-label="Trang thai">Chua co khach hang. Tao ma moi de bat dau.</td></tr>';
        renderCustomerSearchUiState(0, 0);
        return;
    }

    const baseCustomers = applyCustomerFiltersAndSort(customersCache);
    const visibleCustomers = customerSearchLocalQuery
        ? applyCustomerQuickSearch(baseCustomers, customerSearchLocalQuery)
        : baseCustomers;
    if (visibleCustomers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" data-label="Trang thai">Khong co khach hang nao phu hop bo loc hien tai.</td></tr>';
        renderCustomerSearchUiState(baseCustomers.length, 0);
        return;
    }

    tbody.innerHTML = visibleCustomers.map((customer) => `
        <tr data-row-kind="customer" data-row-code="${customer.code || ''}">
            <td data-label="Ma">
                <button class="copy-code-btn mono" type="button" data-copy-code="${customer.code || ''}" title="Bam de copy ma khach">${customer.code || '-'}</button>
                <button class="btn-tiny row-menu-trigger" type="button" data-row-menu-trigger="1" title="Mo menu hanh dong">...</button>
            </td>
            <td data-label="Ten">${customer.name || '-'}</td>
            <td data-label="Bao hanh">${formatWarrantyCell(customer)}</td>
            <td data-label="Cookie" class="mono">${customer.assignedCookieId || '-'}</td>
            <td data-label="Trang thai"><span class="${getStatusPillClass(customer.status)}">${customer.status || 'active'}</span></td>
        </tr>
    `).join('');
    renderHeaderFilterIndicators();
    renderCustomerSearchUiState(baseCustomers.length, visibleCustomers.length);
}

function renderCustomerSearchUiState(localBaseCount = 0, localMatchedCount = 0) {
    const status = el('customerSearchState');
    const searchAllBtn = el('customerSearchAllBtn');
    if (!status || !searchAllBtn) return;

    const localQuery = normalizeSearchText(customerSearchLocalQuery);
    const serverQuery = normalizeSearchText(customerSearchServerQuery);
    const serverMode = !!customersPageState.search;

    if (!localQuery) {
        status.textContent = 'Tim nhanh trong du lieu da tai.';
        setStateClass(status, 'idle');
        searchAllBtn.classList.add('hidden');
        return;
    }

    if (serverMode && serverQuery === localQuery) {
        if (Number(customersPageState.total || 0) > 0) {
            status.textContent = `Dang hien thi ket qua tim toan bo cho \"${localQuery}\".`;
            setStateClass(status, 'success');
        } else {
            status.textContent = `Khong tim thay ket qua toan bo cho \"${localQuery}\".`;
            setStateClass(status, 'warning');
        }
        searchAllBtn.classList.add('hidden');
        return;
    }

    if (localMatchedCount > 0) {
        status.textContent = `Loc local: ${localMatchedCount}/${localBaseCount} ket qua cho \"${localQuery}\".`;
        setStateClass(status, 'success');
        searchAllBtn.classList.add('hidden');
        return;
    }

    status.textContent = `Khong co ket qua local cho \"${localQuery}\". Co the bam \"Tim toan bo\".`;
    setStateClass(status, 'warning');
    searchAllBtn.classList.remove('hidden');
}

function renderCookiesSummary() {
    const summary = el('cookieSummary');
    if (!summary) return;
    const data = cookiesSummary && typeof cookiesSummary === 'object'
        ? (cookiesSummary.summary && typeof cookiesSummary.summary === 'object' ? cookiesSummary.summary : cookiesSummary)
        : null;
    if (!data && (!Array.isArray(cookiesCache) || cookiesCache.length === 0)) {
        summary.textContent = '';
        return;
    }
    const total = Number((data && data.total) || cookiesPageState.total || (Array.isArray(cookiesCache) ? cookiesCache.length : 0));
    const activeCount = Number((data && data.activeCount) || 0);
    const disabledCount = Number((data && data.disabledCount) || 0);
    const deadCount = Number((data && data.deadCount) || 0);
    const unknownCount = Number((data && data.unknownCount) || 0);
    const holdCount = Number((data && data.holdCount) || 0);
    const overcapCount = Number((data && data.overCapacityCount) || 0);
    const assignedCount = Number((data && data.assignedCount) || 0);
    const sbdCount = 0;
    const unassignedCount = Math.max(0, activeCount - sbdCount - unknownCount - holdCount - overcapCount - assignedCount);
    summary.textContent = `Tong: ${total} | Active: ${activeCount} | Disabled: ${disabledCount} | Dead: ${deadCount} | SBD: ${sbdCount} | UNKNOW: ${unknownCount} | HOLD: ${holdCount} | QUA TAI: ${overcapCount} | Dang gan: ${assignedCount} | Chua gan: ${unassignedCount}`;
}

function renderCookiesTable() {
    const tbody = el('cookiesTableBody');
    if (!tbody) return;
    syncCookieSelection();
    if (!Array.isArray(cookiesCache) || cookiesCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" data-label="Trang thai">Chua co cookie trong pool. Hay import danh sach cookie.</td></tr>';
        updateCookieSelectionUi();
        return;
    }
    const customerNameMap = getCustomerNameMap();
    const visibleCookies = applyCookieFiltersAndSort(cookiesCache);
    if (visibleCookies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" data-label="Trang thai">Khong co cookie nao phu hop bo loc hien tai.</td></tr>';
        updateCookieSelectionUi();
        return;
    }

    tbody.innerHTML = visibleCookies.map((cookie) => {
        const assignedCode = normalizeCode(cookie.assignedCustomerCode || '');
        const assignedName = assignedCode ? (customerNameMap.get(assignedCode) || 'Khong ro ten') : '';
        const assignHtml = assignedCode
            ? `<div class="assign-cell"><span class="assign-code">${assignedCode}</span><span class="assign-name">${assignedName}</span></div>`
            : '-';
        const lastCheck = formatDateTime(cookie.lastCheckedAt || cookie.updatedAt);
        const errorLine = cookie.lastError ? `<div class="bad" style="margin-top:4px">${cookie.lastError}</div>` : '';
        const checked = selectedCookieIds.has(cookie.id) ? 'checked' : '';
        const hasRawCookie = !!String(cookie.cookieRaw || '').trim();
        const noteValue = String(cookie.note || '');
        const escapedNote = escapeHtml(noteValue);
        const createLinkBtn = hasRawCookie
            ? `<button class="btn-tiny cookie-link-btn" data-cookie-act="create-youraccount-link" data-id="${cookie.id}" type="button">Tạo link</button>`
            : `<button class="btn-tiny cookie-link-btn" data-cookie-act="create-youraccount-link" data-id="${cookie.id}" type="button" disabled title="Cookie này không có raw">Tạo link</button>`;
        const noteHtml = `
            <div class="cookie-note-wrap">
                <input class="text-input cookie-note-input" type="text" data-cookie-note-input="${cookie.id}" value="${escapedNote}" placeholder="Nhap note...">
                <button class="btn-tiny cookie-note-save" data-cookie-act="save-note" data-id="${cookie.id}" type="button">Luu</button>
            </div>
        `;
        const statusHtml = `
            <span class="${getStatusPillClass(cookie.status)}">${cookie.status || 'active'}</span>
            ${cookie.errorTagged ? '<span class="pill pill-error">ERROR</span>' : ''}
            ${cookie.sbdTagged ? '<span class="pill pill-sbd">SBD</span>' : ''}
            ${cookie.unknownTagged ? '<span class="pill pill-unknown">UNKNOW</span>' : ''}
            ${cookie.holdTagged ? '<span class="pill pill-hold">HOLD</span>' : ''}
            ${cookie.overCapacityTagged ? '<span class="pill pill-overcap">QUA TAI</span>' : ''}
        `;
        return `
            <tr data-row-kind="cookie" data-row-cookie-id="${cookie.id}">
                <td data-label="Chon" class="check-cell">
                    <input class="row-check cookie-row-check" type="checkbox" data-cookie-select="${cookie.id}" ${checked}>
                    <button class="btn-tiny row-menu-trigger" type="button" data-row-menu-trigger="1" title="Mo menu hanh dong">...</button>
                </td>
                <td data-label="Cookie" class="mono">${cookie.netflixIdMasked || '-'}<br><span class="state-idle">${cookie.id || '-'}</span><br>${createLinkBtn}</td>
                <td data-label="Trang thai">${statusHtml}</td>
                <td data-label="Gan khach">${assignHtml}</td>
                <td data-label="Check">${lastCheck}${errorLine}</td>
                <td data-label="Note">${noteHtml}</td>
            </tr>
        `;
    }).join('');
    updateCookieSelectionUi();
    renderHeaderFilterIndicators();
}

function hasColumnFilterActive(table = '', column = '') {
    const filter = tableViewState[table] && tableViewState[table].filters ? tableViewState[table].filters[column] : null;
    if (!filter) return false;
    return !!normalizeFilterText(filter.search) || !!normalizeFilterText(filter.value);
}

function renderHeaderFilterIndicators() {
    const buttons = Array.from(document.querySelectorAll('[data-table-filter-btn]'));
    buttons.forEach((btn) => {
        const descriptor = String(btn.dataset.tableFilterBtn || '');
        const [table, column] = descriptor.split(':');
        const isFilterActive = hasColumnFilterActive(table, column);
        const sortState = tableViewState[table] && tableViewState[table].sort ? tableViewState[table].sort : null;
        const isSortActive = !!sortState && sortState.column === column;
        btn.classList.toggle('active', isFilterActive || isSortActive);
        btn.classList.toggle('sort-asc', isSortActive && sortState.direction === 'asc');
        btn.classList.toggle('sort-desc', isSortActive && sortState.direction === 'desc');
    });
}

function getColumnUniqueValues(table = '', column = '') {
    const values = new Set();
    if (table === 'cookies') {
        const customerNameMap = getCustomerNameMap();
        (Array.isArray(cookiesCache) ? cookiesCache : []).forEach((item) => {
            const val = normalizeFilterText(getCookieColumnDisplay(item, column, customerNameMap));
            if (val) values.add(val);
        });
    } else if (table === 'customers') {
        (Array.isArray(customersCache) ? customersCache : []).forEach((item) => {
            const val = normalizeFilterText(getCustomerColumnDisplay(item, column));
            if (val) values.add(val);
        });
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

function closeHeaderFilterPopup() {
    const popup = el('tableHeaderFilterPopup');
    if (!popup) return;
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    headerFilterPopupContext = null;
}

function openHeaderFilterPopup(triggerBtn, table = '', column = '') {
    const popup = el('tableHeaderFilterPopup');
    const title = el('tableHeaderFilterTitle');
    const searchInput = el('tableHeaderFilterSearch');
    const valueSelect = el('tableHeaderFilterValue');
    if (!popup || !title || !searchInput || !valueSelect || !(triggerBtn instanceof HTMLElement)) return;

    headerFilterPopupContext = { table, column, triggerBtn };
    const state = tableViewState[table] || {};
    const filter = (state.filters && state.filters[column]) || { search: '', value: '' };
    title.textContent = `Lọc cột: ${column}`;
    searchInput.value = filter.search || '';

    const uniqueValues = getColumnUniqueValues(table, column);
    valueSelect.innerHTML = ['<option value="">Tat ca gia tri</option>', ...uniqueValues.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)].join('');
    valueSelect.value = filter.value || '';

    const rect = triggerBtn.getBoundingClientRect();
    popup.style.top = `${window.scrollY + rect.bottom + 8}px`;
    popup.style.left = `${Math.max(8, window.scrollX + rect.left - 240)}px`;
    popup.classList.remove('hidden');
    popup.setAttribute('aria-hidden', 'false');
}

function applyHeaderFilterPopup() {
    if (!headerFilterPopupContext) return;
    const { table, column } = headerFilterPopupContext;
    const searchInput = el('tableHeaderFilterSearch');
    const valueSelect = el('tableHeaderFilterValue');
    tableViewState[table].filters[column] = {
        search: String((searchInput && searchInput.value) || '').trim(),
        value: String((valueSelect && valueSelect.value) || '').trim().toLowerCase()
    };
    if (table === 'cookies') renderCookiesTable();
    else renderCustomersTable();
    closeHeaderFilterPopup();
}

function setHeaderSort(direction = 'asc') {
    if (!headerFilterPopupContext) return;
    const { table, column } = headerFilterPopupContext;
    tableViewState[table].sort = { column, direction: direction === 'desc' ? 'desc' : 'asc' };
    if (table === 'cookies') renderCookiesTable();
    else renderCustomersTable();
}

function clearHeaderFilterColumn() {
    if (!headerFilterPopupContext) return;
    const { table, column } = headerFilterPopupContext;
    tableViewState[table].filters[column] = { search: '', value: '' };
    if (table === 'cookies') renderCookiesTable();
    else renderCustomersTable();
    closeHeaderFilterPopup();
}

function getTagOptionsForCookies(cookies = [], mode = 'add') {
    if (!Array.isArray(cookies) || cookies.length === 0) return [];
    if (mode === 'add') {
        return COOKIE_TAG_DEFS.filter((tagDef) => cookies.some((cookie) => !cookie[tagDef.key]));
    }
    return COOKIE_TAG_DEFS.filter((tagDef) => cookies.some((cookie) => !!cookie[tagDef.key]));
}

function closeTagPickerModal() {
    const modal = el('tagPickerModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    tagPickerContext = null;
}

function openTagPickerModal(cookieIds = [], mode = 'add') {
    const ids = (Array.isArray(cookieIds) ? cookieIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length === 0) {
        toast('Khong co cookie de thao tac tag.', 'warn');
        return;
    }
    const cookies = cookiesCache.filter((item) => ids.includes(String(item.id || '').trim()));
    const options = getTagOptionsForCookies(cookies, mode);
    if (options.length === 0) {
        toast(mode === 'add' ? 'Khong con tag nao de gan.' : 'Khong co tag nao de go.', 'warn');
        return;
    }

    const modal = el('tagPickerModal');
    const title = el('tagPickerTitle');
    const hint = el('tagPickerHint');
    const optionsWrap = el('tagPickerOptions');
    if (!modal || !title || !hint || !optionsWrap) return;

    tagPickerContext = { ids, mode };
    title.textContent = mode === 'add' ? 'GẮN TAG COOKIE' : 'GỠ TAG COOKIE';
    hint.textContent = `Da chon ${ids.length} cookie.`;
    optionsWrap.innerHTML = options
        .map((tagDef) => `<button class="btn btn-ghost tag-picker-btn" type="button" data-tag-picker-key="${tagDef.key}">${mode === 'add' ? 'Gan' : 'Go'} ${tagDef.label}</button>`)
        .join('');

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function mapTagAction(tagKey = '', mode = 'add') {
    const match = COOKIE_TAG_DEFS.find((item) => item.key === tagKey);
    if (!match) return '';
    return mode === 'add' ? match.onAction : match.offAction;
}

function setAdminLoadState(text = '', mode = 'idle') {
    const node = el('adminLoadState');
    if (!node) return;
    node.textContent = text || '';
    setStateClass(node, mode);
}

function buildPagedUrl(base, pageState) {
    const page = Math.max(1, Number(pageState.page || 1));
    const pageSize = Math.max(1, Number(pageState.pageSize || ADMIN_PAGE_SIZE));
    const search = String(pageState.search || '').trim();
    const suffix = search ? `&search=${encodeURIComponent(search)}` : '';
    return `${base}?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}${suffix}`;
}

function applyCustomersPageState(data = {}) {
    customersPageState.page = Math.max(1, Number(data.page || customersPageState.page || 1));
    customersPageState.pageSize = Math.max(1, Number(data.pageSize || customersPageState.pageSize || ADMIN_PAGE_SIZE));
    customersPageState.total = Math.max(0, Number(data.total || 0));
    customersPageState.totalPages = Math.max(1, Number(data.totalPages || 1));
    customersPageState.hasNext = !!data.hasNext;
    customersPageState.hasPrev = !!data.hasPrev;
    customersPageState.search = String(data.search || customersPageState.search || '').trim();
}

function applyCookiesPageState(data = {}) {
    cookiesPageState.page = Math.max(1, Number(data.page || cookiesPageState.page || 1));
    cookiesPageState.pageSize = Math.max(1, Number(data.pageSize || cookiesPageState.pageSize || ADMIN_PAGE_SIZE));
    cookiesPageState.total = Math.max(0, Number(data.total || 0));
    cookiesPageState.totalPages = Math.max(1, Number(data.totalPages || 1));
    cookiesPageState.hasNext = !!data.hasNext;
    cookiesPageState.hasPrev = !!data.hasPrev;
}

function renderCustomersPager() {
    const info = el('customersPagerInfo');
    const prevBtn = el('customersPrevBtn');
    const nextBtn = el('customersNextBtn');
    if (info) {
        const suffix = customersPageState.search ? ` • Tim: ${customersPageState.search}` : '';
        info.textContent = `Trang ${customersPageState.page}/${customersPageState.totalPages} • Tong ${customersPageState.total}${suffix}`;
    }
    if (prevBtn) prevBtn.disabled = !customersPageState.hasPrev;
    if (nextBtn) nextBtn.disabled = !customersPageState.hasNext;
}

function runCustomerLocalSearch() {
    customerSearchLocalQuery = normalizeSearchText((el('customerSearchInput') && el('customerSearchInput').value) || '');
    if (!customerSearchLocalQuery) {
        customersPageState.search = '';
    }
    renderCustomersTable();
}

function scheduleCustomerLocalSearch(delayMs = 400) {
    if (customerSearchDebounceTimer) {
        clearTimeout(customerSearchDebounceTimer);
        customerSearchDebounceTimer = null;
    }
    customerSearchDebounceTimer = window.setTimeout(() => {
        customerSearchDebounceTimer = null;
        runCustomerLocalSearch();
    }, Math.max(0, Number(delayMs || 0)));
}

async function triggerCustomerSearchAll() {
    const query = normalizeSearchText(customerSearchLocalQuery || (el('customerSearchInput') && el('customerSearchInput').value) || '');
    if (!query) return;
    try {
        await loadCustomers({ page: 1, search: query });
        renderCustomersTable();
    } catch (error) {
        setAdminLoadState(error.message || 'Khong tim toan bo duoc.', 'error');
        toast(error.message || 'Khong tim toan bo duoc.', 'bad');
    }
}

async function clearCustomerSearch() {
    customerSearchLocalQuery = '';
    const input = el('customerSearchInput');
    if (input) input.value = '';
    const hadServerSearch = !!String(customersPageState.search || '').trim() || !!String(customerSearchServerQuery || '').trim();
    customerSearchServerQuery = '';
    if (hadServerSearch) {
        await loadCustomers({ page: 1, search: '' });
    } else {
        customersPageState.search = '';
        renderCustomersTable();
    }
}

function renderCookiesPager() {
    const info = el('cookiesPagerInfo');
    const prevBtn = el('cookiesPrevBtn');
    const nextBtn = el('cookiesNextBtn');
    if (info) info.textContent = `Trang ${cookiesPageState.page}/${cookiesPageState.totalPages} • Tong ${cookiesPageState.total}`;
    if (prevBtn) prevBtn.disabled = !cookiesPageState.hasPrev;
    if (nextBtn) nextBtn.disabled = !cookiesPageState.hasNext;
}

async function loadCustomers(options = {}) {
    if (options.page !== undefined) customersPageState.page = Math.max(1, Number(options.page || 1));
    if (options.pageSize !== undefined) customersPageState.pageSize = Math.max(1, Number(options.pageSize || ADMIN_PAGE_SIZE));
    if (options.search !== undefined) customersPageState.search = String(options.search || '').trim();

    const activeSearch = String(customersPageState.search || '').trim();
    setAdminLoadState(activeSearch ? `Dang tim toan bo: ${activeSearch}...` : 'Dang tai danh sach khach...', 'loading');
    const data = await apiRequest(buildPagedUrl('/api/nf-customers', customersPageState), 'GET');
    customersCache = Array.isArray(data.items)
        ? data.items
        : (Array.isArray(data.customers) ? data.customers : []);
    applyCustomersPageState(data);
    customerSearchServerQuery = activeSearch ? activeSearch : '';
    adminCustomersLoaded = true;
    renderCustomersTable();
    renderCookiesTable();
    renderCustomersPager();
    setAdminLoadState(activeSearch ? `Da co ket qua tim toan bo cho: ${activeSearch}.` : 'Da tai danh sach khach.', 'success');
}

async function loadCookies(options = {}) {
    if (options.page !== undefined) cookiesPageState.page = Math.max(1, Number(options.page || 1));
    if (options.pageSize !== undefined) cookiesPageState.pageSize = Math.max(1, Number(options.pageSize || ADMIN_PAGE_SIZE));

    setAdminLoadState('Dang tai danh sach cookie...', 'loading');
    const data = await apiRequest(buildPagedUrl('/api/nf-cookies', cookiesPageState), 'GET');
    cookiesCache = Array.isArray(data.items)
        ? data.items
        : (Array.isArray(data.cookies) ? data.cookies : []);
    cookiesSummary = data;
    applyCookiesPageState(data);
    adminCookiesLoaded = true;
    syncCookieSelection();
    renderCookiesSummary();
    renderCookiesTable();
    renderCookiesPager();
    setAdminLoadState('Da tai danh sach cookie.', 'success');
}
function clearCustomerForm() {
    const codeEditInput = el('customerCodeEditInput');
    const warrantyDaysInput = el('customerWarrantyDaysInput');
    el('customerNameInput').value = '';
    el('customerWarrantyInput').value = '';
    if (warrantyDaysInput) warrantyDaysInput.value = '';
    if (codeEditInput) {
        codeEditInput.value = '';
        codeEditInput.classList.add('hidden');
    }
    el('customerEditCodeInput').value = '';
    el('cancelEditCustomerBtn').classList.add('hidden');
    const saveBtn = el('saveCustomerBtn');
    if (saveBtn) saveBtn.textContent = 'Luu khach hang';
}

function applyWarrantyDaysQuick() {
    const daysInput = el('customerWarrantyDaysInput');
    const warrantyInput = el('customerWarrantyInput');
    if (!daysInput || !warrantyInput) return;

    const raw = String(daysInput.value || '').trim();
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days <= 0) {
        toast('Vui long nhap so ngay hop le (> 0).', 'warn');
        return;
    }

    const target = new Date();
    target.setDate(target.getDate() + days);
    const targetLocal = toDatetimeLocalFromIso(target.toISOString());
    if (!targetLocal) {
        toast('Khong tinh duoc ngay bao hanh.', 'bad');
        return;
    }

    warrantyInput.value = targetLocal;
    toast(`Da tinh ngay bao hanh sau ${days} ngay.`, 'ok');
}

function setTab(tab) {
    activeTab = tab === 'cookies' ? 'cookies' : 'customers';
    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    buttons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });
    el('tabCustomers').classList.toggle('hidden', activeTab !== 'customers');
    el('tabCookies').classList.toggle('hidden', activeTab !== 'cookies');
}

function openAdminModal() {
    const modal = el('nfAdminModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeAdminModal() {
    const modal = el('nfAdminModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function updateRawEditorMeta() {
    const meta = el('cookieRawEditorMeta');
    const textarea = el('cookieRawEditorTextarea');
    if (!meta || !textarea) return;
    const raw = String(textarea.value || '');
    const lines = raw ? raw.split('\n').length : 0;
    meta.textContent = `${lines} dòng • ${raw.length} ký tự`;
}

function openCookieRawEditor(cookie, mode = 'edit') {
    if (!cookie) return;
    const modal = el('cookieRawEditorModal');
    const title = el('cookieRawEditorTitle');
    const textarea = el('cookieRawEditorTextarea');
    const saveBtn = el('cookieRawEditorSaveBtn');
    if (!modal || !title || !textarea || !saveBtn) return;

    rawEditorCookieId = String(cookie.id || '').trim();
    rawEditorInitialRaw = String(cookie.cookieRaw || '');
    rawEditorMode = mode === 'view' ? 'view' : 'edit';

    title.textContent = rawEditorMode === 'view' ? 'Xem full cookie raw' : 'Sửa full cookie raw';
    textarea.value = rawEditorInitialRaw;
    textarea.readOnly = rawEditorMode === 'view';
    saveBtn.classList.toggle('hidden', rawEditorMode !== 'edit');

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    updateRawEditorMeta();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
}

function closeCookieRawEditor() {
    const modal = el('cookieRawEditorModal');
    const textarea = el('cookieRawEditorTextarea');
    if (!modal || !textarea) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    textarea.value = '';
    rawEditorCookieId = '';
    rawEditorInitialRaw = '';
    rawEditorMode = 'edit';
}

async function saveCookieRawEditor() {
    if (rawEditorMode !== 'edit') return;
    const cookieId = String(rawEditorCookieId || '').trim();
    const textarea = el('cookieRawEditorTextarea');
    const saveBtn = el('cookieRawEditorSaveBtn');
    if (!cookieId || !textarea) return;

    const finalRaw = String(textarea.value || '').trim();
    const previousRaw = String(rawEditorInitialRaw || '').trim();
    if (!finalRaw) {
        toast('Noi dung cookie raw trong.', 'warn');
        return;
    }
    if (finalRaw === previousRaw) {
        toast('Khong co thay doi cookie.', 'warn');
        return;
    }

    setButtonBusy(saveBtn, true, 'Dang luu...');
    try {
        await apiRequest('/api/nf-cookies', 'PUT', { cookieId, cookieRaw: finalRaw });
        toast('Da cap nhat full cookie raw.', 'ok');
        closeCookieRawEditor();
        refreshAdminDataInBackground({ cookies: true, customers: true });
    } catch (error) {
        toast(error.message || 'Cap nhat cookie that bai.', 'bad');
    } finally {
        setButtonBusy(saveBtn, false);
    }
}

async function saveCookieNote(cookieId, noteValue, triggerButton = null) {
    const id = String(cookieId || '').trim();
    if (!id) return;
    const normalizedNote = String(noteValue || '').trim();
    await applyCookieAction('save-note', [id], triggerButton, { noteValue: normalizedNote, busyLabel: 'Dang luu...' });
}

function renderAdminState(user) {
    const isAdmin = !!(user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    const fab = el('nfAdminFab');
    const authBox = el('adminAuthBox');
    const workspace = el('adminWorkspace');
    const identity = el('adminIdentity');
    const authState = el('adminAuthState');

    if (fab) {
        fab.classList.remove('hidden');
        fab.classList.toggle('is-admin', isAdmin);
        fab.title = isAdmin ? 'Tai khoan admin da dang nhap' : 'Dang nhap tai khoan';
        fab.setAttribute('aria-label', isAdmin ? 'Tai khoan admin da dang nhap' : 'Dang nhap tai khoan');
    }
    if (identity) identity.textContent = isAdmin ? `Dang nhap: ${user.email}` : 'Chua dang nhap admin';
    if (authBox) authBox.classList.toggle('hidden', isAdmin);
    if (workspace) workspace.classList.toggle('hidden', !isAdmin);
    if (authState) {
        authState.textContent = isAdmin ? 'Da xac thuc admin.' : 'Chua dang nhap.';
        setStateClass(authState, isAdmin ? 'success' : 'idle');
    }

    if (!isAdmin) {
        adminCustomersLoaded = false;
        adminCookiesLoaded = false;
        customerSearchLocalQuery = '';
        customerSearchServerQuery = '';
        customersPageState.search = '';
        customersPageState.page = 1;
        customersPageState.total = 0;
        customersPageState.totalPages = 1;
        customersPageState.hasNext = false;
        customersPageState.hasPrev = false;
        cookiesPageState.page = 1;
        cookiesPageState.total = 0;
        cookiesPageState.totalPages = 1;
        cookiesPageState.hasNext = false;
        cookiesPageState.hasPrev = false;
        renderCustomersPager();
        renderCookiesPager();
        const adminLoadState = el('adminLoadState');
        if (adminLoadState) {
            adminLoadState.textContent = 'Dang nhap de tai du lieu admin theo tung danh sach.';
            setStateClass(adminLoadState, 'idle');
        }
        const searchInput = el('customerSearchInput');
        if (searchInput) searchInput.value = '';
    }
}
async function onSubmitCustomerForm(event) {
    event.preventDefault();
    const newCodeInput = el('customerCodeEditInput');
    const name = String(el('customerNameInput').value || '').trim();
    const warrantyLocal = String(el('customerWarrantyInput').value || '').trim();
    const editCode = normalizeCode(el('customerEditCodeInput').value || '');
    const newCode = normalizeCode((newCodeInput && newCodeInput.value) || '');
    const warrantyIso = toIsoFromDatetimeLocal(warrantyLocal);
    if (!name || !warrantyIso) {
        toast('Vui long nhap ten va thoi gian bao hanh.', 'warn');
        return;
    }
    if (editCode && !newCode) {
        toast('Vui long nhap ma khach hang khi sua.', 'warn');
        return;
    }

    const saveBtn = el('saveCustomerBtn');
    setButtonBusy(saveBtn, true, editCode ? 'Dang cap nhat...' : 'Dang tao...');

    try {
        if (editCode) {
            const found = customersCache.find((item) => item.code === editCode);
            const updatedRes = await apiRequest('/api/nf-customers', 'PUT', {
                code: editCode,
                newCode,
                name,
                warrantyExpiresAt: warrantyIso,
                status: found && found.status ? found.status : 'active'
            });
            if (updatedRes && updatedRes.customer && adminCustomersLoaded) {
                const updatedCustomer = updatedRes.customer;
                customersCache = (Array.isArray(customersCache) ? customersCache : [])
                    .map((item) => (item.code === editCode ? updatedCustomer : item));
                renderCustomersTable();
                renderCookiesTable();
            }
            toast('Da cap nhat khach hang.', 'ok');
        } else {
            const createRes = await apiRequest('/api/nf-customers', 'POST', { name, warrantyExpiresAt: warrantyIso });
            const createdCustomer = createRes && createRes.customer ? createRes.customer : null;
            if (createdCustomer) {
                customersCache = [createdCustomer];
                adminCustomersLoaded = true;
                customersPageState.search = '';
                customerSearchServerQuery = '';
                customerSearchLocalQuery = '';
                customersPageState.page = 1;
                customersPageState.pageSize = ADMIN_PAGE_SIZE;
                customersPageState.total = 1;
                customersPageState.totalPages = 1;
                customersPageState.hasNext = false;
                customersPageState.hasPrev = false;
                const searchInput = el('customerSearchInput');
                if (searchInput) searchInput.value = '';
                renderCustomersTable();
                renderCookiesTable();
                renderCustomersPager();
                setAdminLoadState('Dang hien thi khach vua tao. Bam \"Load danh sach khach\" de tai toan bo.', 'warning');
            }
            toast('Da tao ma khach hang moi.', 'ok');
        }
        clearCustomerForm();
    } catch (error) {
        toast(error.message || 'Luu khach hang that bai.', 'bad');
    } finally {
        setButtonBusy(saveBtn, false);
    }
}

async function runCustomerAction(action = '', code = '', triggerButton = null) {
    const customerCode = normalizeCode(code);
    if (!action || !customerCode) return;
    const customer = customersCache.find((item) => item.code === customerCode);
    if (!customer) return;
    try {
        if (action === 'edit') {
            const codeEditInput = el('customerCodeEditInput');
            const warrantyDaysInput = el('customerWarrantyDaysInput');
            el('customerNameInput').value = customer.name || '';
            el('customerWarrantyInput').value = toDatetimeLocalFromIso(customer.warrantyExpiresAt);
            if (warrantyDaysInput) warrantyDaysInput.value = '';
            el('customerEditCodeInput').value = customer.code || '';
            if (codeEditInput) {
                codeEditInput.value = customer.code || '';
                codeEditInput.classList.remove('hidden');
            }
            el('cancelEditCustomerBtn').classList.remove('hidden');
            const saveBtn = el('saveCustomerBtn');
            if (saveBtn) saveBtn.textContent = `Cap nhat ${customer.code}`;
            return;
        }

        if (action === 'toggle') {
            await apiRequest('/api/nf-customers', 'PUT', {
                code: customerCode,
                name: customer.name,
                warrantyExpiresAt: customer.warrantyExpiresAt,
                status: customer.status === 'inactive' ? 'active' : 'inactive'
            });
            toast('Da cap nhat trang thai.', 'ok');
            await loadCustomers();
            return;
        }

        if (action === 'error') {
            const assignedCookieId = String(customer.assignedCookieId || '').trim();
            if (!assignedCookieId) {
                toast('Khach nay chua co cookie de gan ERROR.', 'warn');
                return;
            }
            await applyCookieAction('error-on', [assignedCookieId], triggerButton, { busyLabel: 'Dang xu ly...' });
            return;
        }

        if (action === 'overload') {
            const assignedCookieId = String(customer.assignedCookieId || '').trim();
            if (!assignedCookieId) {
                toast('Khach nay chua co cookie de gan QUA TAI.', 'warn');
                return;
            }
            const nowIso = new Date().toISOString();
            const overCapacityUntil = buildOverCapacityUntilIso(60 * 60 * 1000);
            await applyCookieAction('overcap-on', [assignedCookieId], triggerButton, {
                busyLabel: 'Dang xu ly...',
                overCapacityUntil,
                lastOverCapacityAt: nowIso,
                lastError: `Manual QUA TAI by customer ${customerCode}`
            });
            return;
        }

        if (action === 'delete') {
            const ok = window.confirm(`Xoa ma khach ${customerCode}?`);
            if (!ok) return;
            await apiRequest('/api/nf-customers', 'DELETE', { code: customerCode });
            toast('Da xoa khach hang.', 'ok');
            await Promise.all([loadCustomers(), loadCookies()]);
        }
    } catch (error) {
        toast(error.message || 'Thao tac khach hang that bai.', 'bad');
    }
}

async function handleCustomerTableAction(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const menuTrigger = target.closest('[data-row-menu-trigger]');
    if (menuTrigger instanceof HTMLElement) {
        event.preventDefault();
        const row = menuTrigger.closest('tr[data-row-kind]');
        if (row instanceof HTMLElement) {
            openRowActionMenuForRow(row, menuTrigger);
        }
        return;
    }

    const copyCode = normalizeCode(target.dataset.copyCode || '');
    if (copyCode) {
        try {
            await navigator.clipboard.writeText(copyCode);
            toast('Da sao chep ma khach.', 'ok');
        } catch (error) {
            toast(`Khong copy tu dong duoc. Ma: ${copyCode}`, 'warn');
        }
        return;
    }

    const action = String(target.dataset.customerAct || '').trim();
    const code = normalizeCode(target.dataset.code || '');
    if (!action || !code) return;
    await runCustomerAction(action, code, target);
}

async function importCookies() {
    const input = el('cookieImportInput');
    const state = el('cookieImportState');
    const content = String(input.value || '').trim();
    if (!content) {
        toast('Vui long nhap noi dung cookie.', 'warn');
        return;
    }

    const importBtn = el('importCookiesBtn');
    setButtonBusy(importBtn, true, 'Dang import...');
    if (state) {
        state.textContent = 'Dang import cookie...';
        setStateClass(state, 'loading');
    }

    try {
        const data = await apiRequest('/api/nf-cookies/import', 'POST', { content });
        if (state) {
            state.textContent = `Them ${data.addedCount || 0} | Trung ${data.skippedCount || 0} | Loi ${data.invalidCount || 0}`;
            setStateClass(state, 'success');
        }
        toast('Import cookie thanh cong.', 'ok');
        await loadCookies();
        input.value = '';
    } catch (error) {
        if (state) {
            state.textContent = error.message || 'Import that bai.';
            setStateClass(state, 'error');
        }
        toast(error.message || 'Import that bai.', 'bad');
    } finally {
        setButtonBusy(importBtn, false);
    }
}

function isExcelFile(file) {
    if (!file) return false;
    const fileName = String(file.name || '').toLowerCase();
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) return true;
    const fileType = String(file.type || '').toLowerCase();
    return fileType.includes('spreadsheetml') || fileType.includes('ms-excel');
}

async function getXlsxModule() {
    if (!xlsxModulePromise) {
        xlsxModulePromise = import(XLSX_ESM_URL);
    }
    return xlsxModulePromise;
}

async function readExcelCookiesFromColumnA(file) {
    const XLSX = await getXlsxModule();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : '';
    if (!firstSheetName) {
        throw new Error('File Excel khong co sheet du lieu.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const cookies = rows
        .map((row) => {
            if (!Array.isArray(row)) return '';
            return String(row[0] ?? '').trim();
        })
        .filter(Boolean);

    if (cookies[0] && cookies[0].toLowerCase() === 'cookie') {
        cookies.shift();
    }

    if (cookies.length === 0) {
        throw new Error('Khong tim thay cookie hop le o cot A cua file Excel.');
    }
    return cookies;
}

function appendCookieBlocks(cookieBlocks = []) {
    const input = el('cookieImportInput');
    if (!input) return 0;

    const normalizedBlocks = cookieBlocks
        .map((block) => String(block || '').trim())
        .filter(Boolean);
    if (normalizedBlocks.length === 0) return 0;

    const incoming = normalizedBlocks.join('\n\n');
    const current = String(input.value || '').trim();
    input.value = current ? `${current}\n\n${incoming}` : incoming;
    return normalizedBlocks.length;
}

function summarizeCheckResult(data = {}) {
    return `Check ${data.totalChecked || 0} | LIVE ${data.liveCount || 0} | DIE ${data.deadCount || 0} | SBD ${data.sbdCount || 0} | Loi ${data.errorCount || 0}`;
}

function applyCookieViewControls() {
    renderCookiesTable();
}

function cloneCookiesCache() {
    return Array.isArray(cookiesCache) ? cookiesCache.map((item) => ({ ...item })) : [];
}

function restoreCookiesCache(snapshot = []) {
    cookiesCache = Array.isArray(snapshot) ? snapshot : [];
    syncCookieSelection();
    renderCookiesSummary();
    renderCookiesTable();
}

function refreshAdminDataInBackground(options = {}) {
    const { cookies = true, customers = false } = options;
    const jobs = [];
    if (cookies) jobs.push(loadCookies());
    if (customers) jobs.push(loadCustomers());
    if (jobs.length === 0) return;
    Promise.all(jobs).catch((error) => {
        toast(error.message || 'Khong dong bo du lieu nen duoc.', 'warn');
    });
}

function shouldRefreshCustomersForCookieAction(action = '') {
    return action === 'delete'
        || action === 'unassign'
        || action === 'disabled'
        || action === 'dead'
        || action === 'error-on'
        || action === 'sbd-on'
        || action === 'unknown-on'
        || action === 'hold-on'
        || action === 'overcap-on';
}

function getCookieActionSuccessMessage(action = '', count = 1) {
    const amount = Number(count || 0);
    if (action === 'delete') return amount > 1 ? `Da xoa ${amount} cookie.` : 'Da xoa cookie.';
    if (action === 'unassign') return amount > 1 ? `Da bo gan ${amount} cookie.` : 'Da bo gan cookie.';
    if (action === 'active' || action === 'disabled' || action === 'dead') {
        return amount > 1 ? `Da cap nhat ${amount} cookie.` : `Da doi trang thai thanh ${action}.`;
    }
    if (action === 'sbd-on') return amount > 1 ? `Da gan tag SBD cho ${amount} cookie.` : 'Da gan tag SBD cho cookie.';
    if (action === 'sbd-off') return amount > 1 ? `Da go tag SBD cho ${amount} cookie.` : 'Da go tag SBD cho cookie.';
    if (action === 'error-on') return amount > 1 ? `Da gan tag ERROR cho ${amount} cookie.` : 'Da gan tag ERROR cho cookie.';
    if (action === 'error-off') return amount > 1 ? `Da go tag ERROR cho ${amount} cookie.` : 'Da go tag ERROR cho cookie.';
    if (action === 'unknown-on') return amount > 1 ? `Da gan tag UNKNOW cho ${amount} cookie.` : 'Da gan tag UNKNOW cho cookie.';
    if (action === 'unknown-off') return amount > 1 ? `Da go tag UNKNOW cho ${amount} cookie.` : 'Da go tag UNKNOW cho cookie.';
    if (action === 'hold-on') return amount > 1 ? `Da gan tag HOLD cho ${amount} cookie.` : 'Da gan tag HOLD cho cookie.';
    if (action === 'hold-off') return amount > 1 ? `Da go tag HOLD cho ${amount} cookie.` : 'Da go tag HOLD cho cookie.';
    if (action === 'overcap-on') return amount > 1 ? `Da gan tag QUA TAI cho ${amount} cookie trong 1 gio.` : 'Da gan tag QUA TAI cho cookie trong 1 gio.';
    if (action === 'overcap-off') return amount > 1 ? `Da go tag QUA TAI cho ${amount} cookie.` : 'Da go tag QUA TAI cho cookie.';
    if (action === 'save-note') return 'Da cap nhat note cookie.';
    return 'Da cap nhat cookie.';
}

function applyOptimisticCookieAction(action = '', cookieIds = [], options = {}) {
    const idSet = new Set((Array.isArray(cookieIds) ? cookieIds : []).map((id) => String(id || '').trim()).filter(Boolean));
    if (idSet.size === 0) return;
    const now = new Date().toISOString();
    const noteValue = String(options.noteValue || '').trim();

    if (action === 'delete') {
        cookiesCache = cookiesCache.filter((cookie) => !idSet.has(String(cookie.id || '').trim()));
        selectedCookieIds = new Set(Array.from(selectedCookieIds).filter((id) => !idSet.has(String(id || '').trim())));
        syncCookieSelection();
        renderCookiesSummary();
        renderCookiesTable();
        return;
    }

    cookiesCache = cookiesCache.map((cookie) => {
        const id = String(cookie.id || '').trim();
        if (!idSet.has(id)) return cookie;

        if (action === 'save-note') {
            return { ...cookie, note: noteValue, updatedAt: now };
        }
        if (action === 'unassign') {
            return { ...cookie, assignedCustomerCode: '', updatedAt: now };
        }
        if (action === 'active' || action === 'disabled' || action === 'dead') {
            return {
                ...cookie,
                status: action,
                assignedCustomerCode: action === 'active' ? cookie.assignedCustomerCode : '',
                updatedAt: now
            };
        }
        if (action === 'error-on' || action === 'error-off') {
            const errorTagged = action === 'error-on';
            return {
                ...cookie,
                errorTagged,
                assignedCustomerCode: errorTagged ? '' : cookie.assignedCustomerCode,
                updatedAt: now
            };
        }
        if (action === 'sbd-on' || action === 'sbd-off') {
            const sbdTagged = action === 'sbd-on';
            return {
                ...cookie,
                sbdTagged,
                assignedCustomerCode: sbdTagged ? '' : cookie.assignedCustomerCode,
                updatedAt: now
            };
        }
        if (action === 'unknown-on' || action === 'unknown-off') {
            const unknownTagged = action === 'unknown-on';
            return {
                ...cookie,
                unknownTagged,
                assignedCustomerCode: unknownTagged ? '' : cookie.assignedCustomerCode,
                updatedAt: now
            };
        }
        if (action === 'hold-on' || action === 'hold-off') {
            const holdTagged = action === 'hold-on';
            return {
                ...cookie,
                holdTagged,
                assignedCustomerCode: holdTagged ? '' : cookie.assignedCustomerCode,
                updatedAt: now
            };
        }
        if (action === 'overcap-on' || action === 'overcap-off') {
            const overCapacityTagged = action === 'overcap-on';
            return {
                ...cookie,
                overCapacityTagged,
                overCapacityUntil: overCapacityTagged
                    ? String(options.overCapacityUntil || buildOverCapacityUntilIso(60 * 60 * 1000))
                    : '',
                lastOverCapacityAt: overCapacityTagged
                    ? String(options.lastOverCapacityAt || now)
                    : String(cookie.lastOverCapacityAt || ''),
                lastError: overCapacityTagged
                    ? String(options.lastError || cookie.lastError || 'Manual QUA TAI')
                    : cookie.lastError,
                assignedCustomerCode: overCapacityTagged ? '' : cookie.assignedCustomerCode,
                updatedAt: now
            };
        }
        return cookie;
    });

    syncCookieSelection();
    renderCookiesSummary();
    renderCookiesTable();
}

function buildCookieActionRequest(action = '', cookieIds = [], options = {}) {
    const isSingle = cookieIds.length === 1;
    const firstId = String(cookieIds[0] || '').trim();
    const base = isSingle ? { cookieId: firstId } : { cookieIds };

    if (action === 'delete') return { method: 'DELETE', body: base };
    if (action === 'unassign') return { method: 'PUT', body: { ...base, unassign: true } };
    if (action === 'active' || action === 'disabled' || action === 'dead') return { method: 'PUT', body: { ...base, status: action } };
    if (action === 'error-on' || action === 'error-off') return { method: 'PUT', body: { ...base, errorTagged: action === 'error-on' } };
    if (action === 'sbd-on' || action === 'sbd-off') return { method: 'PUT', body: { ...base, sbdTagged: action === 'sbd-on' } };
    if (action === 'unknown-on' || action === 'unknown-off') return { method: 'PUT', body: { ...base, unknownTagged: action === 'unknown-on' } };
    if (action === 'hold-on' || action === 'hold-off') return { method: 'PUT', body: { ...base, holdTagged: action === 'hold-on' } };
    if (action === 'overcap-on' || action === 'overcap-off') {
        return {
            method: 'PUT',
            body: {
                ...base,
                overCapacityTagged: action === 'overcap-on',
                overCapacityUntil: action === 'overcap-on'
                    ? String(options.overCapacityUntil || buildOverCapacityUntilIso(60 * 60 * 1000))
                    : '',
                lastOverCapacityAt: action === 'overcap-on'
                    ? String(options.lastOverCapacityAt || new Date().toISOString())
                    : '',
                lastError: action === 'overcap-on'
                    ? String(options.lastError || 'Manual QUA TAI')
                    : String(options.lastError || '')
            }
        };
    }
    if (action === 'save-note') return { method: 'PUT', body: { cookieId: firstId, note: String(options.noteValue || '').trim() } };
    return null;
}

async function applyCookieAction(action = '', cookieIds = [], triggerButton = null, options = {}) {
    const ids = (Array.isArray(cookieIds) ? cookieIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean);
    if (ids.length === 0) return false;

    const requestConfig = buildCookieActionRequest(action, ids, options);
    if (!requestConfig) return false;

    const cookieSnapshot = cloneCookiesCache();
    const shouldRefreshCustomers = shouldRefreshCustomersForCookieAction(action);
    const busyLabel = String(options.busyLabel || 'Dang xu ly...');

    setButtonBusy(triggerButton, true, busyLabel);
    applyOptimisticCookieAction(action, ids, options);

    try {
        const data = await apiRequest('/api/nf-cookies', requestConfig.method, requestConfig.body);
        const affectedCount = Number(data && data.affectedCount ? data.affectedCount : ids.length);
        toast(getCookieActionSuccessMessage(action, affectedCount), 'ok');
        refreshAdminDataInBackground({ cookies: true, customers: shouldRefreshCustomers });
        return true;
    } catch (error) {
        restoreCookiesCache(cookieSnapshot);
        toast(error.message || 'Cap nhat cookie that bai.', 'bad');
        return false;
    } finally {
        setButtonBusy(triggerButton, false);
    }
}

async function runCookieCheck(mode = 'selected', triggerButton = null) {
    if (runtimeBlocked) return;
    const payload = { mode };
    if (mode === 'selected') {
        const cookieIds = getSelectedCookieIds();
        if (cookieIds.length === 0) {
            toast('Hay chon cookie truoc khi check.', 'warn');
            return;
        }
        payload.cookieIds = cookieIds;
    }

    setButtonBusy(triggerButton, true, 'Dang check...');
    setCookieCheckState('Dang check cookie...', 'loading');

    try {
        const data = await apiRequest('/api/nf-cookies/check', 'POST', payload);
        const summaryText = summarizeCheckResult(data);
        setCookieCheckState(summaryText, 'success');
        toast(summaryText, 'ok');
        refreshAdminDataInBackground({ cookies: true, customers: true });
    } catch (error) {
        setCookieCheckState(error.message || 'Check cookie that bai.', 'error');
        toast(error.message || 'Check cookie that bai.', 'bad');
    } finally {
        setButtonBusy(triggerButton, false);
    }
}

async function applyBulkCookieAction(action, triggerButton = null) {
    if (runtimeBlocked) return;
    const cookieIds = getSelectedCookieIds();
    if (cookieIds.length === 0) {
        toast('Hay chon cookie de thao tac.', 'warn');
        return;
    }

    if (action === 'check-selected') {
        await runCookieCheck('selected', triggerButton);
        return;
    }
    if (action === 'tag-add') {
        openTagPickerModal(cookieIds, 'add');
        return;
    }
    if (action === 'tag-remove') {
        openTagPickerModal(cookieIds, 'remove');
        return;
    }

    if (action === 'delete') {
        const ok = window.confirm(`Xoa ${cookieIds.length} cookie da chon?`);
        if (!ok) return;
    }
    await applyCookieAction(action, cookieIds, triggerButton, { busyLabel: 'Dang xu ly...' });
}

async function runCookieRowAction(action = '', cookieId = '', triggerButton = null) {
    const id = String(cookieId || '').trim();
    if (!action || !id) return;
    const cookie = cookiesCache.find((item) => item.id === id);
    if (!cookie) return;

    if (action === 'delete') {
        const ok = window.confirm('Xoa cookie nay khoi danh sach?');
        if (!ok) return;
        await applyCookieAction('delete', [id], triggerButton, { busyLabel: 'Dang xu ly...' });
        return;
    }
    if (action === 'unassign') {
        await applyCookieAction('unassign', [id], triggerButton, { busyLabel: 'Dang xu ly...' });
        return;
    }
    if (action === 'active' || action === 'disabled' || action === 'dead') {
        await applyCookieAction(action, [id], triggerButton, { busyLabel: 'Dang xu ly...' });
        return;
    }
    if (action === 'tag-add') {
        openTagPickerModal([id], 'add');
        return;
    }
    if (action === 'tag-remove') {
        openTagPickerModal([id], 'remove');
        return;
    }
    if (action === 'view-raw') {
        const raw = String(cookie.cookieRaw || '').trim();
        if (!raw) {
            toast('Cookie nay chua co noi dung raw.', 'warn');
            return;
        }
        openCookieRawEditor(cookie, 'view');
        return;
    }
    if (action === 'edit-raw') {
        openCookieRawEditor(cookie, 'edit');
        return;
    }
}

function handleCookieTableChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const cookieId = String(target.dataset.cookieSelect || '').trim();
    if (!cookieId) return;

    if (target.checked) selectedCookieIds.add(cookieId);
    else selectedCookieIds.delete(cookieId);
    updateCookieSelectionUi();
}

function handleSelectAllCookies(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const visibleIds = getVisibleCookieIds();
    if (target.checked) {
        visibleIds.forEach((id) => selectedCookieIds.add(id));
    } else {
        visibleIds.forEach((id) => selectedCookieIds.delete(id));
    }
    renderCookiesTable();
}

function toggleSelectAllCookies() {
    const visibleIds = getVisibleCookieIds();
    const total = visibleIds.length;
    if (total === 0) return;
    const selectedCount = visibleIds.filter((id) => selectedCookieIds.has(id)).length;
    if (selectedCount === total) {
        visibleIds.forEach((id) => selectedCookieIds.delete(id));
    } else {
        visibleIds.forEach((id) => selectedCookieIds.add(id));
    }
    renderCookiesTable();
}

function handleCookieBulkAction(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = String(target.dataset.cookieBulkAct || '').trim();
    if (!action) return;
    applyBulkCookieAction(action, target);
}

async function handleCookieTableAction(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const menuTrigger = target.closest('[data-row-menu-trigger]');
    if (menuTrigger instanceof HTMLElement) {
        event.preventDefault();
        const row = menuTrigger.closest('tr[data-row-kind]');
        if (row instanceof HTMLElement) {
            openRowActionMenuForRow(row, menuTrigger);
        }
        return;
    }
    const action = target.dataset.cookieAct;
    const cookieId = String(target.dataset.id || '').trim();
    if (!action || !cookieId) return;
    const cookie = cookiesCache.find((item) => item.id === cookieId);

    try {
        if (action === 'save-note') {
            const row = target.closest('tr');
            const input = row ? row.querySelector(`[data-cookie-note-input="${cookieId}"]`) : null;
            if (!(input instanceof HTMLInputElement)) return;
            await saveCookieNote(cookieId, input.value, target);
            return;
        }

        if (action === 'view-raw') {
            await runCookieRowAction('view-raw', cookieId, target);
            return;
        }

        if (action === 'create-youraccount-link') {
            if (!cookie) return;
            const raw = String(cookie.cookieRaw || '').trim();
            if (!raw) {
                toast('Cookie nay chua co noi dung raw.', 'warn');
                return;
            }

            setButtonBusy(target, true, 'Dang tao...');
            try {
                const data = await apiRequest('/api/nf-cookie-to-link', 'POST', {
                    cookieStr: raw,
                    device: 'mobile'
                });
                const url = String(data && data.url ? data.url : '').trim();
                if (!url) throw new Error('Khong tao duoc link YourAccount.');

                const opened = window.open(url, '_blank', 'noopener');
                if (!opened || opened.closed) {
                    toast('Link da tao. Popup bi chan, da copy vao clipboard.', 'warn');
                }

                try {
                    await navigator.clipboard.writeText(url);
                    toast('Da tao link YourAccount va copy clipboard.', 'ok');
                } catch (copyError) {
                    toast('Da tao link YourAccount. Khong copy tu dong duoc.', 'warn');
                }
            } catch (error) {
                toast(error.message || 'Tao link YourAccount that bai.', 'bad');
            } finally {
                setButtonBusy(target, false);
            }
            return;
        }

        if (action === 'edit-raw') {
            await runCookieRowAction('edit-raw', cookieId, target);
            return;
        }

        if (action === 'delete') {
            await runCookieRowAction('delete', cookieId, target);
            return;
        }

        if (action === 'unassign') {
            await runCookieRowAction('unassign', cookieId, target);
            return;
        }

        if (action === 'active' || action === 'disabled' || action === 'dead') {
            await runCookieRowAction(action, cookieId, target);
            return;
        }

        if (action === 'tag-add') {
            await runCookieRowAction('tag-add', cookieId, target);
            return;
        }

        if (action === 'tag-remove') {
            await runCookieRowAction('tag-remove', cookieId, target);
            return;
        }

        if (action === 'error-on' || action === 'error-off') {
            await applyCookieAction(action, [cookieId], target, { busyLabel: 'Dang xu ly...' });
            return;
        }

        if (action === 'sbd-on' || action === 'sbd-off') {
            await applyCookieAction(action, [cookieId], target, { busyLabel: 'Dang xu ly...' });
        }
    } catch (error) {
        toast(error.message || 'Cap nhat cookie that bai.', 'bad');
    }
}

function handleCookieTableKeydown(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const cookieId = String(target.dataset.cookieNoteInput || '').trim();
    if (!cookieId) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const row = target.closest('tr');
    const saveBtn = row ? row.querySelector(`[data-cookie-act="save-note"][data-id="${cookieId}"]`) : null;
    if (saveBtn instanceof HTMLElement) saveBtn.click();
}

function closeRowActionMenu() {
    const menu = el('rowActionMenu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    rowActionMenuContext = null;
}

function getCustomerRowMenuItems(code = '') {
    const customer = customersCache.find((item) => item.code === code);
    if (!customer) return [];
    return [
        { action: 'edit', label: 'Sua' },
        { action: 'error', label: 'ERROR' },
        { action: 'overload', label: 'QUA TAI' },
        { action: 'toggle', label: customer.status === 'inactive' ? 'Kich hoat' : 'Khoa' },
        { action: 'delete', label: 'Xoa', danger: true }
    ];
}

function getCookieRowMenuItems(cookieId = '') {
    const cookie = cookiesCache.find((item) => item.id === cookieId);
    if (!cookie) return [];
    return [
        { action: 'active', label: 'Active' },
        { action: 'disabled', label: 'Disabled' },
        { action: 'dead', label: 'Dead' },
        { action: 'tag-add', label: 'GAN TAG' },
        { action: 'tag-remove', label: 'GO TAG' },
        { action: 'view-raw', label: 'Xem raw' },
        { action: 'edit-raw', label: 'Sua raw' },
        { action: 'unassign', label: 'Bo gan' },
        { action: 'delete', label: 'Xoa', danger: true }
    ];
}

function openRowActionMenuForRow(row, anchorEl = null, point = null) {
    if (!(row instanceof HTMLElement)) return;
    const kind = String(row.dataset.rowKind || '').trim();
    const code = normalizeCode(row.dataset.rowCode || '');
    const cookieId = String(row.dataset.rowCookieId || '').trim();
    const title = kind === 'customer' ? `Khach ${code || ''}` : `Cookie ${cookieId || ''}`;
    const items = kind === 'customer' ? getCustomerRowMenuItems(code) : getCookieRowMenuItems(cookieId);
    if (items.length === 0) {
        closeRowActionMenu();
        return;
    }

    const menu = el('rowActionMenu');
    const menuTitle = el('rowActionMenuTitle');
    const menuList = el('rowActionMenuList');
    if (!menu || !menuTitle || !menuList) return;

    menuTitle.textContent = title;
    menuList.innerHTML = items.map((item) => `
        <button
            class="btn-tiny row-action-menu-btn${item.danger ? ' danger' : ''}"
            type="button"
            data-row-menu-act="${item.action}"
        >${item.label}</button>
    `).join('');

    rowActionMenuContext = {
        kind,
        code,
        cookieId
    };

    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');

    const menuRect = menu.getBoundingClientRect();
    const anchorRect = anchorEl instanceof HTMLElement ? anchorEl.getBoundingClientRect() : null;
    const desiredX = point && Number.isFinite(point.x)
        ? point.x
        : anchorRect ? (anchorRect.left + Math.min(anchorRect.width, 30)) : 8;
    const desiredY = point && Number.isFinite(point.y)
        ? point.y
        : anchorRect ? (anchorRect.bottom + 6) : 8;
    const maxX = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxY = Math.max(8, window.innerHeight - menuRect.height - 8);
    menu.style.left = `${Math.min(maxX, Math.max(8, desiredX))}px`;
    menu.style.top = `${Math.min(maxY, Math.max(8, desiredY))}px`;
}

function findRowFromEventTarget(target) {
    if (!(target instanceof HTMLElement)) return null;
    const row = target.closest('tr[data-row-kind]');
    return row instanceof HTMLElement ? row : null;
}

function clearRowLongPressTimer() {
    if (rowLongPressTimer) {
        window.clearTimeout(rowLongPressTimer);
        rowLongPressTimer = null;
    }
    rowLongPressPointerId = null;
}

function onRowPointerDown(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.pointerType === 'mouse') return;
    const row = findRowFromEventTarget(event.target);
    if (!row) return;
    if (event.target.closest('button, input, textarea, select, a')) return;
    clearRowLongPressTimer();
    rowLongPressPointerId = event.pointerId;
    rowLongPressTimer = window.setTimeout(() => {
        openRowActionMenuForRow(row, null, { x: event.clientX, y: event.clientY });
        clearRowLongPressTimer();
    }, 600);
}

function onRowPointerUpOrCancel(event) {
    if (rowLongPressPointerId === null || event.pointerId !== rowLongPressPointerId) return;
    clearRowLongPressTimer();
}

function onRowTableContextMenu(event) {
    if (!(event.target instanceof HTMLElement)) return;
    const row = findRowFromEventTarget(event.target);
    if (!row) return;
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
    openRowActionMenuForRow(row, null, { x: event.clientX, y: event.clientY });
}

async function onRowActionMenuClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = String(target.dataset.rowMenuAct || '').trim();
    if (!action || !rowActionMenuContext) return;
    const { kind, code, cookieId } = rowActionMenuContext;
    closeRowActionMenu();
    if (kind === 'customer') {
        await runCustomerAction(action, code, target);
        return;
    }
    if (kind === 'cookie') {
        try {
            await runCookieRowAction(action, cookieId, target);
        } catch (error) {
            toast(error.message || 'Cap nhat cookie that bai.', 'bad');
        }
    }
}

async function onAdminLogin() {
    if (runtimeBlocked) return;
    const email = String(el('adminEmailInput').value || '').trim();
    const password = String(el('adminPasswordInput').value || '').trim();
    if (!email || !password) {
        toast('Vui long nhap email va mat khau.', 'warn');
        return;
    }

    const loginBtn = el('adminLoginBtn');
    const authState = el('adminAuthState');
    setButtonBusy(loginBtn, true, 'Dang dang nhap...');
    if (authState) {
        authState.textContent = 'Dang xac thuc...';
        setStateClass(authState, 'loading');
    }

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const user = cred.user;
        if (!user || !user.email || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
            await signOut(auth);
            throw new Error('Tai khoan nay khong co quyen admin /nf.');
        }
            toast('Đăng nhập admin thành công.', 'ok');
    } catch (error) {
        if (authState) {
            authState.textContent = error.message || 'Đăng nhập thất bại.';
            setStateClass(authState, 'error');
        }
        toast(error.message || 'Đăng nhập thất bại.', 'bad');
    } finally {
        setButtonBusy(loginBtn, false);
    }
}

function bindEvents() {
    const lookupBtn = el('lookupBtn');
    if (lookupBtn) lookupBtn.addEventListener('click', () => scheduleLookupCustomerCode(1200));

    const codeInput = el('customerCodeInput');
    if (codeInput) {
        codeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                scheduleLookupCustomerCode(1200);
            }
        });
    }

    const loadCustomersBtn = el('adminLoadCustomersBtn');
    if (loadCustomersBtn) {
        loadCustomersBtn.addEventListener('click', async () => {
            setButtonBusy(loadCustomersBtn, true, 'Dang tai...');
            try {
                await loadCustomers();
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc danh sach khach.', 'error');
                toast(error.message || 'Khong tai duoc danh sach khach.', 'bad');
            } finally {
                setButtonBusy(loadCustomersBtn, false);
            }
        });
    }

    const loadCookiesBtn = el('adminLoadCookiesBtn');
    if (loadCookiesBtn) {
        loadCookiesBtn.addEventListener('click', async () => {
            setButtonBusy(loadCookiesBtn, true, 'Dang tai...');
            try {
                await loadCookies();
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc danh sach cookie.', 'error');
                toast(error.message || 'Khong tai duoc danh sach cookie.', 'bad');
            } finally {
                setButtonBusy(loadCookiesBtn, false);
            }
        });
    }

    const customerSearchInput = el('customerSearchInput');
    if (customerSearchInput) {
        customerSearchInput.addEventListener('input', () => {
            if (customersPageState.search) {
                customersPageState.search = '';
            }
            scheduleCustomerLocalSearch(400);
        });
        customerSearchInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            runCustomerLocalSearch();
            const localResults = applyCustomerQuickSearch(applyCustomerFiltersAndSort(customersCache), customerSearchLocalQuery);
            if (localResults.length === 0) {
                triggerCustomerSearchAll();
            }
        });
    }

    const customerSearchAllBtn = el('customerSearchAllBtn');
    if (customerSearchAllBtn) {
        customerSearchAllBtn.addEventListener('click', triggerCustomerSearchAll);
    }

    const customerSearchClearBtn = el('customerSearchClearBtn');
    if (customerSearchClearBtn) {
        customerSearchClearBtn.addEventListener('click', () => {
            clearCustomerSearch().catch((error) => {
                setAdminLoadState(error.message || 'Khong xoa duoc tim kiem.', 'error');
            });
        });
    }

    const customersPrevBtn = el('customersPrevBtn');
    if (customersPrevBtn) {
        customersPrevBtn.addEventListener('click', async () => {
            if (!adminCustomersLoaded || !customersPageState.hasPrev) return;
            try {
                await loadCustomers({ page: customersPageState.page - 1 });
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc trang khach truoc.', 'error');
            }
        });
    }

    const customersNextBtn = el('customersNextBtn');
    if (customersNextBtn) {
        customersNextBtn.addEventListener('click', async () => {
            if (!adminCustomersLoaded || !customersPageState.hasNext) return;
            try {
                await loadCustomers({ page: customersPageState.page + 1 });
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc trang khach tiep.', 'error');
            }
        });
    }

    const cookiesPrevBtn = el('cookiesPrevBtn');
    if (cookiesPrevBtn) {
        cookiesPrevBtn.addEventListener('click', async () => {
            if (!adminCookiesLoaded || !cookiesPageState.hasPrev) return;
            try {
                await loadCookies({ page: cookiesPageState.page - 1 });
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc trang cookie truoc.', 'error');
            }
        });
    }

    const cookiesNextBtn = el('cookiesNextBtn');
    if (cookiesNextBtn) {
        cookiesNextBtn.addEventListener('click', async () => {
            if (!adminCookiesLoaded || !cookiesPageState.hasNext) return;
            try {
                await loadCookies({ page: cookiesPageState.page + 1 });
            } catch (error) {
                setAdminLoadState(error.message || 'Khong tai duoc trang cookie tiep.', 'error');
            }
        });
    }

    const deviceButtons = Array.from(document.querySelectorAll('.btn-device'));
    deviceButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const device = String(btn.dataset.device || 'desktop');
            if (!device) return;
            openDeviceConfirmModal(device);
        });
    });

    const deviceConfirmModal = el('deviceConfirmModal');
    if (deviceConfirmModal) {
        deviceConfirmModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeDeviceConfirm === '1') {
                closeDeviceConfirmModal();
            }
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
            const nextDevice = pendingConfirmDevice;
            closeDeviceConfirmModal();
            proceedDeviceAction(nextDevice);
        });
    }

    const supportBtn = el('supportWarrantyBtn');
    if (supportBtn) supportBtn.addEventListener('click', openSupportModal);

    const supportModal = el('supportModal');
    if (supportModal) {
        supportModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeSupport === '1') closeSupportModal();
        });
    }

    const supportModalCloseBtn = el('supportModalCloseBtn');
    if (supportModalCloseBtn) supportModalCloseBtn.addEventListener('click', closeSupportModal);

    const supportFanpageLink = el('supportFanpageLink');
    if (supportFanpageLink) supportFanpageLink.setAttribute('href', SUPPORT_FANPAGE_URL);

    const renewNetflixBtn = el('renewNetflixBtn');
    if (renewNetflixBtn) renewNetflixBtn.addEventListener('click', openRenewModal);

    const renewModal = el('renewModal');
    if (renewModal) {
        renewModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeRenew === '1') closeRenewModal();
        });
    }

    const renewModalCloseBtn = el('renewModalCloseBtn');
    if (renewModalCloseBtn) renewModalCloseBtn.addEventListener('click', closeRenewModal);

    const renewFanpageLink = el('renewFanpageLink');
    if (renewFanpageLink) renewFanpageLink.setAttribute('href', SUPPORT_FANPAGE_URL);

    const mobileLinkModal = el('mobileLinkModal');
    if (mobileLinkModal) {
        mobileLinkModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeMobileLink === '1') closeMobileLinkModal();
        });
    }

    const mobileLinkCloseBtn = el('mobileLinkCloseBtn');
    if (mobileLinkCloseBtn) mobileLinkCloseBtn.addEventListener('click', closeMobileLinkModal);

    const copyMobileLinkBtn = el('copyMobileLinkBtn');
    if (copyMobileLinkBtn) {
        copyMobileLinkBtn.addEventListener('click', async () => {
            const output = el('mobileLinkOutput');
            const link = String((output && output.value) || mobileGeneratedLink || '').trim();
            if (!link) {
                toast('Chưa có link để sao chép.', 'warn');
                return;
            }
            try {
                await navigator.clipboard.writeText(link);
                toast('Đã sao chép link.', 'ok');
            } catch (error) {
                if (output) {
                    output.focus();
                    output.select();
                }
                toast('Không sao chép tự động được. Hãy copy thủ công.', 'warn');
            }
        });
    }

    const copyUnsupportedLinkBtn = el('copyUnsupportedLinkBtn');
    if (copyUnsupportedLinkBtn) {
        copyUnsupportedLinkBtn.addEventListener('click', async () => {
            const unsupportedLink = 'https://www.netflix.com/unsupported';
            try {
                await navigator.clipboard.writeText(unsupportedLink);
                toast('Đã sao chép link netflix.com/unsupported.', 'ok');
            } catch (error) {
                toast('Không sao chép tự động được. Hãy copy thủ công link netflix.com/unsupported.', 'warn');
            }
        });
    }

    const tvCodeInput = el('tvCodeInput');
    if (tvCodeInput) {
        tvCodeInput.addEventListener('input', () => {
            const digits = String(tvCodeInput.value || '').replace(/\D/g, '').slice(0, 8);
            if (digits !== tvCodeInput.value) tvCodeInput.value = digits;
        });
        tvCodeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitTvCodeFlow();
            }
        });
    }

    const tvCodeSubmitBtn = el('tvCodeSubmitBtn');
    if (tvCodeSubmitBtn) tvCodeSubmitBtn.addEventListener('click', submitTvCodeFlow);

    const tvCodeCloseBtn = el('tvCodeCloseBtn');
    if (tvCodeCloseBtn) tvCodeCloseBtn.addEventListener('click', closeTvCodeModal);

    const tvCodeModal = el('tvCodeModal');
    if (tvCodeModal) {
        tvCodeModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeTvCode === '1') closeTvCodeModal();
        });
    }

    const tvManualLink = el('tvManualLink');
    if (tvManualLink) tvManualLink.setAttribute('href', TV8_MANUAL_URL);

    const tvManualLoginLink = el('tvManualLoginLink');
    if (tvManualLoginLink) {
        tvManualLoginLink.setAttribute('href', '#');
        tvManualLoginLink.setAttribute('aria-disabled', 'true');
    }

    const tvGuideModal = el('tvGuideModal');
    if (tvGuideModal) {
        tvGuideModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeTvGuide === '1') closeTvGuideModal();
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

    const rawEditorModal = el('cookieRawEditorModal');
    if (rawEditorModal) {
        rawEditorModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset.closeRawEditor === '1') closeCookieRawEditor();
        });
    }

    const rawEditorCloseBtn = el('cookieRawEditorCloseBtn');
    if (rawEditorCloseBtn) rawEditorCloseBtn.addEventListener('click', closeCookieRawEditor);

    const rawEditorSaveBtn = el('cookieRawEditorSaveBtn');
    if (rawEditorSaveBtn) rawEditorSaveBtn.addEventListener('click', saveCookieRawEditor);

    const rawEditorCopyBtn = el('cookieRawEditorCopyBtn');
    if (rawEditorCopyBtn) {
        rawEditorCopyBtn.addEventListener('click', async () => {
            const textarea = el('cookieRawEditorTextarea');
            if (!textarea) return;
            try {
                await navigator.clipboard.writeText(String(textarea.value || ''));
                toast('Da copy cookie raw.', 'ok');
            } catch (error) {
                toast('Khong copy duoc. Hay copy thu cong.', 'warn');
            }
        });
    }

    const rawEditorTextarea = el('cookieRawEditorTextarea');
    if (rawEditorTextarea) {
        rawEditorTextarea.addEventListener('input', updateRawEditorMeta);
        rawEditorTextarea.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && rawEditorMode === 'edit') {
                event.preventDefault();
                saveCookieRawEditor();
            }
        });
    }

    const adminLoginBtn = el('adminLoginBtn');
    if (adminLoginBtn) adminLoginBtn.addEventListener('click', onAdminLogin);

    const adminLogoutBtn = el('adminLogoutBtn');
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                toast('Đã đăng xuất.', 'ok');
            } catch (error) {
                toast(error.message || 'Đăng xuất thất bại.', 'bad');
            }
        });
    }

    const adminOpenTestBtn = el('adminOpenTestBtn');
    if (adminOpenTestBtn) {
        adminOpenTestBtn.addEventListener('click', () => {
            const testUrl = '/nf/nf-cookie-to-link.html';
            const opened = window.open(testUrl, '_blank', 'noopener');
            if (!opened || opened.closed) {
                window.location.href = testUrl;
            }
        });
    }

    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    const customerForm = el('customerForm');
    if (customerForm) customerForm.addEventListener('submit', onSubmitCustomerForm);

    const applyWarrantyDaysBtn = el('applyWarrantyDaysBtn');
    if (applyWarrantyDaysBtn) applyWarrantyDaysBtn.addEventListener('click', applyWarrantyDaysQuick);

    const customerWarrantyDaysInput = el('customerWarrantyDaysInput');
    if (customerWarrantyDaysInput) {
        customerWarrantyDaysInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            applyWarrantyDaysQuick();
        });
    }

    const customerCodeEditInput = el('customerCodeEditInput');
    if (customerCodeEditInput) {
        customerCodeEditInput.addEventListener('input', () => {
            const normalized = normalizeCode(customerCodeEditInput.value || '');
            if (normalized !== customerCodeEditInput.value) customerCodeEditInput.value = normalized;
        });
    }

    const cancelEdit = el('cancelEditCustomerBtn');
    if (cancelEdit) cancelEdit.addEventListener('click', clearCustomerForm);

    const customersBody = el('customersTableBody');
    if (customersBody) {
        customersBody.addEventListener('click', handleCustomerTableAction);
        customersBody.addEventListener('contextmenu', onRowTableContextMenu);
        customersBody.addEventListener('pointerdown', onRowPointerDown);
        customersBody.addEventListener('pointerup', onRowPointerUpOrCancel);
        customersBody.addEventListener('pointercancel', onRowPointerUpOrCancel);
    }

    const cookiesBody = el('cookiesTableBody');
    if (cookiesBody) {
        cookiesBody.addEventListener('click', handleCookieTableAction);
        cookiesBody.addEventListener('change', handleCookieTableChange);
        cookiesBody.addEventListener('keydown', handleCookieTableKeydown);
        cookiesBody.addEventListener('contextmenu', onRowTableContextMenu);
        cookiesBody.addEventListener('pointerdown', onRowPointerDown);
        cookiesBody.addEventListener('pointerup', onRowPointerUpOrCancel);
        cookiesBody.addEventListener('pointercancel', onRowPointerUpOrCancel);
    }

    const rowActionMenu = el('rowActionMenu');
    if (rowActionMenu) {
        rowActionMenu.addEventListener('click', onRowActionMenuClick);
    }

    const cookiesSelectAll = el('cookiesSelectAll');
    if (cookiesSelectAll) cookiesSelectAll.addEventListener('change', handleSelectAllCookies);

    const cookieBulkBar = el('cookieBulkBar');
    if (cookieBulkBar) cookieBulkBar.addEventListener('click', handleCookieBulkAction);

    const checkAllCookiesBtn = el('checkAllCookiesBtn');
    if (checkAllCookiesBtn) {
        checkAllCookiesBtn.addEventListener('click', () => runCookieCheck('all', checkAllCookiesBtn));
    }

    const toggleSelectAllCookiesBtn = el('toggleSelectAllCookiesBtn');
    if (toggleSelectAllCookiesBtn) toggleSelectAllCookiesBtn.addEventListener('click', toggleSelectAllCookies);

    const cookieHeaderFilterResetBtn = el('cookieHeaderFilterResetBtn');
    if (cookieHeaderFilterResetBtn) {
        cookieHeaderFilterResetBtn.addEventListener('click', () => {
            resetCookieFilters();
            resetCustomerFilters();
            renderCustomersTable();
            renderCookiesTable();
        });
    }

    const toggleCookieImportBtn = el('toggleCookieImportBtn');
    if (toggleCookieImportBtn) {
        toggleCookieImportBtn.addEventListener('click', () => {
            const collapse = el('cookieImportCollapse');
            if (!collapse) return;
            const willOpen = collapse.classList.contains('hidden');
            collapse.classList.toggle('hidden', !willOpen);
            toggleCookieImportBtn.textContent = willOpen ? 'Đóng import cookie tổng' : 'Import cookie tổng';
        });
    }

    const headerFilterButtons = Array.from(document.querySelectorAll('[data-table-filter-btn]'));
    headerFilterButtons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const descriptor = String(btn.dataset.tableFilterBtn || '');
            const [table, column] = descriptor.split(':');
            if (!table || !column) return;
            openHeaderFilterPopup(btn, table, column);
        });
    });

    const tableHeaderFilterApplyBtn = el('tableHeaderFilterApplyBtn');
    if (tableHeaderFilterApplyBtn) tableHeaderFilterApplyBtn.addEventListener('click', applyHeaderFilterPopup);

    const tableHeaderFilterSearch = el('tableHeaderFilterSearch');
    if (tableHeaderFilterSearch) {
        tableHeaderFilterSearch.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            applyHeaderFilterPopup();
        });
    }

    const tableHeaderFilterClearBtn = el('tableHeaderFilterClearBtn');
    if (tableHeaderFilterClearBtn) tableHeaderFilterClearBtn.addEventListener('click', clearHeaderFilterColumn);

    const tableHeaderSortAscBtn = el('tableHeaderSortAscBtn');
    if (tableHeaderSortAscBtn) tableHeaderSortAscBtn.addEventListener('click', () => setHeaderSort('asc'));

    const tableHeaderSortDescBtn = el('tableHeaderSortDescBtn');
    if (tableHeaderSortDescBtn) tableHeaderSortDescBtn.addEventListener('click', () => setHeaderSort('desc'));

    const tableHeaderFilterPopup = el('tableHeaderFilterPopup');
    if (tableHeaderFilterPopup) {
        tableHeaderFilterPopup.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    const tagPickerModal = el('tagPickerModal');
    if (tagPickerModal) {
        tagPickerModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeTagPicker === '1') {
                closeTagPickerModal();
                return;
            }
            const tagKey = String(target.dataset.tagPickerKey || '').trim();
            if (!tagKey || !tagPickerContext) return;
            const action = mapTagAction(tagKey, tagPickerContext.mode);
            if (!action) return;
            const button = target instanceof HTMLButtonElement ? target : null;
            applyCookieAction(action, tagPickerContext.ids, button, { busyLabel: 'Dang xu ly...' })
                .then((ok) => {
                    if (ok) closeTagPickerModal();
                });
        });
    }

    const tagPickerCloseBtn = el('tagPickerCloseBtn');
    if (tagPickerCloseBtn) tagPickerCloseBtn.addEventListener('click', closeTagPickerModal);

    document.addEventListener('click', () => {
        closeHeaderFilterPopup();
        closeRowActionMenu();
    });

    window.addEventListener('scroll', closeRowActionMenu, true);
    window.addEventListener('resize', closeRowActionMenu);
    window.addEventListener('pointerup', clearRowLongPressTimer);
    window.addEventListener('pointercancel', clearRowLongPressTimer);

    const importBtn = el('importCookiesBtn');
    if (importBtn) importBtn.addEventListener('click', importCookies);

    const fileInput = el('cookieImportFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', async (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) return;
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                if (isExcelFile(file)) {
                    const cookies = await readExcelCookiesFromColumnA(file);
                    const addedCount = appendCookieBlocks(cookies);
                    if (addedCount <= 0) {
                        throw new Error('Khong tim thay cookie hop le o cot A cua file Excel.');
                    }
                    toast(`Da nap ${addedCount} cookie tu file Excel.`, 'ok');
                    return;
                }

                const text = await file.text();
                const current = String(el('cookieImportInput').value || '').trim();
                el('cookieImportInput').value = current ? `${current}\n${text}` : text;
                toast('Da nap noi dung file cookie.', 'ok');
            } catch (error) {
                toast(error.message || 'Khong doc duoc file.', 'bad');
            } finally {
                input.value = '';
            }
        });
    }

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (headerFilterPopupContext) {
            closeHeaderFilterPopup();
            return;
        }
        if (rowActionMenuContext) {
            closeRowActionMenu();
            return;
        }
        const tagModal = el('tagPickerModal');
        if (tagModal && !tagModal.classList.contains('hidden')) {
            closeTagPickerModal();
            return;
        }
        const deviceConfirmModal = el('deviceConfirmModal');
        if (deviceConfirmModal && !deviceConfirmModal.classList.contains('hidden')) {
            closeDeviceConfirmModal();
            return;
        }
        const guideModal = el('tvGuideModal');
        if (guideModal && !guideModal.classList.contains('hidden')) {
            closeTvGuideModal();
            return;
        }
        const tvModal = el('tvCodeModal');
        if (tvModal && !tvModal.classList.contains('hidden')) {
            closeTvCodeModal();
            return;
        }
        const phoneModal = el('mobileLinkModal');
        if (phoneModal && !phoneModal.classList.contains('hidden')) {
            closeMobileLinkModal();
            return;
        }
        const helpModal = el('supportModal');
        if (helpModal && !helpModal.classList.contains('hidden')) {
            closeSupportModal();
            return;
        }
        const renewModal = el('renewModal');
        if (renewModal && !renewModal.classList.contains('hidden')) {
            closeRenewModal();
            return;
        }
        const rawModal = el('cookieRawEditorModal');
        if (rawModal && !rawModal.classList.contains('hidden')) {
            closeCookieRawEditor();
            return;
        }
        closeAdminModal();
    });
}

function bootstrap() {
    bindEvents();
    resetCookieFilters();
    resetCustomerFilters();
    setTab(activeTab);
    resetLookupResult();
    setLookupState('Vui lòng nhập mã khách hàng.', 'idle');
    setCookieCheckState('Chua check cookie.', 'idle');
    updateCookieSelectionUi();
    renderCustomersPager();
    renderCookiesPager();
    applyRuntimeGuard();

    onAuthStateChanged(auth, (user) => {
        renderAdminState(user);
    });
}

bootstrap();







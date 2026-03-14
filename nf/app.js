import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const ADMIN_EMAIL = 'cungbocap306@gmail.com';

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

function el(id) {
    return document.getElementById(id);
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
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
    state.textContent = text || '';
    setStateClass(state, mode);
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
    const total = Array.isArray(cookiesCache) ? cookiesCache.length : 0;
    const selectedCount = getSelectedCookieIds().length;
    const bulkBar = el('cookieBulkBar');
    const count = el('cookieSelectedCount');
    const selectAll = el('cookiesSelectAll');
    const toggleSelectAllBtn = el('toggleSelectAllCookiesBtn');

    if (count) count.textContent = String(selectedCount);
    if (bulkBar) bulkBar.classList.toggle('hidden', selectedCount === 0);
    if (selectAll) {
        selectAll.disabled = total === 0;
        selectAll.checked = total > 0 && selectedCount === total;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < total;
    }
    if (toggleSelectAllBtn) {
        toggleSelectAllBtn.disabled = total === 0;
        toggleSelectAllBtn.textContent = total > 0 && selectedCount === total ? 'Bo chon tat ca' : 'Chon tat ca';
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
}

function resetLookupResult() {
    currentLookupCode = '';
    currentLookupEligible = false;
    setDeviceButtonsEnabled(false);
    setDeviceSectionVisible(false);
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
    setDeviceSectionVisible(currentLookupEligible);
    setDeviceButtonsEnabled(currentLookupEligible);

    if (currentLookupEligible) {
        setLookupState('hãy chọn thiết bị bạn đang dùng để tiến hành sử dụng netflix', 'success');
        return;
    } else {
        setLookupState(payload.message || 'Mã chưa đủ điều kiện sử dụng.', 'warning');
    }
}

async function lookupCustomerCode() {
    if (runtimeBlocked) return;
    const input = el('customerCodeInput');
    const code = normalizeCode(input && input.value);
    if (!code) {
        resetLookupResult();
        setLookupState('Vui lòng nhập mã khách hàng.', 'warning');
        return;
    }

    const lookupBtn = el('lookupBtn');
    setButtonBusy(lookupBtn, true, 'Đang kiểm tra...');
    setLookupState('Đang kiểm tra mã khách hàng...', 'loading');

    try {
        const data = await apiRequest('/api/nf-customer-lookup', 'POST', { customerCode: code });
        renderLookupResult(data);
    } catch (error) {
        resetLookupResult();
        setLookupState(error.message || 'Không kiểm tra được mã.', 'error');
    } finally {
        setButtonBusy(lookupBtn, false);
    }
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
        tbody.innerHTML = '<tr><td colspan="6" data-label="Trang thai">Chua co khach hang. Tao ma moi de bat dau.</td></tr>';
        return;
    }

    tbody.innerHTML = customersCache.map((customer) => `
        <tr>
            <td data-label="Ma" class="mono">${customer.code || '-'}</td>
            <td data-label="Ten">${customer.name || '-'}</td>
            <td data-label="Bao hanh">${formatWarrantyCell(customer)}</td>
            <td data-label="Cookie" class="mono">${customer.assignedCookieId || '-'}</td>
            <td data-label="Trang thai"><span class="${getStatusPillClass(customer.status)}">${customer.status || 'active'}</span></td>
            <td data-label="Hanh dong">
                <div class="row-actions">
                    <button class="btn-tiny" data-customer-act="edit" data-code="${customer.code}">Sua</button>
                    <button class="btn-tiny" data-customer-act="toggle" data-code="${customer.code}">${customer.status === 'inactive' ? 'Kich hoat' : 'Khoa'}</button>
                    <button class="btn-tiny" data-customer-act="delete" data-code="${customer.code}">Xoa</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderCookiesSummary() {
    const summary = el('cookieSummary');
    if (!summary) return;
    if (!cookiesSummary) {
        summary.textContent = '';
        return;
    }
    summary.textContent = `Tong: ${cookiesSummary.total || 0} | Active: ${cookiesSummary.activeCount || 0} | Disabled: ${cookiesSummary.disabledCount || 0} | Dead: ${cookiesSummary.deadCount || 0} | Dang gan: ${cookiesSummary.assignedCount || 0}`;
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

    tbody.innerHTML = cookiesCache.map((cookie) => {
        const assignText = cookie.assignedCustomerCode || '-';
        const lastCheck = formatDateTime(cookie.lastCheckedAt || cookie.updatedAt);
        const errorLine = cookie.lastError ? `<div class="bad" style="margin-top:4px">${cookie.lastError}</div>` : '';
        const checked = selectedCookieIds.has(cookie.id) ? 'checked' : '';
        return `
            <tr>
                <td data-label="Chon" class="check-cell">
                    <input class="row-check cookie-row-check" type="checkbox" data-cookie-select="${cookie.id}" ${checked}>
                </td>
                <td data-label="Cookie" class="mono">${cookie.netflixIdMasked || '-'}<br><span class="state-idle">${cookie.id || '-'}</span></td>
                <td data-label="Trang thai"><span class="${getStatusPillClass(cookie.status)}">${cookie.status || 'active'}</span></td>
                <td data-label="Gan khach" class="mono">${assignText}</td>
                <td data-label="Check">${lastCheck}${errorLine}</td>
                <td data-label="Hanh dong">
                    <div class="row-actions">
                        <button class="btn-tiny" data-cookie-act="active" data-id="${cookie.id}">Active</button>
                        <button class="btn-tiny" data-cookie-act="disabled" data-id="${cookie.id}">Disabled</button>
                        <button class="btn-tiny" data-cookie-act="dead" data-id="${cookie.id}">Dead</button>
                        <button class="btn-tiny" data-cookie-act="unassign" data-id="${cookie.id}">Bo gan</button>
                        <button class="btn-tiny" data-cookie-act="delete" data-id="${cookie.id}">Xoa</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    updateCookieSelectionUi();
}

async function loadCustomers() {
    const data = await apiRequest('/api/nf-customers', 'GET');
    customersCache = Array.isArray(data.customers) ? data.customers : [];
    renderCustomersTable();
}

async function loadCookies() {
    const data = await apiRequest('/api/nf-cookies', 'GET');
    cookiesCache = Array.isArray(data.cookies) ? data.cookies : [];
    cookiesSummary = data;
    syncCookieSelection();
    renderCookiesSummary();
    renderCookiesTable();
}

async function loadAdminData() {
    try {
        await Promise.all([loadCustomers(), loadCookies()]);
    } catch (error) {
        toast(error.message || 'Khong tai duoc du lieu admin.', 'bad');
    }
}

function clearCustomerForm() {
    el('customerNameInput').value = '';
    el('customerWarrantyInput').value = '';
    el('customerEditCodeInput').value = '';
    el('cancelEditCustomerBtn').classList.add('hidden');
    const saveBtn = el('saveCustomerBtn');
    if (saveBtn) saveBtn.textContent = 'Luu khach hang';
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
        fab.title = isAdmin ? 'Tài khoản admin đã đăng nhập' : 'Đăng nhập tài khoản';
        fab.setAttribute('aria-label', isAdmin ? 'Tài khoản admin đã đăng nhập' : 'Đăng nhập tài khoản');
    }
    if (identity) identity.textContent = isAdmin ? `Đăng nhập: ${user.email}` : 'Chưa đăng nhập admin';
    if (authBox) authBox.classList.toggle('hidden', isAdmin);
    if (workspace) workspace.classList.toggle('hidden', !isAdmin);
    if (authState) {
        authState.textContent = isAdmin ? 'Da xac thuc admin.' : 'Chua dang nhap.';
        setStateClass(authState, isAdmin ? 'success' : 'idle');
    }

    if (isAdmin) loadAdminData();
}

async function onSubmitCustomerForm(event) {
    event.preventDefault();
    const name = String(el('customerNameInput').value || '').trim();
    const warrantyLocal = String(el('customerWarrantyInput').value || '').trim();
    const editCode = normalizeCode(el('customerEditCodeInput').value || '');
    const warrantyIso = toIsoFromDatetimeLocal(warrantyLocal);
    if (!name || !warrantyIso) {
        toast('Vui long nhap ten va thoi gian bao hanh.', 'warn');
        return;
    }

    const saveBtn = el('saveCustomerBtn');
    setButtonBusy(saveBtn, true, editCode ? 'Dang cap nhat...' : 'Dang tao...');

    try {
        if (editCode) {
            const found = customersCache.find((item) => item.code === editCode);
            await apiRequest('/api/nf-customers', 'PUT', {
                code: editCode,
                name,
                warrantyExpiresAt: warrantyIso,
                status: found && found.status ? found.status : 'active'
            });
            toast('Da cap nhat khach hang.', 'ok');
        } else {
            await apiRequest('/api/nf-customers', 'POST', { name, warrantyExpiresAt: warrantyIso });
            toast('Da tao ma khach hang moi.', 'ok');
        }
        clearCustomerForm();
        await loadCustomers();
    } catch (error) {
        toast(error.message || 'Luu khach hang that bai.', 'bad');
    } finally {
        setButtonBusy(saveBtn, false);
    }
}

async function handleCustomerTableAction(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.customerAct;
    const code = normalizeCode(target.dataset.code || '');
    if (!action || !code) return;

    const customer = customersCache.find((item) => item.code === code);
    if (!customer) return;

    try {
        if (action === 'edit') {
            el('customerNameInput').value = customer.name || '';
            el('customerWarrantyInput').value = toDatetimeLocalFromIso(customer.warrantyExpiresAt);
            el('customerEditCodeInput').value = customer.code || '';
            el('cancelEditCustomerBtn').classList.remove('hidden');
            const saveBtn = el('saveCustomerBtn');
            if (saveBtn) saveBtn.textContent = `Cap nhat ${customer.code}`;
            return;
        }

        if (action === 'toggle') {
            await apiRequest('/api/nf-customers', 'PUT', {
                code,
                name: customer.name,
                warrantyExpiresAt: customer.warrantyExpiresAt,
                status: customer.status === 'inactive' ? 'active' : 'inactive'
            });
            toast('Da cap nhat trang thai.', 'ok');
            await loadCustomers();
            return;
        }

        if (action === 'delete') {
            const ok = window.confirm(`Xoa ma khach ${code}?`);
            if (!ok) return;
            await apiRequest('/api/nf-customers', 'DELETE', { code });
            toast('Da xoa khach hang.', 'ok');
            await Promise.all([loadCustomers(), loadCookies()]);
        }
    } catch (error) {
        toast(error.message || 'Thao tac khach hang that bai.', 'bad');
    }
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

function summarizeCheckResult(data = {}) {
    return `Check ${data.totalChecked || 0} | LIVE ${data.liveCount || 0} | DIE ${data.deadCount || 0} | SBD ${data.sbdCount || 0} | Loi ${data.errorCount || 0}`;
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
        await Promise.all([loadCookies(), loadCustomers()]);
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

    if (action === 'delete') {
        const ok = window.confirm(`Xoa ${cookieIds.length} cookie da chon?`);
        if (!ok) return;
    }

    setButtonBusy(triggerButton, true, 'Dang xu ly...');
    try {
        if (action === 'unassign') {
            const data = await apiRequest('/api/nf-cookies', 'PUT', { cookieIds, unassign: true });
            toast(`Da bo gan ${data.affectedCount || cookieIds.length} cookie.`, 'ok');
        } else if (action === 'delete') {
            const data = await apiRequest('/api/nf-cookies', 'DELETE', { cookieIds });
            toast(`Da xoa ${data.affectedCount || cookieIds.length} cookie.`, 'ok');
        } else if (action === 'active' || action === 'disabled' || action === 'dead') {
            const data = await apiRequest('/api/nf-cookies', 'PUT', { cookieIds, status: action });
            toast(`Da cap nhat ${data.affectedCount || cookieIds.length} cookie.`, 'ok');
        } else {
            return;
        }
        await Promise.all([loadCookies(), loadCustomers()]);
    } catch (error) {
        toast(error.message || 'Thao tac hang loat that bai.', 'bad');
    } finally {
        setButtonBusy(triggerButton, false);
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
    if (target.checked) {
        selectedCookieIds = new Set((cookiesCache || []).map((item) => item.id));
    } else {
        selectedCookieIds = new Set();
    }
    renderCookiesTable();
}

function toggleSelectAllCookies() {
    const total = Array.isArray(cookiesCache) ? cookiesCache.length : 0;
    if (total === 0) return;
    const selectedCount = getSelectedCookieIds().length;
    if (selectedCount === total) {
        selectedCookieIds = new Set();
    } else {
        selectedCookieIds = new Set((cookiesCache || []).map((item) => item.id));
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
    const action = target.dataset.cookieAct;
    const cookieId = String(target.dataset.id || '').trim();
    if (!action || !cookieId) return;

    try {
        if (action === 'delete') {
            const ok = window.confirm('Xoa cookie nay khoi danh sach?');
            if (!ok) return;
            await apiRequest('/api/nf-cookies', 'DELETE', { cookieId });
            toast('Da xoa cookie.', 'ok');
            await Promise.all([loadCookies(), loadCustomers()]);
            return;
        }

        if (action === 'unassign') {
            await apiRequest('/api/nf-cookies', 'PUT', { cookieId, unassign: true });
            toast('Da bo gan cookie.', 'ok');
            await Promise.all([loadCookies(), loadCustomers()]);
            return;
        }

        if (action === 'active' || action === 'disabled' || action === 'dead') {
            await apiRequest('/api/nf-cookies', 'PUT', { cookieId, status: action });
            toast(`Da doi trang thai thanh ${action}.`, 'ok');
            await Promise.all([loadCookies(), loadCustomers()]);
        }
    } catch (error) {
        toast(error.message || 'Cap nhat cookie that bai.', 'bad');
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
    if (lookupBtn) lookupBtn.addEventListener('click', lookupCustomerCode);

    const codeInput = el('customerCodeInput');
    if (codeInput) {
        codeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                lookupCustomerCode();
            }
        });
    }

    const deviceButtons = Array.from(document.querySelectorAll('.btn-device'));
    deviceButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const device = String(btn.dataset.device || 'desktop');
            generateDeviceLink(device);
        });
    });

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

    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    const customerForm = el('customerForm');
    if (customerForm) customerForm.addEventListener('submit', onSubmitCustomerForm);

    const cancelEdit = el('cancelEditCustomerBtn');
    if (cancelEdit) cancelEdit.addEventListener('click', clearCustomerForm);

    const customersBody = el('customersTableBody');
    if (customersBody) customersBody.addEventListener('click', handleCustomerTableAction);

    const cookiesBody = el('cookiesTableBody');
    if (cookiesBody) {
        cookiesBody.addEventListener('click', handleCookieTableAction);
        cookiesBody.addEventListener('change', handleCookieTableChange);
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
        if (event.key === 'Escape') closeAdminModal();
    });
}

function bootstrap() {
    bindEvents();
    setTab(activeTab);
    resetLookupResult();
    setLookupState('Vui lòng nhập mã khách hàng.', 'idle');
    setCookieCheckState('Chua check cookie.', 'idle');
    updateCookieSelectionUi();
    applyRuntimeGuard();

    onAuthStateChanged(auth, (user) => {
        renderAdminState(user);
    });
}

bootstrap();

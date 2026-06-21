const https = require('https');
const { sanitizeCookieRaw } = require('./_getlink-share-store');
const { evaluateGetlinkCookie } = require('./_getlink-cookie-health');

const GETLINK_SHEET_APPS_SCRIPT_URL = String(process.env.GETLINK_SHEET_APPS_SCRIPT_URL || '').trim();
const GETLINK_SHEET_FETCH_LIMIT = Math.max(20, Math.min(5000, Number(process.env.GETLINK_SHEET_FETCH_LIMIT || 5000) || 5000));
const GETLINK_SHEET_BATCH_SIZE = Math.max(20, Math.min(500, Number(process.env.GETLINK_SHEET_BATCH_SIZE || 100) || 100));
const GETLINK_SHEET_CANDIDATE_BATCH = Math.max(1, Math.min(20, Number(process.env.GETLINK_SHEET_CANDIDATE_BATCH || 3) || 3));
const GETLINK_SHEET_CHECK_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.GETLINK_SHEET_CHECK_CONCURRENCY || 3) || 3));
const GETLINK_SHEET_HTTP_TIMEOUT_MS = Math.max(5000, Math.min(240000, Number(process.env.GETLINK_SHEET_HTTP_TIMEOUT_MS || 200000) || 200000));
const GETLINK_COOKIE_CHECK_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(process.env.GETLINK_COOKIE_CHECK_TIMEOUT_MS || 25000) || 25000));
const ALLOWED_SHEET_SLOTS = new Set(['primary', 'backup1', 'backup2']);
const MAX_APPS_SCRIPT_REDIRECTS = 5;
const MAX_SHEET_DEBUG_SAMPLES = 8;

function withTimeout(promise, timeoutMs, message) {
    const safeTimeout = Math.max(1, Number(timeoutMs || 0) || 1);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new Error(String(message || 'Request timed out').trim() || 'Request timed out');
            error.httpStatus = 504;
            reject(error);
        }, safeTimeout);

        Promise.resolve(promise)
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function buildAppsScriptInvalidResponseError(statusCode = 0, responseBody = '', contentType = '') {
    const bodyText = String(responseBody || '').trim();
    const typeText = String(contentType || '').trim().toLowerCase();
    const isHtml = typeText.includes('text/html') || /^<!doctype html/i.test(bodyText) || /^<html/i.test(bodyText);
    let message = 'Apps Script tra ve du lieu khong hop le.';

    if (statusCode === 404) {
        message = 'Apps Script URL khong hop le hoac ban chua deploy dung Web App /exec.';
    } else if (statusCode === 401 || statusCode === 403) {
        message = 'Apps Script bi chan quyen. Hay deploy Web App voi quyen truy cap phu hop.';
    } else if (isHtml) {
        message = 'Apps Script dang tra ve HTML thay vi JSON. Hay kiem tra lai URL /exec va deploy Web App.';
    }

    const error = new Error(message);
    error.httpStatus = 502;
    return error;
}

function parseAppsScriptJsonResponse(statusCode = 0, responseBody = '', contentType = '') {
    try {
        return JSON.parse(String(responseBody || '{}'));
    } catch (error) {
        throw buildAppsScriptInvalidResponseError(statusCode, responseBody, contentType);
    }
}

function getJsonFromAbsoluteUrl(rawUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(String(rawUrl || '').trim());
        } catch (error) {
            reject(new Error('GETLINK_SHEET_APPS_SCRIPT_URL is invalid.'));
            return;
        }

        const req = https.request({
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
            method: 'GET'
        }, (res) => {
            const statusCode = Number(res.statusCode || 0);
            const location = String(res.headers.location || '').trim();
            const contentType = String(res.headers['content-type'] || '').trim();

            if (statusCode >= 300 && statusCode < 400 && location) {
                if (redirectCount >= MAX_APPS_SCRIPT_REDIRECTS) {
                    const err = new Error('Apps Script redirect qua nhieu lan.');
                    err.httpStatus = 502;
                    reject(err);
                    return;
                }

                const nextUrl = new URL(location, parsedUrl).toString();
                res.resume();
                getJsonFromAbsoluteUrl(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (statusCode < 200 || statusCode >= 300) {
                    let parsed = null;
                    try {
                        parsed = parseAppsScriptJsonResponse(statusCode, data, contentType);
                    } catch (invalidError) {
                        reject(invalidError);
                        return;
                    }

                    const err = new Error(String(parsed && parsed.error ? parsed.error : 'Apps Script request failed.').trim() || 'Apps Script request failed.');
                    err.httpStatus = 502;
                    reject(err);
                    return;
                }

                let parsed = null;
                try {
                    parsed = parseAppsScriptJsonResponse(statusCode, data, contentType);
                } catch (invalidError) {
                    reject(invalidError);
                    return;
                }

                resolve(parsed);
            });
        });

        req.setTimeout(GETLINK_SHEET_HTTP_TIMEOUT_MS, () => {
            req.destroy(new Error(`Apps Script timeout sau ${GETLINK_SHEET_HTTP_TIMEOUT_MS}ms.`));
        });
        req.on('error', (error) => {
            const message = error && error.message ? error.message : 'Unknown error';
            const err = new Error(`Khong ket noi duoc Apps Script: ${message}`);
            err.httpStatus = /timeout/i.test(message) ? 504 : 502;
            reject(err);
        });
        req.end();
    });
}

function normalizeSheetSlots(input) {
    const source = Array.isArray(input) ? input : [];
    const seen = new Set();
    const slots = [];
    source.forEach((item) => {
        const normalized = String(item || '').trim().toLowerCase();
        if (!ALLOWED_SHEET_SLOTS.has(normalized) || seen.has(normalized)) return;
        seen.add(normalized);
        slots.push(normalized);
    });
    return slots;
}

function normalizeSheetRow(item = {}) {
    const rowNumber = Number(item && item.rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) return null;
    return {
        rowNumber,
        cookie: sanitizeCookieRaw(item && item.cookie ? item.cookie : ''),
        mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim()
    };
}

function cloneSheetRow(item = {}) {
    return normalizeSheetRow(item) || null;
}

function isSheetRowEligible(mark = '') {
    const text = String(mark || '').trim();
    return !text;
}

function mapSheetFailReason(reason = '') {
    const normalized = String(reason || '').trim().toLowerCase();
    if (!normalized) return 'token_error';
    if (normalized === 'sbd_blocked') return 'sbd';
    if (normalized === 'missing_account_info') return 'missing_info';
    if (normalized === 'invalid_cookie') return 'invalid_cookie';
    if (normalized === 'dead') return 'dead';
    if (normalized === 'payment_hold') return 'payment_hold';
    if (normalized === 'unknown_plan') return 'unknown_plan';
    return 'token_error';
}

function getNextSheetUsageMark(mark = '') {
    const current = String(mark || '').trim();
    const count = /^\d+$/.test(current) ? Number(current) : 0;
    return String(count + 1);
}

async function callGetlinkSheetScript(action, payload = {}) {
    if (!GETLINK_SHEET_APPS_SCRIPT_URL) {
        const error = new Error('Chua cau hinh GETLINK_SHEET_APPS_SCRIPT_URL tren server.');
        error.httpStatus = 500;
        throw error;
    }

    const url = new URL(GETLINK_SHEET_APPS_SCRIPT_URL);
    url.searchParams.set('action', String(action || '').trim());
    Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
    });

    const response = await withTimeout(
        getJsonFromAbsoluteUrl(url.toString()),
        GETLINK_SHEET_HTTP_TIMEOUT_MS,
        `Apps Script timeout sau ${GETLINK_SHEET_HTTP_TIMEOUT_MS}ms.`
    );
    if (response && response.success === false) {
        const error = new Error(String(response.error || response.message || 'Apps Script request failed.').trim() || 'Apps Script request failed.');
        error.httpStatus = 502;
        throw error;
    }
    return response && typeof response === 'object' ? response : {};
}

async function listGetlinkSheetRows(options = {}) {
    const startRow = Math.max(1, Number(options.startRow || 1) || 1);
    const limit = Math.max(1, Math.min(GETLINK_SHEET_BATCH_SIZE, Number(options.limit || GETLINK_SHEET_CANDIDATE_BATCH) || GETLINK_SHEET_CANDIDATE_BATCH));
    const response = await callGetlinkSheetScript('pullRows', { startRow, limit });
    const rows = Array.isArray(response.items) ? response.items.map(normalizeSheetRow).filter(Boolean) : [];
    rows.sort((a, b) => a.rowNumber - b.rowNumber);
    const nextStartRow = Math.max(startRow, Number(response.nextStartRow || (rows.length > 0 ? rows[rows.length - 1].rowNumber + 1 : startRow)) || startRow);
    const scannedUntilRow = Math.max(startRow - 1, Number(response.scannedUntilRow || (rows.length > 0 ? rows[rows.length - 1].rowNumber : startRow - 1)) || (startRow - 1));
    const hasMore = response && response.hasMore !== undefined
        ? Boolean(response.hasMore)
        : scannedUntilRow >= startRow && nextStartRow > scannedUntilRow;
    return {
        rows,
        nextStartRow,
        scannedUntilRow,
        hasMore
    };
}

async function updateGetlinkSheetRows(updates = []) {
    const normalized = Array.isArray(updates)
        ? updates
            .map((item) => ({
                rowNumber: Number(item && item.rowNumber),
                mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim()
            }))
            .filter((item) => Number.isInteger(item.rowNumber) && item.rowNumber > 0)
        : [];

    if (normalized.length === 0) return;

    await callGetlinkSheetScript('updateRows', {
        updates: JSON.stringify(normalized)
    });
}

function normalizeTimings(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        sheetFetchMs: Math.max(0, Number(source.sheetFetchMs || 0) || 0),
        cookieCheckMs: Math.max(0, Number(source.cookieCheckMs || 0) || 0),
        sheetUpdateMs: Math.max(0, Number(source.sheetUpdateMs || 0) || 0),
        shareUpdateMs: Math.max(0, Number(source.shareUpdateMs || 0) || 0),
        totalMs: Math.max(0, Number(source.totalMs || 0) || 0)
    };
}

function normalizeSheetImportDebug(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const samples = Array.isArray(source.debugSamples)
        ? source.debugSamples
            .map((item) => ({
                rowNumber: Number(item && item.rowNumber),
                hasCookie: !!(item && item.hasCookie),
                mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim(),
                reason: String(item && item.reason ? item.reason : '').trim()
            }))
            .filter((item) => Number.isInteger(item.rowNumber) && item.rowNumber > 0 && item.reason)
            .slice(0, MAX_SHEET_DEBUG_SAMPLES)
        : [];

    return {
        fetchCalls: Math.max(0, Number(source.fetchCalls || 0) || 0),
        lastFetchStartRow: Math.max(0, Number(source.lastFetchStartRow || 0) || 0),
        lastScannedUntilRow: Math.max(0, Number(source.lastScannedUntilRow || 0) || 0),
        visibleRowsSeen: Math.max(0, Number(source.visibleRowsSeen || 0) || 0),
        eligibleRowsSeen: Math.max(0, Number(source.eligibleRowsSeen || 0) || 0),
        rejectedByMark: Math.max(0, Number(source.rejectedByMark || 0) || 0),
        rejectedByEmptyCookie: Math.max(0, Number(source.rejectedByEmptyCookie || 0) || 0),
        rejectedByDuplicate: Math.max(0, Number(source.rejectedByDuplicate || 0) || 0),
        emptyVisibleBatches: Math.max(0, Number(source.emptyVisibleBatches || 0) || 0),
        lastEmptyBatchStartRow: Math.max(0, Number(source.lastEmptyBatchStartRow || 0) || 0),
        lastEmptyBatchEndRow: Math.max(0, Number(source.lastEmptyBatchEndRow || 0) || 0),
        scanStoppedAtRow: Math.max(0, Number(source.scanStoppedAtRow || 0) || 0),
        scannedPhysicalRows: Math.max(0, Number(source.scannedPhysicalRows || 0) || 0),
        hasMoreAtLastFetch: source.hasMoreAtLastFetch !== undefined ? Boolean(source.hasMoreAtLastFetch) : true,
        debugSamples: samples
    };
}

function pushSheetDebugSample(debug = {}, row = {}, reason = '') {
    if (!debug || !Array.isArray(debug.debugSamples) || debug.debugSamples.length >= MAX_SHEET_DEBUG_SAMPLES) return;
    debug.debugSamples.push({
        rowNumber: Number(row && row.rowNumber),
        hasCookie: !!(row && row.cookie),
        mark: String(row && row.mark !== undefined && row.mark !== null ? row.mark : '').trim(),
        reason: String(reason || '').trim()
    });
}

function buildEmptyQueueDebugMessage(state = {}) {
    const debug = normalizeSheetImportDebug(state.debug);
    const stoppedAtRow = Math.max(debug.lastScannedUntilRow, debug.scanStoppedAtRow, 0);
    return `Da quet den row ${stoppedAtRow}. Visible ${debug.visibleRowsSeen}, eligible ${debug.eligibleRowsSeen}, reject mark ${debug.rejectedByMark}, empty cookie ${debug.rejectedByEmptyCookie}, duplicate ${debug.rejectedByDuplicate}.`;
}

function buildEmptyVisibleBatchMessage(state = {}) {
    const debug = normalizeSheetImportDebug(state.debug);
    const startRow = Math.max(0, Number(debug.lastEmptyBatchStartRow || debug.lastFetchStartRow || 0) || 0);
    const endRow = Math.max(startRow, Number(debug.lastEmptyBatchEndRow || debug.lastScannedUntilRow || startRow) || startRow);
    return `Block ${startRow}-${endRow} khong co visible row, dang quet tiep...`;
}

function createSheetImportState(slots = []) {
    const targetSlots = normalizeSheetSlots(slots);
    if (targetSlots.length === 0) {
        const error = new Error('Vui long chon it nhat 1 slot cookie.');
        error.httpStatus = 400;
        throw error;
    }

    return {
        targetSlots,
        assigned: [],
        skipped: [],
        seenCookies: [],
        queuedRows: [],
        nextStartRow: 1,
        scannedPhysicalRows: 0,
        hasMore: true,
        phase: 'pending',
        message: `Dang chuan bi quet Google Sheet cho ${targetSlots.length} cookie...`,
        timings: normalizeTimings(),
        debug: normalizeSheetImportDebug()
    };
}

function normalizeSheetImportState(input = {}, slotsFallback = []) {
    const source = input && typeof input === 'object' ? input : {};
    const targetSlots = normalizeSheetSlots(source.targetSlots && source.targetSlots.length ? source.targetSlots : slotsFallback);
    if (targetSlots.length === 0) {
        const error = new Error('Vui long chon it nhat 1 slot cookie.');
        error.httpStatus = 400;
        throw error;
    }

    return {
        targetSlots,
        assigned: Array.isArray(source.assigned) ? source.assigned.map((item) => ({
            slot: String(item && item.slot ? item.slot : '').trim(),
            rowNumber: Number(item && item.rowNumber),
            cookie: sanitizeCookieRaw(item && item.cookie ? item.cookie : ''),
            previousMark: String(item && item.previousMark ? item.previousMark : '').trim(),
            newMark: String(item && item.newMark ? item.newMark : '').trim(),
            result: item && typeof item.result === 'object' ? item.result : {}
        })).filter((item) => item.slot && Number.isInteger(item.rowNumber) && item.rowNumber > 0 && item.cookie) : [],
        skipped: Array.isArray(source.skipped) ? source.skipped.map((item) => ({
            rowNumber: Number(item && item.rowNumber),
            reason: String(item && item.reason ? item.reason : '').trim()
        })).filter((item) => Number.isInteger(item.rowNumber) && item.rowNumber > 0 && item.reason) : [],
        seenCookies: Array.isArray(source.seenCookies) ? Array.from(new Set(source.seenCookies.map((value) => sanitizeCookieRaw(value)).filter(Boolean))) : [],
        queuedRows: Array.isArray(source.queuedRows) ? source.queuedRows.map(cloneSheetRow).filter(Boolean) : [],
        nextStartRow: Math.max(1, Number(source.nextStartRow || 1) || 1),
        scannedPhysicalRows: Math.max(0, Number(source.scannedPhysicalRows || 0) || 0),
        hasMore: source.hasMore !== undefined ? Boolean(source.hasMore) : true,
        phase: String(source.phase || 'pending').trim() || 'pending',
        message: String(source.message || '').trim(),
        timings: normalizeTimings(source.timings),
        debug: normalizeSheetImportDebug({
            ...(source.debug && typeof source.debug === 'object' ? source.debug : {}),
            scannedPhysicalRows: source.debug && typeof source.debug === 'object' && source.debug.scannedPhysicalRows !== undefined
                ? source.debug.scannedPhysicalRows
                : source.scannedPhysicalRows
        })
    };
}

function getUnfilledSlots(state = {}) {
    const filled = new Set((Array.isArray(state.assigned) ? state.assigned : []).map((item) => item.slot));
    return (Array.isArray(state.targetSlots) ? state.targetSlots : []).filter((slot) => !filled.has(slot));
}

function buildSheetImportResult(state = {}) {
    const normalized = normalizeSheetImportState(state);
    const queueEmpty = normalized.queuedRows.length === 0;
    const scanFinished = (!normalized.hasMore || normalized.scannedPhysicalRows >= GETLINK_SHEET_FETCH_LIMIT) && queueEmpty;
    return {
        success: true,
        status: getUnfilledSlots(normalized).length === 0 || scanFinished
            ? 'completed'
            : 'pending',
        phase: normalized.phase || 'pending',
        message: normalized.message || '',
        assigned: normalized.assigned,
        skipped: normalized.skipped,
        unfilledSlots: getUnfilledSlots(normalized),
        timings: normalizeTimings(normalized.timings),
        debug: normalizeSheetImportDebug({
            ...(normalized.debug && typeof normalized.debug === 'object' ? normalized.debug : {}),
            scanStoppedAtRow: Math.max(
                Number(normalized.debug && normalized.debug.scanStoppedAtRow ? normalized.debug.scanStoppedAtRow : 0) || 0,
                Number(normalized.debug && normalized.debug.lastScannedUntilRow ? normalized.debug.lastScannedUntilRow : 0) || 0
            ),
            scannedPhysicalRows: normalized.scannedPhysicalRows,
            hasMoreAtLastFetch: normalized.hasMore
        })
    };
}

function completeSheetImportState(state = {}, message = '') {
    const next = normalizeSheetImportState(state);
    next.phase = 'completed';
    next.message = String(message || '').trim() || (next.assigned.length > 0
        ? `Da tim thay ${next.assigned.length}/${next.targetSlots.length} cookie PASS.`
        : 'Da quet xong Google Sheet.');
    next.hasMore = false;
    next.queuedRows = [];
    next.debug = normalizeSheetImportDebug({
        ...(next.debug && typeof next.debug === 'object' ? next.debug : {}),
        scanStoppedAtRow: Math.max(
            Number(next.debug && next.debug.scanStoppedAtRow ? next.debug.scanStoppedAtRow : 0) || 0,
            Number(next.debug && next.debug.lastScannedUntilRow ? next.debug.lastScannedUntilRow : 0) || 0
        ),
        scannedPhysicalRows: next.scannedPhysicalRows,
        hasMoreAtLastFetch: next.hasMore
    });
    return next;
}

async function runSheetImportChunk(stateInput = {}) {
    const state = normalizeSheetImportState(stateInput);
    const chunkStartedAt = Date.now();

    const finish = (nextState, message = '') => {
        const completedState = completeSheetImportState(nextState, message);
        completedState.timings.totalMs += Date.now() - chunkStartedAt;
        return completedState;
    };

    if (state.assigned.length >= state.targetSlots.length) {
        return finish(state, `Da tim thay du ${state.assigned.length}/${state.targetSlots.length} cookie PASS.`);
    }

    if (state.queuedRows.length === 0 && (!state.hasMore || state.scannedPhysicalRows >= GETLINK_SHEET_FETCH_LIMIT)) {
        return finish(state, state.assigned.length > 0
            ? `Da quet xong va tim thay ${state.assigned.length}/${state.targetSlots.length} cookie PASS.`
            : 'Da quet xong Google Sheet nhung khong tim thay cookie PASS nao.');
    }

    if (state.queuedRows.length === 0) {
        state.phase = 'pulling_sheet';
        state.message = `Dang quet Google Sheet tu dong ${state.nextStartRow}...`;
        const fetchStartRow = state.nextStartRow;
        const fetchStartedAt = Date.now();
        const batch = await listGetlinkSheetRows({
            startRow: fetchStartRow,
            limit: Math.max(GETLINK_SHEET_CANDIDATE_BATCH, state.targetSlots.length)
        });
        state.timings.sheetFetchMs += Date.now() - fetchStartedAt;
        state.debug.fetchCalls += 1;
        state.debug.lastFetchStartRow = fetchStartRow;
        state.debug.lastScannedUntilRow = Math.max(0, Number(batch.scannedUntilRow || 0) || 0);

        state.nextStartRow = Math.max(batch.nextStartRow, state.nextStartRow + 1);
        state.scannedPhysicalRows += Math.max(0, batch.scannedUntilRow - fetchStartRow + 1);
        state.hasMore = !!batch.hasMore;
        state.debug.scannedPhysicalRows = state.scannedPhysicalRows;
        state.debug.hasMoreAtLastFetch = state.hasMore;
        state.debug.scanStoppedAtRow = Math.max(state.debug.scanStoppedAtRow, state.debug.lastScannedUntilRow);

        if (batch.rows.length > 0) {
            const seenSet = new Set(state.seenCookies);
            const nextQueue = [];
            batch.rows.forEach((row) => {
                if (!row) return;
                state.debug.visibleRowsSeen += 1;
                if (!row.cookie) {
                    state.debug.rejectedByEmptyCookie += 1;
                    pushSheetDebugSample(state.debug, row, 'empty_cookie');
                    return;
                }
                if (!isSheetRowEligible(row.mark)) {
                    state.debug.rejectedByMark += 1;
                    pushSheetDebugSample(state.debug, row, 'mark_not_empty');
                    return;
                }
                if (seenSet.has(row.cookie)) {
                    state.debug.rejectedByDuplicate += 1;
                    pushSheetDebugSample(state.debug, row, 'duplicate_cookie');
                    return;
                }
                seenSet.add(row.cookie);
                state.debug.eligibleRowsSeen += 1;
                nextQueue.push(row);
            });
            state.seenCookies = Array.from(seenSet);
            state.queuedRows = nextQueue;
        }

        if (batch.rows.length === 0 && state.queuedRows.length === 0) {
            if (!state.hasMore || state.scannedPhysicalRows >= GETLINK_SHEET_FETCH_LIMIT) {
                return finish(state, state.assigned.length > 0
                    ? `Da tim thay ${state.assigned.length}/${state.targetSlots.length} cookie PASS.`
                    : 'Da quet xong Google Sheet nhung khong tim thay cookie PASS nao.');
            }

            state.debug.emptyVisibleBatches += 1;
            state.debug.lastEmptyBatchStartRow = fetchStartRow;
            state.debug.lastEmptyBatchEndRow = Math.max(fetchStartRow, Number(batch.scannedUntilRow || fetchStartRow) || fetchStartRow);
            state.phase = 'pulling_sheet';
            state.message = `${buildEmptyVisibleBatchMessage(state)} ${buildEmptyQueueDebugMessage(state)}`;
            state.timings.totalMs += Date.now() - chunkStartedAt;
            return state;
        }
    }

    if (state.queuedRows.length === 0) {
        state.phase = 'pulling_sheet';
        state.message = state.hasMore
            ? `${buildEmptyQueueDebugMessage(state)} Dang tiep tuc quet Google Sheet...`
            : buildEmptyQueueDebugMessage(state);
        state.timings.totalMs += Date.now() - chunkStartedAt;
        return state;
    }

    const windowRows = state.queuedRows.slice(0, GETLINK_SHEET_CHECK_CONCURRENCY);
    state.phase = 'checking_candidates';
    state.message = `Dang check ${windowRows.length} cookie tu Google Sheet...`;
    const checkStartedAt = Date.now();
    const windowResults = await withTimeout(
        Promise.all(windowRows.map(async (row) => ({
            row,
            cookieResult: await withTimeout(
                evaluateGetlinkCookie(row.cookie),
                GETLINK_COOKIE_CHECK_TIMEOUT_MS,
                `Check cookie timeout sau ${GETLINK_COOKIE_CHECK_TIMEOUT_MS}ms.`
            )
        }))),
        GETLINK_COOKIE_CHECK_TIMEOUT_MS + 1000,
        `Check cookie timeout sau ${GETLINK_COOKIE_CHECK_TIMEOUT_MS}ms.`
    );
    state.timings.cookieCheckMs += Date.now() - checkStartedAt;

    const pendingUpdates = [];
    for (const { row, cookieResult } of windowResults) {
        if (state.assigned.length >= state.targetSlots.length) break;

        if (!cookieResult.ok) {
            const failReason = mapSheetFailReason(cookieResult.reason || '');
            pendingUpdates.push({
                rowNumber: row.rowNumber,
                mark: failReason
            });
            state.skipped.push({
                rowNumber: row.rowNumber,
                reason: failReason
            });
            continue;
        }

        const slot = state.targetSlots[state.assigned.length];
        const nextMark = getNextSheetUsageMark(row.mark);
        pendingUpdates.push({
            rowNumber: row.rowNumber,
            mark: nextMark
        });
        state.assigned.push({
            slot,
            rowNumber: row.rowNumber,
            cookie: row.cookie,
            previousMark: String(row.mark || '').trim(),
            newMark: nextMark,
            result: {
                slot,
                ok: true,
                error: '',
                summary: cookieResult.summary || {},
                accountInfo: cookieResult.accountInfo || null,
                overloadOutcome: cookieResult.overloadOutcome || '',
                overloadSignal: cookieResult.overloadSignal || '',
                overloadMessage: cookieResult.overloadMessage || ''
            }
        });
    }

    state.queuedRows = state.queuedRows.slice(windowRows.length);

    if (pendingUpdates.length > 0) {
        state.phase = 'writing_marks';
        state.message = `Dang cap nhat ${pendingUpdates.length} dong trong Google Sheet...`;
        const updateStartedAt = Date.now();
        await updateGetlinkSheetRows(pendingUpdates);
        state.timings.sheetUpdateMs += Date.now() - updateStartedAt;
    }

    if (state.assigned.length >= state.targetSlots.length) {
        return finish(state, `Da tim thay du ${state.assigned.length}/${state.targetSlots.length} cookie PASS.`);
    }

    if (state.queuedRows.length === 0 && (!state.hasMore || state.scannedPhysicalRows >= GETLINK_SHEET_FETCH_LIMIT)) {
        return finish(state, state.assigned.length > 0
            ? `Da tim thay ${state.assigned.length}/${state.targetSlots.length} cookie PASS.`
            : 'Da quet xong Google Sheet nhung khong tim thay cookie PASS nao.');
    }

    state.phase = state.queuedRows.length > 0 ? 'checking_candidates' : 'pulling_sheet';
    state.message = state.queuedRows.length > 0
        ? `Da check xong mot nhom, con ${state.queuedRows.length} cookie dang cho check.`
        : `Da quet xong mot luot. Dang tiep tuc tu dong ${state.nextStartRow}...`;
    state.timings.totalMs += Date.now() - chunkStartedAt;
    return state;
}

async function allocateCookiesFromSheetForSlots(slots = []) {
    let state = createSheetImportState(slots);
    while (true) {
        state = await runSheetImportChunk(state);
        const result = buildSheetImportResult(state);
        if (result.status === 'completed') {
            return result;
        }
    }
}

module.exports = {
    normalizeSheetSlots,
    createSheetImportState,
    normalizeSheetImportState,
    runSheetImportChunk,
    buildSheetImportResult,
    allocateCookiesFromSheetForSlots
};

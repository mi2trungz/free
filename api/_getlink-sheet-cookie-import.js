const https = require('https');
const { sanitizeCookieRaw } = require('./_getlink-share-store');
const { evaluateGetlinkCookie } = require('./_getlink-cookie-health');

const GETLINK_SHEET_APPS_SCRIPT_URL = String(process.env.GETLINK_SHEET_APPS_SCRIPT_URL || '').trim();
const GETLINK_SHEET_FETCH_LIMIT = Math.max(20, Math.min(5000, Number(process.env.GETLINK_SHEET_FETCH_LIMIT || 50) || 50));
const GETLINK_SHEET_BATCH_SIZE = Math.max(5, Math.min(200, Number(process.env.GETLINK_SHEET_BATCH_SIZE || 20) || 20));
const GETLINK_SHEET_CHECK_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.GETLINK_SHEET_CHECK_CONCURRENCY || 3) || 3));
const ALLOWED_SHEET_SLOTS = new Set(['primary', 'backup1', 'backup2']);
const MAX_APPS_SCRIPT_REDIRECTS = 5;

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
        req.on('error', (error) => {
            const err = new Error(`Khong ket noi duoc Apps Script: ${error && error.message ? error.message : 'Unknown error'}`);
            err.httpStatus = 502;
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

    const response = await getJsonFromAbsoluteUrl(url.toString());
    if (response && response.success === false) {
        const error = new Error(String(response.error || response.message || 'Apps Script request failed.').trim() || 'Apps Script request failed.');
        error.httpStatus = 502;
        throw error;
    }
    return response && typeof response === 'object' ? response : {};
}

async function listGetlinkSheetRows(options = {}) {
    const startRow = Math.max(1, Number(options.startRow || 1) || 1);
    const limit = Math.max(1, Math.min(GETLINK_SHEET_FETCH_LIMIT, Number(options.limit || GETLINK_SHEET_BATCH_SIZE) || GETLINK_SHEET_BATCH_SIZE));
    const response = await callGetlinkSheetScript('pullRows', { startRow, limit });
    const rows = Array.isArray(response.items) ? response.items.map(normalizeSheetRow).filter(Boolean) : [];
    rows.sort((a, b) => a.rowNumber - b.rowNumber);
    return rows;
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

async function allocateCookiesFromSheetForSlots(slots = []) {
    const targetSlots = normalizeSheetSlots(slots);
    if (targetSlots.length === 0) {
        const error = new Error('Vui long chon it nhat 1 slot cookie.');
        error.httpStatus = 400;
        throw error;
    }

    const totalStartedAt = Date.now();
    const assigned = [];
    const skipped = [];
    const seenCookies = new Set();
    const timings = {
        sheetFetchMs: 0,
        cookieCheckMs: 0,
        sheetUpdateMs: 0,
        totalMs: 0
    };
    let nextStartRow = 1;

    while (assigned.length < targetSlots.length && nextStartRow <= GETLINK_SHEET_FETCH_LIMIT) {
        const fetchStartedAt = Date.now();
        const rows = await listGetlinkSheetRows({
            startRow: nextStartRow,
            limit: Math.min(GETLINK_SHEET_BATCH_SIZE, GETLINK_SHEET_FETCH_LIMIT - nextStartRow + 1)
        });
        timings.sheetFetchMs += Date.now() - fetchStartedAt;
        if (rows.length === 0) break;

        const pendingUpdates = [];
        const candidateRows = [];
        for (const row of rows) {
            if (!row || !row.cookie || !isSheetRowEligible(row.mark)) continue;
            if (seenCookies.has(row.cookie)) continue;
            seenCookies.add(row.cookie);
            candidateRows.push(row);
        }

        for (let index = 0; index < candidateRows.length && assigned.length < targetSlots.length; index += GETLINK_SHEET_CHECK_CONCURRENCY) {
            const windowRows = candidateRows.slice(index, index + GETLINK_SHEET_CHECK_CONCURRENCY);
            if (windowRows.length === 0) continue;

            const checkStartedAt = Date.now();
            const windowResults = await Promise.all(windowRows.map(async (row) => ({
                row,
                cookieResult: await evaluateGetlinkCookie(row.cookie)
            })));
            timings.cookieCheckMs += Date.now() - checkStartedAt;

            for (const { row, cookieResult } of windowResults) {
                if (assigned.length >= targetSlots.length) break;

                if (!cookieResult.ok) {
                    const failReason = mapSheetFailReason(cookieResult.reason || '');
                    pendingUpdates.push({
                        rowNumber: row.rowNumber,
                        mark: failReason
                    });
                    skipped.push({
                        rowNumber: row.rowNumber,
                        reason: failReason
                    });
                    continue;
                }

                const slot = targetSlots[assigned.length];
                const nextMark = getNextSheetUsageMark(row.mark);
                pendingUpdates.push({
                    rowNumber: row.rowNumber,
                    mark: nextMark
                });
                assigned.push({
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
        }

        if (pendingUpdates.length > 0) {
            const updateStartedAt = Date.now();
            await updateGetlinkSheetRows(pendingUpdates);
            timings.sheetUpdateMs += Date.now() - updateStartedAt;
        }
        nextStartRow = rows[rows.length - 1].rowNumber + 1;
    }

    timings.totalMs = Date.now() - totalStartedAt;
    const filledSlots = new Set(assigned.map((item) => item.slot));
    const unfilledSlots = targetSlots.filter((slot) => !filledSlots.has(slot));
    return {
        success: true,
        assigned,
        skipped,
        unfilledSlots,
        message: `Assigned ${assigned.length} cookies, skipped ${skipped.length} failed cookies`,
        timings
    };
}

module.exports = {
    normalizeSheetSlots,
    allocateCookiesFromSheetForSlots
};

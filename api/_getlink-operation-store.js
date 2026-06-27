const https = require('https');
const crypto = require('crypto');
const {
    SHARE_COOKIE_SLOTS,
    updateShareCookies,
    rotateShareCookies
} = require('./_getlink-share-store');
const {
    createSheetImportState,
    normalizeSheetImportState,
    runSheetImportChunk,
    buildSheetImportResult,
    normalizeSheetSlots
} = require('./_getlink-sheet-cookie-import');

const FIREBASE_PROJECT_ID = 'trada3k-c402a';
const FIREBASE_API_KEY = 'AIzaSyAVV-3HxGFpT_eiAri1SGPWGwu3EL8On58';
const COLL_GETLINK_OPERATIONS = 'settings/getlink_operations/items';

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function firestoreDocPath(docPath) {
    return `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
}

function buildOperationDocPath(operationId = '') {
    return `${COLL_GETLINK_OPERATIONS}/${encodeURIComponent(String(operationId || '').trim())}`;
}

function toStringValue(value = '') {
    return { stringValue: String(value || '') };
}

function parseFirestoreString(valueObj = null) {
    if (!valueObj || typeof valueObj !== 'object') return '';
    if (typeof valueObj.stringValue === 'string') return valueObj.stringValue;
    return '';
}

async function readDoc(docPath) {
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
        method: 'GET'
    });
    if (response.statusCode === 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
        const err = new Error('Failed to read getlink operation doc');
        err.httpStatus = response.statusCode || 500;
        throw err;
    }
    try {
        return JSON.parse(response.body || '{}');
    } catch (error) {
        return null;
    }
}

async function patchDoc(docPath, fields) {
    const payload = JSON.stringify({ fields });
    const response = await httpRequest({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: firestoreDocPath(docPath),
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, payload);
    return response.statusCode >= 200 && response.statusCode < 300;
}

function generateOperationId() {
    return crypto.randomBytes(12).toString('base64url').slice(0, 18);
}

function generateOperationToken() {
    return crypto.randomBytes(18).toString('base64url');
}

function parseOperationState(raw = '') {
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function mapOperationFieldsToRecord(fields = {}) {
    return {
        id: parseFirestoreString(fields.id),
        token: parseFirestoreString(fields.token),
        type: parseFirestoreString(fields.type),
        status: parseFirestoreString(fields.status) || 'pending',
        scope: parseFirestoreString(fields.scope),
        shareId: parseFirestoreString(fields.shareId),
        phase: parseFirestoreString(fields.phase),
        message: parseFirestoreString(fields.message),
        lastError: parseFirestoreString(fields.lastError),
        createdAt: parseFirestoreString(fields.createdAt),
        updatedAt: parseFirestoreString(fields.updatedAt),
        state: parseOperationState(parseFirestoreString(fields.stateJson))
    };
}

function mapOperationRecordToFields(record = {}) {
    return {
        id: toStringValue(record.id || ''),
        token: toStringValue(record.token || ''),
        type: toStringValue(record.type || ''),
        status: toStringValue(record.status || 'pending'),
        scope: toStringValue(record.scope || ''),
        shareId: toStringValue(record.shareId || ''),
        phase: toStringValue(record.phase || ''),
        message: toStringValue(record.message || ''),
        lastError: toStringValue(record.lastError || ''),
        createdAt: toStringValue(record.createdAt || ''),
        updatedAt: toStringValue(record.updatedAt || ''),
        stateJson: toStringValue(JSON.stringify(record.state && typeof record.state === 'object' ? record.state : {}))
    };
}

async function readGetlinkOperationById(operationId = '') {
    const id = String(operationId || '').trim();
    if (!id) return null;
    const doc = await readDoc(buildOperationDocPath(id));
    if (!doc || !doc.fields) return null;
    const mapped = mapOperationFieldsToRecord(doc.fields || {});
    if (!mapped.id) mapped.id = id;
    return mapped;
}

async function saveGetlinkOperation(record = {}) {
    const next = {
        ...record,
        updatedAt: new Date().toISOString()
    };
    if (!next.createdAt) next.createdAt = next.updatedAt;
    const ok = await patchDoc(buildOperationDocPath(next.id), mapOperationRecordToFields(next));
    if (!ok) {
        const err = new Error('Failed to save getlink operation');
        err.httpStatus = 500;
        throw err;
    }
    return next;
}

async function createGetlinkOperation(input = {}) {
    const type = String(input.type || '').trim();
    if (!type) {
        const err = new Error('Invalid getlink operation type');
        err.httpStatus = 400;
        throw err;
    }

    const operation = {
        id: generateOperationId(),
        token: generateOperationToken(),
        type,
        status: 'pending',
        scope: String(input.scope || '').trim(),
        shareId: String(input.shareId || '').trim(),
        phase: 'pending',
        message: String(input.message || '').trim(),
        lastError: '',
        createdAt: new Date().toISOString(),
        updatedAt: '',
        state: input.state && typeof input.state === 'object' ? input.state : {}
    };
    return saveGetlinkOperation(operation);
}

function normalizeOperationResultTimings(result = {}) {
    const source = result && typeof result === 'object' ? result.timings : null;
    return source && typeof source === 'object'
        ? {
            sheetFetchMs: Math.max(0, Number(source.sheetFetchMs || 0) || 0),
            cookieCheckMs: Math.max(0, Number(source.cookieCheckMs || 0) || 0),
            sheetUpdateMs: Math.max(0, Number(source.sheetUpdateMs || 0) || 0),
            shareUpdateMs: Math.max(0, Number(source.shareUpdateMs || 0) || 0),
            totalMs: Math.max(0, Number(source.totalMs || 0) || 0)
        }
        : {
            sheetFetchMs: 0,
            cookieCheckMs: 0,
            sheetUpdateMs: 0,
            shareUpdateMs: 0,
            totalMs: 0
        };
}

function buildAutoFixCookies(assigned = []) {
    const nextCookies = {};
    (Array.isArray(assigned) ? assigned : []).forEach((item) => {
        const slot = String(item && item.slot ? item.slot : '').trim();
        if (slot !== 'primary') return;
        nextCookies[slot] = String(item && item.cookie ? item.cookie : '').trim();
    });
    return nextCookies;
}

function buildAssignedSlotCookies(assigned = []) {
    const nextCookies = {};
    (Array.isArray(assigned) ? assigned : []).forEach((item) => {
        const slot = String(item && item.slot ? item.slot : '').trim();
        if (!slot || !SHARE_COOKIE_SLOTS.includes(slot)) return;
        nextCookies[slot] = String(item && item.cookie ? item.cookie : '').trim();
    });
    return nextCookies;
}

function buildOperationShareSnapshot(record = null) {
    if (!record || typeof record !== 'object') return null;
    return {
        id: String(record.id || '').trim(),
        status: String(record.status || '').trim(),
        desktopOnly: !!record.desktopOnly,
        createdAt: String(record.createdAt || '').trim(),
        updatedAt: String(record.updatedAt || '').trim(),
        revokedAt: String(record.revokedAt || '').trim(),
        expiresAt: String(record.expiresAt || '').trim()
    };
}

function normalizeOverloadFixState(input = {}, slotsFallback = []) {
    const baseState = normalizeSheetImportState(input, slotsFallback);
    const source = input && typeof input === 'object' ? input : {};
    return {
        ...baseState,
        liveCountPrecheck: Math.max(0, Number(source.liveCountPrecheck || 0) || 0),
        shareUpdated: source.shareUpdated === true,
        rotated: source.rotated === true,
        finalCookieStr: String(source.finalCookieStr || '').trim(),
        finalShare: buildOperationShareSnapshot(source.finalShare)
    };
}

function resolveOperationState(operation = {}) {
    if (!operation || typeof operation !== 'object') {
        return normalizeSheetImportState({}, []);
    }
    if (operation.type === 'auto_fix') {
        return normalizeSheetImportState(operation.state, SHARE_COOKIE_SLOTS);
    }
    if (operation.type === 'overload_fix') {
        return normalizeOverloadFixState(operation.state, normalizeSheetSlots(operation.state && operation.state.targetSlots));
    }
    return normalizeSheetImportState(operation.state, normalizeSheetSlots(operation.state && operation.state.targetSlots));
}

function shapeOperationPayload(operation = {}) {
    const state = resolveOperationState(operation);
    const result = buildSheetImportResult(state);
    const payload = {
        success: operation.status !== 'failed',
        status: operation.status,
        operationId: operation.id,
        operationToken: operation.token,
        phase: operation.phase || result.phase || '',
        message: operation.message || result.message || '',
        timings: normalizeOperationResultTimings(result),
        debug: result && result.debug && typeof result.debug === 'object' ? result.debug : {}
    };

    if (operation.type === 'sheet_import') {
        payload.assigned = Array.isArray(result.assigned) ? result.assigned : [];
        payload.skipped = Array.isArray(result.skipped) ? result.skipped : [];
        payload.unfilledSlots = Array.isArray(result.unfilledSlots) ? result.unfilledSlots : [];
        return payload;
    }

    if (operation.type === 'overload_fix') {
        const overloadState = normalizeOverloadFixState(state, normalizeSheetSlots(state && state.targetSlots));
        payload.assigned = Array.isArray(result.assigned) ? result.assigned : [];
        payload.assignedCount = payload.assigned.length;
        payload.unfilledSlots = Array.isArray(result.unfilledSlots) ? result.unfilledSlots : [];
        payload.shareId = String(operation.shareId || '').trim();
        payload.liveCount = Math.max(0, Number(overloadState.liveCountPrecheck || 0) || 0);
        payload.cookieStr = String(overloadState.finalCookieStr || '').trim();
        if (overloadState.finalShare) {
            payload.share = overloadState.finalShare;
        }
        return payload;
    }

    payload.assigned = Array.isArray(result.assigned) ? result.assigned : [];
    payload.assignedCount = payload.assigned.length;
    payload.unfilledSlots = Array.isArray(result.unfilledSlots) ? result.unfilledSlots : [];
    payload.shareId = String(operation.shareId || '').trim();
    return payload;
}

async function createSheetImportOperation(slots = [], scope = '') {
    const state = createSheetImportState(slots);
    return createGetlinkOperation({
        type: 'sheet_import',
        scope,
        message: state.message,
        state
    });
}

async function createAutoFixOperation(shareId = '') {
    const state = createSheetImportState(['primary']);
    return createGetlinkOperation({
        type: 'auto_fix',
        shareId,
        message: state.message,
        state
    });
}

async function createOverloadFixOperation(shareId = '', slots = [], liveCountPrecheck = 0) {
    const state = normalizeOverloadFixState({
        ...createSheetImportState(slots),
        liveCountPrecheck
    }, normalizeSheetSlots(slots));
    return createGetlinkOperation({
        type: 'overload_fix',
        shareId,
        message: state.message,
        state
    });
}

async function advanceGetlinkOperation(operationInput = {}) {
    const operation = operationInput && typeof operationInput === 'object'
        ? { ...operationInput }
        : null;
    if (!operation || !operation.id) {
        const err = new Error('Getlink operation not found');
        err.httpStatus = 404;
        throw err;
    }

    if (operation.status === 'completed' || operation.status === 'failed') {
        return operation;
    }

    try {
        operation.status = 'running';
        const currentState = resolveOperationState(operation);
        let nextState = await runSheetImportChunk(currentState);
        let nextResult = buildSheetImportResult(nextState);

        if (operation.type === 'auto_fix' && nextResult.status === 'completed' && nextState.shareUpdated !== true) {
            if ((Array.isArray(nextResult.assigned) ? nextResult.assigned.length : 0) === 0) {
                operation.status = 'failed';
                operation.phase = 'completed';
                operation.message = 'Khong lay duoc cookie PASS nao tu Google Sheet.';
                operation.lastError = operation.message;
                operation.state = nextState;
                return saveGetlinkOperation(operation);
            }

            operation.phase = 'updating_share';
            operation.message = 'Dang cap nhat cookie moi vao link...';
            const shareUpdateStartedAt = Date.now();
            await updateShareCookies(operation.shareId, buildAutoFixCookies(nextResult.assigned), 'guest-auto-fix');
            nextState.shareUpdated = true;
            nextState.timings = nextState.timings && typeof nextState.timings === 'object' ? nextState.timings : {};
            nextState.timings.shareUpdateMs = Math.max(0, Number(nextState.timings.shareUpdateMs || 0) || 0) + (Date.now() - shareUpdateStartedAt);
            nextState.timings.totalMs = Math.max(0, Number(nextState.timings.totalMs || 0) || 0) + (Date.now() - shareUpdateStartedAt);
            nextState.phase = 'completed';
            nextState.message = 'Da cap nhat 1 cookie hop le cho link.';
            nextResult = buildSheetImportResult(nextState);
        }

        if (operation.type === 'overload_fix') {
            nextState = normalizeOverloadFixState({
                ...nextState,
                liveCountPrecheck: currentState && currentState.liveCountPrecheck
            }, normalizeSheetSlots(nextState && nextState.targetSlots));
            nextResult = buildSheetImportResult(nextState);

            if (nextResult.status === 'completed' && nextState.rotated !== true) {
                const requiredCount = Array.isArray(nextState.targetSlots) ? nextState.targetSlots.length : 0;
                const assignedCount = Array.isArray(nextResult.assigned) ? nextResult.assigned.length : 0;
                if (assignedCount < requiredCount) {
                    operation.status = 'failed';
                    operation.phase = 'completed';
                    operation.message = 'Khong lay du 2 cookie PASS tu Google Sheet de sua loi qua tai.';
                    operation.lastError = operation.message;
                    operation.state = nextState;
                    return saveGetlinkOperation(operation);
                }

                operation.phase = 'updating_share';
                operation.message = 'Dang bo sung cookie moi vao 2 o da chet...';
                const finalizeStartedAt = Date.now();
                const shareUpdateStartedAt = finalizeStartedAt;
                await updateShareCookies(operation.shareId, buildAssignedSlotCookies(nextResult.assigned), 'guest-overload-fix-refill');
                nextState.shareUpdated = true;
                nextState.timings = nextState.timings && typeof nextState.timings === 'object' ? nextState.timings : {};
                nextState.timings.shareUpdateMs = Math.max(0, Number(nextState.timings.shareUpdateMs || 0) || 0) + (Date.now() - shareUpdateStartedAt);

                operation.phase = 'rotating_cookie';
                operation.message = 'Dang thay cookie chinh va hoan tat sua loi qua tai...';
                const rotateStartedAt = Date.now();
                const rotated = await rotateShareCookies(operation.shareId, 'guest-overload-fix');
                nextState.rotated = true;
                nextState.finalCookieStr = String(rotated && rotated.cookieRaw ? rotated.cookieRaw : '').trim();
                nextState.finalShare = buildOperationShareSnapshot(rotated);
                nextState.timings.shareUpdateMs = Math.max(0, Number(nextState.timings.shareUpdateMs || 0) || 0) + (Date.now() - rotateStartedAt);
                nextState.timings.totalMs = Math.max(0, Number(nextState.timings.totalMs || 0) || 0) + (Date.now() - finalizeStartedAt);
                nextState.phase = 'completed';
                nextState.message = 'Da bo sung 2 cookie moi va sua loi qua tai thanh cong.';
                nextResult = buildSheetImportResult(nextState);
            }
        }

        operation.state = nextState;
        operation.phase = nextState.phase || nextResult.phase || '';
        operation.message = nextState.message || nextResult.message || '';
        operation.lastError = '';
        operation.status = nextResult.status === 'completed' ? 'completed' : 'pending';
        return saveGetlinkOperation(operation);
    } catch (error) {
        operation.status = 'failed';
        operation.phase = operation.phase || 'failed';
        operation.message = String(error && error.message ? error.message : 'Getlink operation failed').trim() || 'Getlink operation failed';
        operation.lastError = operation.message;
        return saveGetlinkOperation(operation);
    }
}

async function readAuthorizedGetlinkOperation(operationId = '', token = '') {
    const operation = await readGetlinkOperationById(operationId);
    if (!operation) return null;
    if (String(operation.token || '').trim() !== String(token || '').trim()) {
        const err = new Error('Invalid getlink operation token');
        err.httpStatus = 403;
        throw err;
    }
    return operation;
}

module.exports = {
    COLL_GETLINK_OPERATIONS,
    createSheetImportOperation,
    createAutoFixOperation,
    createOverloadFixOperation,
    readGetlinkOperationById,
    readAuthorizedGetlinkOperation,
    saveGetlinkOperation,
    advanceGetlinkOperation,
    shapeOperationPayload
};

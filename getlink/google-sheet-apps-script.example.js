const SPREADSHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';
const SHEET_NAME = 'Sheet1';
  const DEFAULT_PULL_LIMIT = 500;
  const MAX_PULL_LIMIT = 5000;
  const VISIBLE_SCAN_BLOCK_SIZE = 500;
  const MAX_BLOCKS_PER_PULL = 10;
  const IMPORT_FLAG_COLUMN_INDEX = 10;

  function doGet(e) {
    try {
      const payload = getQueryPayload_(e);
      const action = String(payload.action || '').trim();

      if (!action) {
        return jsonResponse({
          success: true,
          message: 'Apps Script is running'
        });
      }

      if (action === 'pullRows') {
        const result = pullRows(payload);
        const response = {
          success: true,
          items: result.items,
          nextStartRow: result.nextStartRow,
          scannedUntilRow: result.scannedUntilRow,
          hasMore: result.hasMore
        };
        if (isDebugEnabled_(payload)) {
          response.blockStartRow = result.blockStartRow;
          response.blockEndRow = result.blockEndRow;
          response.visibleCountInBlock = result.visibleCountInBlock;
        }
        return jsonResponse(response);
      }

      if (action === 'updateRow') {
        updateRow(payload);
        return jsonResponse({ success: true });
      }

      if (action === 'updateRows') {
        updateRows(payload);
        return jsonResponse({ success: true });
      }

      return jsonResponse({
        success: false,
        error: 'Unsupported action'
      });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: getErrorMessage_(error, 'Unexpected Apps Script error')
      });
    }
  }

  function doPost(e) {
    try {
      const payload = parseJsonBody_(e);
      const action = String(payload.action || '').trim();

      if (action === 'pullRows') {
        const result = pullRows(payload);
        const response = {
          success: true,
          items: result.items,
          nextStartRow: result.nextStartRow,
          scannedUntilRow: result.scannedUntilRow,
          hasMore: result.hasMore
        };
        if (isDebugEnabled_(payload)) {
          response.blockStartRow = result.blockStartRow;
          response.blockEndRow = result.blockEndRow;
          response.visibleCountInBlock = result.visibleCountInBlock;
        }
        return jsonResponse(response);
      }

      if (action === 'updateRow') {
        updateRow(payload);
        return jsonResponse({ success: true });
      }

      if (action === 'updateRows') {
        updateRows(payload);
        return jsonResponse({ success: true });
      }

      return jsonResponse({
        success: false,
        error: 'Unsupported action'
      });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: getErrorMessage_(error, 'Unexpected Apps Script error')
      });
    }
  }

  function parseJsonBody_(e) {
    const raw = String((e && e.postData && e.postData.contents) || '').trim();
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      throw new Error('Invalid JSON payload');
    }
  }

  function getQueryPayload_(e) {
    const params = e && e.parameter && typeof e.parameter === 'object' ? e.parameter : {};
    return {
      action: String(params.action || '').trim(),
      limit: params.limit,
      startRow: params.startRow,
      offset: params.offset,
      rowNumber: params.rowNumber,
      mark: params.mark,
      updates: params.updates,
      debug: params.debug
    };
  }

  function getSheet_() {
    if (!String(SPREADSHEET_ID || '').trim() || SPREADSHEET_ID === 'PUT_YOUR_SPREADSHEET_ID_HERE') {
      throw new Error('SPREADSHEET_ID is not configured');
    }
    if (!String(SHEET_NAME || '').trim()) {
      throw new Error('SHEET_NAME is not configured');
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Sheet not found');
    return sheet;
  }

  function pullRows(payload) {
    const limit = clampLimit_(payload && payload.limit);
    const startRow = getStartRow_(payload);
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 0 || startRow > lastRow) {
      return {
        items: [],
        nextStartRow: Math.max(1, startRow),
        scannedUntilRow: lastRow,
        hasMore: false
      };
    }

    const items = [];
    let cursor = startRow;
    let scannedUntilRow = startRow - 1;
    let scannedBlocks = 0;
    let nextStartRow = startRow;
    let hasMore = false;

    while (cursor <= lastRow && items.length < limit && scannedBlocks < MAX_BLOCKS_PER_PULL) {
      const block = getVisibleRowsBlock_(sheet, cursor, lastRow);
      scannedUntilRow = Math.max(scannedUntilRow, block.scannedUntilRow);
      scannedBlocks += 1;

      if (block.items.length > 0) {
        const remaining = limit - items.length;
        const blockItems = block.items.slice(0, remaining);
        items.push.apply(items, blockItems);

        if (block.items.length > remaining) {
          const lastReturnedRow = blockItems[blockItems.length - 1];
          nextStartRow = Math.max(cursor, Number(lastReturnedRow && lastReturnedRow.rowNumber ? lastReturnedRow.rowNumber + 1 : cursor) || cursor);
          hasMore = true;
          break;
        }
      }

      cursor = block.scannedUntilRow + 1;
      nextStartRow = Math.min(lastRow + 1, cursor);
      hasMore = cursor <= lastRow;
    }

    return {
      items,
      blockStartRow: startRow,
      blockEndRow: scannedUntilRow,
      visibleCountInBlock: items.length,
      nextStartRow: Math.max(1, Math.min(lastRow + 1, nextStartRow)),
      scannedUntilRow,
      hasMore: !!hasMore
    };
  }

  function updateRow(payload) {
    const rowNumber = Number(payload && payload.rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      throw new Error('Invalid rowNumber');
    }

    const mark = String((payload && payload.mark) || '').trim();
    const sheet = getSheet_();
    sheet.getRange(rowNumber, 2).setValue(mark);
  }

  function updateRows(payload) {
    const updates = normalizeUpdates_(payload && payload.updates);
    if (updates.length === 0) {
      throw new Error('Missing updates');
    }

    const sheet = getSheet_();
    updates.forEach((item) => {
      sheet.getRange(item.rowNumber, 2).setValue(item.mark);
    });
  }

  function getVisibleRowsBlock_(sheet, startRow, lastRow) {
    const safeStartRow = Math.max(1, Number(startRow || 1) || 1);
    const safeLastRow = Math.max(0, Number(lastRow || 0) || 0);
    const scannedUntilRow = Math.min(safeLastRow, safeStartRow + VISIBLE_SCAN_BLOCK_SIZE - 1);
    const totalRows = Math.max(0, scannedUntilRow - safeStartRow + 1);
    if (totalRows <= 0) {
      return {
        items: [],
        scannedUntilRow
      };
    }

    const values = sheet.getRange(safeStartRow, 1, totalRows, 11).getValues();
    const items = [];
    for (let index = 0; index < totalRows; index += 1) {
      const rowNumber = safeStartRow + index;
      const row = values[index] || [];
      const importFlag = row[IMPORT_FLAG_COLUMN_INDEX];
      if (!isImportFlagEnabled_(importFlag)) continue;
      items.push({
        rowNumber,
        cookie: String(row[0] || '').trim(),
        mark: String(row[1] || '').trim()
      });
    }

    return {
      items,
      scannedUntilRow
    };
  }

  function clampLimit_(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_PULL_LIMIT;
    return Math.max(1, Math.min(MAX_PULL_LIMIT, Math.floor(numeric)));
  }

  function getStartRow_(payload) {
    const startRowRaw = Number(payload && payload.startRow);
    if (Number.isInteger(startRowRaw) && startRowRaw > 0) {
      return startRowRaw;
    }

    const offsetRaw = Number(payload && payload.offset);
    if (Number.isInteger(offsetRaw) && offsetRaw >= 0) {
      return offsetRaw + 1;
    }

    return 1;
  }

  function isDebugEnabled_(payload) {
    const raw = String(payload && payload.debug !== undefined && payload.debug !== null ? payload.debug : '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  function isImportFlagEnabled_(value) {
    if (typeof value === 'number') return value === 1;
    return String(value !== undefined && value !== null ? value : '').trim() === '1';
  }

  function normalizeUpdates_(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (error) {
        throw new Error('Invalid updates payload');
      }
    }

    const source = Array.isArray(parsed) ? parsed : [];
    return source.map((item) => {
      const rowNumber = Number(item && item.rowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
        throw new Error('Invalid rowNumber in updates');
      }
      return {
        rowNumber,
        mark: String(item && item.mark !== undefined && item.mark !== null ? item.mark : '').trim()
      };
    });
  }

  function getErrorMessage_(error, fallback) {
    return String(error && error.message ? error.message : fallback || 'Unexpected Apps Script error').trim();
  }

  function jsonResponse(data) { 
    return ContentService
      .createTextOutput(JSON.stringify(data || {}))
      .setMimeType(ContentService.MimeType.JSON);
  }

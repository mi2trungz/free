const SPREADSHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';
const SHEET_NAME = 'Sheet1';

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String((payload && payload.action) || '').trim();

    if (action === 'pullRows') {
      return jsonResponse({
        success: true,
        items: pullRows(payload)
      });
    }

    if (action === 'updateRow') {
      updateRow(payload);
      return jsonResponse({ success: true });
    }

    return jsonResponse({
      success: false,
      error: 'Unsupported action'
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error && error.message ? error.message : 'Unexpected Apps Script error'
    });
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found');
  return sheet;
}

function pullRows(payload) {
  const limit = Math.max(1, Math.min(5000, Number(payload && payload.limit) || 500));
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 0) return [];

  const range = sheet.getRange(1, 1, lastRow, 2);
  const values = range.getValues();
  const items = [];

  for (let index = 0; index < values.length && items.length < limit; index += 1) {
    const row = values[index];
    items.push({
      rowNumber: index + 1,
      cookie: String((row && row[0]) || '').trim(),
      mark: String((row && row[1]) || '').trim()
    });
  }

  return items;
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

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

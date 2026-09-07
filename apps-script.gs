const BACKUP_KEY = "change-this-key";
const SHEET_NAME = "backup";

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.key !== BACKUP_KEY) {
      return jsonResponse({ ok: false, error: "Invalid key" });
    }

    const sheet = getBackupSheet();
    sheet.clear();
    sheet.getRange(1, 1, 1, 3).setValues([["savedAt", "source", "json"]]);
    sheet.getRange(2, 1, 1, 3).setValues([[
      payload.savedAt || new Date().toISOString(),
      payload.source || "",
      JSON.stringify(payload.data || {})
    ]]);

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function doGet(e) {
  const callback = e.parameter.callback || "callback";
  if (e.parameter.key !== BACKUP_KEY) {
    return jsonpResponse(callback, { ok: false, error: "Invalid key" });
  }

  try {
    const sheet = getBackupSheet();
    const savedAt = sheet.getRange(2, 1).getValue();
    const source = sheet.getRange(2, 2).getValue();
    const json = sheet.getRange(2, 3).getValue();

    if (!json) {
      return jsonpResponse(callback, { ok: false, error: "Backup not found" });
    }

    return jsonpResponse(callback, {
      ok: true,
      savedAt: savedAt ? String(savedAt) : "",
      source: source ? String(source) : "",
      data: JSON.parse(json)
    });
  } catch (error) {
    return jsonpResponse(callback, { ok: false, error: String(error) });
  }
}

function getBackupSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpResponse(callback, payload) {
  return ContentService
    .createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

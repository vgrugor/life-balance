const BACKUP_KEY = "change-this-key";
const SHEET_NAME = "backup";
const CHUNK_SIZE = 45000;

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.key !== BACKUP_KEY) {
      return jsonResponse({ ok: false, error: "Invalid key" });
    }

    const sheet = getBackupSheet();
    const json = JSON.stringify(payload.data || {});
    const chunks = chunkText(json, CHUNK_SIZE);
    sheet.clear();
    sheet.getRange(1, 1, 1, 4).setValues([["savedAt", "source", "part", "json"]]);
    sheet.getRange(2, 1, chunks.length, 4).setValues(chunks.map((chunk, index) => [
      index === 0 ? payload.savedAt || new Date().toISOString() : "",
      index === 0 ? payload.source || "" : "",
      index + 1,
      chunk
    ]));

    return jsonResponse({ ok: true, chunks: chunks.length });
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
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonpResponse(callback, { ok: false, error: "Backup not found" });
    }

    const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const savedAt = rows[0][0];
    const source = rows[0][1];
    const hasChunkedBackup = rows.some((row) => row[3]);
    const json = hasChunkedBackup
      ? rows
        .filter((row) => row[3])
        .sort((a, b) => Number(a[2]) - Number(b[2]))
        .map((row) => row[3])
        .join("")
      : rows[0][2];

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
  const safeCallback = String(callback).match(/^[A-Za-z_$][0-9A-Za-z_$]*$/) ? callback : "callback";
  return ContentService
    .createTextOutput(safeCallback + "(" + JSON.stringify(payload) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function chunkText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

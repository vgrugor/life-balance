import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(path.resolve('apps-script.gs'), 'utf8');

function createHarness() {
  const sheet = {
    rows: [],
    clear() { this.rows = []; },
    getLastRow() { return this.rows.length; },
    getRange(startRow, startColumn, count, width) {
      return {
        setValues: (values) => {
          assert.equal(values.length, count);
          for (const [index, valuesForRow] of values.entries()) {
            assert.equal(valuesForRow.length, width);
            this.rows[startRow + index - 1] = Array.from(valuesForRow);
          }
        },
        getValues: () => this.rows.slice(startRow - 1, startRow - 1 + count).map((row) =>
          row.slice(startColumn - 1, startColumn - 1 + width))
      };
    }
  };
  const spreadsheet = {
    getSheetByName: (name) => name === 'backup' && sheet.rows.length ? sheet : null,
    insertSheet: (name) => {
      assert.equal(name, 'backup');
      return sheet;
    }
  };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    ContentService: {
      MimeType: { JSON: 'application/json', JAVASCRIPT: 'text/javascript' },
      createTextOutput(text) {
        return {
          text,
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          }
        };
      }
    }
  };
  vm.runInNewContext(source, context, { filename: 'apps-script.gs' });
  return { sheet, doPost: context.doPost, doGet: context.doGet };
}

function post(harness, payload) {
  return JSON.parse(harness.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
}

function get(harness, key, callback = 'receiveBackup') {
  const output = harness.doGet({ parameter: { key, callback } });
  assert.equal(output.mimeType, 'text/javascript');
  assert.ok(output.text.startsWith(`${callback}(`));
  return JSON.parse(output.text.slice(callback.length + 1, -2));
}

test('Apps Script stores and reconstructs a backup larger than one Sheet cell', () => {
  const harness = createHarness();
  const data = {
    schemaVersion: 1,
    tasks: [{ id: 'large-task', title: 'Large note', note: 'x'.repeat(100_000) }],
    plans: [],
    logs: []
  };
  const savedAt = '2026-03-20T12:00:00.000Z';
  const sourceUrl = 'https://example.test/life-balance/';

  assert.deepEqual(post(harness, {
    key: 'change-this-key', savedAt, source: sourceUrl, data
  }), { ok: true, chunks: 3 });
  assert.deepEqual(harness.sheet.rows[0], ['savedAt', 'source', 'part', 'json']);
  assert.equal(harness.sheet.rows.length, 4);
  assert.ok(harness.sheet.rows.slice(1).every((row) => row[3].length <= 45_000));
  assert.deepEqual(harness.sheet.rows.slice(1).map((row) => row[2]), [1, 2, 3]);
  assert.deepEqual(get(harness, 'change-this-key'), { ok: true, savedAt, source: sourceUrl, data });
});

test('Apps Script rejects a wrong key without overwriting an existing backup', () => {
  const harness = createHarness();
  const data = { tasks: [{ id: 'keep-me' }], plans: [], logs: [] };
  assert.equal(post(harness, { key: 'change-this-key', data }).ok, true);
  const originalRows = structuredClone(harness.sheet.rows);

  assert.deepEqual(post(harness, { key: 'wrong-key', data: { tasks: [] } }), {
    ok: false, error: 'Invalid key'
  });
  assert.deepEqual(harness.sheet.rows, originalRows);
  assert.deepEqual(get(harness, 'wrong-key'), { ok: false, error: 'Invalid key' });
  assert.deepEqual(get(harness, 'change-this-key').data, data);
});

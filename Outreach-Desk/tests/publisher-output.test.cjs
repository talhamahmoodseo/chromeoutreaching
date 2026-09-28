const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const secret = '0123456789abcdefABCDEFGHIJKLMNOPQRSTUV';
const config = { endpoint: 'https://script.google.com/macros/s/AKfycbx123abc_ABC-def/exec', secret };
const outputSource = fs.readFileSync(path.join(root, 'extension/publisher-output.js'), 'utf8');
const appsScriptSource = fs.readFileSync(path.join(root, 'sheets-apps-script/Code.gs'), 'utf8');

function loadOutput() {
  const context = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, fetch: undefined });
  vm.runInContext(outputSource, context);
  return context.PublisherOutput;
}

function lead(overrides = {}) {
  return {
    id: 'local-id-never-exported', domain: 'www.example.com', website: 'https://www.example.com/write-for-us#top',
    campaignId: 'campaign-1', campaignName: 'Fall outreach', niche: 'Education', bucket: 'ready',
    score: 82, language: 'English', da: 47, pa: 22, bestEmail: 'editor@example.com',
    emails: [{ email: 'editor@example.com', kind: 'Editorial' }, { email: 'support@example.com', kind: 'General contact' }],
    contactPages: ['https://example.com/contact', 'javascript:alert(1)'],
    opportunities: [
      { url: 'https://example.com/write-for-us', decision: 'qualified', role: 'Guest post', types: ['Guest post'] },
      { url: 'https://example.com/old', decision: 'reject', role: 'Other' }
    ],
    forms: ['https://example.com/contact-form'],
    discoveries: [{ query: 'education "write for us"' }, { query: 'education "write for us"' }],
    summary: 'Independent education publication', decisionReason: 'Confirmed guest article offer',
    createdAt: '2026-09-01T12:00:00.000Z', collectedAt: '2026-09-02T12:00:00.000Z',
    privateNotes: 'do not export', sheetId: 'arbitrary-workbook-id', ...overrides
  };
}

function fakeFetch(ack) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify(ack) };
  };
  fetcher.calls = calls;
  return fetcher;
}

test('config requires the deployed HTTPS Apps Script endpoint and a strong secret', () => {
  const api = loadOutput();
  assert.deepEqual({ ...api.validateConfig(config) }, config);
  assert.throws(() => api.validateConfig({ ...config, endpoint: 'http://script.google.com/macros/s/id/exec' }), /HTTPS/);
  assert.throws(() => api.validateConfig({ ...config, endpoint: 'https://docs.google.com/macros/s/id/exec' }), /script.google.com/);
  assert.throws(() => api.validateConfig({ ...config, endpoint: 'https://script.google.com/macros/s/id/dev' }), /\/exec/);
  assert.throws(() => api.validateConfig({ ...config, secret: 'a'.repeat(40) }), /strong/);
});

test('record maps only bounded publisher fields and does not promote an unmarked email', () => {
  const api = loadOutput();
  const row = api.record(lead({ bestEmail: '', selectedEmail: '' }));
  assert.equal(row.stableKey, 'campaign-1|example.com');
  assert.equal(row.campaignId, 'campaign-1');
  assert.equal(row.campaignName, 'Fall outreach');
  assert.equal(row.score, 82);
  assert.equal(row.language, 'English');
  assert.equal(row.emailType, '');
  assert.equal(row.website, 'https://www.example.com/write-for-us');
  assert.equal(row.researchStatus, 'Ready');
  assert.equal(row.bestEmail, '');
  assert.equal(row.emails, 'editor@example.com; support@example.com');
  assert.equal(row.da, 47);
  assert.equal(row.pa, 22);
  assert.equal(row.decisionReason, 'Confirmed guest article offer');
  assert.equal(row.contactPages, 'https://example.com/contact');
  assert.equal(row.contributionPages, 'https://example.com/write-for-us');
  assert.equal(row.opportunityTypes, 'Guest post');
  assert.equal(row.keywords, 'education "write for us"');
  assert.equal('privateNotes' in row, false);
  assert.equal('sheetId' in row, false);
  const doNotContact = api.record(lead({ doNotContact: true, bestEmail: 'editor@example.com' }));
  assert.equal(doNotContact.researchStatus, 'Rejected');
  assert.equal(doNotContact.bestEmail, '');
  assert.equal(doNotContact.emails, 'editor@example.com; support@example.com');
  assert.throws(() => api.record(lead({ domain: 'attacker.test', website: 'https://example.com/' })), /match/);
});

test('send uses a bounded text/plain credential-free request and validates its acknowledgement', async () => {
  const api = loadOutput(), mapped = api.record(lead());
  const fetcher = fakeFetch({ ok: true, accepted: 1, upserted: 1, moved: 0 });
  const ack = await api.send(config, 'upsert', [mapped], fetcher);
  assert.equal(ack.accepted, 1);
  const call = fetcher.calls[0];
  assert.equal(call.url, config.endpoint);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.redirect, 'follow');
  const body = JSON.parse(call.options.body);
  assert.equal(body.secret, secret);
  assert.equal(body.records[0].stableKey, 'campaign-1|example.com');
  assert.equal('privateNotes' in body.records[0], false);

  await assert.rejects(api.send(config, 'upsert', [mapped], fakeFetch({ ok: true, accepted: 0 })), /count did not match/);
  await assert.rejects(api.send(config, 'upsert', [mapped], fakeFetch({ ok: false, accepted: 0, error: 'Invalid output secret.' })), /Invalid output secret/);
  await assert.rejects(api.send(config, 'upsert', [mapped], async () => { throw new TypeError('Failed to fetch'); }), /redirect behavior/);
});

test('test helper sends ping and requires an explicit zero-record acknowledgement', async () => {
  const api = loadOutput();
  const fetcher = fakeFetch({ ok: true, accepted: 0, message: 'pong' });
  const ack = await api.test(config, fetcher);
  assert.equal(ack.message, 'pong');
  const body = JSON.parse(fetcher.calls[0].options.body);
  assert.equal(body.action, 'ping');
  assert.deepEqual(body.records, []);
  await assert.rejects(api.test(config, fakeFetch({ ok: true, accepted: 0 })), /did not return pong/);
});

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => this.sheet.rows[this.row - 1 + r]?.[this.col - 1 + c] ?? '')); }
  getDisplayValues() { return this.getValues().map(row => row.map(value => String(value))); }
  setValues(values) {
    values.forEach((source, r) => {
      const targetRow = this.row - 1 + r;
      while (this.sheet.rows.length <= targetRow) this.sheet.rows.push([]);
      for (let c = 0; c < this.cols; c++) this.sheet.rows[targetRow][this.col - 1 + c] = source[c];
    });
    return this;
  }
  setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; }
  setWrap() { return this; } setDataValidation() { return this; } createFilter() { this.sheet.filter = { remove: () => { this.sheet.filter = null; } }; return this.sheet.filter; }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 100; this.filter = null; this.widths = {}; }
  getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(value => value !== '' && value !== undefined)) return i + 1; return 0; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.reduce((last, value, index) => value !== '' && value !== undefined ? index + 1 : last, 0))); }
  getRange(row, col, rows, cols) { return new FakeRange(this, row, col, rows, cols); }
  setFrozenRows() {} setColumnWidth(col, width) { this.widths[col] = width; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, count) { this.maxRows += count; }
  deleteRow(row) { this.rows.splice(row - 1, 1); this.maxRows -= 1; }
  getFilter() { return this.filter; }
}
class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
}
function loadAppsScript() {
  const spreadsheet = new FakeSpreadsheet();
  const context = vm.createContext({
    Date, Utilities: { newBlob: value => ({ getBytes: () => new TextEncoder().encode(value) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'OUTREACH_DESK_BEARER_SECRET' ? secret : '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(appsScriptSource, context);
  return { context, spreadsheet, post: payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text) };
}

function payloadRecord(overrides = {}) {
  const row = loadOutput().record(lead());
  const campaignId = overrides.campaignId === undefined ? row.campaignId : overrides.campaignId;
  const stableKey = overrides.stableKey || (campaignId ? `${campaignId}|${row.domain}` : `legacy|${row.domain}|${row.niche.toLowerCase()}`);
  return { ...row, summary: '=HYPERLINK("https://attacker.test","click")', ...overrides, stableKey };
}
function cell(sheet, row, header) { return sheet.rows[row - 1][sheet.rows[0].indexOf(header)]; }

test('Apps Script upserts idempotently, moves status tabs, sanitizes cells, and preserves outreach fields', () => {
  const backend = loadAppsScript(), row = payloadRecord();
  let ack = backend.post({ secret, action: 'upsert', records: [row], sheetId: 'attacker-controlled' });
  assert.deepEqual(ack, { ok: true, accepted: 1, upserted: 1, moved: 0 });
  let useful = backend.spreadsheet.getSheetByName('Useful');
  assert.equal(useful.rows.length, 2);
  assert.equal(cell(useful, 2, 'Stable Key'), 'campaign-1|example.com');
  assert.equal(cell(useful, 2, 'Campaign Name'), 'Fall outreach');
  assert.equal(cell(useful, 2, 'Score'), 82);
  assert.equal(cell(useful, 2, 'Language'), 'English');
  assert.equal(cell(useful, 2, 'Email Type'), 'Editorial');
  assert.equal(cell(useful, 2, 'DA'), 47);
  assert.equal(cell(useful, 2, 'PA'), 22);
  assert.equal(cell(useful, 2, 'Summary'), "'=HYPERLINK(\"https://attacker.test\",\"click\")");
  assert.equal(cell(useful, 2, 'Outreach Status'), 'Not started');
  useful.rows[1][useful.rows[0].indexOf('Outreach Status')] = 'Contacted';
  useful.rows[1][useful.rows[0].indexOf('Outreach Notes')] = 'Negotiated rate, follow up Friday.';

  ack = backend.post({ secret, action: 'upsert', records: [payloadRecord({ researchStatus: 'Rejected', decisionReason: 'Explicit refusal' })] });
  assert.deepEqual(ack, { ok: true, accepted: 1, upserted: 1, moved: 1 });
  assert.equal(useful.getLastRow(), 1);
  let rejected = backend.spreadsheet.getSheetByName('Rejected');
  assert.equal(rejected.getLastRow(), 2);
  assert.equal(cell(rejected, 2, 'Outreach Status'), 'Contacted');
  assert.equal(cell(rejected, 2, 'Outreach Notes'), 'Negotiated rate, follow up Friday.');

  ack = backend.post({ secret, action: 'upsert', records: [payloadRecord({ researchStatus: 'Ready' })] });
  assert.equal(ack.moved, 1);
  assert.equal(backend.spreadsheet.getSheetByName('Rejected').getLastRow(), 1);
  useful = backend.spreadsheet.getSheetByName('Useful');
  assert.equal(useful.getLastRow(), 2);
  assert.equal(cell(useful, 2, 'Outreach Status'), 'Contacted');
  assert.equal(cell(useful, 2, 'Outreach Notes'), 'Negotiated rate, follow up Friday.');
  backend.post({ secret, action: 'upsert', records: [payloadRecord({ summary: 'Latest' })] });
  assert.equal(useful.getLastRow(), 2);
  assert.equal(cell(useful, 2, 'Summary'), 'Latest');
});

test('same domain remains separate across campaigns and updates only its matching campaign row', () => {
  const backend = loadAppsScript();
  backend.post({ secret, action: 'upsert', records: [payloadRecord(), payloadRecord({ campaignId: 'campaign-2', campaignName: 'Winter outreach' })] });
  const useful = backend.spreadsheet.getSheetByName('Useful');
  assert.equal(useful.getLastRow(), 3);
  assert.deepEqual(useful.rows.slice(1).map(row => row[useful.rows[0].indexOf('Stable Key')]).sort(), ['campaign-1|example.com', 'campaign-2|example.com']);
  backend.post({ secret, action: 'upsert', records: [payloadRecord({ campaignName: 'Renamed fall campaign' })] });
  assert.equal(useful.getLastRow(), 3);
  assert.equal(useful.rows.find(row => row[useful.rows[0].indexOf('Campaign ID')] === 'campaign-1')[useful.rows[0].indexOf('Campaign Name')], 'Renamed fall campaign');
});

test('v0.5 schema upgrades by named columns and preserves rows, manual fields, and custom data', () => {
  const backend = loadAppsScript(), useful = backend.spreadsheet.insertSheet('Useful');
  const oldHeaders = ['Stable Key', 'Domain', 'Website', 'Niche', 'Research Status', 'DA', 'PA', 'Decision Reason', 'Best Email', 'Emails', 'Contact Pages', 'Contribution Pages', 'Contact Forms', 'Opportunity Types', 'Summary', 'Keywords', 'First Seen', 'Last Collected', 'Outreach Status', 'Outreach Notes', 'Updated At', 'Pinned'];
  useful.rows = [oldHeaders, ['example.com|education', 'example.com', 'https://example.com/', 'Education', 'Ready', 47, 22, '', 'editor@example.com', 'editor@example.com', '', '', '', '', 'Old details', '', '', '', 'Contacted', 'Keep this note', '2026-01-01T00:00:00.000Z', 'Keep this value']];
  const legacy = loadOutput().record(lead({ campaignId: '', campaignName: '' }));
  const expectedKey = 'legacy|example.com|education';
  backend.post({ secret, action: 'upsert', records: [{ ...legacy, stableKey: expectedKey, summary: 'Refreshed details' }] });
  assert.equal(useful.getLastRow(), 2);
  assert.equal(cell(useful, 2, 'Stable Key'), expectedKey);
  assert.equal(cell(useful, 2, 'Summary'), 'Refreshed details');
  assert.equal(cell(useful, 2, 'Outreach Status'), 'Contacted');
  assert.equal(cell(useful, 2, 'Outreach Notes'), 'Keep this note');
  assert.equal(cell(useful, 2, 'Pinned'), 'Keep this value');
  assert.ok(useful.rows[0].includes('Campaign ID'));
  assert.ok(useful.rows[0].includes('Email Type'));
});

test('Apps Script ping, authentication, limits, URL validation, and fixed action errors are explicit', () => {
  const backend = loadAppsScript();
  assert.deepEqual(backend.post({ secret, action: 'ping', records: [] }), { ok: true, accepted: 0, message: 'pong' });
  assert.match(backend.post({ secret: 'wrong', action: 'ping', records: [] }).error, /Invalid output secret/);
  assert.match(backend.post({ secret, action: 'delete', records: [] }).error, /Unsupported action/);
  assert.match(backend.post({ secret, action: 'upsert', records: [{ stableKey: 'bad' }] }).error, /domain does not match/);
  assert.match(backend.post({ secret, action: 'upsert', records: Array.from({ length: 101 }, () => ({})) }).error, /between 1 and 100/);
  const tooLarge = backend.context.doPost({ postData: { contents: ' '.repeat(512 * 1024 + 1) } });
  assert.match(JSON.parse(tooLarge.text).error, /too large/);
});

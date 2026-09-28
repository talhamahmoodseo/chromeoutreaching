/** Bound Apps Script endpoint for Outreach Desk's optional publisher output. */
const OUTPUT_SECRET_PROPERTY = 'OUTREACH_DESK_BEARER_SECRET';
const OUTPUT_MAX_BODY_BYTES = 512 * 1024;
const OUTPUT_MAX_RECORDS = 100;
const OUTPUT_HEADERS = [
  'Campaign ID', 'Campaign Name', 'Stable Key', 'Domain', 'Website', 'Niche',
  'Research Status', 'Score', 'Language', 'DA', 'PA', 'Decision Reason',
  'Email Type', 'Best Email', 'Emails', 'Contact Pages', 'Contribution Pages',
  'Contact Forms', 'Opportunity Types', 'Summary', 'Keywords', 'First Seen',
  'Last Collected', 'Outreach Status', 'Outreach Notes', 'Updated At'
];
const LEGACY_HEADERS = [
  'Stable Key', 'Domain', 'Website', 'Niche', 'Research Status', 'DA', 'PA',
  'Decision Reason', 'Best Email', 'Emails', 'Contact Pages', 'Contribution Pages',
  'Contact Forms', 'Opportunity Types', 'Summary', 'Keywords', 'First Seen',
  'Last Collected', 'Outreach Status', 'Outreach Notes', 'Updated At'
];
const OUTPUT_STATUS_VALUES = [
  'Not started', 'Drafting', 'Contacted', 'Follow-up', 'Responded',
  'Negotiating', 'Agreed', 'Declined', 'Do not contact'
];

/** Run once from the bound Apps Script editor to authorize and prepare the workbook. */
function initializeOutputWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the output workbook.');
  ensureOutputSheet(spreadsheet, 'Useful');
  ensureOutputSheet(spreadsheet, 'Rejected');
  return 'Useful and Rejected tabs are ready.';
}

/** Receives only ping and fixed-field upsert requests. */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw) throw new Error('Request body is missing.');
    if (raw.length > OUTPUT_MAX_BODY_BYTES || Utilities.newBlob(raw).getBytes().length > OUTPUT_MAX_BODY_BYTES) {
      throw new Error('Request is too large. Send fewer publisher records.');
    }
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Request must be a JSON object.');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty(OUTPUT_SECRET_PROPERTY) || '';
    if (!expectedSecret || !constantTimeEquals(String(payload.secret || ''), expectedSecret)) {
      throw new Error('Invalid output secret. Check the Script Property and extension configuration.');
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (!spreadsheet) throw new Error('This script is not bound to an active output workbook.');
      if (payload.action === 'ping') {
        if (!Array.isArray(payload.records) || payload.records.length !== 0) throw new Error('Ping requests must not include records.');
        return outputJson({ ok: true, accepted: 0, message: 'pong' });
      }
      if (payload.action !== 'upsert') throw new Error('Unsupported action.');
      if (!Array.isArray(payload.records) || payload.records.length < 1 || payload.records.length > OUTPUT_MAX_RECORDS) {
        throw new Error('Send between 1 and 100 publisher records.');
      }
      const incoming = payload.records.map(normalizeOutputRecord);
      const outcome = upsertOutputRecords(spreadsheet, incoming);
      return outputJson({ ok: true, accepted: payload.records.length, upserted: outcome.upserted, moved: outcome.moved });
    } finally { lock.releaseLock(); }
  } catch (error) {
    return outputJson({ ok: false, accepted: 0, error: safeError(error) });
  }
}

/** Validate and discard every field outside the fixed output schema. */
function normalizeOutputRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A publisher record is invalid.');
  const domain = normalizeOutputDomain(input.domain);
  const website = normalizeOutputUrl(input.website, false);
  const websiteHost = normalizeOutputDomain(website);
  if (!domain || !website || !(websiteHost === domain || websiteHost.slice(-(domain.length + 1)) === '.' + domain)) {
    throw new Error('Publisher domain does not match its website.');
  }
  const niche = safeText(input.niche, 90) || 'General';
  const campaignId = safeCampaignId(input.campaignId);
  const stableKey = campaignId ? campaignId + '|' + domain : 'legacy|' + domain + '|' + niche.toLowerCase();
  if (input.stableKey !== stableKey) throw new Error('Publisher stable key does not match its campaign and domain.');
  const researchStatus = safeText(input.researchStatus, 40);
  if (['Ready', 'Form only', 'Review', 'No useful email', 'Rejected'].indexOf(researchStatus) < 0) {
    throw new Error('Publisher research status is invalid.');
  }
  return {
    campaignId: campaignId, campaignName: safeText(input.campaignName, 120),
    stableKey: stableKey, domain: domain, website: website, niche: niche,
    researchStatus: researchStatus, score: safeMetric(input.score), language: safeText(input.language, 60),
    da: safeMetric(input.da), pa: safeMetric(input.pa), decisionReason: safeText(input.decisionReason, 1000),
    emailType: safeText(input.emailType, 80), bestEmail: safeEmail(input.bestEmail),
    emails: safeDelimited(input.emails, 3000, safeEmail),
    contactPages: safeUrlList(input.contactPages, 20), contributionPages: safeUrlList(input.contributionPages, 20),
    contactForms: safeUrlList(input.contactForms, 12), opportunityTypes: safeText(input.opportunityTypes, 800),
    summary: safeText(input.summary, 1500), keywords: safeText(input.keywords, 3000),
    firstSeen: safeIsoDate(input.firstSeen), lastCollected: safeIsoDate(input.lastCollected)
  };
}

/** Idempotent upsert by campaign+domain. Legacy rows are keyed by legacy+domain+niche. */
function upsertOutputRecords(spreadsheet, incoming) {
  const useful = ensureOutputSheet(spreadsheet, 'Useful');
  const rejected = ensureOutputSheet(spreadsheet, 'Rejected');
  const usefulRows = readOutputRows(useful), rejectedRows = readOutputRows(rejected), byKey = {};
  usefulRows.forEach(function (entry) { (byKey[entry.key] || (byKey[entry.key] = [])).push({ tab: 'useful', row: entry.row, values: entry.values, headers: entry.headers }); });
  rejectedRows.forEach(function (entry) { (byKey[entry.key] || (byKey[entry.key] = [])).push({ tab: 'rejected', row: entry.row, values: entry.values, headers: entry.headers }); });

  const deduplicated = {};
  incoming.forEach(function (row) { deduplicated[row.stableKey] = row; });
  const records = Object.keys(deduplicated).map(function (key) { return deduplicated[key]; });
  const removals = { useful: [], rejected: [] }, preserved = {};
  let moved = 0;
  records.forEach(function (row) {
    const target = row.researchStatus === 'Rejected' ? 'rejected' : 'useful';
    const found = byKey[row.stableKey] || [];
    const targetFound = found.find(function (entry) { return entry.tab === target; });
    const manualSource = targetFound || found[0];
    preserved[row.stableKey] = manualSource || null;
    found.forEach(function (entry) {
      if (entry.tab !== target || !targetFound || entry !== targetFound) removals[entry.tab].push(entry.row);
    });
    if (found.length && !targetFound) moved++;
  });

  deleteRowsDescending(useful, removals.useful);
  deleteRowsDescending(rejected, removals.rejected);
  const current = { useful: {}, rejected: {} };
  readOutputRows(useful).forEach(function (entry) { current.useful[entry.key] = entry.row; });
  readOutputRows(rejected).forEach(function (entry) { current.rejected[entry.key] = entry.row; });
  records.forEach(function (row) {
    const targetName = row.researchStatus === 'Rejected' ? 'rejected' : 'useful';
    const sheet = targetName === 'rejected' ? rejected : useful;
    const rowNumber = current[targetName][row.stableKey] || Math.max(2, sheet.getLastRow() + 1);
    ensureOutputCapacity(sheet, rowNumber);
    const source = preserved[row.stableKey];
    const values = source ? remapRow(source, sheet) : Array(getSheetHeaders(sheet).length).fill('');
    writeOutputFields(values, getHeaderMap(sheet), row, source);
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
    current[targetName][row.stableKey] = rowNumber;
  });
  refreshOutputFilter(useful);
  refreshOutputFilter(rejected);
  return { upserted: records.length, moved: moved };
}

/** Creates the fixed schema for a new workbook and safely appends v0.6 columns to v0.5 tabs. */
function ensureOutputSheet(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setValues([OUTPUT_HEADERS]);
  } else {
    let headers = getSheetHeaders(sheet);
    const normalized = headers.map(function (header) { return safeText(header, 100); });
    if (LEGACY_HEADERS.some(function (header) { return normalized.indexOf(header) < 0; })) {
      throw new Error('The ' + name + ' tab is not a supported Outreach Desk schema. Use a new blank output workbook or restore the v0.5 headers.');
    }
    OUTPUT_HEADERS.forEach(function (header) {
      if (normalized.indexOf(header) < 0) {
        const column = headers.length + 1;
        sheet.getRange(1, column, 1, 1).setValues([[header]]);
        headers.push(header);
        normalized.push(header);
      }
    });
  }
  sheet.setFrozenRows(1);
  const headers = getSheetHeaders(sheet), map = headerMap(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#183b4e').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);
  const widths = {
    'Campaign ID': 150, 'Campaign Name': 220, 'Stable Key': 300, 'Domain': 170,
    'Website': 250, 'Niche': 140, 'Research Status': 145, 'Score': 80, 'Language': 110,
    'DA': 60, 'PA': 60, 'Decision Reason': 260, 'Email Type': 150, 'Best Email': 220,
    'Emails': 320, 'Contact Pages': 280, 'Contribution Pages': 280, 'Contact Forms': 240,
    'Opportunity Types': 200, 'Summary': 360, 'Keywords': 320, 'First Seen': 180,
    'Last Collected': 180, 'Outreach Status': 150, 'Outreach Notes': 360, 'Updated At': 190
  };
  headers.forEach(function (header, index) { if (widths[header]) sheet.setColumnWidth(index + 1, widths[header]); });
  applyOutreachStatusValidation(sheet, map);
  refreshOutputFilter(sheet);
  return sheet;
}

function getSheetHeaders(sheet) {
  const count = sheet.getLastColumn();
  if (!count) return [];
  return sheet.getRange(1, 1, 1, count).getDisplayValues()[0].map(function (value) { return String(value || '').trim(); });
}
function headerMap(headers) { const map = {}; headers.forEach(function (name, index) { if (name) map[name] = index; }); return map; }
function getHeaderMap(sheet) { return headerMap(getSheetHeaders(sheet)); }
function applyOutreachStatusValidation(sheet, map) {
  const index = (map || getHeaderMap(sheet))['Outreach Status'];
  if (index === undefined) return;
  const validation = SpreadsheetApp.newDataValidation().requireValueInList(OUTPUT_STATUS_VALUES, true).setAllowInvalid(false).build();
  sheet.getRange(2, index + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setDataValidation(validation);
}
function refreshOutputFilter(sheet) {
  const existing = sheet.getFilter();
  if (existing) existing.remove();
  const columns = getSheetHeaders(sheet).length;
  sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), columns).createFilter();
}
function ensureOutputCapacity(sheet, requiredRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredRow > maxRows) sheet.insertRowsAfter(maxRows, requiredRow - maxRows);
  applyOutreachStatusValidation(sheet);
}
function readOutputRows(sheet) {
  const lastRow = sheet.getLastRow(), headers = getSheetHeaders(sheet), map = headerMap(headers);
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues(), found = [];
  rows.forEach(function (values, index) {
    const stable = String(values[map['Stable Key']] || ''), domain = String(values[map.Domain] || ''), niche = String(values[map.Niche] || 'General');
    if (!stable) return;
    // v0.5 keys become isolated legacy records without changing or dropping their rows.
    const key = stable === domain + '|' + niche.toLowerCase() ? 'legacy|' + domain + '|' + niche.toLowerCase() : stable;
    found.push({ key: key, row: index + 2, values: values, headers: headers });
  });
  return found;
}
function remapRow(source, targetSheet) {
  const headers = getSheetHeaders(targetSheet), values = Array(headers.length).fill('');
  source.headers.forEach(function (header, index) { if (header && index < source.values.length) values[headers.indexOf(header)] = source.values[index]; });
  return values;
}
function writeOutputFields(values, map, row, source) {
  const sourceMap = source ? headerMap(source.headers) : {};
  const sourceValues = source ? source.values : [];
  const oldStatus = sourceMap['Outreach Status'] === undefined ? '' : sourceValues[sourceMap['Outreach Status']];
  const oldNotes = sourceMap['Outreach Notes'] === undefined ? '' : sourceValues[sourceMap['Outreach Notes']];
  const fields = {
    'Campaign ID': safeCell(row.campaignId, 120), 'Campaign Name': safeCell(row.campaignName, 120),
    'Stable Key': safeCell(row.stableKey, 400), 'Domain': safeCell(row.domain, 253), 'Website': safeCell(row.website, 2048),
    'Niche': safeCell(row.niche, 90), 'Research Status': row.researchStatus, 'Score': row.score === null ? '' : row.score,
    'Language': safeCell(row.language, 60), 'DA': row.da === null ? '' : row.da, 'PA': row.pa === null ? '' : row.pa,
    'Decision Reason': safeCell(row.decisionReason, 1000), 'Email Type': safeCell(row.emailType, 80),
    'Best Email': safeCell(row.bestEmail, 254), 'Emails': safeCell(row.emails, 3000),
    'Contact Pages': safeCell(row.contactPages, 5000), 'Contribution Pages': safeCell(row.contributionPages, 5000),
    'Contact Forms': safeCell(row.contactForms, 3000), 'Opportunity Types': safeCell(row.opportunityTypes, 800),
    'Summary': safeCell(row.summary, 1500), 'Keywords': safeCell(row.keywords, 3000),
    'First Seen': safeCell(row.firstSeen, 40), 'Last Collected': safeCell(row.lastCollected, 40),
    'Outreach Status': safeCell(safeText(oldStatus, 100) || 'Not started', 100),
    'Outreach Notes': safeCell(oldNotes, 5000), 'Updated At': new Date().toISOString()
  };
  Object.keys(fields).forEach(function (name) { if (map[name] !== undefined) values[map[name]] = fields[name]; });
}
function deleteRowsDescending(sheet, rows) {
  Array.from(new Set(rows)).sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });
}
function normalizeOutputDomain(value) {
  let raw = safeText(value, 2048).toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/\.$/, '');
  if (raw.startsWith('www.')) raw = raw.slice(4);
  if (raw.length > 253 || raw.indexOf('..') >= 0 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw)) return '';
  return raw;
}
function normalizeOutputUrl(value, allowBareHost) {
  let raw = safeText(value, 2048);
  if (allowBareHost && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const match = raw.match(/^(https?):\/\/([^/?#\s]+)([^#]*)$/i);
  if (!match || match[2].indexOf('@') >= 0) return '';
  const authority = match[2].toLowerCase(), hostMatch = authority.match(/^([a-z0-9.-]+)(?::(80|443))?$/);
  if (!hostMatch || !normalizeOutputDomain(hostMatch[1])) return '';
  const protocol = match[1].toLowerCase(), domain = normalizeOutputDomain(hostMatch[1]);
  const port = hostMatch[2] && !((protocol === 'https' && hostMatch[2] === '443') || (protocol === 'http' && hostMatch[2] === '80')) ? ':' + hostMatch[2] : '';
  return protocol + '://' + domain + port + (match[3] || '/');
}
function safeText(value, limit) {
  if (value === null || value === undefined || !['string', 'number', 'boolean'].includes(typeof value)) return '';
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function safeCell(value, limit) { const text = safeText(value, limit); return /^[\s]*[=+@-]/.test(text) ? "'" + text : text; }
function safeCampaignId(value) {
  const id = safeText(value, 120);
  if (!id) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('Campaign ID contains unsupported characters.');
  return id;
}
function safeEmail(value) {
  const email = safeText(value, 254).toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ? email : '';
}
function safeDelimited(value, limit, mapper) {
  return Array.from(new Set(safeText(value, limit).split(';').map(function (part) { return mapper(part.trim()); }).filter(Boolean))).slice(0, 30).join('; ');
}
function safeUrlList(value, maxItems) {
  return Array.from(new Set(safeText(value, 5000).split(';').map(function (part) { return normalizeOutputUrl(part.trim(), false); }).filter(Boolean))).slice(0, maxItems).join('; ');
}
function safeMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function safeIsoDate(value) {
  const text = safeText(value, 40);
  if (!text) return '';
  const date = new Date(text);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}
function constantTimeEquals(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
function safeError(error) { return safeText(error && error.message ? error.message : 'Request failed.', 300) || 'Request failed.'; }
function outputJson(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

// Throwaway harness: runs logbook_v4.gs against a fake Sheet so setup(), a push
// and a pull can be exercised outside Apps Script. Not part of the build.
const fs = require('fs');
const path = require('path');

function makeSheet(name) {
  const s = { name, data: [], maxRows: 1000 };
  const cell = (r, c) => {
    const row = s.data[r - 1];
    return row && row[c - 1] !== undefined ? row[c - 1] : '';
  };
  const cellSet = (r, c, v) => {
    while (s.data.length < r) s.data.push([]);
    const row = s.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  };
  const range = (row, col, numRows = 1, numCols = 1) => {
    const api = {
      getValue: () => cell(row, col),
      setValue: (v) => { cellSet(row, col, v); return api; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < numRows; i++) {
          const line = [];
          for (let j = 0; j < numCols; j++) line.push(cell(row + i, col + j));
          out.push(line);
        }
        return out;
      },
      setValues: (vals) => {
        vals.forEach((line, i) => line.forEach((v, j) => cellSet(row + i, col + j, v)));
        return api;
      },
      setFormulas: (vals) => api.setValues(vals),
      setFormula: (f) => { cellSet(row, col, f); return api; },
      setNumberFormat: () => api,
      setFontWeight: () => api,
    };
    return api;
  };
  s.getName = () => s.name;
  s.setName = (n) => { s.name = n; };
  s.getRange = range;
  s.getLastRow = () => {
    let i = s.data.length - 1;
    while (i >= 0 && s.data[i].every((v) => v === '' || v == null)) i--;
    return i + 1;
  };
  s.getMaxRows = () => Math.max(s.maxRows, s.data.length);
  s.setFrozenRows = () => s;
  return s;
}

function makeSpreadsheet() {
  const sheets = [];
  return {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
  };
}

const ss = makeSpreadsheet();
global.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.ContentService = {
  createTextOutput: (t) => ({ setMimeType() { return { text: t }; } }),
  MimeType: { JSON: 'application/json' },
};

const code = fs
  .readFileSync(path.join(__dirname, 'logbook_v4.gs'), 'utf8')
  .replace("var KEY = '';", "var KEY = 'testkey';");

const api = new Function('return (function(){' + code + `
  return { setup: setup, doGet: doGet, doPost: doPost, readEntitiesV4: readEntitiesV4, TABS: TABS, VIEWS: VIEWS };
})()`)();

const out = [];
const ok = (label, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ' :: ' + extra : ''));

api.setup();
const names = ss.getSheets().map((s) => s.name);
ok('setup creates tabs', ['Events', 'Ratings', 'Entities', 'Changes'].every((n) => names.includes(n)), names.join(','));
const evSheet = ss.getSheetByName('Events');
ok('Events headers', evSheet.getRange(1, 1, 1, 16).getValues()[0].join(',') === api.TABS.Events.join(','));

const push = {
  key: 'testkey',
  events: [
    { id: 'p:100', ts: 1794759120000, day: '2026-11-15', kind: 'met', ref: 'n:maria', title: 'Maria', cat: 'person', note: 'coffee', src: 'phone' },
    { id: 'm:200', ts: 1794759200000, day: '2026-11-15', kind: 'note', ref: '', title: 'a thought', cat: '', note: 'hello', src: 'phone' },
  ],
  rows: [{ ref: 'f:55', title: 'Some Film', cat: 'movie', stars: 4, ts: 1794759300000 }],
};
const res1 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify(push) } }).text);
ok('push ok', res1.ok === true, JSON.stringify(res1));
ok('two event rows', evSheet.getLastRow() === 3, 'rows=' + evSheet.getLastRow());
ok('seq assigned', evSheet.getRange(2, 16).getValue() === 1 && evSheet.getRange(3, 16).getValue() === 2);
ok('rating row', ss.getSheetByName('Ratings').getLastRow() === 2);
ok('entities created', ss.getSheetByName('Entities').getLastRow() === 3, 'rows=' + ss.getSheetByName('Entities').getLastRow());

const res2 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify(push) } }).text);
ok('retry ok', res2.ok === true);
ok('retry does not duplicate', evSheet.getLastRow() === 3, 'rows=' + evSheet.getLastRow());

const p1 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'testkey', action: 'pull', evCursor: 0, chCursor: 0 }) } }).text);
ok('pull ok', p1.ok === true && p1.v === 4 && p1.api === 3, JSON.stringify(p1).slice(0, 120));
ok('pull returns both events', p1.events.length === 2, 'n=' + p1.events.length);
ok('pull evCursor', p1.evCursor === 2, 'cursor=' + p1.evCursor);
ok('pull entities with fields', p1.entities.length === 2 && 'remindDays' in p1.entities[0], JSON.stringify(p1.entities));
ok('more=false', p1.more === false);

const p2 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'testkey', action: 'pull', evCursor: p1.evCursor, chCursor: p1.chCursor }) } }).text);
ok('no replay after cursor', p2.events.length === 0, 'n=' + p2.events.length);

const bad = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'nope', events: [] }) } }).text);
ok('wrong key refused', bad.ok === false && bad.error === 'key');

const ping = JSON.parse(api.doGet({ parameter: { action: 'ping', key: 'testkey' } }).text);
ok('ping says v4', ping.ok === true && ping.v === 4 && ping.api === 3, JSON.stringify(ping));

const v = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'testkey', action: 'void', id: 'p:100' }) } }).text);
ok('void ok', v.ok === true, JSON.stringify(v));
const p3 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'testkey', action: 'pull', evCursor: p1.evCursor, chCursor: p1.chCursor }) } }).text);
ok('void appears in changes', p3.changes.length === 1 && p3.changes[0].type === 'void', JSON.stringify(p3.changes));
ok('void travels as a change, not a re-served event', p3.events.length === 0, 'n=' + p3.events.length);
const p4 = JSON.parse(api.doPost({ parameter: {}, postData: { contents: JSON.stringify({ key: 'testkey', action: 'pull', evCursor: 0, chCursor: 0 }) } }).text);
ok('a fresh client sees the void flagged', p4.events.length === 2 && p4.events.some((e) => e.id === 'p:100' && e.voided === true), JSON.stringify(p4.events.map((e) => [e.id, e.voided])));

console.log(out.join('\n'));
console.log(out.some((l) => l.startsWith('FAIL')) ? 'RESULT: FAILURES' : 'RESULT: ALL PASS');

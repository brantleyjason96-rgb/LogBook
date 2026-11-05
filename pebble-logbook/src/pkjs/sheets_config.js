// Settings-page piece for the Google Sheets integration.
// The settings page itself is generated (config_html.js), so this module adds
// its own card to that page when index.js builds it. If you later move the card
// into tools/config.html, delete the patch() call in index.js.
//
// The page gets: a URL field, "send everything now" and "test" checkboxes,
// and the Apps Script to paste into the spreadsheet.

var APPS_SCRIPT = [
  "// Logbook -> Google Sheets, v3: the same sheet layout as v2, plus a read API and edit",
  "// actions for the Logbook web app (capture page and dashboard).",
  "//",
  "// Install: Extensions > Apps Script, replace everything with this file, save.",
  "// Run the function \"setup\" once (approve the prompts; run it again after any update).",
  "// Then Deploy > Manage deployments > edit > New version. Keep the same URL.",
  "//",
  "// Set KEY below to a long random string. Your web app and the watch both send it:",
  "//   watch:   paste  <web app URL>?key=YOUR_KEY  into Logbook's settings page",
  "//   web app: Settings page (or the setup link it makes)",
  "//",
  "// Tabs: Events (everything, never overwritten), Ratings (latest per item), Entities (one row",
  "// per person / movie / book...), and the views Today, People, Summary.",
  "",
  "var KEY = '';",
  "",
  "var TABS = {",
  "  Events:   ['event_id', 'when', 'date', 'kind', 'entity_ref', 'title', 'category', 'stars', 'position', 'note', 'source', 'voided'],",
  "  Ratings:  ['ref', 'title', 'category', 'stars', 'date'],",
  "  Entities: ['entity_ref', 'title', 'category', 'first_seen', 'last_seen', 'events', 'avg_stars', 'latest_stars']",
  "};",
  "",
  "var VIEWS = {",
  "  Today: '=QUERY(Events!A:L,\"select B,D,F,G,H,I,J where C = \\'\"&TEXT(TODAY(),\"yyyy-mm-dd\")&\"\\' and L is null order by B desc\",1)',",
  "  People: '=QUERY(Entities!A:H,\"select B,D,E,F where C = \\'person\\' order by E desc\",1)',",
  "  Summary: '=QUERY(Events!A:L,\"select G,count(A),avg(H) where A is not null and L is null group by G order by count(A) desc label count(A) \\'events\\', avg(H) \\'avg stars\\'\",1)'",
  "};",
  "",
  "function setup() {",
  "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
  "  ensureTabs(ss);",
  "  for (var name in VIEWS) {",
  "    var sh = ss.getSheetByName(name) || ss.insertSheet(name);",
  "    sh.getRange(1, 1).setFormula(VIEWS[name]);",
  "  }",
  "  refreshEntityFormulas(ss);",
  "}",
  "",
  "function authorized(e) {",
  "  return !KEY || (e && e.parameter && e.parameter.key === KEY);",
  "}",
  "",
  "// ---- reading (the web app)",
  "",
  "function doGet(e) {",
  "  if (!authorized(e)) return reply({ ok: false, error: 'key' });",
  "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
  "  ensureTabs(ss);",
  "  var p = e.parameter || {};",
  "  if (p.action === 'ping') return reply({ ok: true, v: 2, api: 1 });",
  "  return reply({",
  "    ok: true, v: 2, api: 1,",
  "    events: readEvents(ss, +p.since || 0),",
  "    entities: readEntities(ss),",
  "    ratings: readRatings(ss)",
  "  });",
  "}",
  "",
  "function tm(v) {",
  "  if (v && typeof v.getTime === 'function') return v.getTime();",
  "  return +v || 0;",
  "}",
  "",
  "function readEvents(ss, since) {",
  "  var sh = ss.getSheetByName('Events');",
  "  var last = sh.getLastRow();",
  "  if (last < 2) return [];",
  "  var first = Math.max(2, last - 9999);                       // the latest 10,000 rows at most",
  "  var rows = sh.getRange(first, 1, last - first + 1, 12).getValues();",
  "  var out = [];",
  "  rows.forEach(function (r) {",
  "    if (r[11] !== '' && r[11] !== null) return;                 // voided",
  "    var when = tm(r[1]);",
  "    if (when <= since) return;",
  "    out.push({ id: String(r[0]), when: when, kind: r[3], ref: String(r[4]), title: r[5], cat: r[6],",
  "               stars: r[7] === '' ? null : r[7], pos: r[8], note: r[9], src: r[10] });",
  "  });",
  "  return out;",
  "}",
  "",
  "function readEntities(ss) {",
  "  return column(ss.getSheetByName('Entities'), 1, 3).map(function (r) {",
  "    return { ref: String(r[0]), title: r[1], cat: r[2] };",
  "  });",
  "}",
  "",
  "function readRatings(ss) {",
  "  return column(ss.getSheetByName('Ratings'), 1, 5).map(function (r) {",
  "    return { ref: String(r[0]), title: r[1], cat: r[2], stars: r[3], when: tm(r[4]) };",
  "  });",
  "}",
  "",
  "// ---- writing (the watch and the web app)",
  "",
  "function doPost(e) {",
  "  var body;",
  "  try { body = JSON.parse(e.postData.contents); }",
  "  catch (err) { return reply({ ok: false }); }",
  "  if (!authorized(e)) return reply({ ok: false });",
  "  if (body.test) return reply({ ok: true, v: 2 });",
  "",
  "  var lock = LockService.getScriptLock();",
  "  lock.waitLock(20000);",
  "  try {",
  "    var ss = SpreadsheetApp.getActiveSpreadsheet();",
  "    ensureTabs(ss);",
  "    if (body.action) return reply(editAction(ss, body));",
  "    var ents = {};",
  "    var nr = upsertRatings(ss, body.rows || [], ents);",
  "    var ne = addEvents(ss, body.events || [], ents);",
  "    var nn = addEntities(ss, ents);",
  "    return reply({ ok: true, v: 2, ratings: nr, events: ne, entities: nn });",
  "  } finally {",
  "    lock.releaseLock();",
  "  }",
  "}",
  "",
  "function reply(obj) {",
  "  return ContentService.createTextOutput(JSON.stringify(obj))",
  "    .setMimeType(ContentService.MimeType.JSON);",
  "}",
  "",
  "// ---- tabs",
  "",
  "function ensureTabs(ss) {",
  "  // An existing v1 sheet (first tab, \"ref\" in A1) becomes the Ratings tab.",
  "  if (!ss.getSheetByName('Ratings')) {",
  "    var first = ss.getSheets()[0];",
  "    if (first && first.getRange(1, 1).getValue() === 'ref') first.setName('Ratings');",
  "  }",
  "  for (var name in TABS) {",
  "    var sh = ss.getSheetByName(name) || ss.insertSheet(name);",
  "    var heads = TABS[name];",
  "    if (sh.getLastRow() === 0) {",
  "      sh.getRange(1, 1, 1, heads.length).setValues([heads]);",
  "      sh.setFrozenRows(1);",
  "      sh.getRange(1, 1, 1, heads.length).setFontWeight('bold');",
  "      sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');           // ids stay text",
  "      if (name === 'Events') {",
  "        sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm');",
  "        sh.getRange(1, 3, sh.getMaxRows(), 1).setNumberFormat('@');        // date stays text",
  "      }",
  "      if (name === 'Entities') sh.getRange(1, 4, sh.getMaxRows(), 2).setNumberFormat('yyyy-mm-dd');",
  "    }",
  "  }",
  "  var ev = ss.getSheetByName('Events');                  // v2 sheets get the new \"voided\" column",
  "  if (ev.getRange(1, 12).getValue() !== 'voided') ev.getRange(1, 12).setValue('voided');",
  "}",
  "",
  "function column(sh, col, width) {",
  "  var last = sh.getLastRow();",
  "  return last > 1 ? sh.getRange(2, col, last - 1, width || 1).getValues() : [];",
  "}",
  "",
  "function noteEntity(ents, ref, title, cat) {",
  "  if (!ref) return;",
  "  if (!ents[ref]) ents[ref] = { title: title || ref, cat: cat || '' };",
  "}",
  "",
  "// ---- Ratings: latest rating per ref",
  "",
  "function upsertRatings(ss, rows, ents) {",
  "  if (!rows.length) return 0;",
  "  var sh = ss.getSheetByName('Ratings');",
  "  var rowOf = {};",
  "  column(sh, 1).forEach(function (r, i) { rowOf[r[0]] = i + 2; });",
  "  var fresh = [];",
  "  var next = sh.getLastRow() + 1;",
  "  rows.forEach(function (r) {",
  "    var ref = String(r.ref);",
  "    var vals = [ref, r.title, r.cat, r.stars, new Date(r.ts)];",
  "    noteEntity(ents, ref, r.title, r.cat);",
  "    if (rowOf[ref]) {",
  "      sh.getRange(rowOf[ref], 1, 1, 5).setValues([vals]);",
  "    } else {",
  "      rowOf[ref] = next + fresh.length;",
  "      fresh.push(vals);",
  "    }",
  "  });",
  "  if (fresh.length) sh.getRange(next, 1, fresh.length, 5).setValues(fresh);",
  "  return rows.length;",
  "}",
  "",
  "// ---- Events: append only, event_id makes a retry harmless",
  "",
  "function addEvents(ss, events, ents) {",
  "  if (!events.length) return 0;",
  "  var sh = ss.getSheetByName('Events');",
  "  var have = {};",
  "  column(sh, 1).forEach(function (r) { have[r[0]] = true; });",
  "  var fresh = [];",
  "  events.forEach(function (ev) {",
  "    var id = String(ev.id);",
  "    if (have[id]) return;",
  "    have[id] = true;",
  "    noteEntity(ents, String(ev.ref || ''), ev.title, ev.cat);",
  "    fresh.push([id, new Date(ev.ts), String(ev.day || ''), ev.kind || 'note', String(ev.ref || ''),",
  "      ev.title || '', ev.cat || '', ev.stars === undefined || ev.stars === null ? '' : ev.stars,",
  "      ev.pos || '', ev.note || '', ev.src || 'watch', '']);",
  "  });",
  "  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);",
  "  return fresh.length;",
  "}",
  "",
  "// ---- Entities: one row per ref; the numbers are formulas over Events (voided ones left out)",
  "",
  "function entityFormulas(r) {",
  "  var live = ',Events!$L:$L,\"\"';",
  "  return [",
  "    '=IFERROR(MINIFS(Events!$B:$B,Events!$E:$E,$A' + r + live + '),\"\")',",
  "    '=IFERROR(MAXIFS(Events!$B:$B,Events!$E:$E,$A' + r + live + '),\"\")',",
  "    '=COUNTIFS(Events!$E:$E,$A' + r + live + ')',",
  "    '=IFERROR(AVERAGEIFS(Events!$H:$H,Events!$E:$E,$A' + r + ',Events!$D:$D,\"rated\"' + live + '),\"\")',",
  "    '=IFERROR(VLOOKUP($A' + r + ',Ratings!$A:$D,4,FALSE),\"\")'",
  "  ];",
  "}",
  "",
  "function addEntities(ss, ents) {",
  "  var sh = ss.getSheetByName('Entities');",
  "  var have = {};",
  "  column(sh, 1).forEach(function (r) { have[r[0]] = true; });",
  "  var refs = Object.keys(ents).filter(function (k) { return !have[k]; });",
  "  if (!refs.length) return 0;",
  "  var start = sh.getLastRow() + 1;",
  "  sh.getRange(start, 1, refs.length, 3).setValues(refs.map(function (k) {",
  "    return [k, ents[k].title, ents[k].cat];",
  "  }));",
  "  sh.getRange(start, 4, refs.length, 5).setFormulas(refs.map(function (k, i) { return entityFormulas(start + i); }));",
  "  return refs.length;",
  "}",
  "",
  "function refreshEntityFormulas(ss) {",
  "  var sh = ss.getSheetByName('Entities');",
  "  var n = sh.getLastRow() - 1;",
  "  if (n < 1) return;",
  "  var f = [];",
  "  for (var i = 0; i < n; i++) f.push(entityFormulas(i + 2));",
  "  sh.getRange(2, 4, n, 5).setFormulas(f);",
  "}",
  "",
  "// ---- edits from the web app: rename, merge, void",
  "",
  "function rowsWhere(sh, col, value) {",
  "  var out = [];",
  "  column(sh, col).forEach(function (r, i) { if (String(r[0]) === value) out.push(i + 2); });",
  "  return out;",
  "}",
  "",
  "function setCol(sh, rows, col, value) {",
  "  rows.forEach(function (r) { sh.getRange(r, col, 1, 1).setValues([[value]]); });",
  "}",
  "",
  "function editAction(ss, b) {",
  "  var ev = ss.getSheetByName('Events'), ra = ss.getSheetByName('Ratings'), en = ss.getSheetByName('Entities');",
  "  var i;",
  "  if (b.action === 'void') {",
  "    setCol(ev, rowsWhere(ev, 1, String(b.id)), 12, 'x');",
  "    return { ok: true, v: 2 };",
  "  }",
  "  if (b.action === 'rename') {",
  "    var name = String(b.name || '').trim();",
  "    if (!b.ref || !name) return { ok: false };",
  "    setCol(en, rowsWhere(en, 1, b.ref), 2, name);",
  "    setCol(ra, rowsWhere(ra, 1, b.ref), 2, name);",
  "    setCol(ev, rowsWhere(ev, 5, b.ref), 6, name);",
  "    return { ok: true, v: 2 };",
  "  }",
  "  if (b.action === 'merge') {                      // move everything from one entity into another",
  "    var from = String(b.from || ''), to = String(b.to || ''), toTitle = String(b.title || '');",
  "    if (!from || !to || from === to) return { ok: false };",
  "    var evRows = rowsWhere(ev, 5, from);",
  "    setCol(ev, evRows, 5, to);",
  "    setCol(ev, evRows, 6, toTitle);",
  "    var fromRatings = rowsWhere(ra, 1, from), toRatings = rowsWhere(ra, 1, to);",
  "    if (fromRatings.length && !toRatings.length) {",
  "      setCol(ra, fromRatings, 1, to);",
  "      setCol(ra, fromRatings, 2, toTitle);",
  "    } else {",
  "      for (i = fromRatings.length - 1; i >= 0; i--) ra.deleteRow(fromRatings[i]);",
  "    }",
  "    if (!rowsWhere(en, 1, to).length) addEntities(ss, (function () { var o = {}; o[to] = { title: toTitle, cat: b.cat || '' }; return o; })());",
  "    var fromEnt = rowsWhere(en, 1, from);",
  "    for (i = fromEnt.length - 1; i >= 0; i--) en.deleteRow(fromEnt[i]);",
  "    refreshEntityFormulas(ss);",
  "    return { ok: true, v: 2 };",
  "  }",
  "  return { ok: false };",
  "}"
].join('\n');

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var CSS =
  '.gsrow{display:flex;gap:10px;align-items:center;margin-top:10px}' +
  '.gsrow input{width:auto;flex:none}' +
  'details.gs{margin-top:12px}' +
  'details.gs summary{color:var(--acc);font-weight:600;cursor:pointer}' +
  'details.gs ol{color:var(--mut);font-size:14px;padding-left:20px;margin:10px 0}' +
  'details.gs li{margin-bottom:6px}' +
  '#gss{height:230px}';

var CARD =
  '<div class="card" id="gsCard">' +
    '<b>Google Sheets sync</b>' +
    '<p class="hint">Each rating and note is added to a spreadsheet of yours (Events keeps everything, Ratings keeps the latest per item). ' +
    'Leave this empty to switch sync off.</p>' +
    '<input id="gsu" placeholder="Paste your Apps Script web app URL" autocapitalize="off" autocomplete="off" spellcheck="false">' +
    '<label class="gsrow"><input type="checkbox" id="gsb"> Send all my ratings and notes when I save</label>' +
    '<label class="gsrow"><input type="checkbox" id="gst"> Test the connection when I save</label>' +
    '<p class="hint" id="gsp"></p>' +
    '<details class="gs"><summary>How to set this up</summary>' +
      '<ol>' +
        '<li>Create a new Google Sheet.</li>' +
        '<li>Open Extensions, then Apps Script. Replace the code with the script below and save.</li>' +
        '<li>Choose Run, then setup, once, and approve the prompts. It builds the tabs.</li>' +
        '<li>Choose Deploy, New deployment, Web app. Set Execute as to Me and Who has access to Anyone, then deploy and approve the prompts.</li>' +
        '<li>Copy the Web app URL into the box above and tap Save.</li>' +
      '</ol>' +
      '<p class="hint">Set KEY in the script, then add ?key=YOUR_KEY to the end of the URL you paste above. Without a key, anyone who has the URL can read and add rows. ' +
      'If you edit the script later, deploy a new version.</p>' +
      '<textarea id="gss" readonly>' + escHtml(APPS_SCRIPT) + '</textarea>' +
      '<div style="height:8px"></div>' +
      '<button class="ghost" id="gsc" style="width:100%">Select script</button>' +
    '</details>' +
  '</div>';

var SCRIPT =
  '(function(){' +
  'function g(id){return document.getElementById(id);}' +
  'window.__sheetsInit=function(init){' +
    'if(!g("gsu"))return;' +
    'g("gsu").value=init.sheetsUrl||"";' +
    'var n=init.sheetsPending||0;' +
    'g("gsp").textContent=n?(n+(n===1?" rating is":" ratings are")+" waiting to sync."):"";' +
  '};' +
  'window.__sheetsOut=function(){' +
    'if(!g("gsu"))return null;' +
    'return{url:g("gsu").value.trim(),backfill:g("gsb").checked,test:g("gst").checked};' +
  '};' +
  'if(g("gsc"))g("gsc").onclick=function(){var t=g("gss");t.focus();t.select();try{document.execCommand("copy");}catch(e){}};' +
  '})();';

function swap(html, find, replacement, name) {
  var i = html.indexOf(find);
  if (i < 0) {
    console.log('Logbook: settings page changed, could not add Sheets piece "' + name + '"');
    return html;
  }
  return html.slice(0, i) + replacement + html.slice(i + find.length);
}

// Adds the Sheets card and its wiring to the generated settings page.
function patch(html) {
  html = swap(html, '</style>', CSS + '</style>', 'css');
  html = swap(html, '<div class="card">\n      <b>Export</b>', CARD + '<div class="card">\n      <b>Export</b>', 'card');
  html = swap(html, '<script>\nvar INIT', '<script>' + SCRIPT + '</script>\n<script>\nvar INIT', 'script');
  html = swap(html, "$('tk').value = INIT.tmdbKey || '';",
    "$('tk').value = INIT.tmdbKey || ''; if (window.__sheetsInit) window.__sheetsInit(INIT);", 'init');
  html = swap(html, 'edits: edits, deletes: deletes };',
    'edits: edits, deletes: deletes, sheets: window.__sheetsOut ? window.__sheetsOut() : null };', 'out');
  return html;
}

module.exports = { patch: patch, appsScript: APPS_SCRIPT };

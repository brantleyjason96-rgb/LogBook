// Logbook -> Google Sheets, v4: the v3 sheet plus an incremental sync API for the
// Android app. The v3 clients (the Pebble watch, the web app) keep working exactly
// as before: the same tabs, the same GET, the same POST shapes and the same edits.
//
// Install: Extensions > Apps Script, replace everything with this file, save.
// Run the function "setup" once (approve the prompts; run it again after any update).
// setup() migrates an existing v1/v2/v3 sheet: it adds the new columns, creates the
// Changes tab and refreshes the view formulas. It NEVER rewrites old rows - their
// "seq" cells stay empty, which every reader treats as seq 0, so a fresh client
// that pulls with cursor 0 still sees the whole history exactly once.
// Then Deploy > Manage deployments > edit > New version. Keep the same URL.
//
// Set KEY below to a long random string. The key may travel on the URL (?key=...)
// exactly as in v3 (the watch and the web app), or in the POST body as {"key": "..."}
// (the Android app only sends it there). It is never echoed back in any response.
//
// Tabs: Events (everything, never overwritten; now with track / about / place / seq),
// Ratings (latest per item, unchanged), Entities (one row per person/item; now with
// the People fields), Changes (append-only: every edit other clients must replay)
// and the views Today, People, Summary.
//
// What v4 adds (docs/API_V4.md):
//   POST {'action':'pull', key, evCursor, chCursor, limit} - cursor pagination over
//     events (insertion order by seq, NOT by when; voided rows included but flagged)
//     and changes. Old rows with no seq read back as seq 0 and are served to any
//     client whose evCursor is <= 0; pages that end among those legacy rows return a
//     negative evCursor meaning "this many legacy rows are already served to you".
//     limit defaults to 500, caps at 2000; more:true while another page remains.
//   POST {events, rows} - captures stored exactly as v3 stored them, plus track /
//     about / place and a monotonically increasing seq assigned under the lock.
//   POST {action:'void'|'rename'|'merge'} - exactly today's edits, and the edit is
//     also appended to Changes so an offline client can replay it.
//     Changes are {id, type, payload}; the id makes them idempotent, like event ids.
//   POST {changes:[{id, type, payload}]} - accepted inside any capture or edit POST.
//     Types: void{eventId}, rename{ref,name}, merge{from,to,title,cat},
//     entityFields{ref, remindDays (an integer 1..730, or null to clear),
//     snoozedUntil (an ISO date or null), retired (a bool or null), org, role, tags},
//     alias{heard,ref}, fuDone{key,done,ts}. Invalid field values are ignored (the
//     old value stays); unknown change types are logged untouched so newer clients
//     can read them back.

var KEY = '';

var TABS = {
  Events:   ['event_id', 'when', 'date', 'kind', 'entity_ref', 'title', 'category', 'stars', 'position', 'note', 'source', 'voided', 'track', 'about', 'place', 'seq'],
  Ratings:  ['ref', 'title', 'category', 'stars', 'date'],
  Entities: ['entity_ref', 'title', 'category', 'first_seen', 'last_seen', 'events', 'avg_stars', 'latest_stars', 'remind_days', 'snoozed_until', 'retired', 'org', 'role', 'tags'],
  Changes:  ['seq', 'id', 'ts', 'type', 'payload_json']
};

var VIEWS = {
  // The sheet formula needs <>"'"&TEXT(TODAY(),"yyyy-mm-dd")&"'"<> around one single
  // quote on each side; inside a single-quoted JS string that is \'" and "\'.
  Today: '=QUERY(Events!A:L,"select B,D,F,G,H,I,J where C = \'"&TEXT(TODAY(),"yyyy-mm-dd")&"\' and L is null order by B desc",1)',
  People: '=QUERY(Entities!A:H,"select B,D,E,F where C = \'person\' order by E desc",1)',
  Summary: '=QUERY(Events!A:L,"select G,count(A),avg(H) where A is not null and L is null group by G order by count(A) desc label count(A) \'events\', avg(H) \'avg stars\'",1)'
};

var PULL_DEFAULT_LIMIT = 500;
var PULL_MAX_LIMIT = 2000;
var REMIND_MIN_DAYS = 1;
var REMIND_MAX_DAYS = 730;

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs(ss);
  for (var name in VIEWS) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1).setFormula(VIEWS[name]);
  }
  refreshEntityFormulas(ss);
}

function authorized(e, body) {
  if (!KEY) return true;
  if (e && e.parameter && e.parameter.key === KEY) return true;
  if (body && body.key === KEY) return true;      // the Android app puts the key only in the body
  return false;
}

// ---- reading (the v3 GET, unchanged except the version numbers)

function doGet(e) {
  if (!authorized(e, null)) return reply({ ok: false, error: 'key' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs(ss);
  var p = e.parameter || {};
  if (p.action === 'ping') return reply({ ok: true, v: 4, api: 3 });
  return reply({
    ok: true, v: 4, api: 3,
    events: readEvents(ss, +p.since || 0),
    entities: readEntities(ss),
    ratings: readRatings(ss)
  });
}

function tm(v) {
  if (v && typeof v.getTime === 'function') return v.getTime();
  return +v || 0;
}

function readEvents(ss, since) {
  var sh = ss.getSheetByName('Events');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var first = Math.max(2, last - 9999);                       // the latest 10,000 rows at most (v3 behaviour)
  var rows = sh.getRange(first, 1, last - first + 1, 12).getValues();
  var out = [];
  rows.forEach(function (r) {
    if (r[11] !== '' && r[11] !== null) return;               // voided
    var when = tm(r[1]);
    if (when <= since) return;                                // the v3 quirk: filters on when, not insertion order
    out.push({ id: String(r[0]), when: when, kind: r[3], ref: String(r[4]), title: r[5], cat: r[6],
               stars: r[7] === '' ? null : r[7], pos: r[8], note: r[9], src: r[10] });
  });
  return out;
}

function readEntities(ss) {
  return column(ss.getSheetByName('Entities'), 1, 3).map(function (r) {
    return { ref: String(r[0]), title: r[1], cat: r[2] };
  });
}

function readRatings(ss) {
  return column(ss.getSheetByName('Ratings'), 1, 5).map(function (r) {
    return { ref: String(r[0]), title: r[1], cat: r[2], stars: r[3], when: tm(r[4]) };
  });
}

// ---- writing (the watch, the web app and the Android app). Everything happens
// under LockService.getScriptLock(); seq values are max(seq)+1 computed inside it.

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return reply({ ok: false }); }
  if (!authorized(e, body)) return reply({ ok: false, error: 'key' });
  if (body.test) return reply({ ok: true, v: 4 });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs(ss);
    if (body.action === 'pull') return reply(pull(ss, body));
    if (body.action) {
      var res = editAction(ss, body);
      if (res.ok) {
        logActionChange(ss, body);                          // the edit, on the Changes tab, with a stable id
        if (body.changes && body.changes.length) applyChanges(ss, body.changes);
      }
      return reply(res);
    }
    var ents = {};
    upsertRatings(ss, body.rows || [], ents);
    addEvents(ss, body.events || [], ents);
    addEntities(ss, ents);
    applyChanges(ss, body.changes || []);                   // idempotent by change id
    return reply({ ok: true, v: 4 });
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- the v4 pull: POST {'action':'pull', key, evCursor, chCursor, limit}

function pull(ss, b) {
  var limit = pullLimit(b);
  var ev = eventsPage(ss, +b.evCursor || 0, limit);
  var ch = changesPage(ss, +b.chCursor || 0, limit);
  return {
    ok: true, v: 4, api: 3,
    events: ev.items, changes: ch.items, entities: readEntitiesV4(ss),
    evCursor: ev.cursor, chCursor: ch.cursor,
    more: ev.more || ch.more
  };
}

function pullLimit(b) {
  var n = +(b && b.limit);
  if (!isFinite(n) || n < 1) n = PULL_DEFAULT_LIMIT;
  if (n > PULL_MAX_LIMIT) n = PULL_MAX_LIMIT;
  return n;
}

// Events stream, insertion order: legacy rows (no seq -> 0) first while the client is
// still catching up from cursor 0, then the seq rows in seq order. A page that ends
// among legacy rows returns a negative evCursor, "legacy rows already served to you".
function eventsPage(ss, evCursor, limit) {
  var sh = ss.getSheetByName('Events');
  var last = sh.getLastRow();
  if (last < 2) return { items: [], cursor: evCursor, more: false, limit: limit };
  var rows = sh.getRange(2, 1, last - 1, 16).getValues();
  var legacy = [], fresh = [];
  for (var i = 0; i < rows.length; i++) {
    var s = +rows[i][15] || 0;
    if (s > 0) fresh.push(rows[i]); else legacy.push(rows[i]);
  }
  fresh.sort(function (a, b) { return (+a[15] || 0) - (+b[15] || 0); });   // insertion order, not "when"
  var skip = 0, stream;
  if (evCursor <= 0) {
    skip = Math.min(-evCursor, legacy.length);
    stream = legacy.slice(skip).concat(fresh);
  } else {
    stream = [];
    for (var j = 0; j < fresh.length; j++) if ((+fresh[j][15] || 0) > evCursor) stream.push(fresh[j]);
  }
  var page = stream.slice(0, limit);
  var cursor = evCursor;
  if (page.length) {
    var lastSeq = +page[page.length - 1][15] || 0;
    if (lastSeq > 0) cursor = lastSeq;                     // the page reached seq rows: done catching up
    else {
      var legacyServed = 0;
      for (var k = 0; k < page.length; k++) if (!((+page[k][15] || 0) > 0)) legacyServed++;
      cursor = -(skip + legacyServed);                    // still walking the legacy rows
    }
  }
  var items = [];
  for (var m = 0; m < page.length; m++) items.push(eventToWire(page[m]));
  return { items: items, cursor: cursor, more: stream.length > page.length, limit: limit };
}

function changesPage(ss, chCursor, limit) {
  var sh = ss.getSheetByName('Changes');
  var last = sh.getLastRow();
  var items = [];
  if (last > 1) {
    var rows = sh.getRange(2, 1, last - 1, 5).getValues();
    var match = [];
    for (var i = 0; i < rows.length; i++) {
      var s = +rows[i][0] || 0;
      if (s > chCursor) match.push(rows[i]);
    }
    if (match.length) {
      var page = match.slice(0, limit);
      for (var j = 0; j < page.length; j++) {
        var r = page[j];
        var payload = null;
        try { payload = JSON.parse(String(r[4])); } catch (err) { payload = null; }
        items.push({ id: String(r[1]), type: String(r[3]), payload: payload, seq: +r[0] || 0, ts: tm(r[2]) });
      }
      return { items: items, cursor: +page[page.length - 1][0] || 0, more: match.length > page.length };
    }
  }
  return { items: items, cursor: chCursor, more: false };
}

// The v4 wire shape of one event row (all the GET fields plus day, seq, track,
// about, place and the voided flag; "when" becomes whenMs - frozen in Wire.kt).

function eventToWire(r) {
  var cat = r[6];
  var st = r[7];
  st = st === '' || st === null ? null : (typeof st === 'number' ? st : (+st || null));
  return {
    id: String(r[0]), whenMs: tm(r[1]), day: strOf(r[2]), kind: strOf(r[3]),
    ref: strOf(r[4]), title: strOf(r[5]),
    cat: (cat === '' || cat === null) ? null : String(cat),
    stars: st, pos: strOf(r[8]), note: strOf(r[9]), src: strOf(r[10]),
    place: strOf(r[14]), track: strOf(r[12]), about: strOf(r[13]),
    seq: +r[15] || 0,
    voided: r[11] !== '' && r[11] !== null
  };
}

function strOf(v) { return v === '' || v == null ? '' : String(v); }

function intOrNull(v) {
  if (v === '' || v == null) return null;
  var n = +v;
  return isFinite(n) && Math.round(n) === n ? n : null;
}

// The full entities list every pull returns, the People fields included.

function readEntitiesV4(ss) {
  return column(ss.getSheetByName('Entities'), 1, 14).map(function (r) {
    var retired = r[10];
    return {
      ref: String(r[0]), title: strOf(r[1]),
      cat: (r[2] === '' || r[2] == null) ? null : String(r[2]),
      remindDays: intOrNull(r[8]),
      snoozedUntil: (r[9] === '' || r[9] == null) ? null : String(r[9]),
      retired: retired === true || retired === 'true' ? true : (retired === false || retired === 'false' ? false : null),
      org: strOf(r[11]), role: strOf(r[12]), tags: strOf(r[13])
    };
  });
}

// ---- tabs. The migration touches the header row only: old data rows are never
// rewritten, so their seq cells stay empty (= 0 for every reader).

function ensureTabs(ss) {
  // An existing v1 sheet (first tab, "ref" in A1) becomes the Ratings tab.
  if (!ss.getSheetByName('Ratings')) {
    var first = ss.getSheets()[0];
    if (first && first.getRange(1, 1).getValue() === 'ref') first.setName('Ratings');
  }
  for (var name in TABS) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var heads = TABS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, heads.length).setValues([heads]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, heads.length).setFontWeight('bold');
      sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');           // ids stay text
      if (name === 'Events') {
        sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
        sh.getRange(1, 3, sh.getMaxRows(), 1).setNumberFormat('@');        // date stays text
      }
      if (name === 'Entities') sh.getRange(1, 4, sh.getMaxRows(), 2).setNumberFormat('yyyy-mm-dd');
      if (name === 'Changes') {
        sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');         // change ids stay text
        sh.getRange(1, 3, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
      }
    } else {
      // v1/v2/v3 sheets gain the new header cells (v2 gets "voided" back, v3 gets
      // track/about/place/seq, remind_days/snoozed_until/retired/org/role/tags).
      var cur = sh.getRange(1, 1, 1, heads.length).getValues()[0];
      for (var j = 0; j < heads.length; j++) {
        if (cur[j] !== heads[j]) sh.getRange(1, j + 1).setValue(heads[j]);
      }
    }
  }
}

function column(sh, col, width) {
  var last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, col, last - 1, width || 1).getValues() : [];
}

// ---- captures, exactly as v3 stored them, plus the new columns and seq

function noteEntity(ents, ref, title, cat) {
  if (!ref) return;
  if (!ents[ref]) ents[ref] = { title: title || ref, cat: cat || '' };
}

// ---- Ratings: latest rating per ref

function upsertRatings(ss, rows, ents) {
  if (!rows.length) return 0;
  var sh = ss.getSheetByName('Ratings');
  var rowOf = {};
  column(sh, 1).forEach(function (r, i) { rowOf[r[0]] = i + 2; });
  var fresh = [];
  var next = sh.getLastRow() + 1;
  rows.forEach(function (r) {
    var ref = String(r.ref);
    var vals = [ref, r.title, r.cat, r.stars, new Date(r.ts)];
    noteEntity(ents, ref, r.title, r.cat);
    if (rowOf[ref]) {
      sh.getRange(rowOf[ref], 1, 1, 5).setValues([vals]);
    } else {
      rowOf[ref] = next + fresh.length;
      fresh.push(vals);
    }
  });
  if (fresh.length) sh.getRange(next, 1, fresh.length, 5).setValues(fresh);
  return rows.length;
}

// ---- Events: append only, event_id makes a retry harmless. Every new row gets
// the next seq (max(seq)+1), never a row number, because a sort would break it.

function addEvents(ss, events, ents) {
  if (!events.length) return 0;
  var sh = ss.getSheetByName('Events');
  var have = {};
  column(sh, 1).forEach(function (r) { have[r[0]] = true; });
  var seq = nextSeqOf(sh, 16);
  var fresh = [];
  events.forEach(function (ev) {
    var id = String(ev.id);
    if (have[id]) return;                                   // a retried capture never duplicates
    have[id] = true;
    noteEntity(ents, String(ev.ref || ''), ev.title, ev.cat);
    fresh.push([id, new Date(ev.ts), String(ev.day || ''), ev.kind || 'note', String(ev.ref || ''),
      ev.title || '', ev.cat || '', ev.stars === undefined || ev.stars === null ? '' : ev.stars,
      ev.pos || '', ev.note || '', ev.src || 'watch', '',
      ev.track || '', ev.about || '', ev.place || '', seq++]);
  });
  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 16).setValues(fresh);
  return fresh.length;
}

function nextSeqOf(sh, col) {
  var max = 0;
  var last = sh.getLastRow();
  if (last > 1) {
    var vals = sh.getRange(2, col, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var s = +vals[i][0];
      if (s > max) max = s;
    }
  }
  return max + 1;
}

// ---- Entities: one row per ref; the numbers are formulas over Events (voided out)

function entityFormulas(r) {
  var live = ',Events!$L:$L,""';
  return [
    '=IFERROR(MINIFS(Events!$B:$B,Events!$E:$E,$A' + r + live + '),"")',
    '=IFERROR(MAXIFS(Events!$B:$B,Events!$E:$E,$A' + r + live + '),"")',
    '=COUNTIFS(Events!$E:$E,$A' + r + live + ')',
    '=IFERROR(AVERAGEIFS(Events!$H:$H,Events!$E:$E,$A' + r + ',Events!$D:$D,"rated"' + live + '),"")',
    '=IFERROR(VLOOKUP($A' + r + ',Ratings!$A:$D,4,FALSE),"")'
  ];
}

function addEntities(ss, ents) {
  var sh = ss.getSheetByName('Entities');
  var have = {};
  column(sh, 1).forEach(function (r) { have[r[0]] = true; });
  var refs = Object.keys(ents).filter(function (k) { return !have[k]; });
  if (!refs.length) return 0;
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, refs.length, 3).setValues(refs.map(function (k) {
    return [k, ents[k].title, ents[k].cat];
  }));
  sh.getRange(start, 4, refs.length, 5).setFormulas(refs.map(function (k, i) { return entityFormulas(start + i); }));
  return refs.length;
}

function refreshEntityFormulas(ss) {
  var sh = ss.getSheetByName('Entities');
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var f = [];
  for (var i = 0; i < n; i++) f.push(entityFormulas(i + 2));
  sh.getRange(2, 4, n, 5).setFormulas(f);
}

// ---- edits from the web app: void, rename, merge. v3 behaviour, byte for byte,
// via the same doVoid/doRename/doMerge the change pipeline uses.

function rowsWhere(sh, col, value) {
  var out = [];
  column(sh, col).forEach(function (r, i) { if (String(r[0]) === value) out.push(i + 2); });
  return out;
}

function setCol(sh, rows, col, value) {
  rows.forEach(function (r) { sh.getRange(r, col, 1, 1).setValues([[value]]); });
}

function editAction(ss, b) {
  if (b.action === 'void') {
    doVoid(ss, b.id);
    return { ok: true, v: 4 };
  }
  if (b.action === 'rename') {
    var name = String(b.name || '').trim();
    if (!b.ref || !name) return { ok: false };
    doRename(ss, b.ref, name);
    return { ok: true, v: 4 };
  }
  if (b.action === 'merge') {                      // move everything from one entity into another
    var from = String(b.from || ''), to = String(b.to || ''), toTitle = String(b.title || '');
    if (!from || !to || from === to) return { ok: false };
    doMerge(ss, from, to, toTitle, b.cat);
    return { ok: true, v: 4 };
  }
  return { ok: false };
}

function doVoid(ss, id) {
  var ev = ss.getSheetByName('Events');
  setCol(ev, rowsWhere(ev, 1, String(id)), 12, 'x');
}

function doRename(ss, ref, name) {
  var en = ss.getSheetByName('Entities'), ra = ss.getSheetByName('Ratings'), ev = ss.getSheetByName('Events');
  setCol(en, rowsWhere(en, 1, ref), 2, name);
  setCol(ra, rowsWhere(ra, 1, ref), 2, name);
  setCol(ev, rowsWhere(ev, 5, ref), 6, name);
}

function doMerge(ss, from, to, toTitle, cat) {
  var ev = ss.getSheetByName('Events'), ra = ss.getSheetByName('Ratings'), en = ss.getSheetByName('Entities');
  var i;
  var evRows = rowsWhere(ev, 5, from);
  setCol(ev, evRows, 5, to);
  setCol(ev, evRows, 6, toTitle);
  var fromRatings = rowsWhere(ra, 1, from), toRatings = rowsWhere(ra, 1, to);
  if (fromRatings.length && !toRatings.length) {
    setCol(ra, fromRatings, 1, to);
    setCol(ra, fromRatings, 2, toTitle);
  } else {
    for (i = fromRatings.length - 1; i >= 0; i--) ra.deleteRow(fromRatings[i]);
  }
  if (!rowsWhere(en, 1, to).length) addEntities(ss, (function () { var o = {}; o[to] = { title: toTitle, cat: cat || '' }; return o; })());
  var fromEnt = rowsWhere(en, 1, from);
  for (i = fromEnt.length - 1; i >= 0; i--) en.deleteRow(fromEnt[i]);
  refreshEntityFormulas(ss);
}

// The PWA (and a v3 client) send edit actions without a change id, so the script
// derives a stable one from the payload: a retry of the same edit logs once.

function logActionChange(ss, b) {
  var type = String(b.action);
  var payload = null;
  if (type === 'void') payload = { eventId: String(b.id == null ? '' : b.id) };
  else if (type === 'rename') payload = { ref: String(b.ref || ''), name: String(b.name || '').trim() };
  else if (type === 'merge') payload = { from: String(b.from || ''), to: String(b.to || ''), title: String(b.title || ''), cat: b.cat == null ? null : String(b.cat) };
  else return;
  var id = null;
  if (type === 'void') id = 'ch-void-' + payload.eventId;
  else if (type === 'rename') id = 'ch-rename-' + payload.ref + '-' + payload.name;
  else id = 'ch-merge-' + payload.from + '-' + payload.to + '-' + payload.title;
  applyChanges(ss, [{ id: id, type: type, payload: payload, ts: Date.now() }]);
}

// ---- the change pipeline. Applies a change to the sheet (exactly what the
// matching v3 edit does) and appends it to the Changes tab. Idempotent by id:
// the same id is never applied or logged twice. The payload is logged as the
// applied truth - invalid entity field values are dropped, not recorded.

function applyChanges(ss, changes) {
  if (!changes || !changes.length) return 0;
  var sh = ss.getSheetByName('Changes');
  var known = {};
  column(sh, 2).forEach(function (r) { known[String(r[0])] = true; });
  var seq = nextSeqOf(sh, 1);                            // max(seq)+1, under the caller's lock
  var now = Date.now();
  var fresh = [];
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    if (!c || !c.id || !c.type) continue;
    var id = String(c.id);
    if (known[id]) continue;                             // applied once, logged once
    known[id] = true;
    var payload = c.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (err) { payload = null; }
    }
    var out = applyChange(ss, String(c.type), payload);
    if (out === null) continue;                          // malformed: nothing to log either
    fresh.push([seq++, id, new Date(+c.ts || now), String(c.type), JSON.stringify(out)]);
  }
  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 5).setValues(fresh);
  return fresh.length;
}

function applyChange(ss, type, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (type === 'void') {
    if (payload.eventId == null || payload.eventId === '') return null;
    var evId = String(payload.eventId);
    doVoid(ss, evId);
    return { eventId: evId };
  }
  if (type === 'rename') {
    var ref = String(payload.ref || ''), name = String(payload.name || '').trim();
    if (!ref || !name) return null;
    doRename(ss, ref, name);
    return { ref: ref, name: name };
  }
  if (type === 'merge') {
    var from = String(payload.from || ''), to = String(payload.to || ''), toTitle = String(payload.title || '');
    if (!from || !to || from === to) return null;
    doMerge(ss, from, to, toTitle, payload.cat);
    return { from: from, to: to, title: toTitle, cat: payload.cat == null ? null : String(payload.cat) };
  }
  if (type === 'entityFields') return entityFieldsApply(ss, payload);
  if (type === 'alias') {
    if (payload.heard == null || payload.ref == null) return null;
    return { heard: String(payload.heard), ref: String(payload.ref) };
  }
  if (type === 'fuDone') {
    if (payload.key == null) return null;
    return { key: String(payload.key), done: payload.done === false ? false : true, ts: +payload.ts || 0 };
  }
  return payload;   // unknown types are recorded untouched so newer clients can replay them
}

// entityFields: remindDays is an integer 1..730 (null clears), snoozedUntil an ISO
// date (null clears), retired a bool (null keeps the old flag), org/role/tags text
// (missing or null keeps the old value). Invalid values are ignored, not errors.

function entityFieldsApply(ss, payload) {
  var ref = String(payload.ref || '');
  if (!ref) return null;
  var en = ss.getSheetByName('Entities');
  var rows = rowsWhere(en, 1, ref);
  var out = { ref: ref };

  if (payload.remindDays === null) {
    if (rows.length) setCol(en, rows, 9, '');
    out.remindDays = null;
  } else if (typeof payload.remindDays === 'number' && isFinite(payload.remindDays) &&
             Math.round(payload.remindDays) === payload.remindDays &&
             payload.remindDays >= REMIND_MIN_DAYS && payload.remindDays <= REMIND_MAX_DAYS) {
    if (rows.length) setCol(en, rows, 9, payload.remindDays);
    out.remindDays = payload.remindDays;
  }

  if (payload.snoozedUntil === null) {
    if (rows.length) setCol(en, rows, 10, '');
    out.snoozedUntil = null;
  } else if (typeof payload.snoozedUntil === 'string' && isoDateOk(payload.snoozedUntil)) {
    if (rows.length) setCol(en, rows, 10, payload.snoozedUntil);
    out.snoozedUntil = payload.snoozedUntil;
  }

  if (payload.retired === true || payload.retired === false) {
    if (rows.length) setCol(en, rows, 11, payload.retired);
    out.retired = payload.retired;
  }

  var text = { org: 12, role: 13, tags: 14 };
  for (var k in text) {
    if (typeof payload[k] === 'string') {
      if (rows.length) setCol(en, rows, text[k], payload[k]);
      out[k] = payload[k];
    }
  }
  return out;
}

function isoDateOk(s) {
  if (typeof s !== 'string' || s.length < 10 || s.length > 32) return false;
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(s)) return false;
  var y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10);
  if (!(y >= 1900 && y <= 2999) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return false;
  return s.length === 10 || !isNaN(Date.parse(s));
}


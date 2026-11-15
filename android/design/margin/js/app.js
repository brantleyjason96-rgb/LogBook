/* Logbook for Android, "Margin" direction: clickable mockup. Not the app.
   Every reusable piece carries data-component="Lb..." and becomes one composable (see HANDOFF.md).
   Routes match brief section 5 and are kept in the hash: #feed?filter=people, #person/n:dr-okafor ... */
(function () {
  'use strict';
  var D = window.LB_DATA, DAY = 864e5;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var qs = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ state
  var S = {
    hash: '', path: 'feed', p: {}, stack: [], tab: 'feed',
    theme: qs.get('theme') || 'system', sync: qs.get('sync') || 'synced', fs: +(qs.get('fs') || 1), device: qs.get('device') || '360',
    done: {}, queue: 2, peopleSort: 'recent', thingSort: 'recent', thingCat: 'all',
    menu: null, sheet: null, snack: null, F: null, notif: true, checkTime: '8:00 AM', recent: D.recentSearches.slice(), syncing: false, scroll: {}
  };
  var SYNC = {
    synced: { pill: 'Synced 4:12', cls: 'ok', line: '' },
    waiting: { pill: '2 waiting', cls: 'wait', line: 'Two entries are saved on this phone and will send soon.' },
    offline: { pill: 'Offline', cls: '', line: 'You are offline. New entries are saved on this phone.' },
    none: { pill: 'Not connected', cls: 'none', line: 'This phone is not connected to your Sheet.', act: ['Connect', 'connect'] },
    wrongkey: { pill: 'Wrong key', cls: 'bad', line: 'The Sheet refused the key. Nothing is syncing.', act: ['Fix in Settings', 'settings'] },
    oldscript: { pill: 'Script is old', cls: 'bad', line: 'Your Apps Script is older than version 4. Update it to sync.', act: ['How to update', 'settings'] }
  };

  // ------------------------------------------------------------------ dates
  var dn = function (s) { var a = s.split('-'); return Math.round(Date.UTC(+a[0], +a[1] - 1, +a[2]) / DAY); };
  var T0 = dn(D.TODAY);
  var dstr = function (n) { return new Date(n * DAY).toISOString().slice(0, 10); };
  var ago = function (s) { return T0 - dn(s); };
  var fmt = function (s, o) { return new Date(dn(s) * DAY).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o)); };
  var dLong = function (s) { return fmt(s, { weekday: 'long', month: 'short', day: 'numeric' }); };
  var dShort = function (s) { return fmt(s, { weekday: 'short', month: 'short', day: 'numeric' }); };
  var dMD = function (s) { return fmt(s, { month: 'short', day: 'numeric' }); };
  var dFull = function (s) { return fmt(s, { month: 'long', day: 'numeric' }); };
  var rel = function (n) { return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? n + ' days ago' : n < 60 ? Math.round(n / 7) + ' weeks ago' : Math.round(n / 30) + ' months ago'; };
  var everyText = function (d) { return d <= 1 ? 'about daily' : d < 10 ? 'every ' + d + ' days' : d < 45 ? 'every ' + Math.round(d / 7) + ' weeks' : 'every ' + Math.round(d / 30) + ' months'; };
  var mins = function (t) { var m = /(\d+):(\d+) (AM|PM)/.exec(t); return m ? ((+m[1] % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2] : 0; };

  // ------------------------------------------------------------------ model (stands in for :core)
  var person = function (ref) { return D.people.find(function (p) { return p.ref === ref; }); };
  var thing = function (ref) { return D.things.find(function (t) { return t.ref === ref; }); };
  var live = function () { return D.events.filter(function (e) { return !e.voided; }); };
  var evOf = function (ref) { return live().filter(function (e) { return e.ref === ref; }); };
  var lastMet = function (p) { var e = evOf(p.ref).find(function (e) { return e.kind === 'met'; }); return e ? e.date : null; };
  function cad(p) {
    var lm = lastMet(p), since = lm ? ago(lm) : null, gap = p.remindDays || p.usualGap || 0, st = 'ok', label = 'On track';
    if (since == null) { st = 'noted'; label = 'Noted'; }
    else if (p.met === 1) { st = 'new'; label = 'New'; }
    else if (since > Math.max(45, gap * 3)) { st = 'quiet'; label = 'Quiet'; }
    else if (since > Math.max(14, gap * 1.6)) { st = 'slipping'; label = 'Slipping'; }
    var snoozed = p.snoozeUntil && dn(p.snoozeUntil) > T0;
    var past = p.remindDays && !p.retired && since != null ? since - p.remindDays : null;
    return { since: since, st: st, label: label, snoozed: snoozed, past: past, due: past != null && past > 0 && !snoozed, dueDate: lm && p.remindDays ? dstr(dn(lm) + p.remindDays) : null };
  }
  var needsYou = function () { return D.people.filter(function (p) { var c = cad(p); return !c.snoozed && (c.due || c.st === 'slipping' || c.st === 'quiet'); }).sort(function (a, b) { return cad(b).since - cad(a).since; }); };
  function statusTag(p) {
    var c = cad(p);
    if (c.due) return '<span class="tag due" data-component="LbStatusTag">Reminder due</span>';
    if (c.snoozed) return '<span class="tag" data-component="LbStatusTag">Snoozed</span>';
    if (c.st === 'slipping' || c.st === 'quiet') return '<span class="tag warn" data-component="LbStatusTag">' + c.label + '</span>';
    return '';
  }

  // follow-ups: the rule from app.js followUps(). Honorific periods are protected here (see HANDOFF, finding F1).
  var FU_LEAD = /^(?:ask|send|email|call|text|bring|check|share|try|buy|book|schedule|reread|re-read|finish|look into|find|talk to|tell|order|print|grade|review|write|read|follow up|remind|invite|thank|return|pick up|drop off)\b/i;
  var FU_NEED = /\b(?:need to|needs to|have to|has to|got to|gotta|plan to|planning to|remember to|supposed to|should|must|don'?t forget to|forgot to)\s+(.+)/i;
  function clauses(e) {
    var parts = String(e.note || '').split(/(?<!\b(?:Ms|Mr|Mrs|Dr))([.;!?\n]+\s*)/), out = [];
    for (var i = 0; i < parts.length; i += 2) {
      var raw = parts[i], c = raw.trim(), m, fu = null;
      if (c.length >= 5 && ago(e.date) <= 60) {
        if (FU_LEAD.test(c)) fu = c; else if ((m = FU_NEED.exec(c)) && m[1].length > 2) fu = m[1];
      }
      out.push({ raw: raw, sep: parts[i + 1] || '', fu: fu, key: e.id + ':' + (i / 2) });
    }
    return out;
  }
  var cap1 = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  function followUps(all) {
    var out = [];
    live().forEach(function (e) { clauses(e).forEach(function (c) { if (c.fu && (all || !S.done[c.key])) out.push({ key: c.key, text: cap1(c.fu), e: e }); }); });
    return out;
  }
  function noteHtml(e, q) {
    if (!e.note) return '';
    if (q) { var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); return '<p>' + esc(e.note).replace(re, '<mark data-component="LbHighlight">$1</mark>') + '</p>'; }
    return '<p>' + clauses(e).map(function (c) {
      if (!c.fu) return esc(c.raw + c.sep);
      var i = c.raw.toLowerCase().lastIndexOf(c.fu.toLowerCase()), lead = i > 0 ? c.raw.slice(0, i) : '';
      return esc(lead) + '<mark data-component="LbHighlight"' + (S.done[c.key] ? ' class="done"' : '') + '>' + esc(c.raw.slice(lead.length)) + '</mark>' + esc(c.sep);
    }).join('') + '</p>';
  }

  // ------------------------------------------------------------------ small components
  var ICON = {
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3c2.2.6 3.5 2.4 3.5 5.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12 5 5 9-10"/>',
    book: '<path d="M12 6.5C10.5 5 8 4.5 3 4.5V18c5 0 7.5.5 9 2 1.5-1.5 4-2 9-2V4.5c-5 0-7.5.5-9 2zM12 6.5V20"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    note: '<path d="M5 4h14v16H5zM9 9h6M9 13h4"/>', pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', chev: '<path d="m9 5 7 7-7 7"/>', up: '<path d="m5 15 7-7 7 7"/>', down: '<path d="m5 9 7 7 7-7"/>',
    more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14M3 10h5M16 10h5M3 14h5M16 14h5"/>', feed: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2M20 14v6h-6M17 17h.01"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>', star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>'
  };
  var ic = function (n) { return '<svg class="i" aria-hidden="true" viewBox="0 0 24 24">' + ICON[n] + '</svg>'; };
  var go = function (to, label, cls, inner, extra) { return '<button type="button" class="' + (cls || '') + '" data-act="go" data-to="' + esc(to) + '"' + (label ? ' aria-label="' + esc(label) + '"' : '') + (extra || '') + '>' + inner + '</button>'; };
  var act = function (a, cls, inner, extra) { return '<button type="button" class="' + (cls || '') + '" data-act="' + a + '"' + (extra || '') + '>' + inner + '</button>'; };
  var bars = function (v) { var mx = Math.max.apply(null, v) || 1; return '<div class="bars" data-component="LbMiniBars" role="img" aria-label="Counts: ' + v.join(', ') + '">' + v.map(function (n) { return '<i' + (n ? '' : ' class="z"') + ' style="height:' + Math.max(8, Math.round(n / mx * 100)) + '%"></i>'; }).join('') + '</div>'; };
  var stars = function (n) { return n == null ? '' : '<span class="st" data-component="LbStarRating" role="img" aria-label="' + n + ' of 5 stars"><u><s style="width:' + (n * 20) + '%"></s></u><em>' + n + '</em></span>'; };
  var pill = function (k) { var s = SYNC[k]; return S.syncing ? '<span class="pill spin" data-component="LbSyncPill">Syncing</span>' : '<span class="pill ' + s.cls + '" data-component="LbSyncPill">' + s.pill + '</span>'; };
  var CAT = { movie: ['Movie', 'm', 'film'], tv: ['TV', 'm', 'film'], podcast: ['Podcast', 'm', 'mic'], album: ['Album', 'm', 'film'], song: ['Song', 'm', 'film'], book: ['Book', 'b', 'book'], recipe: ['Recipe', 'b', 'book'], game: ['Game', 'm', 'film'], coffee: ['Coffee', 'w', 'pin'], restaurant: ['Restaurant', 'w', 'pin'], place: ['Place', 'w', 'pin'], event: ['Event', 'w', 'pin'] };
  var catOf = function (c) { return CAT[c] || [cap1(c || 'Other'), 'w', 'pin']; };
  var tile = function (k, icon) { return '<span class="ki ' + k + '" data-component="LbKindTile">' + ic(icon) + '</span>'; };
  var kb = function () { return '<div class="kb" aria-hidden="true">' + ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map(function (r, i) { return '<div>' + (i === 2 ? '<i class="w">⇧</i>' : '') + r.split('').map(function (c) { return '<i>' + c + '</i>'; }).join('') + (i === 2 ? '<i class="w">⌫</i>' : '') + '</div>'; }).join('') + '<div><i class="w">?123</i><i class="sp"></i><i class="w">⏎</i></div></div>'; };

  function entry(e, o) {
    o = o || {};
    var p = person(e.ref), t = thing(e.ref), k, icn, title, kd = '', fus = clauses(e).filter(function (c) { return c.fu; });
    if (e.kind === 'met') { k = ''; icn = 'people'; title = o.ctx === 'person' ? '<b>Met</b>' : go('person/' + e.ref, '', 'lk', esc(p ? p.name : e.title)); kd = (o.ctx === 'person' ? '' : 'met') + (e.place ? (o.ctx === 'person' ? '' : ' · ') + esc(e.place) : ''); }
    else if (e.kind === 'note') { k = 't'; icn = 'note'; title = '<b>' + (o.ctx === 'person' ? 'Note' : 'A thought') + '</b>'; if (p && o.ctx !== 'person') kd = 'about ' + go('person/' + e.ref, '', 'lk', esc(p.name), ' style="font-size:var(--f-label)"'); else if (t && o.ctx !== 'person') kd = 'about ' + esc(t.title); }
    else {
      var c = catOf(t ? t.cat : e.cat); k = c[1]; icn = c[2];
      title = o.ctx === 'person' ? '<b>' + (e.kind === 'went' ? 'Went' : e.kind === 'rated' ? 'Rated' : 'Logged') + '</b>' : go('item/' + e.ref, '', 'plain', esc(t ? t.title : e.title));
      kd = (e.kind === 'went' ? 'went · ' : '') + (o.ctx === 'person' ? '' : c[0].toLowerCase() === 'tv' ? 'TV' : c[0].toLowerCase()) + (e.pos ? ' · stopped at ' + esc(e.pos) : '') + (e.kind === 'logged' && !e.pos && t && t.stars == null ? ' · not rated yet' : '');
    }
    kd = kd.replace(/^ · /, '');
    var time = o.ctx === 'person' || o.ctx === 'search' ? (o.ctx === 'search' ? fmt(e.date, { weekday: 'short' }) + '<br>' + dMD(e.date) : dMD(e.date) + '<br>' + e.t) : e.t;
    var open = fus.filter(function (c) { return !S.done[c.key]; }).length;
    var fub = fus.length && !o.q ? '<button type="button" class="fub' + (open ? '' : ' done') + '" data-component="LbFollowUpTag" data-act="fu-entry" data-id="' + e.id + '" role="checkbox" aria-checked="' + (!open) + '"><i></i>' + (open ? 'Follow-up' : 'Done') + '</button>' : '';
    return '<div class="en' + (o.fresh ? ' new' : '') + '" data-component="LbEntryRow" data-ev="' + e.id + '"' + (o.ctx === 'person' ? ' data-hold="1"' : '') + '><time>' + time + '</time>' + tile(k, icn) + '<div>' + title + stars(e.stars) + (kd ? '<span class="kd">' + kd + '</span>' : '') + noteHtml(e, o.q) + fub + '</div></div>';
  }
  function dayBlock(date, evs, o) {
    var a = ago(date), name = a === 0 ? 'Today' : a === 1 ? 'Yesterday' : dShort(date), sub = a < 2 ? dLong(date) : '';
    return '<div><div class="dh" data-component="LbDayHeader"><b>' + name + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '<em>' + evs.length + (evs.length === 1 ? ' entry' : ' entries') + '</em></div>' +
      evs.map(function (e, i) { return entry(e, { fresh: a === 0 && i === 0 && !(o && o.plain) }); }).join('') + '</div>';
  }
  function days(evs) {
    var by = {}, order = [];
    evs.forEach(function (e) { if (!by[e.date]) { by[e.date] = []; order.push(e.date); } by[e.date].push(e); });
    return order.map(function (d) { return dayBlock(d, by[d]); }).join('');
  }
  var empty = function (k, icon, title, text, btn) { return '<div class="empty" data-component="LbEmptyState">' + tile(k, icon) + '<b>' + title + '</b><span>' + text + '</span>' + (btn || '') + '</div>'; };

  // ------------------------------------------------------------------ shells
  function topBar() {
    var s = SYNC[S.sync];
    return '<div class="tp" data-component="LbTopBar">' + go('search', '', 'sf', ic('search') + '<span>' + (S.fs >= 1.5 ? 'Search' : 'Search people, titles, notes') + '</span>', ' data-component="LbSearchField"') +
      go('account', 'Account and sync. ' + (S.syncing ? 'Syncing' : s.pill), 'av s-' + S.sync, '<i>J</i>', ' data-component="LbAvatarButton"') + '</div>';
  }
  function strip() {
    var s = SYNC[S.sync];
    if (S.syncing) return '<div class="strip" role="status">' + pill(S.sync) + '<span>Checking your Sheet for new entries.</span></div>';
    if (S.sync === 'synced') return '';
    return '<div class="strip" role="status" data-component="LbSyncStrip">' + pill(S.sync) + '<span>' + s.line + '</span>' + (s.act ? go(s.act[1], '', '', s.act[0]) : '') + '</div>';
  }
  function navBar() {
    var n = needsYou().length, t = S.tab;
    var b = function (id, icon, label, badge) { return '<button type="button" class="' + (t === id ? 'on' : '') + '" data-act="tab" data-to="' + id + '"' + (t === id ? ' aria-current="page"' : '') + '><span class="g">' + ic(icon) + (badge ? '<span class="bdg" aria-label="' + badge + ' people to reach out to">' + badge + '</span>' : '') + '</span>' + label + '</button>'; };
    return '<nav class="nav" data-component="LbBottomNav" aria-label="Main">' + b('feed', 'feed', 'Feed') + b('nudges', 'bell', 'Nudges', n) + b('review', 'bars', 'Review') + '</nav>';
  }
  var fab = function (open) { return open ? go('back', 'Close', 'fab sq', ic('x'), ' data-component="LbNewButton"') : go('capture', 'New entry', 'fab', ic('plus') + '<span>New</span>', ' data-component="LbNewButton"'); };
  function tabShell(inner, flat) { return topBar() + strip() + inner + (flat ? '' : fab(S.path === 'capture') + navBar() + '<div class="gest"></div>'); }
  var body = function (html, cls) { return '<div class="body ' + (cls || '') + '" id="body">' + html + '<div class="sm" style="text-align:center;font-family:var(--mono)">Sample data</div></div>'; };

  // ------------------------------------------------------------------ feed
  var FILTERS = [['all', 'All'], ['people', 'People'], ['things', 'Things'], ['thoughts', 'Thoughts'], ['places', 'Places'], ['loops', 'Open loops']];
  function feedChips(f) {
    var nfu = followUps().length;
    return '<div class="fch" role="tablist" aria-label="Filter the feed">' + FILTERS.map(function (x) {
      var n = x[0] === 'people' ? D.people.length : x[0] === 'loops' ? nfu : 0;
      return go('feed' + (x[0] === 'all' ? '' : '?filter=' + x[0]), '', 'chip' + (f === x[0] ? ' on' : ''), x[1] + (n ? ' <span class="n">' + n + '</span>' : ''), ' role="tab" aria-selected="' + (f === x[0]) + '" data-component="LbFilterChip"');
    }).join('') + '</div>';
  }
  function weekCard() {
    var w = D.week;
    return go('review', 'Your week: ' + w.entries + ' entries, up from ' + w.before + '. Open the review.', 'wk', '<div class="n">' + w.entries + '<small>entries this week, up from ' + w.before + '</small></div>' + bars(w.perDay) +
      '<p>' + w.peopleMet + ' meetings, ' + w.rated + ' rated. Tap for the full week.</p><div class="th">' + w.themes.slice(0, 3).map(function (t) { return '<span>' + t[0] + (t[1] === 'Rising' ? ' ↑' : t[1] === 'New' ? ' new' : '') + '</span>'; }).join('') + '</div>', ' data-component="LbWeekCard"');
  }
  function peopleList() {
    var s = S.peopleSort, list = D.people.slice(), L = { recent: 'Seen recently', longest: 'Not seen longest', often: 'Most often', az: 'A to Z' };
    list.sort(function (a, b) { return s === 'az' ? a.name.localeCompare(b.name) : s === 'often' ? b.met - a.met : s === 'longest' ? cad(b).since - cad(a).since : cad(a).since - cad(b).since; });
    return '<div class="sub"><span>' + list.length + ' people</span>' + act('menu', '', ic('sort') + L[s], ' data-menu="psort" aria-haspopup="menu"') + '</div><div>' + list.map(function (p) {
      var c = cad(p), notes = evOf(p.ref).filter(function (e) { return e.note; }).length;
      return go('person/' + p.ref, '', 'pr', '<span class="pav">' + p.ini + '</span><div><b>' + esc(p.name) + '</b><small>' + (c.since == null ? 'Noted · no meetings yet' : 'Met ' + p.met + ' times · last ' + rel(c.since)) + (notes ? ' · ' + notes + (notes === 1 ? ' note' : ' notes') : '') + '</small></div><div class="mini">' + statusTag(p) + bars(p.months) + '</div>', ' data-component="LbPersonRow"');
    }).join('') + '</div>';
  }
  function thingsList() {
    var cats = ['all'].concat(D.things.map(function (t) { return t.cat; }).filter(function (c, i, a) { return a.indexOf(c) === i; })), s = S.thingSort, L = { recent: 'Recent', stars: 'Highest rated', az: 'A to Z' };
    var list = D.things.filter(function (t) { return S.thingCat === 'all' || t.cat === S.thingCat; });
    list.sort(function (a, b) { var ea = evOf(a.ref)[0], eb = evOf(b.ref)[0]; return s === 'az' ? a.title.localeCompare(b.title) : s === 'stars' ? (b.stars || 0) - (a.stars || 0) : dn(eb.date) - dn(ea.date); });
    return '<div class="chips" style="padding-block:0">' + cats.map(function (c) { return act('thing-cat', 'chip' + (S.thingCat === c ? ' on' : ''), c === 'all' ? 'All kinds' : catOf(c)[0], ' data-v="' + c + '" aria-pressed="' + (S.thingCat === c) + '"'); }).join('') + '</div>' +
      '<div class="sub"><span>' + list.length + (list.length === 1 ? ' thing' : ' things') + '</span>' + act('menu', '', ic('sort') + L[s], ' data-menu="tsort" aria-haspopup="menu"') + '</div><div>' + list.map(function (t) {
        var c = catOf(t.cat), ev = evOf(t.ref);
        return go('item/' + t.ref, '', 'pr', tile(c[1], c[2]).replace('class="ki', 'style="width:40px;height:40px;border-radius:12px" class="ki') + '<div><b>' + esc(t.title) + '</b><small>' + c[0] + ' · ' + ev.length + (ev.length === 1 ? ' entry' : ' entries') + ' · last ' + rel(ago(ev[0].date)) + (t.stoppedAt ? ' · stopped at ' + t.stoppedAt : '') + '</small></div><div class="mini">' + (t.stars == null ? '<span class="tag">Not rated</span>' : stars(t.stars)) + '</div>', ' data-component="LbThingRow"');
      }).join('') + '</div>';
  }
  function vFeed() {
    var f = S.p.filter || 'all', st = S.p.state, inner;
    if (st === 'empty') inner = empty('t', 'note', 'Nothing logged yet', 'Tap New to log who you saw, what you did, or a thought. It is saved on this phone first.', go('capture', '', 'btn r', ic('plus') + 'New entry'));
    else if (f === 'people') inner = peopleList();
    else if (f === 'things') inner = thingsList();
    else {
      var evs = live().filter(function (e) { return f === 'thoughts' ? e.kind === 'note' : f === 'places' ? /^x:/.test(e.ref) : f === 'loops' ? clauses(e).some(function (c) { return c.fu; }) : true; });
      inner = (f === 'all' ? weekCard() : f === 'loops' ? '<div class="sub"><span>' + followUps().length + ' open, found in your notes from the last 60 days</span></div>' : '') +
        (evs.length ? days(evs) : empty('t', 'check', 'Nothing here', 'No entries match this filter yet.'));
    }
    return tabShell(feedChips(f) + body('<div class="fade" style="display:grid;gap:14px">' + inner + '</div>'));
  }

  // ------------------------------------------------------------------ search
  function searchResults(q) {
    q = (q || '').trim();
    if (!q) return '<div class="lbl"><span>Recent searches</span></div><div class="chips" style="padding-block:0">' + S.recent.map(function (r) { return go('search?q=' + encodeURIComponent(r), '', 'chip', ic('search') + esc(r)); }).join('') + '</div>' +
      '<div class="lbl"><span>Themes this week</span></div><div class="chips" style="padding-block:0">' + D.week.themes.map(function (t) { return go('search?q=' + t[0], '', 'chip', esc(t[0]) + ' <span class="n">' + t[2] + '</span>'); }).join('') + '</div>';
    var lq = q.toLowerCase(), ppl = D.people.filter(function (p) { return p.name.toLowerCase().indexOf(lq) >= 0; }), th = D.things.filter(function (t) { return t.title.toLowerCase().indexOf(lq) >= 0; });
    var evs = live().filter(function (e) { return (e.note || '').toLowerCase().indexOf(lq) >= 0; });
    if (!ppl.length && !th.length && !evs.length) return empty('t', 'search', 'No matches', 'Nothing in your people, titles or notes matches \u201c' + esc(q) + '\u201d. Check the spelling or try a shorter word.');
    return (ppl.length || th.length ? '<div class="lbl"><span>People and things</span></div><div class="chips" style="padding-block:0">' + ppl.map(function (p) { return go('person/' + p.ref, '', 'chip', '<span class="pav sm">' + p.ini + '</span>' + esc(p.name)); }).join('') + th.map(function (t) { return go('item/' + t.ref, '', 'chip', ic(catOf(t.cat)[2]) + esc(t.title)); }).join('') + '</div>' : '') +
      '<div class="lbl"><span>' + evs.length + (evs.length === 1 ? ' entry' : ' entries') + '</span><span>Newest first</span></div><div>' + evs.map(function (e) { return entry(e, { ctx: 'search', q: q }); }).join('') + '</div>';
  }
  function vSearch() {
    var q = S.p.q || '';
    return '<div class="tp"><div class="sf on" data-component="LbSearchField">' + go('back', 'Back', 'ibt', ic('back')) + '<input id="q" type="search" value="' + esc(q) + '" placeholder="Search people, titles, notes" aria-label="Search" autocomplete="off">' + (q ? act('clear-q', 'ibt', ic('x'), ' aria-label="Clear search"') : '') + '</div></div>' +
      '<div class="body flat" id="body"><div id="sres" style="display:grid;gap:14px">' + searchResults(q) + '</div></div>' + (S.p.kb === '0' ? '' : kb()) + '<div class="gest"></div>';
  }

  // ------------------------------------------------------------------ nudges
  function nudgeCard(p) {
    var c = cad(p), why = c.due ? 'Reminder ' + everyText(p.remindDays) + ', ' + c.past + ' days past' : c.label + ', ' + c.since + ' days. You usually meet ' + everyText(p.usualGap);
    return '<div class="card" data-component="LbNudgeCard">' + go('person/' + p.ref, '', 'who', '<span class="pav md">' + p.ini + '</span><div><b>' + esc(p.name) + '</b><small>' + why + '</small></div>') + statusTag(p) +
      '<div class="quote">' + esc(p.draft) + '</div><div class="btnr">' + act('text', 'btn', ic('send') + 'Text', ' data-ref="' + p.ref + '"') + act('menu', 'btn o', 'Snooze ' + ic('down'), ' data-menu="snooze" data-ref="' + p.ref + '" aria-haspopup="menu"') + act('met-now', 'btn o', 'Met just now', ' data-ref="' + p.ref + '"') + '</div></div>';
  }
  function fuRow(f) {
    var d = S.done[f.key], p = person(f.e.ref), from = p ? (f.e.kind === 'met' ? 'From meeting ' : 'From a note on ') + p.name : f.e.kind === 'went' ? 'From ' + (thing(f.e.ref) || {}).title : 'From a thought';
    return '<div class="fu' + (d ? ' done' : '') + '" data-component="LbFollowUpRow">' + act('fu', 'ck', '<i>' + (d ? ic('check') : '') + '</i>', ' data-key="' + f.key + '" role="checkbox" aria-checked="' + !!d + '" aria-label="Done: ' + esc(f.text) + '"') + '<div><mark' + (d ? ' class="done"' : '') + '>' + esc(f.text) + '</mark><small>' + esc(from) + ' · ' + rel(ago(f.e.date)) + '</small></div></div>';
  }
  function suggestions() {
    var out = [], pr = person('n:priya-nair'), bs = thing('b:braiding-sweetgrass'), top = needsYou()[0];
    if (pr && !evOf(pr.ref).some(function (e) { return e.kind === 'met' && e.date === D.TODAY; })) out.push(['Met Priya?', 'You often see Priya on Sundays around 4 PM', 'Log it', 'capture/met?who=' + pr.ref]);
    if (bs) out.push(['Back to Braiding Sweetgrass?', 'Stopped at chapter 7', 'Add note', 'capture/note?about=' + bs.ref]);
    if (top) out.push(['Check in with ' + top.greet, 'It has been ' + cad(top).since + ' days, longer than your usual ' + everyText(top.usualGap), 'Open', 'person/' + top.ref]);
    return out;
  }
  function vNudges() {
    var ppl = needsYou(), fus = followUps(true).filter(function (f) { return !S.done[f.key] || S.done[f.key] === 'now'; }), nOpen = followUps().length, sg = suggestions();
    if (S.p.state === 'empty') return tabShell('<div class="ttl"><h1>Nudges</h1></div>' + body(empty('m', 'check', 'You are all caught up', 'No one is overdue and no follow-ups are open. New nudges appear here when a reminder comes due.')));
    return tabShell('<div class="ttl"><h1>Nudges</h1><span>' + ppl.length + (ppl.length === 1 ? ' person' : ' people') + ', ' + nOpen + (nOpen === 1 ? ' follow-up' : ' follow-ups') + '</span></div>' + body(
      '<div class="lbl"><span>Reach out</span><span>' + ppl.length + '</span></div>' + (ppl.length ? ppl.map(nudgeCard).join('') : '<p class="sm2">No one is overdue right now.</p>') +
      '<div class="lbl"><span>Follow-ups</span><span>' + nOpen + '</span></div>' + (fus.length ? '<div class="card">' + fus.map(fuRow).join('') + '</div>' : '<p class="sm2">No open follow-ups.</p>') +
      '<div class="lbl"><span>Looks like right now</span></div>' + sg.map(function (s) { return '<div class="card dash" data-component="LbSuggestionCard"><div class="sg"><div class="g"><b>' + esc(s[0]) + '</b><small>' + esc(s[1]) + '</small></div>' + go(s[3], '', 'btn', s[2]) + '</div></div>'; }).join('')));
  }

  // ------------------------------------------------------------------ review
  function heat() {
    var weeks = 12, start = T0 - 6 - (weeks - 1) * 7, seed = 7, cells = '', months = '', counts = {};
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    live().forEach(function (e) { counts[e.date] = (counts[e.date] || 0) + 1; });
    for (var w = 0; w < weeks; w++) {
      for (var r = 0; r < 7; r++) {
        var d = start + w * 7 + r; if (d > T0) continue;
        var x = rnd(), ds = dstr(d), n = T0 - d < 7 ? (counts[ds] || 0) : Math.max(counts[ds] || 0, x < .28 ? 0 : x < .58 ? 1 : x < .8 ? 2 : x < .93 ? 3 : 5);
        var lvl = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4;
        cells += '<rect class="l' + lvl + '" data-act="go" data-to="today/' + ds + '" x="' + (w * 17 + 14) + '" y="' + (r * 17 + 14) + '" width="14" height="14" rx="3"><title>' + dMD(ds) + ': ' + n + '</title></rect>';
      }
      var first = dstr(start + w * 7);
      if (+first.slice(8) <= 7) months += '<text x="' + (w * 17 + 14) + '" y="9">' + fmt(first, { month: 'short' }) + '</text>';
    }
    return '<svg class="heat" data-component="LbActivityGrid" viewBox="0 0 ' + (weeks * 17 + 14) + ' 135" role="img" aria-label="Entries per day for the last 12 weeks. Tap a day to open it.">' + months + cells + '</svg>';
  }
  function vReview() {
    var w = D.week, mx = w.themes[0][2], cmx = D.cats30[0][2], tt = { Rising: '', New: '', Steady: '', Fading: ' warn' };
    return tabShell('<div class="ttl"><h1>Your week</h1><span>compared with the week before</span></div>' + body(
      '<p class="story">' + D.story + '</p>' +
      '<div class="stats two">' + [[w.entries, 'entries', w.before], [w.peopleMet, 'meetings', w.peopleBefore], [w.rated, 'rated', w.ratedBefore], [w.avgStars, 'average stars', w.avgBefore]].map(function (s) { return '<div class="stat" data-component="LbStatTile"><b>' + s[0] + '</b><span>' + s[1] + ' (' + s[2] + ' before)</span></div>'; }).join('') + '</div>' +
      '<div class="card"><h4>Themes in your notes</h4>' + w.themes.map(function (t) { return go('search?q=' + t[0], '', 'theme', '<div class="g"><b>' + t[0] + '</b> <span class="tag' + tt[t[1]] + '">' + t[1] + '</span><small>' + t[2] + ' entries' + (t[3] ? ', ' + t[3] : '') + '</small></div><span class="meter" data-component="LbMeter"><i style="width:' + Math.round(t[2] / mx * 100) + '%"></i></span>', ' data-component="LbThemeRow"'); }).join('') + '</div>' +
      '<div class="card"><h4>Last 12 weeks</h4>' + heat() + '<span class="sm">Tap a day to open it.</span></div>' +
      '<div class="card"><h4>By category, 30 days</h4>' + D.cats30.map(function (c) { return '<div class="hbar" data-component="LbCategoryBar" style="--c:var(--' + c[1] + '-fg)"><span>' + c[0] + '</span><i style="width:' + Math.round(c[2] / cmx * 100) + '%"></i><span>' + c[2] + '</span></div>'; }).join('') + '</div>' +
      '<div class="card"><h4>Worth noticing</h4>' + D.notices.map(function (n) { return '<div class="tg" style="--c:var(--' + n[0] + ')"><i></i><div>' + n[1] + '</div></div>'; }).join('') + '</div>' +
      '<div class="card"><h4>Your taste, from your ratings</h4>' + D.taste.map(function (t) { return '<div><div class="hd"><b>' + t[0] + '</b><span class="sm">' + t[1].toFixed(1) + ' average, ' + t[2] + ' rated</span></div><span class="meter wide" style="margin-top:6px"><i style="width:' + t[1] * 20 + '%;background:var(--' + t[3] + '-fg)"></i></span></div>'; }).join('') + '</div>' +
      '<div class="stats two"><div class="stat"><b>' + w.streak + ' days</b><span>logging streak</span></div>' + go('feed?filter=loops', '', 'stat', '<b>' + followUps().length + '</b><span>open follow-ups</span>') + '</div>'));
  }

  // ------------------------------------------------------------------ today
  function calendar(sel, actName) {
    var first = dn('2026-11-01'), lead = new Date(first * DAY).getUTCDay(), has = {}, h = '';
    live().forEach(function (e) { has[e.date] = 1; });
    'SMTWTFS'.split('').forEach(function (c) { h += '<span>' + c + '</span>'; });
    for (var i = 0; i < lead; i++) h += '<span></span>';
    for (var d = 0; d < 30; d++) { var ds = dstr(first + d); h += '<button type="button" data-act="' + actName + '" data-d="' + ds + '" class="' + (has[ds] ? 'has ' : '') + (ds === sel ? 'sel' : '') + '"' + (first + d > T0 ? ' disabled' : '') + ' aria-label="' + dFull(ds) + '">' + (d + 1) + '</button>'; }
    return '<div class="cal" data-component="LbCalendar">' + h + '</div>';
  }
  function vToday() {
    var date = S.path.split('/')[1] || D.TODAY, evs = live().filter(function (e) { return e.date === date; }), a = ago(date);
    return '<div class="cap-top">' + go('back', 'Back', 'ibt', ic('back')) + '<span class="crumb">' + (a === 0 ? 'Today' : a === 1 ? 'Yesterday' : rel(a)) + '</span>' +
      go('today/' + dstr(dn(date) - 1), 'Previous day', 'ibt', ic('back')) + go('today/' + dstr(dn(date) + 1), 'Next day', 'ibt', ic('chev'), a <= 0 ? ' disabled style="opacity:.3"' : '') + go('today/' + date + '?pick=1', 'Pick a date', 'ibt', ic('cal')) + '</div>' +
      '<div class="ttl"><h1>' + dLong(date) + '</h1></div>' +
      '<div class="body" id="body">' + (evs.length ? '<div><div class="dh"><b></b><em>' + evs.length + (evs.length === 1 ? ' entry' : ' entries') + '</em></div>' + evs.map(function (e) { return entry(e); }).join('') + '</div>' : empty('t', 'cal', 'Nothing logged this day', 'You can still add something for ' + dFull(date) + '. Use New, then set When.')) + '</div>' +
      fab() + navBar() + '<div class="gest"></div>' +
      (S.p.pick ? '<div class="scrim hi" data-act="go" data-to="today/' + date + '"></div><div class="sheet" data-component="LbSheet" role="dialog" aria-label="Pick a date"><h2>November 2026</h2>' + calendar(date, 'pick-day') + '<span class="sm">Days in bold have entries.</span><div class="gest"></div></div>' : '');
  }

  // ------------------------------------------------------------------ capture
  var MEDIA = [['movie', 'Movie'], ['tv', 'TV'], ['podcast', 'Podcast'], ['album', 'Album'], ['song', 'Song'], ['book', 'Book'], ['recipe', 'Recipe'], ['game', 'Game']];
  var SRC = { movie: 'TMDB', tv: 'TMDB', podcast: 'iTunes', album: 'iTunes', song: 'iTunes', book: 'Open Library', recipe: 'TheMealDB' };
  function newF(t) {
    var F = { t: t, name: '', ref: null, note: '', when: 'Just now', more: false, place: '', remind: 'Off', about: null, tag: '', stars: 0, kind: 'movie', q: '', picked: null, err: '' };
    if (S.p.demo) { F.name = 'coffee with Maria'; F.ref = 'n:maria-alvarez'; F.note = 'Walked the lake loop. She is applying for the instructional coach job. Ask how the interview goes.'; F.more = true; F.place = 'Lakeside Park'; F.remind = '2 weeks'; }
    if (S.p.who) { F.ref = S.p.who; F.name = person(S.p.who).name; }
    if (S.p.about) F.about = S.p.about;
    if (S.p.q) F.q = S.p.q;
    if (S.p.kind) F.kind = S.p.kind;
    return F;
  }
  function parseWho(F) {
    var m = /^(.*?)\s+with\s+(.+)$/i.exec(F.name.trim()), who = (m ? m[2] : F.name).trim().toLowerCase(), what = m ? m[1].trim() : '';
    var hits = who ? D.people.filter(function (p) { return p.name.toLowerCase().indexOf(who) >= 0 || who.split(' ').some(function (w) { return w.length > 1 && p.name.toLowerCase().split(' ').indexOf(w) >= 0; }); }) : [];
    return { what: what, who: who, hits: hits, picked: F.ref ? person(F.ref) : hits[0] };
  }
  function parseHtml(F) {
    var r = parseWho(F);
    if (!r.who) return '<span class="sm">You can type a name, or a phrase like \u201ccoffee with Maria\u201d.</span>';
    return r.picked ? ic('check') + '<span>Reading this as ' + (r.what ? '<b>' + esc(r.what) + '</b> with ' : '') + '<b>' + esc(r.picked.name) + '</b></span>'
      : ic('plus') + '<span>New person: <b>' + esc(r.who.replace(/\b\w/g, function (c) { return c.toUpperCase(); })) + '</b></span>';
  }
  function pchips(F) {
    var r = parseWho(F), list = r.who ? r.hits : D.people.slice(0, 4);
    return list.map(function (p) { return act('pick-person', 'chip' + (r.picked === p && r.who ? ' on' : ''), esc(p.name), ' data-ref="' + p.ref + '" aria-pressed="' + (r.picked === p && !!r.who) + '"'); }).join('');
  }
  var chipset = function (name, opts, cur) { return '<div class="chips" style="padding-block:0" role="group">' + opts.map(function (o) { return act('set-f', 'chip' + (cur === o ? ' on' : ''), (o === 'Pick date and time' ? ic('cal') : '') + esc(o), ' data-k="' + name + '" data-v="' + esc(o) + '" aria-pressed="' + (cur === o) + '"'); }).join('') + '</div>'; };
  var field = function (id, label, val, o) { o = o || {}; return '<div data-component="LbField"><label class="fl" for="' + id + '">' + label + '</label><div class="fld' + (o.ta ? ' ta' : '') + (o.bad ? ' bad' : '') + '">' + (o.icon ? ic(o.icon) : '') + (o.ta ? '<textarea id="' + id + '" data-f="' + o.f + '" rows="3" placeholder="' + (o.ph || '') + '">' + esc(val) + '</textarea>' + act('mic', 'mic', ic('mic'), ' aria-label="Dictate" data-for="' + id + '"') : '<input id="' + id + '" data-f="' + o.f + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '" placeholder="' + (o.ph || '') + '" autocomplete="off">') + '</div>' + (o.bad ? '<p class="sm" style="color:var(--coral);margin-top:4px" role="alert">' + o.bad + '</p>' : '') + '</div>'; };
  function starInput(F) {
    return '<div data-component="LbStarInput"><span class="fl">Rating' + (F.t === 'any' ? ' (optional)' : '') + '</span><div class="stars-in">' + act('star-step', 'rnd', ic('minus'), ' data-d="-0.5" aria-label="Half a star less"') +
      '<span class="track" id="track" role="slider" tabindex="0" aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + F.stars + '" aria-valuetext="' + (F.stars ? F.stars + ' stars' : 'Not rated') + '"><s style="width:' + F.stars * 20 + '%"></s></span>' +
      '<span class="val" id="sval">' + (F.stars ? F.stars : '–') + '</span>' + act('star-step', 'rnd', ic('plus'), ' data-d="0.5" aria-label="Half a star more"') + '</div><span class="sm">Tap or drag the stars. Half stars from 0.5 to 5.</span></div>';
  }
  function capFrame(title, inner, save) {
    var off = S.sync !== 'synced';
    return '<div class="cap-top">' + go('back', 'Close without saving', 'ibt', ic('x')) + '<h1>' + title + '</h1>' + (off ? pill(S.sync) : '') + '</div>' +
      '<div class="body flat" id="body">' + inner + '</div>' +
      (save ? '<div class="stk" data-component="LbSaveBar"><p>Saved to this phone first. It syncs when you are online.</p>' + save + '</div>' : '') + (S.p.kb ? kb() : '') + '<div class="gest pg"></div>';
  }
  function vCapture() {
    var t = S.path.split('/')[1], rate = S.path.split('/')[2] === 'rate', F = S.F;
    if (!F || F.t !== t) F = S.F = newF(t);
    if (t === 'met') {
      var r = parseWho(F), places = (r.picked ? r.picked.places : [["Hazel's Coffee", 6], ['School', 4], ['Lakeside Park', 3]]);
      return capFrame('Met someone',
        field('f-name', 'Name, or say what happened', F.name, { f: 'name', bad: F.err }) + '<div class="parse" id="parse" data-component="LbParseLine" aria-live="polite">' + parseHtml(F) + '</div><div class="chips" id="pchips" style="padding-block:0">' + pchips(F) + '</div>' +
        field('f-note', 'Anything to remember (optional)', F.note, { f: 'note', ta: 1 }) +
        '<div><span class="fl">When</span>' + chipset('when', ['Just now', 'Earlier today', 'Yesterday', 'Pick date and time'], F.when.indexOf(',') > 0 ? 'Pick date and time' : F.when) + (F.when.indexOf(',') > 0 ? '<p class="sm2" style="margin-top:8px">' + esc(F.when) + '</p>' : '') + '</div>' +
        '<div class="more">' + act('toggle-more', 'mh', '<span>More details</span>' + ic(F.more ? 'up' : 'down'), ' aria-expanded="' + F.more + '"') + (F.more ? '<div class="mb">' +
          field('f-place', 'Place', F.place, { f: 'place', icon: 'pin' }) + '<div class="chips" style="padding-block:0">' + places.map(function (p) { return act('set-f', 'chip', esc(p[0]) + ' <span class="n">×' + p[1] + '</span>', ' data-k="place" data-v="' + esc(p[0]) + '"'); }).join('') + '</div>' +
          '<div><span class="fl">Remind me every</span>' + chipset('remind', ['Off', '1 week', '2 weeks', '1 month', 'Custom'], F.remind) + '<p class="sm" style="margin-top:8px">' + (F.remind === 'Off' ? 'No reminder. Logbook still notices when you have not met for a while.' : F.remind === 'Custom' ? 'Choose any number of days or weeks, from 1 day to 2 years.' : 'Next reminder around ' + dFull(dstr(T0 + { '1 week': 7, '2 weeks': 14, '1 month': 30 }[F.remind])) + '. Meeting again starts the count over.') + '</p></div></div>' : '') + '</div>',
        act('save', 'btn r blk', 'Save'));
    }
    if (t === 'note') {
      var ab = F.about ? (person(F.about) || thing(F.about)) : null;
      return capFrame('A thought',
        field('f-note', 'What is on your mind?', F.note, { f: 'note', ta: 1, bad: F.err }) +
        '<div><span class="fl">About (optional: a person or thing you have logged)</span><div class="chips" style="padding-block:0">' + D.people.concat(D.things).map(function (x) { return act('set-f', 'chip' + (F.about === x.ref ? ' on' : ''), esc(x.name || x.title), ' data-k="about" data-v="' + x.ref + '" aria-pressed="' + (F.about === x.ref) + '"'); }).join('') + '</div>' + (ab ? '<p class="sm" style="margin-top:8px">This note will also show on the page for ' + esc(ab.name || ab.title) + '.</p>' : '') + '</div>',
        act('save', 'btn r blk', 'Save'));
    }
    if (t === 'any') {
      return capFrame('Went, ate, did',
        field('f-name', 'What was it?', F.name, { f: 'name', bad: F.err }) + '<div class="chips" style="padding-block:0">' + act('set-f', 'chip', "Hazel's Coffee <span class=\"n\">×6</span>", ' data-k="name" data-v="Hazel\'s Coffee"') + act('set-f', 'chip', 'Lakeside Park <span class="n">×3</span>', ' data-k="name" data-v="Lakeside Park"') + '</div>' +
        '<div><span class="fl">Kind</span>' + chipset('tag', ['restaurant', 'coffee', 'place', 'event'], F.tag) + '</div>' + field('f-tag', 'Or type a new kind', ['restaurant', 'coffee', 'place', 'event'].indexOf(F.tag) < 0 ? F.tag : '', { f: 'tag', ph: 'hike, museum, concert' }) +
        starInput(F) + field('f-note', 'Note (optional)', F.note, { f: 'note', ta: 1 }),
        act('save', 'btn r blk', 'Save'));
    }
    if (rate && F.picked) {
      return capFrame('Rate it',
        '<div class="card"><div class="hd"><b class="ttl-b">' + esc(F.picked.title) + '</b><span class="src">' + (F.picked.src || 'Typed') + '</span></div><span class="sm">' + catOf(F.kind)[0] + (F.picked.sub ? ' · ' + esc(F.picked.sub) : '') + '</span></div>' + starInput(F) + field('f-note', 'Note (optional)', F.note, { f: 'note', ta: 1 }),
        '<div class="btnr" style="flex-wrap:nowrap">' + act('save', 'btn r blk', 'Save') + act('save-nostars', 'btn o blk', 'Just log it') + '</div>');
    }
    return capFrame('Watched, listened, read',
      '<div class="chips" style="padding-block:0" role="group" aria-label="Kind">' + MEDIA.map(function (m) { return act('set-f', 'chip' + (F.kind === m[0] ? ' on' : ''), m[1], ' data-k="kind" data-v="' + m[0] + '" aria-pressed="' + (F.kind === m[0]) + '"'); }).join('') + '</div>' +
      field('f-q', 'Title', F.q, { f: 'q', type: 'search', icon: 'search' }) + '<div id="mres" aria-live="polite">' + mediaResults(F) + '</div>');
  }
  function mediaResults(F) {
    var q = F.q.trim(), typed = q ? act('pick-typed', '', tile('t', 'plus') + '<span class="g"><b>Add \u201c' + esc(q) + '\u201d as typed</b><small>Logs it without a catalog match</small></span>') : '';
    var wrap = function (card) { return card + (typed ? '<div class="res" style="margin-top:10px">' + typed + '</div>' : ''); };
    if (F.kind === 'game') return wrap('<div class="card dash"><b class="ttl-b">Games have no catalog</b><span class="sm2">Type the title and add it as typed.</span></div>');
    if (S.sync === 'offline') return wrap('<div class="card dash"><b class="ttl-b">You are offline</b><span class="sm2">Catalog search needs a connection. You can still add the title as typed, and it will save on this phone.</span></div>');
    if (S.p.state === 'nokey' && SRC[F.kind] === 'TMDB') return wrap('<div class="card dash"><b class="ttl-b">Add a TMDB key to search movies and TV</b><span class="sm2">The key is free. Without it you can still add titles as typed.</span>' + go('settings', '', 'btn', 'Open Settings') + '</div>');
    if (!q) return '<span class="sm">Type a title. ' + catOf(F.kind)[0] + ' results come from ' + SRC[F.kind] + '.</span>';
    var res = D.catalog.filter(function (c) { return c.kind === F.kind && c.title.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    if (!res.length) return wrap('<div class="card dash"><b class="ttl-b">No results for \u201c' + esc(q) + '\u201d</b><span class="sm2">Check the spelling, or add it as typed.</span></div>');
    return '<div class="res" data-component="LbCatalogResult">' + res.map(function (c) { var k = catOf(F.kind); return act('pick-res', '', tile(k[1], k[2]) + '<span class="g"><b>' + esc(c.title) + '</b><small>' + esc(c.sub || k[0]) + '</small></span><span class="src">' + c.src + '</span>', ' data-i="' + D.catalog.indexOf(c) + '"'); }).join('') + typed + '</div>';
  }
  function saveCapture(noStars) {
    var F = S.F, e = { id: 'n' + Date.now(), date: F.when === 'Yesterday' ? dstr(T0 - 1) : D.TODAY, t: F.when === 'Just now' ? D.NOW_TIME : F.when === 'Earlier today' ? '2:00 PM' : F.when === 'Yesterday' ? '6:00 PM' : D.NOW_TIME, note: F.note.trim() };
    if (F.t === 'met') {
      var r = parseWho(F);
      if (!r.who) { F.err = 'Add a name to save.'; return render(); }
      var p = r.picked;
      if (!p) { var nm = r.who.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); p = { ref: 'n:' + r.who.replace(/\W+/g, '-'), name: nm, greet: nm.split(' ')[0], ini: nm.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2), met: 0, usualGap: 0, first: 'Nov 15, 2026', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], topics: [], places: [], draft: 'Hi ' + nm.split(' ')[0] + ', I was thinking of you. Do you have time to talk this week?' }; D.people.push(p); }
      p.met++; p.snoozeUntil = null; p.months[11]++;
      if (F.remind !== 'Off' && F.remind !== 'Custom') p.remindDays = { '1 week': 7, '2 weeks': 14, '1 month': 30 }[F.remind];
      e.kind = 'met'; e.ref = p.ref; e.place = F.place.trim();
    } else if (F.t === 'note') {
      if (!e.note) { F.err = 'Write something to save.'; return render(); }
      e.kind = 'note'; e.ref = F.about || '';
    } else if (F.t === 'any') {
      if (!F.name.trim()) { F.err = 'Add a name to save.'; return render(); }
      var th = D.things.find(function (x) { return x.title.toLowerCase() === F.name.trim().toLowerCase(); });
      if (!th) { th = { ref: 'x:' + F.name.trim().toLowerCase().replace(/\W+/g, '-'), title: F.name.trim(), cat: F.tag || 'place', stars: null, first: 'Nov 15, 2026' }; D.things.push(th); }
      if (F.stars) th.stars = F.stars;
      e.kind = 'went'; e.ref = th.ref; if (F.stars) e.stars = F.stars;
    } else {
      var th2 = F.picked.ref ? thing(F.picked.ref) : null;
      if (!th2) { th2 = { ref: 'x:' + F.picked.title.toLowerCase().replace(/\W+/g, '-'), title: F.picked.title, cat: F.kind, stars: null, first: 'Nov 15, 2026' }; D.things.push(th2); }
      var st = noStars ? 0 : F.stars;
      if (st) th2.stars = st;
      e.kind = st ? 'rated' : 'logged'; e.ref = th2.ref; if (st) e.stars = st;
    }
    var i = D.events.findIndex(function (x) { return dn(x.date) < dn(e.date) || (x.date === e.date && mins(x.t) < mins(e.t)); });
    D.events.splice(i < 0 ? D.events.length : i, 0, e);
    if (S.sync !== 'synced') S.queue++;
    S.F = null; S.stack = []; S.tab = 'feed';
    snack(S.sync === 'synced' ? 'Saved and synced.' : 'Saved on this phone. ' + S.queue + ' waiting to sync.');
    nav('feed', true);
  }

  // ------------------------------------------------------------------ person and item
  function vPerson() {
    var p = person(S.path.slice(7));
    if (!p) return capFrame('Not found', empty('t', 'search', 'No such person', 'This person is not in the sample data.'));
    var c = cad(p), evs = evOf(p.ref), fus = followUps().filter(function (f) { return f.e.ref === p.ref; }), L = 'DJFMAMJJASON', mx = Math.max.apply(null, p.months) || 1;
    var late = c.st === 'slipping' || c.st === 'quiet' || c.due;
    var rem = p.retired ? '<div class="rem calm" data-component="LbReminderCard"><h4>' + ic('bell') + 'Reminder</h4><div class="big">Retired</div><span class="sm2">No reminders for ' + esc(p.greet) + '. The history stays.</span><div class="btnr">' + act('retire', 'btn o', 'Bring back', ' data-ref="' + p.ref + '"') + '</div></div>'
      : !p.remindDays ? '<div class="rem calm" data-component="LbReminderCard"><h4>' + ic('bell') + 'Reminder</h4><span class="sm2">No reminder set. Logbook still notices when you have not met for longer than usual.</span><div class="btnr">' + act('sheet', 'btn o', 'Set a reminder', ' data-sheet="reminder" data-ref="' + p.ref + '"') + '</div></div>'
        : '<div class="rem' + (c.due ? '' : ' calm') + '" data-component="LbReminderCard"><div class="hd"><h4>' + ic('bell') + 'Reminder</h4>' + (c.due ? '<span class="tag due">' + c.past + ' days past due</span>' : c.snoozed ? '<span class="tag">Snoozed until ' + dMD(p.snoozeUntil) + '</span>' : '') + '</div><div class="big">' + cap1(everyText(p.remindDays)) + '</div><span class="sm2">' + (c.dueDate ? (dn(c.dueDate) <= T0 ? 'Was due ' : 'Next due ') + dFull(c.dueDate) + '. ' : '') + 'Meeting again starts the count over.</span><div class="btnr">' + act('sheet', 'btn o', 'Change', ' data-sheet="reminder" data-ref="' + p.ref + '"') + act('snooze', 'btn o', 'Snooze 1 week', ' data-d="7" data-ref="' + p.ref + '"') + act('snooze', 'btn o', 'Snooze 1 month', ' data-d="30" data-ref="' + p.ref + '"') + '</div></div>';
    return '<div class="cap-top">' + go('back', 'Back', 'ibt', ic('back')) + '<span class="crumb">Feed · People</span>' + act('menu', 'ibt', ic('more'), ' data-menu="person" data-ref="' + p.ref + '" aria-label="More actions" aria-haspopup="menu"') + '</div>' +
      '<div class="body flat" id="body"><div class="who xl"><span class="pav lg">' + p.ini + '</span><div style="flex:1"><b>' + esc(p.name) + '</b><small>First logged ' + p.first + ' · met ' + p.met + ' times</small></div></div>' + (statusTag(p) || '<span class="tag">' + c.label + '</span>') +
      '<div class="stats"><div class="stat" data-component="LbStatTile"><b>' + (p.usualGap ? p.usualGap + ' d' : '–') + '</b><span>your usual gap</span></div><div class="stat' + (late ? ' w' : '') + '"><b>' + (c.since == null ? '–' : c.since + ' d') + '</b><span>since you last met</span></div><div class="stat"><b>' + fus.length + '</b><span>open follow-up' + (fus.length === 1 ? '' : 's') + '</span></div></div>' +
      '<div class="btnr">' + act('met-now', 'btn', 'Met just now', ' data-ref="' + p.ref + '"') + go('capture/note?about=' + p.ref, '', 'btn o', 'Add a note') + act('text', 'btn o', ic('send') + 'Message', ' data-ref="' + p.ref + '"') + '</div>' + rem +
      '<div class="card"><h4>Contact, last 12 months</h4><div class="mb12" data-component="LbMonthBars" role="img" aria-label="Meetings per month: ' + p.months.join(', ') + '">' + p.months.map(function (n, i) { return '<div><i' + (n ? '' : ' class="z"') + ' style="height:' + (n ? Math.max(4, Math.round(n / mx * 52)) : 2) + 'px"></i><span>' + L[i] + '</span></div>'; }).join('') + '</div></div>' +
      '<div class="card" data-component="LbDraftCard"><h4>A check-in you could send</h4><div class="draft">' + esc(p.draft) + '</div><div class="btnr">' + act('text', 'btn', ic('send') + 'Send as text', ' data-ref="' + p.ref + '"') + act('copy', 'btn o', ic('copy') + 'Copy', ' data-ref="' + p.ref + '"') + '</div><span class="sm">Written from your own notes. Nothing is sent for you.</span></div>' +
      (p.topics.length ? '<div class="card"><h4>You usually talk about</h4><div class="chips" style="padding-block:0">' + p.topics.map(function (t) { return go('search?q=' + encodeURIComponent(t), '', 'chip', esc(t)); }).join('') + '</div></div>' : '') +
      (fus.length ? '<div class="card"><h4>Open follow-ups</h4>' + fus.map(fuRow).join('') + '</div>' : '') +
      (p.places.length ? '<div class="card"><h4>Where you meet</h4><div class="chips" style="padding-block:0">' + p.places.map(function (x, i) { return go('search?q=' + encodeURIComponent(x[0]), '', 'chip', (i ? '' : ic('pin')) + esc(x[0]) + ' <span class="n">×' + x[1] + '</span>'); }).join('') + '</div></div>' : '') +
      '<div><div class="dh"><b>Timeline</b><em>press and hold an entry to remove it</em></div>' + (evs.length ? evs.map(function (e, i) { return entry(e, { ctx: 'person' }); }).join('') : '<p class="sm2" style="padding-top:8px">No entries yet.</p>') + '</div><div class="sm" style="text-align:center;font-family:var(--mono)">Sample data</div></div><div class="gest pg"></div>';
  }
  function vItem() {
    var t = thing(S.path.slice(5));
    if (!t) return capFrame('Not found', empty('t', 'search', 'No such item', 'This item is not in the sample data.'));
    var c = catOf(t.cat), evs = evOf(t.ref);
    return '<div class="cap-top">' + go('back', 'Back', 'ibt', ic('back')) + '<span class="crumb">Feed · Things</span>' + act('menu', 'ibt', ic('more'), ' data-menu="item" data-ref="' + t.ref + '" aria-label="More actions" aria-haspopup="menu"') + '</div>' +
      '<div class="body flat" id="body"><div class="who xl">' + tile(c[1], c[2]).replace('class="ki', 'style="width:60px;height:60px;border-radius:18px" class="ki') + '<div style="flex:1"><b>' + esc(t.title) + '</b><small>First logged ' + t.first + '</small></div></div><span class="tag">' + c[0] + '</span>' +
      '<div class="stats"><div class="stat" data-component="LbStatTile"><b>' + evs.length + '</b><span>' + (evs.length === 1 ? 'entry' : 'entries') + '</span></div><div class="stat"><b>' + (t.stars == null ? '–' : t.stars) + '</b><span>' + (t.stars == null ? 'not rated yet' : 'latest stars') + '</span></div><div class="stat"><b>' + (evs.length ? ago(evs[0].date) + ' d' : '–') + '</b><span>since last entry</span></div></div>' +
      (t.stoppedAt ? '<div class="card dash"><div class="sg"><div class="g"><b>Stopped at ' + t.stoppedAt + '</b><small>Pick it up where you left off</small></div>' + go('capture/note?about=' + t.ref, '', 'btn', 'Add note') + '</div></div>' : '') +
      '<div class="btnr">' + act('log-again', 'btn', 'Log again', ' data-ref="' + t.ref + '"') + act('rate-item', 'btn o', ic('star') + (t.stars == null ? 'Rate it' : 'Rate again'), ' data-ref="' + t.ref + '"') + go('capture/note?about=' + t.ref, '', 'btn o', 'Add a note') + '</div>' +
      '<div><div class="dh"><b>Timeline</b><em>press and hold an entry to remove it</em></div>' + evs.map(function (e) { return entry(e, { ctx: 'person' }); }).join('') + '</div><div class="sm" style="text-align:center;font-family:var(--mono)">Sample data</div></div><div class="gest pg"></div>';
  }

  // ------------------------------------------------------------------ account, settings, reminders, connect
  function accountSheet() {
    var s = SYNC[S.sync], off = S.sync === 'offline' || S.sync === 'none';
    return '<div class="scrim hi" data-act="go" data-to="back"></div><div class="sheet" data-component="LbSheet" role="dialog" aria-label="Account and sync"><div class="who"><span class="pav md" style="background:var(--ink);color:var(--page)">J</span><div><b>This phone</b><small>412 entries stored here</small></div></div>' +
      '<div class="card' + (s.cls === 'bad' ? ' err' : '') + '"><div class="hd">' + pill(S.sync) + (S.queue && S.sync !== 'synced' && S.sync !== 'waiting' ? '<span class="pill wait">' + S.queue + ' waiting</span>' : '') + '</div><span class="sm2">' + (S.syncing ? 'Checking your Sheet for new entries.' : s.line || 'Everything on this phone is in your Sheet.') + '</span>' +
      '<div class="btnr">' + act('sync-now', 'btn', ic('refresh') + 'Sync now', off ? ' disabled' : '') + (s.act ? go(s.act[1], '', 'btn o', s.act[0]) : '') + '</div></div>' +
      '<div class="grp">' + go('settings', '', 'row', ic('gear') + '<span class="g"><b>Settings</b><small>Connection, this device, privacy</small></span>' + ic('chev'), ' data-component="LbSettingsRow"') + go('settings/reminders', '', 'row', ic('bell') + '<span class="g"><b>Reminders</b><small>' + (S.notif ? 'Notifications on · checked daily at ' + S.checkTime : 'Notifications are off') + '</small></span>' + ic('chev')) + act('sheet', 'row', ic('x') + '<span class="g"><b style="color:var(--coral)">Disconnect this phone</b><small>Removes the key and the local copy</small></span>', ' data-sheet="disconnect"') + '</div><div class="gest"></div></div>';
  }
  function errCard() {
    if (S.sync === 'wrongkey') return '<div class="card err" role="alert"><b class="ttl-b">The Sheet refused this key</b><span class="sm2">Open your Apps Script, copy the KEY value, paste it below, then choose Save and test. Your entries are safe on this phone.</span></div>';
    if (S.sync === 'oldscript') return '<div class="card err" role="alert"><b class="ttl-b">Your Apps Script is older than version 4</b><span class="sm2">This app needs version 4 to sync. Paste the new script, run setup again, and deploy a new version at the same web address. Your watch and the web app keep working.</span>' + act('toast', 'btn o', 'Show the steps', ' data-msg="Opens the update guide (docs/DEPLOY_V4.md)."') + '</div>';
    return '';
  }
  function vSettings() {
    var bad = S.sync === 'wrongkey';
    return '<div class="cap-top">' + go('back', 'Back', 'ibt', ic('back')) + '<h1>Settings</h1></div><div class="body flat" id="body">' +
      '<div class="card"><div class="hd"><h4>Sync</h4>' + pill(S.sync) + '</div><span class="sm">412 entries on this phone · ' + (S.sync === 'synced' ? '0' : S.queue) + ' waiting to send · last sync 4:12 PM</span><div class="btnr">' + act('sync-now', 'btn', ic('refresh') + 'Sync now', S.sync === 'offline' || S.sync === 'none' ? ' disabled' : '') + act('sheet', 'btn o', 'Clear local copy', ' data-sheet="clear"') + '</div></div>' + errCard() +
      '<div class="lbl"><span>Connection</span></div>' + field('s-url', 'Apps Script web app address', 'https://script.google.com/macros/s/…/exec', { f: 'x' }) + field('s-key', 'Key', '••••••••••', { f: 'x', type: 'password', bad: bad ? 'This key was refused.' : '' }) + field('s-tmdb', 'TMDB key (optional, for movie and TV search)', '••••••••', { f: 'x', type: 'password' }) +
      '<div class="btnr">' + act('save-test', 'btn', 'Save and test') + act('sheet', 'btn o', ic('qr') + 'Scan QR', ' data-sheet="scan"') + '</div>' +
      '<div class="lbl"><span>Another phone</span></div><div class="card dash"><span class="sm2">A setup link or QR code contains your key. Treat it like a password.</span><div class="btnr">' + act('sheet', 'btn o', ic('qr') + 'Show QR', ' data-sheet="qr"') + act('toast', 'btn o', ic('link') + 'Copy link', ' data-msg="Setup link copied. It contains your key."') + '</div></div>' +
      '<div class="grp">' + go('settings/reminders', '', 'row', '<span class="g"><b>Reminders</b><small>' + (S.notif ? 'Notifications on · checked daily at ' + S.checkTime : 'Notifications are off') + '</small></span>' + ic('chev'), ' data-component="LbSettingsRow"') +
      act('toast', 'row', '<span class="g"><b>Privacy</b><small>No analytics. The key is kept out of backups. Do not enter student data.</small></span>' + ic('chev'), ' data-msg="Opens the privacy page."') + act('toast', 'row', '<span class="g"><b>Version 1.0.0</b><small>How to update the app</small></span>' + ic('chev'), ' data-msg="Opens the update steps."') + '</div>' +
      act('sheet', 'btn dz blk', 'Disconnect this phone', ' data-sheet="disconnect"') + '</div><div class="gest pg"></div>';
  }
  function vReminders() {
    return '<div class="cap-top">' + go('back', 'Back', 'ibt', ic('back')) + '<h1>Reminders</h1></div><div class="body flat" id="body">' +
      '<div class="card' + (S.notif ? '' : ' err') + '"><div class="hd"><h4>Notifications</h4><span class="tag' + (S.notif ? '' : ' due') + '">' + (S.notif ? 'Allowed' : 'Not allowed') + '</span></div><span class="sm2">' + (S.notif ? 'Logbook can tell you when it is time to reach out to someone.' : 'Reminders cannot appear until you allow notifications. Nudges still show inside the app.') + '</span><div class="btnr">' + act('toggle-notif', 'btn' + (S.notif ? ' o' : ''), S.notif ? 'Turn off' : 'Allow notifications') + go('outside/notification', '', 'btn o', 'Preview a reminder') + '</div></div>' +
      '<div class="card"><h4>Check once a day at</h4>' + chipset('checkTime', ['7:00 AM', '8:00 AM', '12:00 PM', '6:00 PM'], S.checkTime) + '<span class="sm">Logbook also checks after every sync and when the phone restarts.</span></div>' +
      '<div class="card"><h4>If reminders arrive late or not at all</h4><span class="sm2">Some phones stop background work to save battery. These steps let Logbook run its daily check.</span><ol class="steps"><li>Open the phone\u2019s Settings, then Apps, then Logbook.</li><li>Choose Battery.</li><li>Choose Unrestricted (some phones say \u201cDon\u2019t optimise\u201d).</li><li>On Samsung, Xiaomi and OnePlus phones, also turn on Auto-start for Logbook.</li></ol><div class="btnr">' + act('toast', 'btn o', 'Open battery settings', ' data-msg="Opens the phone\u2019s battery settings for Logbook."') + '</div></div>' +
      '<div class="card dash"><h4>Who has a reminder</h4>' + D.people.filter(function (p) { return p.remindDays && !p.retired; }).map(function (p) { var c = cad(p); return go('person/' + p.ref, '', 'row', '<span class="pav">' + p.ini + '</span><span class="g"><b>' + esc(p.name) + '</b><small>' + cap1(everyText(p.remindDays)) + (c.due ? ' · ' + c.past + ' days past' : c.snoozed ? ' · snoozed' : '') + '</small></span>' + ic('chev')); }).join('') + '</div></div><div class="gest pg"></div>';
  }
  function vConnect() {
    var paste = S.p.paste;
    return '<div class="body flat" id="body"><div class="hero"><h1>Logbook</h1><p>Connect this phone to your Google Sheet. Scan the setup code from the Logbook web app, or paste the setup link.</p></div>' + errCard() +
      '<div style="display:grid;gap:10px">' + act('sheet', 'btn blk', ic('qr') + 'Scan QR', ' data-sheet="scan"') + go('connect?paste=1', '', 'btn o blk', ic('link') + 'Paste link') + '</div>' +
      (paste ? field('c-link', 'Setup link', '', { f: 'x', ph: 'https://…/#u=…&k=…' }) + act('connect', 'btn r blk', 'Connect') : '') + '</div><div class="gest pg"></div>';
  }
  function fakeQr() {
    var n = 21, seed = 11, r = '';
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var finder = function (x, y) { return (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13); };
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var on;
      if (finder(x, y)) { var fx = x > 13 ? x - 14 : x, fy = y > 13 ? y - 14 : y; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5); } else on = rnd() > .52;
      if (on) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    return '<div class="qr" role="img" aria-label="Sample QR code, not a real key"><svg viewBox="0 0 21 21" fill="#0F1222">' + r + '</svg></div>';
  }

  // ------------------------------------------------------------------ outside the app
  function vOutside() {
    var k = S.path.split('/')[1] || 'notification', n = live().filter(function (e) { return e.date === D.TODAY; }).length;
    var wbtn = function (k2, icon, label, to) { return go(to, '', '', tile(k2, icon) + label); };
    var widget = '<div class="widget" data-component="LbWidget"><div class="hd"><b>Logbook</b><span class="sm">' + n + ' today</span></div><div class="g4">' + wbtn('', 'people', 'Met', 'capture/met') + wbtn('m', 'star', 'Rate', 'capture/media') + wbtn('w', 'pin', 'Did', 'capture/any') + wbtn('t', 'note', 'Note', 'capture/note') + '</div></div>';
    var icons = '<div class="icons">' + ['Phone', 'Messages', 'Camera'].map(function (a) { return '<div class="app-ic"><i></i>' + a + '</div>'; }).join('') + '<button type="button" class="app-ic lb" data-act="go" data-to="' + (k === 'shortcuts' ? 'feed' : 'outside/shortcuts') + '"><i>L</i>Logbook</button></div>';
    var inner = k === 'notification' ? '<div class="notif" data-component="LbReminderNotification" role="group" aria-label="Notification"><div class="app"><i>L</i>Logbook · now</div><b>Time to check in with Dr. Okafor</b><span class="sm2">It has been 34 days. You set a reminder for every 4 weeks.</span><div class="acts">' + go('person/n:dr-okafor', '', '', 'Open') + act('snooze', '', 'Snooze a week', ' data-d="7" data-ref="n:dr-okafor" data-then="nudges"') + act('met-now', '', 'Mark contacted', ' data-ref="n:dr-okafor" data-then="person/n:dr-okafor"') + '</div></div><p class="hint">This is the reminder as it appears in the notification shade. \u201cMark contacted\u201d logs a meeting for today.</p>' + icons
      : k === 'widget' ? widget + '<p class="hint">Home-screen widget, 4 × 2. Each button opens that capture flow.</p>' + icons
        : icons + '<div class="menu left" data-component="LbShortcutMenu" role="menu" style="position:relative;left:0;width:fit-content;justify-self:end">' + go('capture/met', '', '', ic('people') + 'Met someone', ' role="menuitem"') + go('capture/note', '', '', ic('note') + 'A thought', ' role="menuitem"') + '</div><p class="hint">Press and hold the app icon to get these two shortcuts. Tap the icon to open the app.</p>';
    return '<div class="home">' + inner + '</div><div class="gest pg"></div>';
  }

  // ------------------------------------------------------------------ overlays
  function dial() {
    var it = function (k, icon, label, to) { return go(to, '', 'sdi', '<span>' + label + '</span>' + tile(k, icon)); };
    return '<div class="scrim" data-act="go" data-to="back"></div><div class="sd" data-component="LbSpeedDial" role="menu" aria-label="New entry">' + it('', 'people', 'Met someone', 'capture/met') + it('m', 'film', 'Watched, listened, read', 'capture/media') + it('w', 'pin', 'Went, ate, did', 'capture/any') + it('t', 'note', 'A thought', 'capture/note') + '</div>';
  }
  function menuHtml() {
    var m = S.menu; if (!m) return '';
    var items = m.id === 'psort' ? [['recent', 'Seen recently'], ['longest', 'Not seen longest'], ['often', 'Most often'], ['az', 'A to Z']].map(function (x) { return act('sort', '', (S.peopleSort === x[0] ? ic('check') : '<span style="width:20px"></span>') + x[1], ' data-k="peopleSort" data-v="' + x[0] + '" role="menuitemradio" aria-checked="' + (S.peopleSort === x[0]) + '"'); })
      : m.id === 'tsort' ? [['recent', 'Recent'], ['stars', 'Highest rated'], ['az', 'A to Z']].map(function (x) { return act('sort', '', (S.thingSort === x[0] ? ic('check') : '<span style="width:20px"></span>') + x[1], ' data-k="thingSort" data-v="' + x[0] + '" role="menuitemradio" aria-checked="' + (S.thingSort === x[0]) + '"'); })
        : m.id === 'snooze' ? [act('snooze', '', '1 week', ' data-d="7" data-ref="' + m.ref + '" role="menuitem"'), act('snooze', '', '1 month', ' data-d="30" data-ref="' + m.ref + '" role="menuitem"')]
          : m.id === 'person' ? [act('sheet', '', 'Rename', ' data-sheet="rename" data-ref="' + m.ref + '" role="menuitem"'), act('sheet', '', 'Merge into', ' data-sheet="merge" data-ref="' + m.ref + '" role="menuitem"'), act('retire', '', person(m.ref).retired ? 'Bring reminders back' : 'Retire', ' data-ref="' + m.ref + '" role="menuitem"'), act('toast', 'dz', 'Remove entry', ' data-msg="Press and hold an entry in the timeline to remove it." role="menuitem"')]
            : [act('sheet', '', 'Rename', ' data-sheet="rename" data-ref="' + m.ref + '" role="menuitem"'), act('sheet', '', 'Merge into', ' data-sheet="merge" data-ref="' + m.ref + '" role="menuitem"')];
    return '<div class="scrim hi" style="background:transparent" data-act="close"></div><div class="menu" data-component="LbMenu" role="menu" style="top:' + (m.y || 76) + 'px">' + items.join('') + '</div>';
  }
  function sheetHtml() {
    var s = S.sheet; if (!s) return '';
    var x = s.ref ? (person(s.ref) || thing(s.ref)) : null, nm = x ? (x.name || x.title) : '', h;
    if (s.type === 'reminder') h = '<h2>Remind me about ' + esc(x.greet) + '</h2>' + '<div class="chips" style="padding-block:0">' + [['Off', 0], ['1 week', 7], ['2 weeks', 14], ['4 weeks', 28], ['2 months', 60]].map(function (o) { return act('set-remind', 'chip' + ((x.remindDays || 0) === o[1] ? ' on' : ''), o[0], ' data-ref="' + s.ref + '" data-d="' + o[1] + '" aria-pressed="' + ((x.remindDays || 0) === o[1]) + '"'); }).join('') + act('toast', 'chip', 'Custom', ' data-msg="Opens a number field: 1 day to 2 years."') + '</div><span class="sm">A reminder is due this long after you last met. Meeting again starts the count over.</span>';
    else if (s.type === 'rename') h = '<h2>Rename</h2>' + field('r-name', 'Name', nm, { f: 'x' }) + '<span class="sm">The new name shows on every entry. ' + (S.sync === 'synced' ? '' : 'It will sync when you are back online.') + '</span><div class="btnr">' + act('do-rename', 'btn', 'Rename', ' data-ref="' + s.ref + '"') + act('close', 'btn o', 'Cancel') + '</div>';
    else if (s.type === 'merge') h = '<h2>Merge ' + esc(nm) + ' into</h2><span class="sm2">Use this when two names are the same ' + (x.name ? 'person' : 'thing') + '. All entries move to the one you pick.</span><div class="grp">' + (x.name ? D.people : D.things).filter(function (o) { return o !== x; }).map(function (o) { return act('do-merge', 'row', '<span class="g"><b>' + esc(o.name || o.title) + '</b></span>' + ic('chev'), ' data-into="' + esc(o.name || o.title) + '"'); }).join('') + '</div>' + act('close', 'btn o', 'Cancel');
    else if (s.type === 'remove') h = '<h2>Remove this entry?</h2><span class="sm2">It disappears from this phone, the web app and the Sheet views. The row stays in the Sheet, marked as removed.</span><div class="btnr">' + act('do-remove', 'btn r', 'Remove', ' data-id="' + s.id + '"') + act('close', 'btn o', 'Keep it') + '</div>';
    else if (s.type === 'disconnect') h = '<h2>Disconnect this phone?</h2><span class="sm2">The key and the local copy are removed from this phone. Your Sheet is not changed.' + (S.queue && S.sync !== 'synced' ? ' <b style="color:var(--coral)">' + S.queue + ' entries have not synced and will be lost.</b>' : '') + '</span><div class="btnr">' + act('do-disconnect', 'btn r', 'Disconnect') + act('close', 'btn o', 'Stay connected') + '</div>';
    else if (s.type === 'clear') h = '<h2>Clear the local copy?</h2><span class="sm2">Logbook downloads everything again from your Sheet. Entries that have not synced are kept.</span><div class="btnr">' + act('toast', 'btn', 'Clear and download', ' data-msg="Local copy cleared. Downloading from your Sheet."') + act('close', 'btn o', 'Cancel') + '</div>';
    else if (s.type === 'qr') h = '<h2>Set up another phone</h2>' + fakeQr() + '<span class="sm2" style="text-align:center">Scan this with Logbook on the other phone. It contains your key, so do not share a photo of it.</span>' + act('close', 'btn o blk', 'Done');
    else if (s.type === 'scan') h = '<h2>Scan the setup code</h2><div style="height:180px;border-radius:16px;background:#0F1222;display:flex;align-items:center;justify-content:center"><div style="width:120px;height:120px;border:2px solid #fff;border-radius:12px;opacity:.8"></div></div><span class="sm2">Point the camera at the QR code in the Logbook web app, under Settings.</span><div class="btnr">' + act('connect', 'btn', 'Use the sample code') + act('close', 'btn o', 'Cancel') + '</div>';
    else if (s.type === 'when') h = '<h2>When did you meet?</h2>' + calendar(s.d || D.TODAY, 'when-day') + '<div><span class="fl">Time</span><div class="chips" style="padding-block:0">' + ['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM'].map(function (t) { return act('when-time', 'chip' + ((s.t || '3:00 PM') === t ? ' on' : ''), t, ' data-t="' + t + '"'); }).join('') + '</div></div>' + act('when-ok', 'btn blk', 'Use ' + dMD(s.d || D.TODAY) + ', ' + (s.t || '3:00 PM'));
    return '<div class="scrim hi" data-act="close"></div><div class="sheet" data-component="LbSheet" role="dialog" aria-modal="true">' + h + '<div class="gest"></div></div>';
  }

  // ------------------------------------------------------------------ component gallery
  function vGallery() {
    var cell = function (name, params, html) { return '<div class="cell"><div class="lab"><b>' + name + '</b><span>' + params + '</span></div>' + html + '</div>'; };
    var sw = function (n, v, l, d) { return '<div><i style="background:var(--' + v + ')"></i><span><b>' + n + '</b>' + l + '<br>' + d + '</span></div>'; };
    var e0 = D.events[0], p4 = person('n:dr-okafor');
    return '<div class="gal ph' + (S.fs >= 1.5 ? ' big' : '') + '" id="gal" style="--fs:' + S.fs + '">' +
      cell('Colour', 'follows the theme', '<div class="swt">' + sw('page', 'page', '#FBFBFD', '#0D0F1A') + sw('panel', 'panel', '#FFFFFF', '#151828') + sw('ink', 'ink', '#0F1222', '#ECEEF8') + sw('ink2', 'ink2', '#464B63', '#B5BAD0') + sw('mute', 'mute', '#62677D', '#8D93AB') + sw('cobalt', 'cobalt', '#2B50F5', '#8FA3FF') + sw('soft', 'soft', '#EDF0FF', '#1D2340') + sw('coral', 'coral', '#D63B1F', '#FF7A5E') + sw('mark', 'mark', '#FFE35C', '28% in dark') + sw('ok', 'ok', '#1B9E6A', '#52D49B') + sw('warn', 'warn', '#8A5A00', '#F0B84A') + sw('star', 'star', '#D18A00', '#F0B84A') + '</div>') +
      cell('Type', 'Instrument Serif · Plus Jakarta Sans · DM Mono', '<span style="font:400 var(--f-big)/1 var(--serif)">23</span><span style="font:400 var(--f-screen)/1.05 var(--serif)">Your week</span><span style="font:400 var(--f-day)/1 var(--serif)">Yesterday</span><b class="ttl-b">Title 15 / 700</b><span>Body 14. Grading done early.</span><span class="sm2">Label 12 / 500</span><span style="font:500 var(--f-meta) var(--mono);color:var(--mute)">3:50 PM · meta 11</span>') +
      cell('LbKindTile', 'kind', '<div class="btnr">' + tile('', 'people') + tile('t', 'note') + tile('m', 'film') + tile('w', 'pin') + tile('b', 'book') + '</div><span class="sm">person · thought · media · place · book and recipe</span>') +
      cell('LbFilterChip / LbChip', 'label, selected, count?, onClick', '<div class="chips" style="padding-block:0"><span class="chip on">All</span><span class="chip">People <span class="n">5</span></span><span class="chip">Open loops <span class="n">6</span></span><span class="chip">' + ic('pin') + 'Lakeside Park <span class="n">×3</span></span></div>') +
      cell('LbButton', 'label, style, icon?, onClick', '<div class="btnr"><span class="btn">Text</span><span class="btn o">Snooze</span><span class="btn r">Save</span><span class="btn dz">Disconnect</span><span class="btn" style="opacity:.45">Disabled</span></div>') +
      cell('LbStatusTag', 'status', '<div class="btnr"><span class="tag">On track</span><span class="tag">New</span><span class="tag warn">Slipping</span><span class="tag warn">Quiet</span><span class="tag due">Reminder due</span><span class="tag">Snoozed</span></div>') +
      cell('LbSyncPill', 'state', '<div class="btnr">' + Object.keys(SYNC).map(function (k) { return '<span class="pill ' + SYNC[k].cls + '">' + SYNC[k].pill + '</span>'; }).join('') + '<span class="pill spin">Syncing</span></div>') +
      cell('LbSearchField · LbAvatarButton', 'query, focused · syncState', '<div class="tp"><span class="sf" style="flex:1 1 100%">' + ic('search') + '<span>Search people, titles, notes</span></span><span class="av"><i>J</i></span><span class="av s-waiting"><i>J</i></span><span class="av s-offline"><i>J</i></span><span class="av s-wrongkey"><i>J</i></span></div>') +
      cell('LbEntryRow · LbHighlight · LbFollowUpTag', 'entry, isNewest, onOpen, onFollowUpDone', entry(e0, { fresh: true }) + entry(D.events[2]) + entry(D.events[6])) +
      cell('LbDayHeader', 'title, subtitle, count', '<div class="dh"><b>Today</b><span>Sunday, Nov 15</span><em>4 entries</em></div><div class="dh"><b>Fri, Nov 13</b><em>5 entries</em></div>') +
      cell('LbWeekCard', 'weekStats, onOpen', weekCard()) +
      cell('LbPersonRow · LbThingRow', 'person, cadence, months · item', '<div>' + '<div class="pr"><span class="pav">O</span><div><b>Dr. Okafor</b><small>Met 14 times · last 5 weeks ago</small></div><div class="mini"><span class="tag due">Reminder due</span>' + bars(p4.months) + '</div></div><div class="pr">' + tile('m', 'film').replace('class="ki', 'style="width:40px;height:40px;border-radius:12px" class="ki') + '<div><b>Past Lives</b><small>Movie · 1 entry · last today</small></div><div class="mini">' + stars(4.5) + '</div></div></div>') +
      cell('LbNudgeCard', 'person, reason, draft, onText, onSnooze, onMet', nudgeCard(p4)) +
      cell('LbFollowUpRow · LbSuggestionCard', 'followUp, done, onToggle · suggestion', '<div class="card">' + followUps(true).slice(0, 2).map(fuRow).join('') + '</div><div class="card dash"><div class="sg"><div class="g"><b>Met Priya?</b><small>You often see Priya on Sundays around 4 PM</small></div><span class="btn">Log it</span></div></div>') +
      cell('LbField · LbParseLine', 'label, value, error?, multiline, trailing', '<div><span class="fl">Name, or say what happened</span><div class="fld"><input value="coffee with Maria" aria-label="Sample field" readonly></div></div><div class="parse">' + ic('check') + '<span>Reading this as <b>coffee</b> with <b>Maria Alvarez</b></span></div><div><span class="fl">Key</span><div class="fld bad"><input value="••••••" aria-label="Sample field with an error" readonly></div><p class="sm" style="color:var(--coral);margin-top:4px">This key was refused.</p></div>') +
      cell('LbStarRating · LbStarInput', 'stars · value, onChange', '<div>' + stars(4.5) + stars(2) + '</div><div class="stars-in"><span class="rnd">' + ic('minus') + '</span><span class="track"><s style="width:70%"></s></span><span class="val">3.5</span><span class="rnd">' + ic('plus') + '</span></div>') +
      cell('LbStatTile · LbMeter · LbCategoryBar', 'value, label, warn', '<div class="stats"><div class="stat"><b>21 d</b><span>your usual gap</span></div><div class="stat w"><b>34 d</b><span>since you last met</span></div><div class="stat"><b>1</b><span>open follow-up</span></div></div><span class="meter wide"><i style="width:70%"></i></span><div class="hbar" style="--c:var(--kp-fg)"><span>Person</span><i style="width:100%"></i><span>10</span></div>') +
      cell('LbReminderCard', 'interval, dueDate, pastDays, snoozedUntil, retired', '<div class="rem"><div class="hd"><h4>' + ic('bell') + 'Reminder</h4><span class="tag due">6 days past due</span></div><div class="big">Every 4 weeks</div><div class="btnr"><span class="btn o">Change</span><span class="btn o">Snooze 1 week</span></div></div>') +
      cell('LbBottomNav · LbNewButton', 'selected, nudgeCount · expanded', '<div style="display:flex;gap:10px;align-items:center"><span class="fab">' + ic('plus') + '<span>New</span></span><span class="fab sq">' + ic('x') + '</span></div><nav class="nav" style="border:1px solid var(--line);border-radius:16px"><button class="on" type="button"><span class="g">' + ic('feed') + '</span>Feed</button><button type="button"><span class="g">' + ic('bell') + '<span class="bdg">2</span></span>Nudges</button><button type="button"><span class="g">' + ic('bars') + '</span>Review</button></nav>') +
      cell('LbSpeedDial', 'onPick(kind)', '<div class="sd" style="justify-items:start"><span class="sdi" style="flex-direction:row-reverse"><span>Met someone</span>' + tile('', 'people') + '</span><span class="sdi" style="flex-direction:row-reverse"><span>A thought</span>' + tile('t', 'note') + '</span></div>') +
      cell('LbSnackbar · LbMenu · LbEmptyState', 'message · items · icon, title, text, action?', '<div class="snack">Saved on this phone. 3 waiting to sync.</div><div class="menu" style="width:fit-content"><button type="button">' + ic('check') + 'Seen recently</button><button type="button"><span style="width:20px"></span>A to Z</button></div>' + empty('m', 'check', 'You are all caught up', 'No one is overdue.')) +
      '</div>';
  }

  // ------------------------------------------------------------------ router and render
  function parse(h) { var i = h.indexOf('?'), p = {}; new URLSearchParams(i < 0 ? '' : h.slice(i + 1)).forEach(function (v, k) { p[k] = v; }); return { path: (i < 0 ? h : h.slice(0, i)) || 'feed', p: p }; }
  function nav(to, replace) {
    if (to === 'back') { S.menu = S.sheet = null; var prev = S.stack.pop(); to = prev || S.tab; replace = true; }
    if (!replace && S.hash && S.hash !== to) S.stack.push(S.hash);
    if (S.stack.length > 30) S.stack.shift();
    var r = parse(to), top = r.path.split('/')[0];
    if (top !== 'capture' || r.path === 'capture') { if (top !== 'settings') S.F = null; } else if (S.F && (S.F.t !== r.path.split('/')[1] || r.p.demo || r.p.who || r.p.about || r.p.q != null)) S.F = null;
    if (top === 'feed' || top === 'nudges' || top === 'review') { S.tab = top; if (!r.p.filter && top === 'feed' && S.path === 'feed' && S.p.filter) S.stack = []; }
    S.hash = to; S.path = r.path; S.p = r.p; S.menu = S.sheet = null;
    try { if (decodeURIComponent(location.hash.slice(1)) !== to) history.replaceState(null, '', '#' + to); } catch (err) { /* hash is a convenience only */ }
    render();
  }
  function screen() {
    var top = S.path.split('/')[0];
    if (top === 'capture' && S.path === 'capture') return tabView(S.tab) + dial();
    if (top === 'account') return tabView(S.tab) + accountSheet();
    if (top === 'capture') return vCapture();
    return tabView(top);
  }
  function tabView(top) {
    return top === 'search' ? vSearch() : top === 'nudges' ? vNudges() : top === 'review' ? vReview() : top === 'today' ? vToday() : top === 'person' ? vPerson() : top === 'item' ? vItem()
      : top === 'settings' ? (S.path === 'settings/reminders' ? vReminders() : vSettings()) : top === 'connect' ? vConnect() : top === 'outside' ? vOutside() : vFeed();
  }
  var status = function () { return '<div class="status" aria-hidden="true"><span>4:12</span><span class="ic">' + (S.sync === 'offline' ? '' : 'LTE ') + '▮▮▮ 82%</span></div>'; };
  function tablet() {
    var top = S.path.split('/')[0], detail = top === 'person' || top === 'item', save = { path: S.path, p: S.p };
    if (!detail && ['feed', 'nudges', 'review', 'capture', 'account'].indexOf(top) < 0) return '<div class="pane"><div class="single" style="display:flex;flex-direction:column;flex:1;min-height:0">' + status() + screen() + '</div></div>';
    var listHtml, n = needsYou().length, t = S.tab;
    if (detail) { S.path = 'feed'; S.p = { filter: top === 'person' ? 'people' : 'things' }; listHtml = vFeed(); S.path = save.path; S.p = save.p; } else listHtml = tabView(top === 'capture' || top === 'account' ? S.tab : top);
    listHtml = listHtml.replace(/<button type="button" class="fab[\s\S]*?<\/button>/, '').replace(/<nav class="nav"[\s\S]*?<\/nav><div class="gest"><\/div>/, '');
    var b = function (id, icon, label, badge) { return '<button type="button" class="' + (t === id ? 'on' : '') + '" data-act="tab" data-to="' + id + '"><span class="g">' + ic(icon) + (badge ? '<span class="bdg">' + badge + '</span>' : '') + '</span>' + label + '</button>'; };
    var right = detail ? (top === 'person' ? vPerson() : vItem()) : '<div class="body flat">' + empty('t', 'people', 'Pick a person or a thing', 'Choose People or Things in the feed, then tap a row. The page opens here.') + '</div>';
    if (detail) { right = right.replace(/<div class="body flat" id="body">/, '<div class="body flat" id="body2">'); }
    return '<div class="rail" data-component="LbNavRail">' + fab(S.path === 'capture') + '<nav class="nav" aria-label="Main">' + b('feed', 'feed', 'Feed') + b('nudges', 'bell', 'Nudges', n) + b('review', 'bars', 'Review') + '</nav></div>' +
      '<div class="pane list">' + status() + listHtml + '</div><div class="pane">' + status() + right + '</div>' + (S.path === 'capture' ? dial() : '') + (top === 'account' ? accountSheet() : '');
  }
  var DEV = { '360': [360, 800], '411': [411, 914], tablet: [1024, 720] };
  function render() {
    var scr = $('#scr'), b = $('#body'), key = S.path + (S.p.filter || '');
    if (b && S.lastKey) S.scroll[S.lastKey] = b.scrollTop;
    document.documentElement[S.theme === 'system' ? 'removeAttribute' : 'setAttribute']('data-theme', S.theme);
    var stage = $('#stage');
    if (S.path === 'components') { stage.innerHTML = vGallery(); }
    else {
      if (!scr) { stage.innerHTML = '<div class="phone"><div class="scr ph" id="scr"></div></div>'; scr = $('#scr'); }
      var d = DEV[S.device] || DEV['360'], isTab = S.device === 'tablet';
      scr.style.cssText = '--dw:' + d[0] + 'px;--dh:' + d[1] + 'px;--fs:' + S.fs;
      scr.className = 'scr ph' + (S.fs >= 1.5 ? ' big' : '') + (isTab ? ' tab' : '');
      scr.innerHTML = (isTab ? tablet() : status() + screen()) + menuHtml() + sheetHtml() + '<div id="snack">' + snackHtml() + '</div>';
      b = $('#body');
      if (b && S.lastKey === key && S.scroll[key]) b.scrollTop = S.scroll[key];
    }
    S.lastKey = key;
    chrome();
  }
  var snackHtml = function () { var low = /^(capture\/|person|item|settings|connect|search|outside)/.test(S.path); return S.snack ? '<div class="snack' + (low ? ' low' : '') + '" data-component="LbSnackbar" role="status">' + esc(S.snack) + '</div>' : ''; };
  var snackT;
  function snack(msg) { S.snack = msg; clearTimeout(snackT); snackT = setTimeout(function () { S.snack = null; var el = $('#snack'); if (el) el.innerHTML = ''; }, 3600); var el = $('#snack'); if (el) el.innerHTML = snackHtml(); }

  // ------------------------------------------------------------------ page chrome (not part of the app)
  var INDEX = [
    ['Tabs', [['Feed', 'feed'], ['People', 'feed?filter=people'], ['Things', 'feed?filter=things'], ['Thoughts', 'feed?filter=thoughts'], ['Places', 'feed?filter=places'], ['Open loops', 'feed?filter=loops'], ['Feed, first run', 'feed?state=empty'], ['Nudges', 'nudges'], ['Nudges, caught up', 'nudges?state=empty'], ['Review', 'review']]],
    ['Search and days', [['Search', 'search'], ['Results', 'search?q=rubric'], ['No results', 'search?q=zebra'], ['Today', 'today/2026-11-15'], ['A past day', 'today/2026-11-13'], ['Date picker', 'today/2026-11-13?pick=1']]],
    ['New', [['Speed dial', 'capture'], ['Met someone', 'capture/met'], ['Met, filled in', 'capture/met?demo=1'], ['Met, keyboard', 'capture/met?demo=1&kb=1'], ['A thought', 'capture/note'], ['Went, ate, did', 'capture/any'], ['Media', 'capture/media'], ['Media results', 'capture/media?q=past'], ['No TMDB key', 'capture/media?state=nokey&q=past'], ['No results', 'capture/media?q=zzz'], ['Rate it', 'capture/media/rate']]],
    ['Pages', [['Person', 'person/n:dr-okafor'], ['Person, on track', 'person/n:maria-alvarez'], ['Item', 'item/b:braiding-sweetgrass'], ['Item, not rated', 'item/t:severance']]],
    ['Account', [['Account sheet', 'account'], ['Settings', 'settings'], ['Reminders', 'settings/reminders'], ['Connect (first run)', 'connect']]],
    ['Outside the app', [['Notification', 'outside/notification'], ['Widget', 'outside/widget'], ['Shortcuts', 'outside/shortcuts']]],
    ['Reference', [['Components', 'components']]]
  ];
  function chromeInit() {
    var seg = function (k, opts) { return '<div class="seg" role="group">' + opts.map(function (o) { return '<button type="button" data-set="' + k + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>'; };
    $('#side').innerHTML = '<div class="pnl"><div class="routebar"><button type="button" data-act="go" data-to="back">← Back</button><code id="route"></code></div>' +
      '<div class="ctl"><span>Theme</span>' + seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) + '</div>' +
      '<div class="sw-row"><span id="offl">Offline</span><button type="button" class="switch" id="offline" role="switch" aria-labelledby="offl" aria-checked="false"></button></div>' +
      '<div class="ctl"><span>Sync state</span>' + seg('sync', [['synced', 'Synced'], ['waiting', '2 waiting'], ['offline', 'Offline'], ['none', 'Not connected'], ['wrongkey', 'Wrong key'], ['oldscript', 'Script is old']]) + '</div>' +
      '<div class="ctl"><span>Text size</span>' + seg('fs', [['1', '100%'], ['1.3', '130%'], ['2', '200%']]) + '</div>' +
      '<div class="ctl"><span>Screen</span>' + seg('device', [['360', '360 × 800'], ['411', '411 × 914'], ['tablet', 'Tablet']]) + '</div></div>' +
      '<div class="pnl idx" id="idx">' + INDEX.map(function (g) { return '<h3>' + g[0] + '</h3><div>' + g[1].map(function (s) { return '<button type="button" data-jump="' + s[1] + '">' + s[0] + '</button>'; }).join('') + '</div>'; }).join('') + '</div>';
    $('#side').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.set) { var k = b.dataset.set; S[k] = k === 'fs' ? +b.dataset.v : b.dataset.v; if (k === 'device') { var s = $('#scr'); if (s) s.parentNode.remove(); } render(); }
      else if (b.id === 'offline') { S.sync = S.sync === 'offline' ? 'synced' : 'offline'; render(); }
      else if (b.dataset.jump) { S.stack = []; if (b.dataset.jump === 'capture/media/rate') { S.F = newF('media'); S.F.picked = D.catalog[0]; S.F.stars = 4.5; S.hash = 'capture/media'; } nav(b.dataset.jump); }
      else if (b.dataset.act === 'go') nav('back');
    });
  }
  function chrome() {
    if (!$('#side').firstChild) return;
    document.querySelectorAll('#side [data-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(S[b.dataset.set]) === b.dataset.v); });
    $('#offline').setAttribute('aria-checked', S.sync === 'offline');
    $('#route').textContent = '#' + S.hash;
    document.querySelectorAll('#idx [data-jump]').forEach(function (b) { b.setAttribute('aria-current', b.dataset.jump === S.hash); });
  }

  // ------------------------------------------------------------------ actions
  var ACT = {
    go: function (el) { nav(el.dataset.to); },
    tab: function (el) { S.stack = []; nav(el.dataset.to); },
    close: function () { S.menu = S.sheet = null; render(); },
    menu: function (el) { var r = el.getBoundingClientRect(), s = $('#scr').getBoundingClientRect(); S.menu = { id: el.dataset.menu, ref: el.dataset.ref, y: Math.min(r.bottom - s.top + 4, s.height - 260) }; render(); },
    sheet: function (el) { S.menu = null; S.sheet = { type: el.dataset.sheet, ref: el.dataset.ref }; render(); },
    sort: function (el) { S[el.dataset.k] = el.dataset.v; S.menu = null; render(); },
    'thing-cat': function (el) { S.thingCat = el.dataset.v; render(); },
    toast: function (el) { S.menu = S.sheet = null; render(); snack(el.dataset.msg); },
    fu: function (el) { var k = el.dataset.key; if (S.done[k]) delete S.done[k]; else S.done[k] = 'now'; render(); snack(S.done[k] ? 'Marked done.' + (S.sync === 'synced' ? '' : ' It will sync later.') : 'Follow-up reopened.'); },
    'fu-entry': function (el) { var e = D.events.find(function (x) { return x.id === el.dataset.id; }), cs = clauses(e).filter(function (c) { return c.fu; }), open = cs.some(function (c) { return !S.done[c.key]; }); cs.forEach(function (c) { if (open) S.done[c.key] = 'now'; else delete S.done[c.key]; }); render(); snack(open ? 'Follow-up marked done.' : 'Follow-up reopened.'); },
    text: function (el) { snack('Opens your messages app with the draft to ' + person(el.dataset.ref).greet + '. Nothing is sent for you.'); },
    copy: function (el) { var t = person(el.dataset.ref).draft; try { navigator.clipboard.writeText(t).then(function () { snack('Draft copied.'); }, function () { snack('Copy is blocked here. On the phone this copies the draft.'); }); } catch (e) { snack('Copy is blocked here. On the phone this copies the draft.'); } },
    snooze: function (el) { var p = person(el.dataset.ref); p.snoozeUntil = dstr(T0 + +el.dataset.d); S.menu = null; if (el.dataset.then) nav(el.dataset.then); else render(); snack(p.greet + ' is snoozed until ' + dFull(p.snoozeUntil) + '.'); },
    'met-now': function (el) { var p = person(el.dataset.ref); D.events.unshift({ id: 'n' + Date.now(), date: D.TODAY, t: D.NOW_TIME, kind: 'met', ref: p.ref }); p.met++; p.months[11]++; p.snoozeUntil = null; if (S.sync !== 'synced') S.queue++; if (el.dataset.then) nav(el.dataset.then); else render(); snack('Logged: met ' + p.greet + ' just now. The reminder starts over.'); },
    retire: function (el) { var p = person(el.dataset.ref); p.retired = !p.retired; S.menu = null; render(); snack(p.retired ? 'Reminders for ' + p.greet + ' are retired.' : 'Reminders for ' + p.greet + ' are back.'); },
    'set-remind': function (el) { var p = person(el.dataset.ref); p.remindDays = +el.dataset.d || null; p.retired = false; S.sheet = null; render(); snack(p.remindDays ? 'Reminder set: ' + everyText(p.remindDays) + '.' : 'Reminder turned off.'); },
    'do-rename': function (el) { var x = person(el.dataset.ref) || thing(el.dataset.ref), v = ($('#r-name').value || '').trim(); if (!v) return; if (x.name) { x.name = v; x.greet = v; } else x.title = v; S.sheet = null; render(); snack('Renamed to ' + v + '.'); },
    'do-merge': function (el) { S.sheet = null; render(); snack('In the app, every entry moves to ' + el.dataset.into + '. The sample data is not changed.'); },
    'do-remove': function (el) { var e = D.events.find(function (x) { return x.id === el.dataset.id; }); if (e) e.voided = true; S.sheet = null; render(); snack('Entry removed.'); },
    'do-disconnect': function () { S.sync = 'none'; S.sheet = null; S.stack = []; nav('connect', true); snack('This phone is disconnected.'); },
    connect: function () { S.sync = 'synced'; S.sheet = null; S.stack = []; S.tab = 'feed'; nav('feed', true); snack('Connected. Downloading your entries.'); },
    'save-test': function () { snack(S.sync === 'offline' ? 'You are offline. The test runs when you are back online.' : S.sync === 'wrongkey' ? 'The Sheet refused this key.' : S.sync === 'oldscript' ? 'Connected, but the script is older than version 4.' : 'Connection works. Synced 4:12.'); },
    'sync-now': function () { S.syncing = true; render(); setTimeout(function () { S.syncing = false; if (S.sync === 'waiting') { S.sync = 'synced'; S.queue = 0; } render(); snack(S.sync === 'synced' ? 'Synced. Everything is in your Sheet.' : SYNC[S.sync].line); }, 1200); },
    'toggle-notif': function () { S.notif = !S.notif; render(); },
    'pick-day': function (el) { nav('today/' + el.dataset.d, true); },
    'clear-q': function () { nav('search', true); var q = $('#q'); if (q) q.focus(); },
    // capture
    'pick-person': function (el) { var F = S.F; F.ref = el.dataset.ref; if (!F.name.trim() || !parseWho(F).hits.length) F.name = person(F.ref).name; F.err = ''; render(); },
    'set-f': function (el) {
      var k = el.dataset.k, v = el.dataset.v;
      if (k === 'checkTime') { S.checkTime = v; return render(); }
      if (k === 'when' && v === 'Pick date and time') { S.sheet = { type: 'when', d: D.TODAY, t: '3:00 PM' }; return render(); }
      if (k === 'about') v = S.F.about === v ? null : v;
      S.F[k] = v; if (k === 'name') S.F.err = ''; render();
    },
    'when-day': function (el) { S.sheet.d = el.dataset.d; render(); }, 'when-time': function (el) { S.sheet.t = el.dataset.t; render(); },
    'when-ok': function () { S.F.when = dMD(S.sheet.d) + ', ' + S.sheet.t; S.sheet = null; render(); },
    'toggle-more': function () { S.F.more = !S.F.more; render(); },
    mic: function (el) { var ta = $('#' + el.dataset.for); el.classList.add('live'); snack('Listening. Dictation uses the phone\u2019s speech recognizer.'); setTimeout(function () { el.classList.remove('live'); if (ta && S.F) { S.F.note = (S.F.note ? S.F.note.replace(/\s*$/, ' ') : '') + 'Walked and talked for an hour.'; ta.value = S.F.note; } }, 1400); },
    'star-step': function (el) { setStars(S.F.stars + +el.dataset.d); },
    'pick-res': function (el) { S.F.picked = D.catalog[+el.dataset.i]; nav('capture/media/rate'); },
    'pick-typed': function () { S.F.picked = { title: S.F.q.trim(), sub: '', src: '' }; nav('capture/media/rate'); },
    save: function () { saveCapture(false); }, 'save-nostars': function () { saveCapture(true); },
    'log-again': function (el) { var t = thing(el.dataset.ref); D.events.unshift({ id: 'n' + Date.now(), date: D.TODAY, t: D.NOW_TIME, kind: /^x:/.test(t.ref) ? 'went' : 'logged', ref: t.ref }); render(); snack('Logged ' + t.title + ' again.'); },
    'rate-item': function (el) { var t = thing(el.dataset.ref); S.F = newF('media'); S.F.kind = CAT[t.cat] && SRC[t.cat] ? t.cat : 'movie'; S.F.picked = { title: t.title, ref: t.ref, src: SRC[t.cat] || '' }; S.F.stars = t.stars || 0; S.stack.push(S.hash); S.hash = 'capture/media'; nav('capture/media/rate', true); }
  };
  function setStars(v) { var F = S.F; F.stars = Math.max(0, Math.min(5, Math.round(v * 2) / 2)); var tr = $('#track'); if (tr) { tr.firstChild.style.width = F.stars * 20 + '%'; tr.setAttribute('aria-valuenow', F.stars); tr.setAttribute('aria-valuetext', F.stars ? F.stars + ' stars' : 'Not rated'); $('#sval').textContent = F.stars || '–'; } }

  function bind() {
    var stage = $('#stage'), hold, dragging = false;
    stage.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
      var fn = ACT[el.dataset.act]; if (fn) fn(el);
    });
    stage.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'q') { S.p.q = t.value; S.hash = 'search' + (t.value ? '?q=' + t.value : ''); $('#sres').innerHTML = searchResults(t.value); chrome(); return; }
      if (!S.F || !t.dataset.f || t.dataset.f === 'x') return;
      S.F[t.dataset.f] = t.dataset.f === 'tag' ? t.value.trim().toLowerCase() : t.value;
      if (t.dataset.f === 'name' && S.F.t === 'met') { S.F.ref = null; $('#parse').innerHTML = parseHtml(S.F); $('#pchips').innerHTML = pchips(S.F); }
      if (t.dataset.f === 'q') $('#mres').innerHTML = mediaResults(S.F);
    });
    stage.addEventListener('keydown', function (ev) {
      if (ev.target.id === 'q' && ev.key === 'Enter' && ev.target.value.trim()) { var v = ev.target.value.trim(); S.recent = [v].concat(S.recent.filter(function (r) { return r !== v; })).slice(0, 5); }
      if (ev.target.id === 'track') { if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { setStars(S.F.stars + .5); ev.preventDefault(); } if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { setStars(S.F.stars - .5); ev.preventDefault(); } }
      if (ev.key === 'Escape' && (S.menu || S.sheet)) { S.menu = S.sheet = null; render(); }
    });
    var starAt = function (ev) { var tr = $('#track'), r = tr.getBoundingClientRect(); setStars(Math.ceil(Math.max(0.01, (ev.clientX - r.left) / r.width) * 10) / 2); };
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('#track')) { dragging = true; starAt(ev); return; }
      var en = ev.target.closest('[data-hold]'); clearTimeout(hold);
      if (en) hold = setTimeout(function () { S.sheet = { type: 'remove', id: en.dataset.ev }; render(); }, 550);
    });
    stage.addEventListener('pointermove', function (ev) { if (dragging) starAt(ev); else if (Math.abs(ev.movementX) + Math.abs(ev.movementY) > 6) clearTimeout(hold); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { stage.addEventListener(n, function () { dragging = false; clearTimeout(hold); }); });
    stage.addEventListener('contextmenu', function (ev) { var en = ev.target.closest('[data-hold]'); if (en) { ev.preventDefault(); S.sheet = { type: 'remove', id: en.dataset.ev }; render(); } });
    stage.addEventListener('focusin', function (ev) { if (ev.target.matches('input, textarea') && matchMedia('(pointer: coarse)').matches) { var s = $('#scr'); if (s) s.classList.add('realkb'); } });
    window.addEventListener('hashchange', function () { var h = decodeURIComponent(location.hash.slice(1)); if (h && h !== S.hash) nav(h); });
  }

  if (qs.get('bare')) document.body.classList.add('bare'); else chromeInit();
  bind();
  var start = decodeURIComponent(location.hash.slice(1));
  if (start === 'capture/media/rate') { S.F = newF('media'); S.F.picked = D.catalog[0]; S.F.stars = 4.5; S.hash = 'capture/media'; }
  nav(start || 'feed', true);
})();

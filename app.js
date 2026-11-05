'use strict';
// Logbook web app: capture (phone) and dashboard (desktop) on top of your Google Sheet.
// No build step, no dependencies. Data lives in the Sheet; this page keeps a local copy so it
// opens instantly and holds anything you capture while offline.
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  };

  // ------------------------------------------------------------------ settings and state
  let cfg = store.get('cfg', { url: '', key: '', tmdb: '' });
  let data = store.get('data', { events: [], entities: [], ratings: [], at: 0 });
  let queue = store.get('queue', []);            // captured actions waiting to reach the Sheet
  let rev = 0, built = null, builtRev = -1;      // model cache
  let status = { text: '', cls: '' };
  let flushing = false;
  let F = null;                                  // the capture flow in progress

  // A setup link looks like  https://yoursite.netlify.app/#u=<script url>&k=<key>&t=<tmdb key>
  (function readSetupLink() {
    if (!/^#u=/.test(location.hash)) return;
    const p = new URLSearchParams(location.hash.slice(1));
    cfg = { url: p.get('u') || '', key: p.get('k') || '', tmdb: p.get('t') || cfg.tmdb || '' };
    store.set('cfg', cfg);
    history.replaceState(null, '', location.pathname + '#/home');
  })();

  const connected = () => !!cfg.url;

  // ------------------------------------------------------------------ dates
  const DAY = 864e5, p2 = n => (n < 10 ? '0' : '') + n;
  const dayNum = ms => { const d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
  const localDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDate = ms => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const keyToDate = k => { const a = k.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); };
  const fmtDayLong = k => keyToDate(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const addDays = (k, n) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return localDay(d.getTime()); };
  function rel(ms) {
    const n = dayNum(Date.now()) - dayNum(ms);
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 14) return n + ' days ago';
    if (n < 60) return Math.round(n / 7) + ' weeks ago';
    return Math.round(n / 30) + ' months ago';
  }
  const daysSince = ms => dayNum(Date.now()) - dayNum(ms);

  // ------------------------------------------------------------------ categories
  const CAT_LABEL = { movie: 'Movie', tv: 'TV', podcast: 'Podcast', music: 'Album', book: 'Book', song: 'Song', game: 'Game', recipe: 'Recipe', person: 'Person', thought: 'Thought', other: 'Other' };
  function catKey(cat) {
    const c = String(cat || '').toLowerCase();
    if (c === 'album') return 'music';
    return CAT_LABEL[c] ? c : 'other';
  }
  const KIND_LABEL = { met: 'Met', rated: 'Rated', logged: 'Logged', note: 'Note', bookmark: 'Bookmark' };

  // ------------------------------------------------------------------ names (same rules as the watch)
  function norm(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function slugOf(t) {
    const s = norm(t).replace(/ /g, '-').slice(0, 30);
    if (s) return s;
    let h = 0; const x = String(t);
    for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0;
    return 'u' + Math.abs(h).toString(36);
  }
  function titleCase(t) { return t !== t.toLowerCase() ? t : t.replace(/\b[a-z]/g, c => c.toUpperCase()); }
  // "coffee with Maria Lopez, we talked about the field trip" -> name + note
  function parseWho(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
    let act = '', about = '', rest = '', head = t, m;
    if ((m = /^(.*?)\s*(?:[,;:]| - )\s*(.+)$/.exec(t))) { head = m[1]; rest = m[2]; }
    if ((m = /^(.*?)\s+(?:about|regarding)\s+(.+)$/i.exec(head))) { head = m[1]; about = m[2]; }
    if ((m = /^((?:\S+\s+){0,3}?\S+)\s+(?:with|to)\s+(.+)$/i.exec(head))) { act = m[1]; head = m[2]; }
    return { name: titleCase(head.trim()).slice(0, 40).replace(/[.,]+$/, ''), note: [act, about, rest].filter(Boolean).join(', ') };
  }
  // ---- hard names: match by sound (kept in step with names.js in the watch app)
  var HONOR = { ms: 1, miss: 1, mz: 1, mrs: 1, missus: 1, mr: 1, mister: 1, dr: 1, doctor: 1, prof: 1, professor: 1, coach: 1 };

  function nnorm(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '');
  }

  function lev(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  // a rough sound code: similar-sounding consonants share a letter, vowels and h/w/y are dropped
  function sound(tok) {
    var s = String(tok).replace(/^(kn|gn|pn)/, 'n').replace(/^wr/, 'r').replace(/ph/g, 'f').replace(/ck/g, 'k');
    s = s.replace(/[cgjkq]/g, 'k').replace(/z/g, 's').replace(/v/g, 'f').replace(/b/g, 'p').replace(/d/g, 't').replace(/[hwy]/g, '');
    s = s.charAt(0) + s.slice(1).replace(/[aeiou]/g, '');
    return s.replace(/(.)\1+/g, '$1');
  }

  function tokens(name) { return nnorm(name).split(' ').filter(Boolean); }
  function core(name) {
    var t = tokens(name), c = t.filter(function (x) { return !HONOR[x]; });
    return c.length ? c : t;
  }

  function tokMatch(a, b) {
    if (a === b) return true;
    var sa = sound(a), sb = sound(b);
    if (sa === sb && sa.length >= 3 && lev(a, b) <= 3) return true;
    return sa.length >= 5 && sb.length >= 5 && lev(sa, sb) <= 1 && lev(a, b) <= 2;
  }

  function nameMatch(spoken, known) {
    var s = core(spoken), k = core(known), i;
    if (!s.length || !k.length) return false;
    if (s.length === k.length) { for (i = 0; i < s.length; i++) if (!tokMatch(s[i], k[i])) return false; return true; }
    if (s.length === 1) return k.some(function (t) { return tokMatch(s[0], t); });   // just a first or last name
    return false;
  }

  // people: [{ref, name, count}]. aliases: { 'what was heard': ref } learned earlier. Returns a person or null.
  function fuzzyFind(spoken, people, aliases) {
    var n = nnorm(spoken), i, hits = [];
    if (!n) return null;
    if (aliases && aliases[n]) for (i = 0; i < people.length; i++) if (people[i].ref === aliases[n]) return people[i];
    for (i = 0; i < people.length; i++) if (nameMatch(spoken, people[i].name)) hits.push(people[i]);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {                       // two or more candidates: only pick one that clearly dominates
      hits.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
      if ((hits[0].count || 0) >= 3 && (hits[0].count || 0) >= 2 * (hits[1].count || 0)) return hits[0];
    }
    return null;
  }

  const aliasMap = () => store.get('aliases', {});
  function findPerson(name) {
    const n = norm(name);
    if (!n) return null;
    const people = model().people;
    const exact = people.find(p => norm(p.title) === n);
    if (exact) return exact;
    const toks = n.split(' ');
    const hits = people.filter(p => { const pt = norm(p.title).split(' '); return toks.every(t => pt.indexOf(t) >= 0); });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
    const am = aliasMap(), f = fuzzyFind(name, people.map(p => ({ ref: p.ref, name: p.title, count: p.met, p })), am);
    if (f && n !== norm(f.name) && !am[n]) { am[n] = f.ref; store.set('aliases', am); }
    return f ? f.p : null;
  }

  // ------------------------------------------------------------------ model
  function allEvents() {
    const seen = new Map();
    data.events.forEach(e => seen.set(e.id, e));
    queue.forEach(q => (q.events || []).forEach(e => seen.set(e.id, { id: e.id, when: e.ts, kind: e.kind, ref: e.ref || '', title: e.title, cat: e.cat, stars: e.stars == null ? null : e.stars, pos: e.pos || '', track: e.track || '', note: e.note || '', src: e.src || 'phone', pending: true })));
    return [...seen.values()].sort((a, b) => b.when - a.when);
  }
  function model() {
    if (built && builtRev === rev) return built;
    const events = allEvents();
    const ents = new Map(data.entities.map(e => [e.ref, e]));
    const by = new Map();
    for (const e of events) {
      if (!e.ref) continue;
      let x = by.get(e.ref);
      if (!x) {
        const en = ents.get(e.ref);
        x = { ref: e.ref, title: (en && en.title) || e.title, cat: (en && en.cat) || e.cat, events: [], met: 0, last: e.when, first: e.when, stars: null };
        by.set(e.ref, x);
      }
      x.events.push(e);
      if (e.when < x.first) x.first = e.when;
      if (e.kind === 'met') x.met++;
      if (e.stars != null && x.stars == null) x.stars = e.stars;     // events are newest first
    }
    const items = [...by.values()];
    const isPerson = x => catKey(x.cat) === 'person' || /^n:/.test(x.ref);
    built = { events, by, items, people: items.filter(isPerson), content: items.filter(x => !isPerson(x) && x.events.some(e => e.kind === 'rated' || e.kind === 'logged')) };
    builtRev = rev;
    return built;
  }
  const titleOf = e => { const x = model().by.get(e.ref); return (x && x.title) || e.title || 'Untitled'; };

  // ------------------------------------------------------------------ talking to the Sheet
  function withKey(extra) {
    const u = cfg.url + (cfg.url.indexOf('?') >= 0 ? '&' : '?') + (cfg.key ? 'key=' + encodeURIComponent(cfg.key) : '');
    return u + (extra || '');
  }
  async function apiGet(extra) {
    const r = await fetch(withKey(extra), { redirect: 'follow' });
    const d = await r.json();
    if (!d || d.ok !== true) throw new Error(d && d.error === 'key' ? 'Wrong key' : 'The script did not answer correctly');
    return d;
  }
  async function apiPost(body) {
    const r = await fetch(withKey(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d || d.ok !== true) throw new Error('The script did not accept that (wrong key or old script?)');
    return d;
  }
  function setStatus(text, cls) {
    status = { text, cls };
    const el = $('#sync');
    if (el) { el.textContent = text; el.className = 'pill ' + (cls || ''); }
  }
  function syncLabel() {
    if (!connected()) return setStatus('Not connected', 'bad');
    if (queue.length) return setStatus(queue.length + ' waiting to send', 'wait');
    if (data.at) return setStatus('Synced ' + fmtTime(data.at), 'ok');
    setStatus('Not synced yet', '');
  }
  async function refresh(quiet) {
    if (!connected()) { syncLabel(); return; }
    try {
      const d = await apiGet();
      data = { events: d.events || [], entities: d.entities || [], ratings: d.ratings || [], at: Date.now() };
      store.set('data', data);
      rev++;
      syncLabel();
      if (!quiet) toast('Up to date');
      const ae = document.activeElement;
      if (!F && !$('#dlg').open && !(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) render();
    } catch (e) {
      setStatus(navigator.onLine === false ? 'Offline' : 'Could not sync', 'bad');
      if (!quiet) toast(e.message || 'Could not reach your Sheet');
    }
  }
  async function flush() {
    if (flushing || !connected() || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        await apiPost({ events: queue[0].events || [], rows: queue[0].rows || [] });
        queue.shift();
        store.set('queue', queue);
        syncLabel();
      }
      await refresh(true);
    } catch (e) {
      setStatus(navigator.onLine === false ? 'Offline: ' + queue.length + ' waiting' : queue.length + ' waiting to send', 'wait');
    }
    flushing = false;
  }
  function submit(action) {            // action = { events: [...], rows: [...] }
    queue.push(action);
    store.set('queue', queue);
    rev++;
    syncLabel();
    flush();
  }
  async function edit(body, done) {    // rename / merge / void: need a connection, not queued
    try {
      await apiPost(body);
      await refresh(true);
      if (done) done();
    } catch (e) { toast(e.message || 'Could not save that change'); }
  }

  // ------------------------------------------------------------------ small UI helpers
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2600);
  }
  function dialog(html, onOpen) {
    const d = $('#dlg');
    d.innerHTML = html;
    if (!d.open) d.showModal();
    if (onOpen) onOpen(d);
    return d;
  }
  const closeDialog = () => { const d = $('#dlg'); if (d.open) d.close(); };

  function starsHtml(val, big) {
    let s = '<span class="stars' + (big ? '' : ' sm') + '"' + (big ? ' id="starpick"' : '') + '>';
    for (let i = 1; i <= 5; i++) {
      const w = val >= i ? 100 : (val >= i - 0.5 ? 50 : 0);
      s += '<span class="st" data-i="' + i + '">\u2605<span class="fill" style="width:' + w + '%">\u2605</span></span>';
    }
    return s + '</span>';
  }
  // the star picker: tap a star (left half = half star), or use the minus and plus buttons
  function starBox(v) {
    return '<div id="starbox" class="row">' + starsHtml(v, true) + '<button class="btn ghost sm" data-act="star-dec" aria-label="Lower rating">\u2212</button>' +
      '<span id="starval" class="mute" style="min-width:5.5em;text-align:center">' + (v ? ratingText(v) : 'no rating') + '</span>' +
      '<button class="btn ghost sm" data-act="star-inc" aria-label="Raise rating">+</button></div>';
  }
  const ratingText = v => (v == null ? '' : (Math.round(v * 2) / 2).toString().replace(/\.0$/, '') + '\u2605');

  function eventRow(e, opts) {
    opts = opts || {};
    const x = e.ref ? model().by.get(e.ref) : null;
    const ck = catKey((x && x.cat) || e.cat);
    const title = e.ref ? titleOf(e) : (e.title || 'Thought');
    const link = e.ref ? '<a href="#/e/' + encodeURIComponent(e.ref) + '">' + esc(title) + '</a>' : esc(title);
    const meta = [fmtTime(e.when), opts.date ? fmtDate(e.when) : '', e.pos ? '@' + e.pos : '', e.track ? '\u266a ' + e.track : '', e.src || ''].filter(Boolean).join(' \u00b7 ');
    return '<li class="ev' + (opts.newest ? ' new' : '') + '" data-id="' + esc(e.id) + '"><span class="dot c-' + ck + '"></span><div class="ev-main">' +
      '<div class="ev-title">' + link + '<span class="kind">' + esc(KIND_LABEL[e.kind] || e.kind) + '</span>' +
      (e.stars != null ? ' ' + starsHtml(e.stars, false) : '') + '</div>' +
      (e.note ? '<div class="ev-note">' + esc(e.note) + '</div>' : '') +
      '<div class="ev-meta">' + esc(meta) + (e.pending ? ' \u00b7 waiting to send' : '') + '</div></div>' +
      (e.pending ? '' : '<button class="linkbtn" data-act="void" data-id="' + esc(e.id) + '">Remove</button>') + '</li>';
  }

  // ------------------------------------------------------------------ insights
  // Everything below is computed on this device from your own log. No AI service is involved,
  // nothing leaves the page, and each number can be traced to entries you wrote.
  const STOP = new Set(('a about after again all also an and any are as at back be because been before being but by can could did do does done down each for from get got had has have her here his how i if in into is it its just like lot me more most my need needs no not now of on one only or our out over really said say saw see she should so some such talk talked talking than that the their them then there these they thing things this those to too up us very was we went were what when where which who why will with would yes you your today yesterday tomorrow week weeks day days time met meet asked ask told tell chat chatted'.split(' ')));
  const words = t => norm(t).split(' ').filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const snip = (t, n) => { t = String(t || '').trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : t; };
  const initials = t => String(t).replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(' ').filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || '?';
  const greetName = t => /^(dr|mr|mrs|ms|prof)\b/i.test(t) ? t : String(t).split(' ')[0];
  const WEEKDAY = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const hourLabel = h => (h === 12 ? 'noon' : h === 0 ? 'midnight' : (h % 12) + (h < 12 ? ' AM' : ' PM'));
  const evDay = e => dayNum(e.when);
  const today0 = () => dayNum(Date.now());
  const inWindow = (e, from, to) => { const a = today0() - evDay(e); return a >= from && a < to; };   // days ago, from..to-1

  // how often you usually see someone, and whether you are past that
  function cadenceOf(p) {
    const days = [...new Set(p.events.filter(e => e.kind === 'met').map(evDay))].sort((a, b) => a - b);
    const gaps = []; for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
    const since = days.length ? today0() - days[days.length - 1] : daysSince(p.last);
    const med = gaps.length ? Math.max(1, Math.round(median(gaps))) : 0;
    let st = 'ok', label = 'On track', tone = 'green';
    if (!days.length) { st = 'noted'; label = 'Noted'; tone = 'gray'; }
    else if (days.length === 1) { if (since > 45) { st = 'quiet'; label = 'Quiet'; tone = 'amber'; } else { st = 'new'; label = 'New'; tone = 'gray'; } }
    else if (since > Math.max(45, med * 3)) { st = 'quiet'; label = 'Quiet'; tone = 'amber'; }
    else if (since > Math.max(14, med * 1.6)) { st = 'slipping'; label = 'Slipping'; tone = 'amber'; }
    return { meets: days.length, med, since, st, label, tone, ratio: med ? since / med : since / 30 };
  }
  const cadOf = p => p.cad || (p.cad = cadenceOf(p));
  const needsAttention = () => model().people.filter(p => { const c = cadOf(p); return p.met >= 2 && (c.st === 'slipping' || c.st === 'quiet'); }).sort((a, b) => cadOf(b).ratio - cadOf(a).ratio);
  const everyText = med => med <= 1 ? 'about daily' : med < 10 ? 'every ' + med + ' days' : med < 45 ? 'every ' + Math.round(med / 7) + ' weeks' : 'every ' + Math.round(med / 30) + ' months';

  // things you told yourself to do, found in your notes
  const FU_LEAD = /^(?:ask|send|email|call|text|bring|check|share|try|buy|book|schedule|reread|re-read|finish|look into|find|talk to|tell|order|print|grade|review|write|read|follow up|remind|invite|thank|return|pick up|drop off)\b/i;
  const FU_NEED = /\b(?:need to|needs to|have to|has to|got to|gotta|plan to|planning to|remember to|supposed to|should|must|don'?t forget to|forgot to)\s+(.+)/i;
  function followUps() {
    const done = store.get('done', {}), cutoff = Date.now() - 60 * DAY, seen = new Set(), out = [];
    model().events.forEach(e => {
      if (!e.note || e.when < cutoff || e.kind === 'bookmark') return;
      String(e.note).split(/[.;!?\n]+|\s+(?:and then|then)\s+/).forEach((c, i) => {
        c = c.trim(); if (c.length < 5) return;
        let text = null, m;
        if (FU_LEAD.test(c)) text = c; else if ((m = FU_NEED.exec(c)) && m[1].length > 2) text = m[1];
        if (!text) return;
        const key = e.id + ':' + i, dup = (e.ref || '') + '|' + norm(text);
        if (done[key] || seen.has(dup)) return;
        seen.add(dup);
        out.push({ key, text: snip(cap(text), 90), ref: e.ref || '', who: e.ref ? titleOf(e) : '', when: e.when });
      });
    });
    return out;
  }
  function topicsOf(p, n) {
    const c = new Map(), own = new Set(norm(p.title).split(' ')), notes = p.events.filter(e => e.note).length;
    p.events.forEach(e => { if (e.note) new Set(words(e.note)).forEach(w => { if (!own.has(w)) c.set(w, (c.get(w) || 0) + 1); }); });
    return [...c.entries()].filter(x => x[1] >= 2 || notes <= 3).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(x => x[0]);
  }
  // themes: words that show up in this week's notes compared with the four weeks before
  function themes() {
    const cur = new Map(), prev = new Map(), who = new Map();
    model().events.forEach(e => {
      if (!e.note) return;
      const w = new Set(words(e.note)), a = today0() - evDay(e);
      w.forEach(x => {
        if (a >= 0 && a < 7) { cur.set(x, (cur.get(x) || 0) + 1); if (e.ref && /^n:/.test(e.ref)) { if (!who.has(x)) who.set(x, new Set()); who.get(x).add(titleOf(e)); } }
        else if (a >= 7 && a < 35) prev.set(x, (prev.get(x) || 0) + 1);
      });
    });
    const list = [...cur.entries()].map(([w, c]) => {
      const p = (prev.get(w) || 0) / 4;
      const trend = !prev.get(w) ? 'New' : c > p * 1.5 ? 'Rising' : c < p * 0.6 ? 'Fading' : 'Steady';
      return { word: w, cur: c, prev: prev.get(w) || 0, trend, tone: { New: 'green', Rising: 'rose', Steady: 'blue', Fading: 'amber' }[trend], who: [...(who.get(w) || [])].slice(0, 3) };
    }).sort((a, b) => b.cur - a.cur || a.word.localeCompare(b.word));
    const strong = list.filter(t => t.cur >= 2);
    return (strong.length >= 3 ? strong : list).slice(0, 6);
  }
  function resumeList() {
    const out = [], seen = new Set();
    model().items.filter(x => catKey(x.cat) !== 'person' && !/^n:/.test(x.ref)).forEach(x => {
      const e = x.events.find(v => v.pos || v.kind === 'bookmark');
      if (e && daysSince(e.when) <= 90) { seen.add(x.ref); const n = x.events.find(v => v.note && v.kind !== 'bookmark'); out.push({ ref: x.ref, title: x.title, cat: x.cat, where: (e.pos ? 'Stopped at ' + e.pos : 'Bookmarked ' + rel(e.when)) + (e.track ? ' \u00b7 ' + e.track : ''), note: (n && n.note) || (e.kind === 'bookmark' && e.note) || '', when: e.when }); }
    });
    model().items.filter(x => ['tv', 'podcast', 'book', 'game'].indexOf(catKey(x.cat)) >= 0 && !seen.has(x.ref)).forEach(x => {
      const e = x.events[0];
      if (e.kind === 'logged' && e.stars == null && daysSince(e.when) >= 1 && daysSince(e.when) <= 45 && !x.events.some(v => v.stars != null)) out.push({ ref: x.ref, title: x.title, cat: x.cat, where: 'Logged ' + rel(e.when) + ', not rated yet', note: e.note || '', when: e.when });
    });
    return out.sort((a, b) => b.when - a.when).slice(0, 4);
  }
  function streak() {
    const set = new Set(model().events.map(evDay)); let d = today0(), n = 0;
    if (!set.has(d)) d--;
    while (set.has(d)) { n++; d--; }
    return n;
  }
  function aWhileBack() {
    const out = [];
    [[365, 3, 'A year ago'], [90, 2, 'About three months ago'], [30, 1, 'A month ago']].forEach(t => {
      model().events.filter(e => (e.note || e.stars != null) && inWindow(e, t[0] - t[1], t[0] + t[1] + 1)).slice(0, 1).forEach(e => out.push({ label: t[2], e }));
    });
    return out.slice(0, 2);
  }
  function weekStats(offset) {
    const evs = model().events.filter(e => inWindow(e, offset, offset + 7));
    const rated = evs.filter(e => e.stars != null);
    return { evs, n: evs.length, days: new Set(evs.map(evDay)).size, people: new Set(evs.filter(e => e.kind === 'met').map(e => e.ref)), rated, avg: rated.length ? rated.reduce((s, e) => s + e.stars, 0) / rated.length : null };
  }
  function notices() {
    const m = model(), out = [];
    // a habit that dropped
    const cats = {};
    m.events.forEach(e => { const a = today0() - evDay(e), k = catKey((m.by.get(e.ref) || {}).cat || e.cat); if (k === 'thought' || k === 'person') return; if (a < 7) (cats[k] = cats[k] || [0, 0])[0]++; else if (a < 35) (cats[k] = cats[k] || [0, 0])[1]++; });
    Object.keys(cats).forEach(k => { const prev = cats[k][1] / 4; if (prev >= 2 && cats[k][0] <= prev * 0.4) out.push({ color: 'var(--warn)', text: CAT_LABEL[k] + ' entries fell from about ' + Math.round(prev) + ' a week to ' + cats[k][0] + '.' }); });
    // most repeated item
    const rep = m.items.filter(x => catKey(x.cat) !== 'person').map(x => [x, x.events.filter(e => e.kind === 'rated').length]).sort((a, b) => b[1] - a[1])[0];
    if (rep && rep[1] >= 3) out.push({ color: 'var(--ok)', text: 'You have rated ' + rep[0].title + ' ' + rep[1] + ' times, more than anything else.' });
    // the person you see most
    const top = m.people.slice().sort((a, b) => b.met - a.met)[0];
    if (top && top.met >= 5) out.push({ color: 'var(--c-person)', text: 'You have met ' + top.title + ' ' + top.met + ' times, more than anyone else.' });
    // your busiest weekday
    const dow = [0, 0, 0, 0, 0, 0, 0]; let tot = 0;
    m.events.forEach(e => { if (today0() - evDay(e) < 84) { dow[new Date(e.when).getDay()]++; tot++; } });
    if (tot >= 20) { const b = dow.indexOf(Math.max.apply(null, dow)); out.push({ color: 'var(--acc)', text: WEEKDAY[b] + ' are your busiest day for logging.' }); }
    return out.slice(0, 4);
  }
  function tasteList() {
    const by = {};
    model().content.forEach(x => { if (x.stars == null) return; const k = catKey(x.cat); (by[k] = by[k] || []).push(x.stars); });
    return Object.keys(by).map(k => ({ k, n: by[k].length, avg: by[k].reduce((s, v) => s + v, 0) / by[k].length })).sort((a, b) => b.avg - a.avg);
  }
  function narrative() {
    const w = weekStats(0), p = weekStats(7), th = themes().slice(0, 2);
    if (!w.n) return 'Nothing logged in the last seven days yet. A single entry from the watch is enough to get this page going.';
    const counts = {}; w.evs.filter(e => e.kind === 'met').forEach(e => { counts[e.ref] = (counts[e.ref] || 0) + 1; });
    const twice = Object.keys(counts).filter(r => counts[r] >= 2).length;
    let s = 'You logged ' + w.n + (w.n === 1 ? ' entry' : ' entries') + ' across ' + w.days + (w.days === 1 ? ' day' : ' days') + '. ';
    if (w.people.size) s += 'You met ' + w.people.size + (w.people.size === 1 ? ' person' : ' people') + (twice ? ', ' + (twice === 1 ? 'one of them twice' : twice + ' of them more than once') : '') + '. ';
    if (w.rated.length) s += 'You rated ' + w.rated.length + (w.rated.length === 1 ? ' thing' : ' things') + ', averaging ' + w.avg.toFixed(1) + ' stars. ';
    if (th.length) s += 'Your notes kept coming back to ' + th.map(t => '\u201c' + t.word + '\u201d').join(' and ') + '. ';
    if (p.n) s += w.n > p.n ? 'That is up from ' + p.n + ' the week before.' : w.n < p.n ? 'That is down from ' + p.n + ' the week before.' : 'Same as the week before.';
    return s.trim();
  }
  // what you might want to log right now
  function suggestions() {
    const out = [], now = new Date(), dow = now.getDay(), hr = now.getHours(), t0 = today0(), m = model();
    const metToday = new Set(m.events.filter(e => e.kind === 'met' && evDay(e) === t0).map(e => e.ref));
    m.people.forEach(p => {
      if (metToday.has(p.ref)) return;
      const hits = p.events.filter(e => { const d = t0 - evDay(e); return e.kind === 'met' && d > 0 && d <= 84 && new Date(e.when).getDay() === dow && Math.abs(new Date(e.when).getHours() - hr) <= 1; });
      if (new Set(hits.map(evDay)).size >= 2) out.push({ score: 10 + hits.length, title: 'Met ' + greetName(p.title) + '?', why: 'You often see ' + greetName(p.title) + ' on ' + WEEKDAY[dow] + ' around ' + hourLabel(hr), act: 'Log it', attrs: 'data-act="met-again" data-ref="' + esc(p.ref) + '"' });
    });
    const r = resumeList()[0];
    if (r) out.push({ score: 5, title: 'Back to ' + r.title + '?', why: r.where, act: 'Add note', attrs: 'data-act="note-about" data-ref="' + esc(r.ref) + '"' });
    const o = needsAttention()[0];
    if (o) out.push({ score: 3, title: 'Check in with ' + greetName(o.title), why: 'It has been ' + cadOf(o).since + ' days, longer than your usual ' + everyText(cadOf(o).med || 30), act: 'Open', attrs: 'data-act="go" data-to="#/e/' + encodeURIComponent(o.ref) + '"' });
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
  }
  const suggHtml = list => list.length ? '<div class="card tint"><h2>Looks like right now</h2>' + list.map(s => '<div class="srow"><div class="grow"><b>' + esc(s.title) + '</b><div class="small mute">' + esc(s.why) + '</div></div><button class="btn sm" ' + s.attrs + '>' + esc(s.act) + '</button></div>').join('') + '</div>' : '';
  function checkInDraft(p) {
    const c = cadOf(p), n = p.events.find(e => e.note && e.kind !== 'bookmark'), fu = followUps().find(f => f.ref === p.ref && norm(f.text).indexOf(norm(greetName(p.title))) < 0);
    const wk = Math.round(c.since / 7);
    let s = 'Hi ' + greetName(p.title) + ', ' + (c.since >= 10 ? 'it has been ' + (wk >= 2 ? 'about ' + wk + ' weeks' : c.since + ' days') + ' since we caught up. ' : 'I was thinking of you. ');
    s += n ? 'Last time we talked about ' + snip(n.note.replace(/[.!?]+$/, ''), 60).toLowerCase() + '. How is that going?' : 'Do you have time to talk this week?';
    if (fu) s += ' I still want to ' + fu.text.charAt(0).toLowerCase() + fu.text.slice(1).replace(/[.!?]+$/, '') + '.';
    return s;
  }

  // ------------------------------------------------------------------ routing and views
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3c2.2.6 3.5 2.4 3.5 5.7"/>',
    capture: '<path d="M12 5v14M5 12h14"/>',
    content: '<path d="M12 6.5C10.5 5 8 4.5 3 4.5V18c5 0 7.5.5 9 2 1.5-1.5 4-2 9-2V4.5c-5 0-7.5.5-9 2zM12 6.5V20"/>',
    review: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    note: '<path d="M5 4h14v16H5zM9 9h6M9 13h4"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'
  };
  const svgIcon = k => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
  const NAV = [
    ['home', 'Home', 'home'], ['people', 'People', 'people'], ['capture', 'Capture', 'capture', 'fab'], ['content', 'Content', 'content'], ['review', 'Review', 'review'],
    ['today', 'Today', 'today', 'more'], ['search', 'Search', 'search', 'more'], ['settings', 'Settings', 'settings', 'more']
  ];
  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    return { name: parts[0] || 'home', arg: decodeURIComponent(parts.slice(1).join('/') || '') };
  }
  let entKind = 'people';
  function renderNav(active) {
    $('#nav').innerHTML = NAV.map(n => '<a href="#/' + n[0] + '" class="' + (n[3] || '') + (n[0] === active || (active === 'week' && n[0] === 'review') || (active === 'e' && n[0] === (entKind === 'content' ? 'content' : 'people')) ? ' on' : '') + '"><span class="g">' + svgIcon(n[2]) + '</span>' + n[1] + '</a>').join('');
  }
  function render() {
    const r = route();
    if (!connected() && r.name !== 'settings') { location.hash = '#/settings'; return; }
    renderNav(r.name);
    stopMic();
    const v = { home: viewHome, capture: viewCapture, today: viewToday, people: viewPeople, e: viewEntity, content: viewContent, search: viewSearch, review: viewReview, week: viewReview, settings: viewSettings }[r.name] || viewHome;
    const main = $('#main');
    main.innerHTML = v(r.arg);
    if (r.name === 'e') renderNav('e');
    window.scrollTo(0, 0);
    if (r.name !== 'capture') F = null;
    afterRender(r);
    syncLabel();
  }
  function afterRender(r) {
    if (r.name === 'capture' && F) flowBind();
    if (r.name === 'search') { const i = $('#q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  // ---- Home: the daily brief
  const sectionHead = (title, link, label) => '<div class="row sb"><h2>' + esc(title) + '</h2>' + (link ? '<a class="small" href="' + link + '">' + esc(label) + '</a>' : '') + '</div>';
  const peopleLine = p => { const c = cadOf(p); return c.med ? 'You usually meet ' + everyText(c.med) + '. ' : ''; };
  function fuRow(f, showWho) {
    return '<div class="fu"><button class="check" data-act="fu-done" data-k="' + esc(f.key) + '" aria-label="Mark done: ' + esc(f.text) + '"></button><div class="grow"><div>' + esc(f.text) + '</div><div class="small mute">' +
      (showWho && f.who ? 'From your note on <a href="#/e/' + encodeURIComponent(f.ref) + '">' + esc(f.who) + '</a>, ' : 'Noted ') + rel(f.when) + '</div></div></div>';
  }
  function viewHome() {
    const m = model(), now = new Date(), hr = now.getHours();
    const greet = 'This week';
    if (!m.events.length) {
      return '<h1>' + greet + '</h1><div class="card"><b>Nothing logged yet</b><p class="mute">Capture something from the watch or below and this page fills in: who you saw, what you finished, what to follow up on.</p></div>' + quickTiles();
    }
    const t0 = today0(), evs = m.events.filter(e => evDay(e) === t0).sort((a, b) => a.when - b.when);
    const att = needsAttention(), fu = followUps(), res = resumeList(), w = weekStats(0), back = aWhileBack(), st = streak();
    const bits = [att.length ? att.length + (att.length === 1 ? ' person' : ' people') + ' worth a message' : '', fu.length ? fu.length + (fu.length === 1 ? ' follow-up' : ' follow-ups') + ' waiting' : '', res.length ? res.length + ' to pick up' : ''].filter(Boolean);
    return '<div class="hello"><div class="small mute">' + fmtDayLong(localDay(Date.now())) + '</div><h1>' + greet + '</h1>' + (bits.length ? '<p class="mute">' + bits.join(' · ') + '</p>' : '<p class="mute">You are all caught up</p>') + '</div>' +
      '<div class="card story"><p>' + esc(narrative()) + '</p></div>' + quickTiles() + suggHtml(suggestions()) +
      '<div class="cols"><div class="col">' +
      '<section class="card">' + sectionHead('Today so far', '#/today', 'See the day') + (evs.length ? '<ul class="list">' + evs.slice(-6).map((e, i, a) => eventRow(e, { newest: i === a.length - 1 })).join('') + '</ul>' : '<div class="empty">Nothing yet today.</div>') + '</section>' +
      (att.length ? '<section class="card">' + sectionHead('People worth a message', '#/people', 'All people') + att.slice(0, 3).map(p => {
        const c = cadOf(p), n = p.events.find(e => e.note && e.kind !== 'bookmark');
        return '<div class="srow"><span class="av">' + esc(initials(p.title)) + '</span><div class="grow"><a class="strong" href="#/e/' + encodeURIComponent(p.ref) + '">' + esc(p.title) + '</a> <span class="pillx amber">' + c.since + ' days</span><div class="small mute">' + esc(peopleLine(p)) + (n ? 'Last note: “' + esc(snip(n.note, 60)) + '”' : '') + '</div></div></div>';
      }).join('') + '</section>' : '') +
      (fu.length ? '<section class="card">' + sectionHead('Follow-ups from your notes', '', '') + fu.slice(0, 5).map(f => fuRow(f, true)).join('') + '<p class="small mute" style="margin:.6rem 0 0">Found by looking for things like “ask”, “send” and “need to” in your notes.</p></section>' : '') +
      '</div><div class="col">' +
      (res.length ? '<section class="card">' + sectionHead('Pick up where you left off', '#/content', 'Content') + res.map(r => '<div class="srow"><span class="swatch c-' + catKey(r.cat) + '"></span><div class="grow"><a class="strong" href="#/e/' + encodeURIComponent(r.ref) + '">' + esc(r.title) + '</a><div class="small mute">' + esc(r.where) + '</div>' + (r.note ? '<div class="small">“' + esc(snip(r.note, 70)) + '”</div>' : '') + '</div></div>').join('') + '</section>' : '') +
      '<section class="card">' + sectionHead('This week', '#/review', 'Full review') + '<div class="stats two"><div class="stat"><b>' + w.n + '</b><span>entries</span></div><div class="stat"><b>' + w.people.size + '</b><span>people met</span></div><div class="stat"><b>' + w.rated.length + '</b><span>rated</span></div><div class="stat"><b>' + st + '</b><span>' + (st === 1 ? 'day' : 'days') + ' in a row</span></div></div></section>' +
      (back.length ? '<section class="card"><h2>A while back</h2>' + back.map(b => '<div class="srow"><div class="grow"><div class="small mute">' + esc(b.label) + '</div><div><a class="strong" href="' + (b.e.ref ? '#/e/' + encodeURIComponent(b.e.ref) : '#/today/' + localDay(b.e.when)) + '">' + esc(b.e.ref ? titleOf(b.e) : 'A thought') + '</a>' + (b.e.stars != null ? ' ' + starsHtml(b.e.stars, false) : '') + '</div>' + (b.e.note ? '<div class="small">“' + esc(snip(b.e.note, 90)) + '”</div>' : '') + '</div></div>').join('') + '</section>' : '') +
      '</div></div>';
  }
  function quickTiles() {
    return '<div class="quick"><a href="#/capture/met" class="q-met">' + svgIcon('people') + 'Met</a><a href="#/capture/media" class="q-media">' + svgIcon('content') + 'Rate</a><a href="#/capture/any" class="q-any">' + svgIcon('pin') + 'Did</a><a href="#/capture/note" class="q-note">' + svgIcon('note') + 'Note</a></div>';
  }

  // ---- Review: the week, in words and numbers
  function viewReview() {
    const m = model(), today = today0();
    const w = weekStats(0), p = weekStats(7), th = themes(), taste = tasteList(), nt = notices(), fu = followUps();
    const counts = {};
    m.events.forEach(e => { const d = dayNum(e.when); counts[d] = (counts[d] || 0) + 1; });
    const dow = (new Date().getDay() + 6) % 7, weeks = 12, start = today - dow - (weeks - 1) * 7;
    let cells = '', months = '';
    for (let wk = 0; wk < weeks; wk++) {
      for (let r = 0; r < 7; r++) {
        const d = start + wk * 7 + r;
        if (d > today) continue;
        const n = counts[d] || 0, lvl = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4;
        cells += '<rect class="l' + lvl + '" x="' + (wk * 17 + 14) + '" y="' + (r * 17 + 14) + '" width="14" height="14" rx="3"><title>' + new Date(d * DAY).toISOString().slice(0, 10) + ': ' + n + '</title></rect>';
      }
      const first = new Date((start + wk * 7) * DAY);
      if (first.getUTCDate() <= 7) months += '<text x="' + (wk * 17 + 14) + '" y="9">' + first.toLocaleDateString([], { month: 'short', timeZone: 'UTC' }) + '</text>';
    }
    const mo = m.events.filter(e => today - evDay(e) < 30), catCount = {};
    mo.forEach(e => { const k = catKey((m.by.get(e.ref) || {}).cat || e.cat); catCount[k] = (catCount[k] || 0) + 1; });
    const cc = Object.entries(catCount).sort((a, b) => b[1] - a[1]), top = cc.length ? cc[0][1] : 1;
    const best = m.content.filter(x => x.stars != null).sort((a, b) => b.stars - a.stars || b.last - a.last).slice(0, 3);
    return '<h1>Your week</h1><p class="small mute" style="margin-top:-.4rem">The last 7 days, compared with the week before</p>' +
      '<div class="card story"><p>' + esc(narrative()) + '</p></div>' +
      '<div class="stats"><div class="stat"><b>' + w.n + '</b><span>entries' + (p.n ? ' (' + p.n + ' before)' : '') + '</span></div><div class="stat"><b>' + w.people.size + '</b><span>people met</span></div><div class="stat"><b>' + w.rated.length + '</b><span>rated</span></div><div class="stat"><b>' + (w.avg == null ? '–' : w.avg.toFixed(1)) + '</b><span>avg stars</span></div></div>' +
      '<div class="cols"><div class="col">' +
      '<section class="card"><h2>Themes in your notes</h2>' + (th.length ? th.map(t => '<a class="theme" href="#/search/' + encodeURIComponent(t.word) + '"><div class="grow"><b>' + esc(t.word) + '</b> <span class="pillx ' + t.tone + '">' + t.trend + '</span><div class="small mute">' + t.cur + (t.cur === 1 ? ' entry' : ' entries') + ' this week' + (t.who.length ? ', with ' + esc(t.who.join(', ')) : '') + '</div></div><span class="meter"><i style="width:' + Math.min(100, t.cur * 25) + '%"></i></span></a>').join('') : '<div class="empty">Themes appear once you have a few notes this week.</div>') + '</section>' +
      '<section class="card"><h2>Last 12 weeks</h2><svg class="heat" viewBox="0 0 ' + (weeks * 17 + 14) + ' 135" role="img" aria-label="Activity by day">' + months + cells + '</svg></section>' +
      '<section class="card"><h2>By category, 30 days</h2><div class="bars">' + (cc.length ? cc.map(c => '<div class="bar"><span>' + CAT_LABEL[c[0]] + '</span><i class="c-' + c[0] + '" style="width:' + Math.max(4, Math.round(c[1] / top * 100)) + '%"></i><span class="mute">' + c[1] + '</span></div>').join('') : '<div class="empty">Nothing in the last 30 days.</div>') + '</div></section>' +
      '</div><div class="col">' +
      (nt.length ? '<section class="card"><h2>Worth noticing</h2>' + nt.map(n => '<div class="srow"><span class="dotx" style="background:' + n.color + '"></span><div class="grow small" style="font-size:.95rem">' + esc(n.text) + '</div></div>').join('') + '</section>' : '') +
      '<section class="card"><h2>Your taste, from your ratings</h2>' + (taste.length ? taste.map(t => '<div class="taste"><div class="row sb"><b>' + esc(CAT_LABEL[t.k]) + '</b><span class="small mute">' + (Math.round(t.avg * 10) / 10) + ' avg, ' + t.n + ' rated</span></div><div class="meter wide"><i class="c-' + t.k + '" style="width:' + Math.round(t.avg / 5 * 100) + '%"></i></div></div>').join('') + (best.length ? '<p class="small mute" style="margin:.7rem 0 0">Highest rated: ' + best.map(b => '<a href="#/e/' + encodeURIComponent(b.ref) + '">' + esc(b.title) + '</a>').join(', ') + '</p>' : '') : '<div class="empty">Rate a few things and your taste shows up here.</div>') + '</section>' +
      '<section class="card"><h2>Streak</h2><div class="stats two"><div class="stat"><b>' + streak() + '</b><span>days in a row logged</span></div><div class="stat"><b>' + fu.length + '</b><span>open follow-ups</span></div></div></section>' +
      '</div></div>';
  }

  // ---- A person: how it is going, what you talk about, what is open
  function viewPerson(x) {
    const c = cadOf(x), topics = topicsOf(x, 6), fu = followUps().filter(f => f.ref === x.ref);
    const now = new Date(), bars = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1), n = x.events.filter(e => { const t = new Date(e.when); return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth(); }).length;
      bars.push({ n, label: d.toLocaleDateString([], { month: 'narrow' }) });
    }
    const mx = Math.max(1, ...bars.map(b => b.n));
    const draft = (c.st === 'slipping' || c.st === 'quiet' || x.met >= 1) ? checkInDraft(x) : '';
    return '<p><a href="#/people">← People</a></p>' +
      '<div class="phead"><span class="av big">' + esc(initials(x.title)) + '</span><div class="grow"><h1>' + esc(x.title) + '</h1><div class="small mute">First logged ' + fmtDate(x.first) + ' · met ' + x.met + (x.met === 1 ? ' time' : ' times') + '</div></div><span class="pillx ' + c.tone + '">' + c.label + '</span></div>' +
      '<div class="stats three"><div class="stat"><b>' + (c.med ? c.med + (c.med === 1 ? ' day' : ' days') : '–') + '</b><span>your usual gap</span></div><div class="stat' + (c.st === 'slipping' || c.st === 'quiet' ? ' warn' : '') + '"><b>' + c.since + (c.since === 1 ? ' day' : ' days') + '</b><span>since you last met</span></div><div class="stat"><b>' + fu.length + '</b><span>open follow-ups</span></div></div>' +
      '<p class="row"><button class="btn sm" data-act="met-again" data-ref="' + esc(x.ref) + '">Met just now</button><button class="btn ghost sm" data-act="note-about" data-ref="' + esc(x.ref) + '">Add a note</button><button class="btn ghost sm" data-act="rename" data-ref="' + esc(x.ref) + '">Rename</button><button class="btn ghost sm" data-act="merge" data-ref="' + esc(x.ref) + '">Merge into…</button></p>' +
      '<section class="card"><h2>Your contact, last 12 months</h2><div class="mbars">' + bars.map(b => '<div><i style="height:' + (b.n ? Math.max(4, Math.round(b.n / mx * 56)) : 2) + 'px"' + (b.n ? '' : ' class="zero"') + ' title="' + b.n + '"></i><span>' + b.label + '</span></div>').join('') + '</div></section>' +
      '<div class="cols"><div class="col">' +
      '<section class="card"><h2>You usually talk about</h2>' + (topics.length ? '<div class="chips">' + topics.map(t => '<a class="chip" href="#/search/' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('') + '</div>' : '<div class="empty">Topics appear once you have written a few notes about them.</div>') +
      '<h2 style="margin-top:1rem">Open follow-ups</h2>' + (fu.length ? fu.map(f => fuRow(f, false)).join('') : '<div class="small mute">None found in your notes.</div>') + '</section>' +
      (draft ? '<section class="card tint"><h2>A check-in you could send</h2><textarea id="draft" rows="5" aria-label="Draft message">' + esc(draft) + '</textarea><p class="row" style="margin-bottom:0"><button class="btn sm" data-act="copy-draft">Copy</button><span class="small mute">Written from your own notes. Nothing is sent for you.</span></p></section>' : '') +
      '</div><div class="col"><section class="card"><h2>Timeline</h2><ul class="list">' + x.events.map(e => eventRow(e, { date: true })).join('') + '</ul></section></div></div>';
  }

  // ---- Capture
  function viewCapture(arg) {
    if (arg && !F) startFlow(arg);
    if (F) return flowHtml();
    const recent = model().events.slice(0, 5);
    return '<h1>Capture</h1>' + suggHtml(suggestions()) + '<div class="tiles">' +
      '<button class="tile t-met" data-act="flow" data-t="met"><b>Met someone</b><span>a person, with a note</span></button>' +
      '<button class="tile t-media" data-act="flow" data-t="media"><b>Watched, listened, read</b><span>search and rate</span></button>' +
      '<button class="tile t-any" data-act="flow" data-t="any"><b>Went, ate, did</b><span>anything else</span></button>' +
      '<button class="tile t-note" data-act="flow" data-t="note"><b>A thought</b><span>just write it down</span></button></div>' +
      '<h2>Just now</h2><div class="card">' + (recent.length ? '<ul class="list">' + recent.map(e => eventRow(e)).join('') + '</ul>' : '<div class="empty">Nothing yet. Capture your first one above.</div>') + '</div>';
  }
  function startFlow(t) {
    F = { t, step: t === 'media' ? 'pick' : 'form', kind: 'movie', stars: 0, picked: null, q: '', note: '', name: '', tag: '', about: '' };
  }
  const MEDIA = [['movie', 'Movie'], ['tv', 'TV show'], ['podcast', 'Podcast'], ['album', 'Album'], ['song', 'Song'], ['book', 'Book'], ['recipe', 'Recipe'], ['game', 'Game']];
  function flowTop(title) { return '<div class="row sb"><h1>' + esc(title) + '</h1><button class="linkbtn" data-act="flow-cancel">Cancel</button></div>'; }
  function peopleChips(filter) {
    const f = norm(filter);
    let list = model().people.slice().sort((a, b) => b.last - a.last);
    if (f) list = list.filter(p => norm(p.title).indexOf(f) >= 0 || nameMatch(filter, p.title));
    return list.slice(0, 10).map(p => '<button class="chip" data-act="pick-person" data-ref="' + esc(p.ref) + '">' + esc(p.title) + '</button>').join('');
  }
  function flowHtml() {
    if (F.t === 'met') {
      return flowTop('Who did you see?') +
        '<label for="f-name">Name, or say what happened ("coffee with Maria")</label><input type="text" id="f-name" autocomplete="off" value="' + esc(F.name) + '">' +
        '<div class="chips" id="f-chips">' + peopleChips(F.name) + '</div>' +
        '<label for="f-note">Anything to remember (optional)</label><textarea id="f-note">' + esc(F.note) + '</textarea>' + micBtn('f-note') +
        '<p><button class="btn" data-act="save-met">Save</button></p>';
    }
    if (F.t === 'note') {
      const opts = model().items.map(x => '<option value="' + esc(x.title) + '"></option>').join('');
      return flowTop('A thought') +
        '<label for="f-note">What is on your mind?</label><textarea id="f-note" rows="5">' + esc(F.note) + '</textarea>' + micBtn('f-note') +
        '<label for="f-about">About (optional: a person or item you have logged)</label><input type="text" id="f-about" list="f-ents" autocomplete="off" value="' + esc(F.about) + '"><datalist id="f-ents">' + opts + '</datalist>' +
        '<p><button class="btn" data-act="save-note">Save</button></p>';
    }
    if (F.t === 'any') {
      const tags = [...new Set(model().events.filter(e => /^x:/.test(e.ref) && e.cat && catKey(e.cat) === 'other').map(e => String(e.cat).toLowerCase()))];
      ['restaurant', 'coffee', 'place', 'event'].forEach(t => { if (tags.indexOf(t) < 0) tags.push(t); });
      return flowTop('Went, ate, did') +
        '<label for="f-name">What was it?</label><input type="text" id="f-name" autocomplete="off" value="' + esc(F.name) + '">' +
        '<label>Kind</label><div class="chips">' + tags.slice(0, 10).map(t => '<button class="chip' + (F.tag === t ? ' on' : '') + '" data-act="pick-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
        '<input type="text" id="f-tag" placeholder="or type a new kind" value="' + (tags.indexOf(F.tag) < 0 ? esc(F.tag) : '') + '">' +
        '<label>Rating (optional)</label>' + starBox(F.stars) +
        '<label for="f-note">Note (optional)</label><textarea id="f-note">' + esc(F.note) + '</textarea>' + micBtn('f-note') +
        '<p><button class="btn" data-act="save-any">Save</button></p>';
    }
    // media
    if (F.step === 'pick') {
      return flowTop('Watched, listened, read') +
        '<div class="chips">' + MEDIA.map(m => '<button class="chip' + (F.kind === m[0] ? ' on' : '') + '" data-act="pick-kind" data-k="' + m[0] + '">' + m[1] + '</button>').join('') + '</div>' +
        '<label for="f-q">Title</label><input type="search" id="f-q" autocomplete="off" value="' + esc(F.q) + '">' +
        '<div class="results" id="f-res">' + (F.resHtml || '') + '</div>';
    }
    return flowTop('Rate it') + '<div class="card"><b>' + esc(F.picked.title) + '</b><div class="small mute">' + esc(CAT_LABEL[catKey(F.picked.cat)]) + (F.picked.sub ? ' \u00b7 ' + esc(F.picked.sub) : '') + '</div></div>' +
      '<label>Rating</label>' + starBox(F.stars) +
      '<label for="f-note">Note (optional)</label><textarea id="f-note">' + esc(F.note) + '</textarea>' + micBtn('f-note') +
      '<p class="row"><button class="btn" data-act="save-media">Save</button> <button class="btn ghost" data-act="save-media-nostars">Just log it</button></p>';
  }
  function flowBind() {
    const name = $('#f-name'), note = $('#f-note'), q = $('#f-q'), tag = $('#f-tag'), about = $('#f-about');
    if (name) name.addEventListener('input', () => { F.name = name.value; F.pickedRef = null; const c = $('#f-chips'); if (c) c.innerHTML = peopleChips(name.value); });
    if (note) note.addEventListener('input', () => { F.note = note.value; });
    if (tag) tag.addEventListener('input', () => { F.tag = tag.value.trim().toLowerCase(); });
    if (about) about.addEventListener('input', () => { F.about = about.value; });
    if (q) { q.addEventListener('input', () => { F.q = q.value; clearTimeout(F.timer); F.timer = setTimeout(doSearch, 350); }); }
    const first = name || q || note;
    if (first && !F.focused) { F.focused = true; first.focus(); }
  }

  // ---- searching catalogs (same sources and ids as the watch)
  const fetchJSON = async (url, headers) => { const r = await fetch(url, { headers: headers || {} }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const yr = d => (d && String(d).length >= 4 ? String(d).slice(0, 4) : '');
  const SEARCH = {
    movie: async q => {
      if (!cfg.tmdb) throw new Error('Add your TMDB key in Settings to search movies');
      const long = cfg.tmdb.length > 40;
      const d = await fetchJSON('https://api.themoviedb.org/3/search/movie?query=' + encodeURIComponent(q) + (long ? '' : '&api_key=' + encodeURIComponent(cfg.tmdb)), long ? { Authorization: 'Bearer ' + cfg.tmdb } : null);
      return (d.results || []).slice(0, 8).map(r => ({ ref: 'm:' + r.id, title: r.title + (yr(r.release_date) ? ' (' + yr(r.release_date) + ')' : ''), cat: 'movie', sub: '' }));
    },
    tv: async q => {
      if (!cfg.tmdb) throw new Error('Add your TMDB key in Settings to search shows');
      const long = cfg.tmdb.length > 40;
      const d = await fetchJSON('https://api.themoviedb.org/3/search/tv?query=' + encodeURIComponent(q) + (long ? '' : '&api_key=' + encodeURIComponent(cfg.tmdb)), long ? { Authorization: 'Bearer ' + cfg.tmdb } : null);
      return (d.results || []).slice(0, 8).map(r => ({ ref: 't:' + r.id, title: r.name + (yr(r.first_air_date) ? ' (' + yr(r.first_air_date) + ')' : ''), cat: 'tv', sub: '' }));
    },
    podcast: async q => (await fetchJSON('https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term=' + encodeURIComponent(q))).results
      .filter(r => r.collectionId).map(r => ({ ref: 'p:' + r.collectionId, title: r.collectionName, cat: 'podcast', sub: r.artistName || '' })),
    album: async q => (await fetchJSON('https://itunes.apple.com/search?media=music&entity=album&limit=8&term=' + encodeURIComponent(q))).results
      .filter(r => r.collectionId).map(r => ({ ref: 'a:' + r.collectionId, title: (r.artistName ? r.artistName + ' - ' : '') + r.collectionName, cat: 'music', sub: '' })),
    song: async q => (await fetchJSON('https://itunes.apple.com/search?media=music&entity=song&limit=8&term=' + encodeURIComponent(q))).results
      .filter(r => r.trackId && r.trackName).map(r => ({ ref: 's:' + r.trackId, title: (r.artistName ? r.artistName + ' - ' : '') + r.trackName, cat: 'song', sub: '' })),
    book: async q => (await fetchJSON('https://openlibrary.org/search.json?limit=8&fields=key,title,author_name,first_publish_year&q=' + encodeURIComponent(q))).docs
      .filter(r => r.key && r.title).map(r => ({ ref: 'b:' + String(r.key).replace('/works/', ''), title: r.title + ((r.author_name || [])[0] ? ' - ' + r.author_name[0] : ''), cat: 'book', sub: r.first_publish_year ? String(r.first_publish_year) : '' })),
    recipe: async q => ((await fetchJSON('https://www.themealdb.com/api/json/v1/1/search.php?s=' + encodeURIComponent(q))).meals || [])
      .slice(0, 8).map(r => ({ ref: 'r:' + r.idMeal, title: r.strMeal, cat: 'recipe', sub: r.strArea || '' })),
    game: async () => []
  };
  async function doSearch() {
    const q = F && F.q.trim();
    const box = $('#f-res');
    if (!box) return;
    if (!q) { F.resHtml = ''; box.innerHTML = ''; return; }
    const mine = ++F.seq || (F.seq = 1);
    let list = [], err = '';
    box.innerHTML = '<p class="mute">Searching...</p>';
    try { list = await SEARCH[F.kind](q); } catch (e) { err = e.message || 'Search failed'; }
    if (!F || F.seq !== mine) return;
    F.results = list;
    F.typed = { ref: 'x:' + slugOf(q), title: q, cat: F.kind === 'album' ? 'music' : F.kind, sub: '' };
    F.resHtml = (err ? '<p class="mute small">' + esc(err) + '. You can still add it as typed.</p>' : '') +
      list.map((r, i) => '<button class="res" data-act="pick-result" data-i="' + i + '">' + esc(r.title) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</button>').join('') +
      '<button class="res" data-act="pick-typed">Add \u201c' + esc(q) + '\u201d as typed</button>';
    box.innerHTML = F.resHtml;
  }

  // ---- saving what you captured
  function mkEvent(o) {
    const ts = Date.now();
    return Object.assign({ id: 'p-' + ts.toString(36) + '-' + Math.random().toString(36).slice(2, 6), ts, day: localDay(ts), src: 'phone' }, o);
  }
  function done(msg) { F = null; toast(msg); location.hash = '#/capture'; render(); }
  function saveMet() {
    let ref, title, note = F.note.trim();
    const typed = F.name.trim();
    const picked = F.pickedRef && model().by.get(F.pickedRef);
    if (picked && norm(picked.title) === norm(typed)) { ref = picked.ref; title = picked.title; }
    else {
      const w = parseWho(typed);
      if (!norm(w.name)) { toast('Type a name first'); return; }
      const known = findPerson(w.name);
      ref = known ? known.ref : 'n:' + slugOf(w.name);
      title = known ? known.title : w.name;
      note = [w.note, note].filter(Boolean).join(', ');
    }
    submit({ events: [mkEvent({ kind: 'met', ref, title, cat: 'person', note })] });
    done('Logged ' + title);
  }
  function saveNote() {
    const text = F.note.trim();
    if (!text) { toast('Write something first'); return; }
    const x = F.about.trim() && model().items.find(i => norm(i.title) === norm(F.about));
    submit({ events: [mkEvent(x ? { kind: 'note', ref: x.ref, title: x.title, cat: x.cat, note: text } : { kind: 'note', ref: '', title: 'Thought', cat: 'thought', note: text })] });
    done('Saved');
  }
  function saveItem(item, withStars) {
    const stars = withStars && F.stars > 0 ? F.stars : null;
    const ev = mkEvent({ kind: stars ? 'rated' : 'logged', ref: item.ref, title: item.title, cat: item.cat, stars, note: F.note.trim() });
    if (stars) ev.id = 'r-' + item.ref + '-' + ev.ts;
    submit({ events: [ev], rows: stars ? [{ ref: item.ref, title: item.title, cat: item.cat, stars, ts: ev.ts }] : [] });
    done('Saved ' + item.title);
  }
  function saveAny() {
    const name = F.name.trim();
    const tag = (F.tag || '').trim().toLowerCase();
    if (!name) { toast('What was it?'); return; }
    saveItem({ ref: 'x:' + slugOf(name), title: name, cat: tag || 'other' }, true);
  }

  // ---- Today
  function viewToday(arg) {
    const day = /^\d{4}-\d\d-\d\d$/.test(arg) ? arg : localDay(Date.now());
    const m = model();
    const evs = m.events.filter(e => localDay(e.when) === day).sort((a, b) => a.when - b.when);
    const people = new Set(evs.filter(e => e.kind === 'met').map(e => e.ref));
    const rated = evs.filter(e => e.stars != null);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.stars, 0) / rated.length).toFixed(1) : '\u2013';
    const isToday = day === localDay(Date.now());
    return '<div class="daynav"><button class="btn ghost sm" data-act="go" data-to="#/today/' + addDays(day, -1) + '" aria-label="Previous day">\u2039</button>' +
      '<h1>' + (isToday ? 'Today' : fmtDayLong(day)) + (isToday ? '<div class="small mute">' + fmtDayLong(day) + '</div>' : '') + '</h1>' +
      '<button class="btn ghost sm" data-act="go" data-to="#/today/' + addDays(day, 1) + '" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>\u203a</button></div>' +
      '<div class="stats"><div class="stat"><b>' + evs.length + '</b><span>logged</span></div><div class="stat"><b>' + people.size + '</b><span>people met</span></div>' +
      '<div class="stat"><b>' + rated.length + '</b><span>rated</span></div><div class="stat"><b>' + avg + '</b><span>avg stars</span></div></div>' +
      '<div class="card">' + (evs.length ? '<ul class="list">' + evs.map(e => eventRow(e)).join('') + '</ul>' : '<div class="empty">Nothing logged ' + (isToday ? 'yet today' : 'this day') + '.</div>') + '</div>' +
      '<p><a href="#/review">Your week \u2192</a></p>';
  }

  // ---- People
  let peopleSort = 'recent', peopleQ = '';
  function viewPeople() {
    let list = model().people.slice();
    const q = norm(peopleQ);
    if (q) list = list.filter(p => norm(p.title).indexOf(q) >= 0);
    const sorters = { recent: (a, b) => b.last - a.last, stale: (a, b) => a.last - b.last, most: (a, b) => b.met - a.met || b.events.length - a.events.length, az: (a, b) => a.title.localeCompare(b.title) };
    list.sort(sorters[peopleSort]);
    return '<h1>People</h1><div class="row"><input type="search" id="pq" placeholder="Find someone" value="' + esc(peopleQ) + '" style="flex:1;min-width:160px">' +
      '<select id="psort" aria-label="Sort" style="width:auto">' + [['recent', 'Seen recently'], ['stale', 'Not seen longest'], ['most', 'Most often'], ['az', 'A to Z']].map(o => '<option value="' + o[0] + '"' + (peopleSort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="card" style="margin-top:.8rem">' + (list.length ? '<ul class="list">' + list.map(p => {
        const notes = p.events.filter(e => e.note).length, d = daysSince(p.last);
        return '<li class="ev"><span class="dot c-person"></span><div class="ev-main"><div class="ev-title"><a href="#/e/' + encodeURIComponent(p.ref) + '">' + esc(p.title) + '</a>' +
          (d >= 21 && p.met >= 2 ? '<span class="flag">' + d + ' days</span>' : '') + '</div><div class="ev-meta">' +
          (p.met ? 'Met ' + p.met + (p.met === 1 ? ' time' : ' times') : 'No meetings logged') + ' \u00b7 last ' + rel(p.last) + (notes ? ' \u00b7 ' + notes + (notes === 1 ? ' note' : ' notes') : '') + '</div></div></li>';
      }).join('') + '</ul>' : '<div class="empty">' + (peopleQ ? 'No one matches.' : 'No people yet. Log someone from Capture or the watch.') + '</div>') + '</div>';
  }

  // ---- One person or item
  function viewEntity(ref) {
    const x = model().by.get(ref);
    if (!x) return '<p><a href="#/people">\u2190 Back</a></p><div class="empty">That item is not in your log.</div>';
    const ck = catKey(x.cat), person = ck === 'person' || /^n:/.test(x.ref);
    entKind = person ? 'people' : 'content';
    if (person) return viewPerson(x);
    const rated = x.events.filter(e => e.stars != null);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.stars, 0) / rated.length) : null;
    return '<p><a href="' + (person ? '#/people' : '#/content') + '">\u2190 ' + (person ? 'People' : 'Content') + '</a></p>' +
      '<div class="row sb"><h1>' + esc(x.title) + '</h1><span class="badge c-' + ck + '">' + esc(CAT_LABEL[ck] === 'Other' && x.cat ? x.cat : CAT_LABEL[ck]) + '</span></div>' +
      '<div class="stats">' + (person ? '<div class="stat"><b>' + x.met + '</b><span>times met</span></div>' : '') +
      '<div class="stat"><b>' + x.events.length + '</b><span>entries</span></div>' +
      '<div class="stat"><b>' + rel(x.last).replace(' ago', '') + '</b><span>last seen</span></div>' +
      (avg != null ? '<div class="stat"><b>' + (Math.round(avg * 10) / 10) + '</b><span>avg stars</span></div>' : '') + '</div>' +
      '<p class="row">' + (person ? '<button class="btn sm" data-act="met-again" data-ref="' + esc(x.ref) + '">Met just now</button>' : '') +
      '<button class="btn ghost sm" data-act="rename" data-ref="' + esc(x.ref) + '">Rename</button>' +
      '<button class="btn ghost sm" data-act="merge" data-ref="' + esc(x.ref) + '">Merge into\u2026</button></p>' +
      '<div class="card"><ul class="list">' + x.events.map(e => eventRow(e, { date: true })).join('') + '</ul></div>';
  }

  // ---- Content
  let contentCat = 'all', contentSort = 'recent';
  function viewContent() {
    const all = model().content;
    const cats = [...new Set(all.map(x => catKey(x.cat)))];
    let list = all.filter(x => contentCat === 'all' || catKey(x.cat) === contentCat);
    const s = { recent: (a, b) => b.last - a.last, stars: (a, b) => (b.stars || 0) - (a.stars || 0) || b.last - a.last, az: (a, b) => a.title.localeCompare(b.title) }[contentSort];
    list.sort(s);
    return '<h1>Content</h1><div class="chips"><button class="chip' + (contentCat === 'all' ? ' on' : '') + '" data-act="ccat" data-c="all">All</button>' +
      cats.map(c => '<button class="chip' + (contentCat === c ? ' on' : '') + '" data-act="ccat" data-c="' + c + '">' + CAT_LABEL[c] + '</button>').join('') +
      '</div><div class="row"><label for="csort" style="margin:0">Sort</label><select id="csort" style="width:auto">' + [['recent', 'Most recent'], ['stars', 'Highest rated'], ['az', 'A to Z']].map(o => '<option value="' + o[0] + '"' + (contentSort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="card" style="margin-top:.8rem">' + (list.length ? '<ul class="list">' + list.map(x => '<li class="ev"><span class="dot c-' + catKey(x.cat) + '"></span><div class="ev-main"><div class="ev-title"><a href="#/e/' + encodeURIComponent(x.ref) + '">' + esc(x.title) + '</a> ' + (x.stars != null ? starsHtml(x.stars, false) : '') + '</div><div class="ev-meta">' + esc(CAT_LABEL[catKey(x.cat)] === 'Other' ? (x.cat || 'Other') : CAT_LABEL[catKey(x.cat)]) + ' \u00b7 ' + fmtDate(x.last) + (x.events.filter(e => e.note).length ? ' \u00b7 ' + x.events.filter(e => e.note).length + ' note(s)' : '') + '</div></div></li>').join('') + '</ul>' : '<div class="empty">Nothing here yet.</div>') + '</div>';
  }

  // ---- Search
  let searchQ = '';
  function viewSearch(arg) {
    if (arg) searchQ = arg;
    return '<h1>Search</h1><input type="search" id="q" placeholder="People, titles, notes\u2026" value="' + esc(searchQ) + '" autocomplete="off"><div id="qres">' + searchResults() + '</div>';
  }
  function searchResults() {
    const toks = norm(searchQ).split(' ').filter(Boolean);
    if (!toks.length) return '<div class="empty">Search everything you have logged.</div>';
    const m = model();
    const hay = e => norm([titleOf(e), e.note, e.cat, e.kind, e.pos, e.track].join(' '));
    const hits = m.events.filter(e => { const h = hay(e); return toks.every(t => h.indexOf(t) >= 0); });
    const items = m.items.filter(x => { const h = norm(x.title + ' ' + x.cat); return toks.every(t => h.indexOf(t) >= 0); }).slice(0, 8);
    return (items.length ? '<h2 style="margin-top:1rem">Matches</h2><div class="chips">' + items.map(x => '<a class="chip" href="#/e/' + encodeURIComponent(x.ref) + '">' + esc(x.title) + '</a>').join('') + '</div>' : '') +
      '<h2 style="margin-top:1rem">' + hits.length + (hits.length === 1 ? ' entry' : ' entries') + '</h2>' +
      (hits.length ? '<div class="card"><ul class="list">' + hits.slice(0, 100).map(e => eventRow(e, { date: true })).join('') + '</ul></div>' : '<div class="empty">Nothing found.</div>');
  }

  // ---- Settings
  function viewSettings() {
    const link = connected() ? location.origin + location.pathname + '#u=' + encodeURIComponent(cfg.url) + '&k=' + encodeURIComponent(cfg.key) + (cfg.tmdb ? '&t=' + encodeURIComponent(cfg.tmdb) : '') : '';
    return '<h1>Settings</h1>' + (connected() ? '' : '<div class="card"><b>Connect your Sheet</b><p class="mute">Paste the web app URL from Apps Script (Deploy, Manage deployments) and the key you set in the script. Setup takes a minute and you only do it once per device.</p></div>') +
      '<div class="card"><label for="s-url">Apps Script web app URL</label><input type="url" id="s-url" value="' + esc(cfg.url) + '" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off" spellcheck="false">' +
      '<label for="s-key">Key (the KEY value in your script)</label><input type="password" id="s-key" value="' + esc(cfg.key) + '" autocomplete="off">' +
      '<label for="s-tmdb">TMDB key (optional, for movie and TV search)</label><input type="password" id="s-tmdb" value="' + esc(cfg.tmdb) + '" autocomplete="off">' +
      '<p class="row"><button class="btn" data-act="save-settings">Save and test</button>' + (connected() ? '<button class="btn ghost" data-act="disconnect">Disconnect this device</button>' : '') + '</p></div>' +
      (connected() ? '<div class="card"><h2>Set up your phone</h2><p class="mute small">Open this link on your phone (send it to yourself in a private message), then use the browser menu to Install app. It contains your key, so treat it like a password.</p>' +
        '<input type="text" id="s-link" readonly value="' + esc(link) + '"><p><button class="btn ghost sm" data-act="copy-link">Copy link</button></p></div>' : '') +
      '<div class="card"><h2>This device</h2><p class="small mute">' + data.events.length + ' entries stored here, ' + queue.length + ' waiting to send. Last sync: ' + (data.at ? new Date(data.at).toLocaleString() : 'never') + '.</p>' +
      '<p class="row"><button class="btn ghost sm" data-act="refresh">Sync now</button><button class="btn ghost sm" data-act="clear-cache">Clear local copy</button></p></div>';
  }

  // ------------------------------------------------------------------ events (delegated)
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) { const st = e.target.closest('.st'); if (st && F && $('#starpick') && $('#starpick').contains(st)) setStars(st, e); return; }
    const a = t.dataset.act;
    switch (a) {
      case 'refresh': refresh(false); flush(); break;
      case 'go': location.hash = t.dataset.to; break;
      case 'flow': F = null; location.hash = '#/capture'; startFlow(t.dataset.t); render(); break;
      case 'flow-cancel': F = null; location.hash = '#/capture'; render(); break;
      case 'star-dec': setStarVal(Math.round((F.stars - 0.5) * 2) / 2); break;
      case 'star-inc': setStarVal(Math.round((F.stars + 0.5) * 2) / 2); break;
      case 'pick-person': { const x = model().by.get(t.dataset.ref); F.name = x.title; F.pickedRef = x.ref; $('#f-name').value = x.title; $('#f-note').focus(); break; }
      case 'pick-kind': F.kind = t.dataset.k; F.resHtml = ''; render(); if (F.q) doSearch(); break;
      case 'pick-result': F.picked = F.results[+t.dataset.i]; F.step = 'rate'; F.focused = false; render(); break;
      case 'pick-typed': F.picked = F.typed; F.step = 'rate'; F.focused = false; render(); break;
      case 'pick-tag': F.tag = t.dataset.tag; { const ti = $('#f-tag'); if (ti) ti.value = ''; } document.querySelectorAll('[data-act=pick-tag]').forEach(c => c.classList.toggle('on', c === t)); break;
      case 'save-met': saveMet(); break;
      case 'save-note': saveNote(); break;
      case 'save-any': saveAny(); break;
      case 'save-media': saveItem(F.picked, true); break;
      case 'save-media-nostars': saveItem(F.picked, false); break;
      case 'void': voidEvent(t); break;
      case 'met-again': { const x = model().by.get(t.dataset.ref); submit({ events: [mkEvent({ kind: 'met', ref: x.ref, title: x.title, cat: 'person' })] }); toast('Logged ' + x.title); render(); break; }
      case 'rename': renameDialog(t.dataset.ref); break;
      case 'merge': mergeDialog(t.dataset.ref); break;
      case 'ccat': contentCat = t.dataset.c; render(); break;
      case 'save-settings': saveSettings(); break;
      case 'disconnect': cfg = { url: '', key: '', tmdb: '' }; store.set('cfg', cfg); data = { events: [], entities: [], ratings: [], at: 0 }; store.set('data', data); rev++; render(); break;
      case 'copy-link': { const i = $('#s-link'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand('copy'); } toast('Link copied'); break; }
      case 'clear-cache': data = { events: [], entities: [], ratings: [], at: 0 }; store.set('data', data); rev++; refresh(false); break;
      case 'close-dialog': closeDialog(); break;
      case 'fu-done': { const d = store.get('done', {}); d[t.dataset.k] = Date.now(); store.set('done', d); rev++; toast('Marked done'); render(); break; }
      case 'note-about': { const x = model().by.get(t.dataset.ref); F = null; startFlow('note'); if (x) F.about = x.title; location.hash = '#/capture'; render(); break; }
      case 'copy-draft': { const i = $('#draft'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand('copy'); } toast('Copied. Paste it into your messages app.'); break; }
      case 'mic': micToggle(t.dataset.target); break;
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'pq') { peopleQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#pq'); i.focus(); i.setSelectionRange(pos, pos); }
    if (e.target.id === 'q') { searchQ = e.target.value; $('#qres').innerHTML = searchResults(); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'psort') { peopleSort = e.target.value; render(); }
    if (e.target.id === 'csort') { contentSort = e.target.value; render(); }
  });
  function setStars(st, ev) {
    const r = st.getBoundingClientRect();
    const i = +st.dataset.i, left = (ev.clientX - r.left) < r.width / 2;
    let v = left ? i - 0.5 : i;
    if (v === F.stars) v = 0;                       // tap the same value again to clear
    setStarVal(v);
  }
  function setStarVal(v) {
    F.stars = Math.max(0, Math.min(5, v));
    $('#starbox').outerHTML = starBox(F.stars);
  }
  // voice typing in the browser (Chrome on Android): keeps listening through pauses until you tap stop.
  // The browser sends the audio to its own speech service, so it is left off for anything you would not say aloud.
  let rec = null, micOn = false, micTarget = '';
  const micBtn = id => (window.SpeechRecognition || window.webkitSpeechRecognition) ? '<p class="mic"><button type="button" class="btn ghost sm" data-act="mic" data-target="' + id + '" id="mic-' + id + '">Dictate</button></p>' : '';
  function stopMic() {
    micOn = false;
    if (rec) { try { rec.onend = null; rec.stop(); } catch (e) { /* already stopped */ } rec = null; }
    const b = micTarget && $('#mic-' + micTarget); if (b) { b.textContent = 'Dictate'; b.classList.remove('rec'); }
    micTarget = '';
  }
  function micToggle(id) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice typing is not available here. Use the microphone on your keyboard.'); return; }
    if (micOn) { stopMic(); return; }
    const el = $('#' + id); if (!el) return;
    rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = navigator.language || 'en-US';
    micTarget = id; micOn = true;
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const t = ev.results[i][0].transcript.trim();
        if (t) { el.value = (el.value && !/\s$/.test(el.value) ? el.value + ' ' : el.value) + t; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    };
    rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { toast('Microphone permission is off for this site'); stopMic(); } };
    rec.onend = () => { if (micOn && rec) { try { rec.start(); } catch (e) { stopMic(); } } };     // the browser ends on silence; start again until told to stop
    try { rec.start(); } catch (e) { stopMic(); return; }
    const b = $('#mic-' + id); if (b) { b.textContent = '\u25a0 Listening, tap to stop'; b.classList.add('rec'); }
  }
  let voidArm = null;
  function voidEvent(btn) {
    if (voidArm !== btn.dataset.id) {
      voidArm = btn.dataset.id; btn.textContent = 'Tap again'; btn.classList.add('armed');
      setTimeout(() => { if (voidArm === btn.dataset.id) { voidArm = null; btn.textContent = 'Remove'; btn.classList.remove('armed'); } }, 3000);
      return;
    }
    voidArm = null;
    edit({ action: 'void', id: btn.dataset.id }, () => { toast('Removed'); render(); });
  }
  function renameDialog(ref) {
    const x = model().by.get(ref);
    dialog('<form method="dialog" id="rn"><h2>Rename</h2><label for="rn-name">Name</label><input type="text" id="rn-name" value="' + esc(x.title) + '" autocomplete="off">' +
      '<p class="row"><button class="btn" value="ok">Save</button><button class="btn ghost" type="button" data-act="close-dialog">Cancel</button></p></form>', d => {
      $('#rn', d).addEventListener('submit', () => { const name = $('#rn-name', d).value.trim(); if (name && name !== x.title) edit({ action: 'rename', ref, name }, () => { toast('Renamed'); render(); }); });
    });
  }
  function mergeDialog(ref) {
    const x = model().by.get(ref), person = catKey(x.cat) === 'person' || /^n:/.test(x.ref);
    const others = (person ? model().people : model().items).filter(o => o.ref !== ref).sort((a, b) => a.title.localeCompare(b.title));
    dialog('<form method="dialog" id="mg"><h2>Merge ' + esc(x.title) + '</h2><p class="mute small">Everything logged under this name moves to the one you pick, and this name goes away.</p>' +
      '<label for="mg-to">Merge into</label><select id="mg-to">' + others.map(o => '<option value="' + esc(o.ref) + '">' + esc(o.title) + '</option>').join('') + '</select>' +
      '<p class="row"><button class="btn" value="ok"' + (others.length ? '' : ' disabled') + '>Merge</button><button class="btn ghost" type="button" data-act="close-dialog">Cancel</button></p></form>', d => {
      $('#mg', d).addEventListener('submit', () => {
        const to = model().by.get($('#mg-to', d).value);
        if (to) edit({ action: 'merge', from: ref, to: to.ref, title: to.title, cat: to.cat }, () => { toast('Merged'); location.hash = '#/e/' + encodeURIComponent(to.ref); render(); });
      });
    });
  }
  async function saveSettings() {
    const url = $('#s-url').value.trim().replace(/[?&]key=[^&]*/, ''), key = $('#s-key').value.trim(), tmdb = $('#s-tmdb').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('That does not look like an Apps Script web app URL'); return; }
    const old = cfg;
    cfg = { url, key, tmdb };
    try {
      const d = await apiGet('&action=ping');
      if (!d.api) throw new Error('This script is out of date. Paste in the v3 script and deploy a new version.');
      store.set('cfg', cfg);
      toast('Connected');
      await refresh(true);
      location.hash = '#/home';
      render();
    } catch (e) {
      cfg = old;
      toast(e.message === 'Failed to fetch' ? 'Could not reach the script. Check the URL and that access is set to Anyone.' : e.message);
    }
  }

  // ------------------------------------------------------------------ start
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { flush(); refresh(true); });
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  if (connected()) { flush(); refresh(true); }
  window.__logbook = { model, get queue() { return queue; } };     // handy in the browser console
})();

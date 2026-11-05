// Marks: many per item, and a note said after marking goes on that mark.
// Reuses the loader in nowplaying.test.cjs, so it is required first (that file defines boot()).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC = path.join(__dirname, '../src/pkjs');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function boot(opts = {}) {
  const sent = [], asked = [], store = Object.assign({}, opts.store), modules = {};
  const Pebble = { addEventListener() {}, sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    subscribeToSource: (cfg) => { asked.push(cfg); if (opts.answer === 'error') setImmediate(() => cfg.onError({})); else if (opts.answer) setImmediate(() => cfg.onData(opts.answer)); return { unsubscribe() {} }; } };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const req = (name) => {
    const f = path.join(SRC, name.replace('./', '') + '.js');
    if (!modules[f]) { const m = { exports: {} }; modules[f] = m;
      new Function('module', 'exports', 'require', 'Pebble', 'localStorage', 'console', fs.readFileSync(f, 'utf8'))(m, m.exports, req, Pebble, localStorage, { log() {} }); }
    return modules[f].exports;
  };
  if (!opts.answer) req('./nowplaying').CONFIG.plugin = '';
  const body = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8') +
    '\nreturn { addMark: addMark, addBookmark: addBookmark, noteEntries: noteEntries, markEntries: markEntries, reflectRows: reflectRows, state: state };';
  const api = new Function('require', 'Pebble', 'localStorage', 'console', 'setTimeout', 'clearTimeout', body)(req, Pebble, localStorage, { log() {} }, setTimeout, clearTimeout);
  return { api, sent, store, asked };
}
const flashes = (t) => t.sent.map((m) => m.LIST_LABEL).filter(Boolean);
const playing = { instances: [{ properties: { title: { shortText: { text: 'Episode 12' } }, artist: { shortText: { text: 'A Show' } }, playing: { boolean: { value: true } } } }] };
const SHEETS = { store: { sheetsUrl: JSON.stringify('https://script.google.com/macros/s/x/exec') } };

test('pressing Mark this spot again adds another mark instead of removing the first', async () => {
  const t = boot();
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.addBookmark('p:1', 'My Podcast'); await tick();
  assert.equal(t.api.state.marks.length, 3);
  assert.ok(t.api.state.marks.every((m) => m.marked && m.ref === 'p:1'));
  assert.equal(t.api.noteEntries('p:1').length, 3, 'all three listed on the item page');
  assert.ok(t.api.noteEntries('p:1').every((e) => e.flags & 4), 'each shows the ribbon');
  assert.ok(!flashes(t).includes('Bookmark removed'));
});

test('words said after marking go on that mark, with its track kept', async () => {
  const t = boot({ ...SHEETS, answer: playing });
  t.api.addBookmark('p:1', 'My Podcast'); await tick();
  t.api.addMark('p:1', 'My Podcast', 'the guest explains glaciers'); await tick();
  assert.equal(t.api.state.marks.length, 1, 'no second mark');
  const mk = t.api.state.marks[0];
  assert.deepEqual([mk.note, mk.track, mk.marked], ['the guest explains glaciers', 'A Show - Episode 12', true]);
  assert.deepEqual(flashes(t).slice(-1), ['Note added to mark']);
  assert.ok(t.api.noteEntries('p:1')[0].flags & 4, 'still shows the ribbon with a note on it');
  const ev = JSON.parse(t.store.evQueue).pop();
  assert.deepEqual([ev.kind, ev.note, ev.track, ev.about], ['note', 'the guest explains glaciers', 'A Show - Episode 12', 'n-' + mk.ts]);
});

test('a note goes on the latest mark only; the next note after it is a new note', async () => {
  const t = boot();
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);        // newest mark
  t.api.addMark('p:1', 'My Podcast', 'first thought'); await tick(5);
  t.api.addMark('p:1', 'My Podcast', 'second thought'); await tick();
  const m = t.api.state.marks;
  assert.equal(m.length, 3);
  assert.equal(m.filter((x) => x.marked && x.note === 'first thought').length, 1);
  assert.equal(m[0].note, 'second thought');
  assert.ok(!m[0].marked, 'the second note is a plain note');
});

test('a spoken position makes a new mark, never attaches', async () => {
  const t = boot();
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.addMark('p:1', 'My Podcast', '26 minutes in, funny bit'); await tick();
  assert.equal(t.api.state.marks.length, 2);
  assert.deepEqual([t.api.state.marks[0].pos, t.api.state.marks[0].note], ['26:00', 'funny bit']);
  assert.equal(t.api.state.marks[1].note, '', 'the first mark is untouched');
});

test('an old mark does not take a note (outside the 10 minute window)', async () => {
  const t = boot();
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.state.marks[0].ts -= 11 * 60 * 1000;
  t.api.addMark('p:1', 'My Podcast', 'something later'); await tick();
  assert.equal(t.api.state.marks.length, 2);
});

test('a note about a different item or a person never attaches to the mark', async () => {
  const t = boot();
  t.api.addBookmark('p:1', 'My Podcast'); await tick(5);
  t.api.addMark('p:2', 'Other Show', 'a thought'); await tick(5);
  t.api.addMark('n:maria', 'Maria', 'coffee', true); await tick();
  assert.equal(t.api.state.marks.length, 3);
  assert.equal(t.api.state.marks.find((x) => x.ref === 'p:1').note, '');
});

// ---- the now-playing card at the top of Reflect
const show = (o) => ({ instances: [{ properties: {
  title: { shortText: { text: o.title } }, artist: { shortText: { text: o.artist || '' } }, album: { shortText: { text: o.album || '' } },
  playing: { boolean: { value: o.playing !== false } } } }] });
const LOG = { store: { log: JSON.stringify([
  { ref: 'p:111', title: 'Radiolab', cat: 'podcast', stars: 4, ts: Date.now() - 1000 },
  { ref: 'b:333', title: 'Dune', cat: 'book', stars: 5, ts: Date.now() - 2000 }]) } };
const rowsOf = (t) => new Promise((res) => t.api.reflectRows(res));

test('card: first row is the track, tied to the logged item whose title matches the album', async () => {
  const t = boot({ ...LOG, answer: show({ title: 'The Fact of the Matter', artist: 'WNYC', album: 'Radiolab' }) });
  const rows = await rowsOf(t);
  assert.deepEqual(rows[0], { label: 'The Fact of the Matter', ref: 'np:p:111', flags: 0 });
  assert.deepEqual(rows.slice(1).map((r) => r.ref), ['p:111', 'b:333'], 'your ratings follow, unchanged');
});

test('card: paused shows (flag 8), and a show with no match becomes its own item', async () => {
  const t = boot({ ...LOG, answer: show({ title: 'Ep 5', album: 'Brand New Show', playing: false }) });
  const rows = await rowsOf(t);
  assert.deepEqual([rows[0].label, rows[0].ref, rows[0].flags], ['Ep 5', 'np:x:brand-new-show', 8]);
});

test('card: nothing playing, plugin error, or feature off gives the plain Reflect list', async () => {
  for (const o of [{ answer: { instances: [] } }, { answer: 'error' }, {}]) {
    const t = boot({ ...LOG, ...o });
    const rows = await rowsOf(t);
    assert.deepEqual(rows.map((r) => r.ref), ['p:111', 'b:333']);
  }
});

test('tapping the card marks the item with the track (even if paused) and a note then goes on that mark', async () => {
  const t = boot({ store: { ...LOG.store, ...SHEETS.store }, answer: show({ title: 'The Fact of the Matter', artist: 'WNYC', album: 'Radiolab', playing: false }) });
  const card = (await rowsOf(t))[0];
  const asked = t.asked.length;
  t.api.addBookmark(card.ref.slice(3), card.label); await tick();       // what the watch sends for a tap
  assert.equal(t.asked.length, asked, 'no second plugin call: the card is what gets marked');
  const mk = t.api.state.marks[0];
  assert.deepEqual([mk.ref, mk.title, mk.marked, mk.track], ['p:111', 'Radiolab', true, 'WNYC - The Fact of the Matter']);
  t.api.addMark('p:111', card.label, 'great point about glaciers'); await tick();   // what the watch sends after dictation
  assert.equal(t.api.state.marks.length, 1);
  assert.equal(t.api.state.marks[0].note, 'great point about glaciers');
  assert.deepEqual(flashes(t).slice(-1), ['Note added to mark']);
});

test('tapping the card for a new show names the item after the album', async () => {
  const t = boot({ ...LOG, answer: show({ title: 'Ep 5', album: 'Brand New Show' }) });
  const card = (await rowsOf(t))[0];
  t.api.addBookmark(card.ref.slice(3), card.label); await tick();
  assert.deepEqual([t.api.state.marks[0].ref, t.api.state.marks[0].title], ['x:brand-new-show', 'Brand New Show']);
});

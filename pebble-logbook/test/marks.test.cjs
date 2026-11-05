// Marks: many per item, and a note said after marking goes on that mark.
// Reuses the loader in nowplaying.test.cjs, so it is required first (that file defines boot()).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC = path.join(__dirname, '../src/pkjs');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function boot(opts = {}) {
  const sent = [], store = Object.assign({}, opts.store), modules = {};
  const Pebble = { addEventListener() {}, sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    subscribeToSource: (cfg) => { if (opts.answer) setImmediate(() => cfg.onData(opts.answer)); return { unsubscribe() {} }; } };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const req = (name) => {
    const f = path.join(SRC, name.replace('./', '') + '.js');
    if (!modules[f]) { const m = { exports: {} }; modules[f] = m;
      new Function('module', 'exports', 'require', 'Pebble', 'localStorage', 'console', fs.readFileSync(f, 'utf8'))(m, m.exports, req, Pebble, localStorage, { log() {} }); }
    return modules[f].exports;
  };
  if (!opts.answer) req('./nowplaying').CONFIG.plugin = '';
  const body = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8') +
    '\nreturn { addMark: addMark, addBookmark: addBookmark, noteEntries: noteEntries, markEntries: markEntries, state: state };';
  const api = new Function('require', 'Pebble', 'localStorage', 'console', 'setTimeout', 'clearTimeout', body)(req, Pebble, localStorage, { log() {} }, setTimeout, clearTimeout);
  return { api, sent, store };
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

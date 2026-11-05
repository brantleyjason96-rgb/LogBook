const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SRC = path.join(__dirname, '../src/pkjs');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// A plugin envelope, in the shape the other plugins use (shortText / numericValue / boolean).
const track = (o) => ({ instances: [{ instanceId: '1', properties: Object.fromEntries(Object.entries(o).map(([k, v]) => [
  k, typeof v === 'string' ? { shortText: { text: v } } : typeof v === 'boolean' ? { boolean: { value: v } } : { numericValue: { value: v } }])) }] });

// Loads the real phone-side code with a fake Pebble. `answer` is what the music plugin sends:
// an envelope, 'error', or 'silent' (never answers). index.js is plain script code that uses
// require(), so it is run as a function body and the pieces the tests need are handed back.
function boot(opts = {}) {
  const sent = [], subscribed = [], store = Object.assign({}, opts.store);
  const Pebble = {
    addEventListener() {},
    sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    subscribeToSource: (cfg) => {
      subscribed.push(cfg);
      if (opts.answer === 'error') setImmediate(() => cfg.onError({ code: 'nope' }));
      else if (opts.answer && opts.answer !== 'silent') setImmediate(() => cfg.onData(opts.answer));
      return { unsubscribe() { Pebble.unsubscribed = (Pebble.unsubscribed || 0) + 1; } };
    },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const modules = {};
  const req = (name) => {
    const f = path.join(SRC, name.replace('./', '') + '.js');
    if (!modules[f]) {
      const m = { exports: {} };
      modules[f] = m;
      new Function('module', 'exports', 'require', 'Pebble', 'localStorage', 'console', fs.readFileSync(f, 'utf8'))
        (m, m.exports, req, Pebble, localStorage, { log() {} });
    }
    return modules[f].exports;
  };
  const np = req('./nowplaying');
  if (opts.plugin !== 'default') {      // 'default' keeps the shipped settings; otherwise a stand-in plugin that also reports position
    np.CONFIG.plugin = opts.plugin === null ? '' : (opts.plugin || 'test-music-plugin');
    np.CONFIG.keys.position = 'position';
  }
  if (opts.timeoutMs) np.CONFIG.timeoutMs = opts.timeoutMs;
  const body = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8') +
    '\nreturn { addMark: addMark, addBookmark: addBookmark, markEvent: markEvent, markEntries: markEntries, noteEntries: noteEntries, state: state };';
  const api = new Function('require', 'Pebble', 'localStorage', 'console', 'setTimeout', 'clearTimeout', body)
    (req, Pebble, localStorage, { log() {} }, setTimeout, clearTimeout);
  return { api, np, Pebble, sent, subscribed, store };
}
const flashes = (t) => t.sent.map((m) => m.LIST_LABEL).filter(Boolean);

test('parse: position in seconds, artist and title', () => {
  const { np } = boot();
  const r = np.parse(track({ title: 'Heavy Rotation', artist: 'Some Band', position: 754, playing: true }));
  assert.deepEqual(r, { title: 'Heavy Rotation', artist: 'Some Band', album: '', position: 754, playing: true });
});
test('parse: milliseconds are converted when the unit is ms', () => {
  const { np } = boot();
  np.CONFIG.positionUnit = 'ms';
  assert.equal(np.parse(track({ title: 'x', position: 754999 })).position, 754);
});
test('parse: no position keeps the track with position null', () => {
  const { np } = boot();
  assert.equal(np.parse(track({ title: 'Episode 12', artist: 'A Show' })).position, null);
});
test('parse: paused, empty or missing data is "nothing playing"', () => {
  const { np } = boot();
  assert.equal(np.parse(track({ title: 'x', playing: false })), null);
  assert.equal(np.parse(track({ artist: 'only artist' })), null);
  assert.equal(np.parse({ instances: [] }), null);
  assert.equal(np.parse(null), null);
});
test('fmtSeconds matches the spoken-position shape', () => {
  const { np } = boot();
  assert.deepEqual([0, 9, 754, 3725].map(np.fmtSeconds), ['0:00', '0:09', '12:34', '1:02:05']);
});

test('a bookmark picks up the track and the position from the plugin', async () => {
  const t = boot({ answer: track({ title: 'Heavy Rotation', artist: 'Some Band', position: 754, playing: true }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  const mk = t.api.state.marks[0];
  assert.equal(mk.pos, '12:34');
  assert.equal(mk.track, 'Some Band - Heavy Rotation');
  assert.equal(mk.title, 'My Podcast', 'the item you bookmarked is unchanged');
  assert.deepEqual(flashes(t).slice(-1), ['Saved @12:34']);
  const ev = t.api.markEvent(mk);
  assert.deepEqual([ev.kind, ev.ref, ev.pos, ev.track], ['bookmark', 'p:123', '12:34', 'Some Band - Heavy Rotation']);
  assert.equal(t.Pebble.unsubscribed, 1, 'the one-off subscription is closed');
});

test('no position from the plugin: the track alone is shown', async () => {
  const t = boot({ answer: track({ title: 'Episode 12', artist: 'A Show', playing: true }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  const mk = t.api.state.marks[0];
  assert.equal(mk.pos, '');
  assert.equal(mk.track, 'A Show - Episode 12');
  assert.deepEqual(flashes(t).slice(-1), ['Bookmarked: A Show - Episode 12']);
  assert.match(t.api.markEntries()[0].label, /A Show - Ep/, 'shown in the Bookmarks list');
});

test('a position you say out loud wins and the plugin is not asked', async () => {
  const t = boot({ answer: track({ title: 'x', position: 99 }) });
  t.api.addMark('p:123', 'My Podcast', 'about twenty minutes in');
  await tick();
  assert.equal(t.api.state.marks[0].pos, '20:00');
  assert.equal(t.api.state.marks[0].track, undefined);
  assert.equal(t.subscribed.length, 0);
});

test('people and loose thoughts never ask the plugin', async () => {
  const t = boot({ answer: track({ title: 'x', position: 5 }) });
  t.api.addMark('n:maria', 'Maria', 'coffee', true);
  t.api.addMark('k:thought', 'Thought', 'idea', true);
  await tick();
  assert.equal(t.subscribed.length, 0);
  assert.equal(t.api.state.marks.length, 2);
});

test('feature off (no plugin id): behaves exactly as before', async () => {
  const t = boot({ plugin: null, answer: track({ title: 'x', position: 5 }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  assert.equal(t.subscribed.length, 0);
  assert.deepEqual([t.api.state.marks[0].pos, t.api.state.marks[0].track], ['', undefined]);
  assert.deepEqual(flashes(t).slice(-1), ['Bookmarked']);
});

test('plugin error: the bookmark is still saved, without a track', async () => {
  const t = boot({ answer: 'error' });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  assert.equal(t.api.state.marks.length, 1);
  assert.deepEqual([t.api.state.marks[0].pos, t.api.state.marks[0].track], ['', undefined]);
  assert.deepEqual(flashes(t).slice(-1), ['Bookmarked']);
});

test('plugin never answers: the bookmark is saved after the timeout', async () => {
  const t = boot({ answer: 'silent', timeoutMs: 20 });
  t.api.addMark('p:123', 'My Podcast', '');
  assert.equal(t.api.state.marks.length, 0, 'waiting for the plugin');
  await tick(60);
  assert.equal(t.api.state.marks.length, 1);
  assert.deepEqual(flashes(t).slice(-1), ['Bookmarked']);
});

test('paused music is ignored', async () => {
  const t = boot({ answer: track({ title: 'x', position: 5, playing: false }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  assert.equal(t.api.state.marks[0].track, undefined);
});

// ---- the shipped settings, against an envelope shaped exactly like MusicPlugin.kt builds it
const real = (o) => ({ instances: [{ instanceId: 'track', properties: {
  title: { shortText: { text: o.title }, longText: { text: o.title } },
  artist: { shortText: { text: o.artist }, longText: { text: o.artist } },
  album: { shortText: { text: 'Album' }, longText: { text: 'Album' } },
  playing: { boolean: { value: o.playing }, shortText: { text: o.playing ? 'Playing' : 'Paused' } } } }] });

test('shipped settings subscribe to music/track on the built-in Music plugin', async () => {
  const t = boot({ plugin: 'default', answer: real({ title: 'Heavy Rotation', artist: 'Some Band', playing: true }) });
  t.api.addMark('a:222', 'Some Band - Heavy Rotation', '');
  await tick();
  const s = t.subscribed[0];
  assert.deepEqual([s.plugin, s.category, s.item], ['00000000-0000-0000-0001-000000000003', 'music', 'track']);
  assert.deepEqual(s.properties, ['title', 'artist', 'album', 'playing']);
});

test('real plugin: no position, so the track alone is kept and shown', async () => {
  const t = boot({ plugin: 'default', answer: real({ title: 'Heavy Rotation', artist: 'Some Band', playing: true }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  assert.deepEqual([t.api.state.marks[0].pos, t.api.state.marks[0].track], ['', 'Some Band - Heavy Rotation']);
  assert.deepEqual(flashes(t).slice(-1), ['Some Band - Heavy Rotation'], 'too long with the prefix, so just the track');
});

test('real plugin: paused is read from the boolean, not the "Paused" text', async () => {
  const t = boot({ plugin: 'default', answer: real({ title: 'x', artist: 'y', playing: false }) });
  t.api.addMark('p:123', 'My Podcast', '');
  await tick();
  assert.equal(t.api.state.marks[0].track, undefined);
});

test('real plugin: "?" placeholders mean no title / no artist', () => {
  const { np } = boot({ plugin: 'default' });
  assert.equal(np.parse(real({ title: '?', artist: '?', playing: true })), null);
  assert.equal(np.parse(real({ title: 'Song', artist: '?', playing: true })).artist, '');
});

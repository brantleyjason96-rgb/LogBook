'use strict';
// What is playing on the phone, read through the Pebble music plugin, so a bookmark can say
// which track you were on and how far in.
//
// The plugin is the Core Pebble app's built-in Music plugin (MusicPlugin.kt in coredevices/mobileapp):
// Android only, publishes title, artist, album and playing, and NOT playback position. So in practice a
// bookmark gets the track, and a position only if a later plugin version adds one (see keys.position).
// Tested against a mocked plugin built from that source, not yet on a real watch.
//
// Plain ES5, like the rest of the phone-side code.

var CONFIG = {
  plugin: '00000000-0000-0000-0001-000000000003',   // the built-in Music plugin. Empty = feature off.
  category: 'music',
  item: 'track',
  keys: {                      // property names in the plugin's data
    title: 'title',
    artist: 'artist',
    album: 'album',            // for a podcast app this is usually the show
    position: '',              // the plugin does not publish one today; name it here if that changes
    playing: 'playing'
  },
  positionUnit: 'seconds',     // 'seconds' or 'ms', used only if keys.position is set
  timeoutMs: 1500              // give up waiting after this long; the bookmark is saved without it
};

function enabled() {
  return !!CONFIG.plugin;
}

// One property of one instance: shortText -> string, numericValue / boolean -> value.
function field(props, key, kind) {
  var p = props && key && props[key];
  if (!p) return undefined;
  var v = (kind && p[kind]) || p.shortText || p.longText || p.numericValue || p.boolean;
  if (!v) return undefined;
  return v.text !== undefined ? v.text : v.value;
}

// Plugin data -> { title, artist, album, position (whole seconds, or null), playing } or null when
// nothing is playing or there is no title to show. Paused counts as nothing unless keepPaused
// (the Reflect card shows a paused episode, because that is when you stop to write a note).
function parse(envelope, keepPaused) {
  var inst = envelope && envelope.instances && envelope.instances[0];
  if (!inst) return null;
  var props = inst.properties || {}, k = CONFIG.keys;
  var title = String(field(props, k.title) || '').replace(/\s+/g, ' ').trim();
  if (!title || title === '?') return null;               // the plugin sends "?" when it has no title
  var playing = field(props, k.playing, 'boolean');       // also sent as the text "Playing"/"Paused"
  if (playing === false && !keepPaused) return null;      // paused: not "what I am listening to"
  var artist = String(field(props, k.artist) || '').replace(/\s+/g, ' ').trim();
  if (artist === '?') artist = '';
  var album = String(field(props, k.album) || '').replace(/\s+/g, ' ').trim();
  if (album === '?') album = '';
  var pos = field(props, k.position);
  var position = null;
  if (typeof pos === 'number' && isFinite(pos) && pos >= 0) {
    position = Math.floor(CONFIG.positionUnit === 'ms' ? pos / 1000 : pos);
  }
  return { title: title, artist: artist, album: album, position: position, playing: playing !== false };
}

function two(n) { return (n < 10 ? '0' : '') + n; }

// 754 -> "12:34", 3725 -> "1:02:05" (same shape the spoken positions use)
function fmtSeconds(sec) {
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

function label(np) {
  return np.artist ? np.artist + ' - ' + np.title : np.title;
}

// Asks the plugin once, then calls cb(np) with parse()'s result, or cb(null) when the feature is
// off, the plugin errors, or it does not answer in time. cb is called exactly once.
// opts (optional): { timeoutMs, keepPaused }
function read(cb, opts) {
  opts = opts || {};
  if (!enabled() || typeof Pebble === 'undefined' || !Pebble.subscribeToSource) { cb(null); return; }
  var done = false, sub = null, timer = null;
  function finish(np) {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    try { if (sub && sub.unsubscribe) sub.unsubscribe(); } catch (e) {}
    cb(np);
  }
  try {
    sub = Pebble.subscribeToSource({
      category: CONFIG.category, item: CONFIG.item, plugin: CONFIG.plugin,
      properties: [CONFIG.keys.title, CONFIG.keys.artist, CONFIG.keys.album, CONFIG.keys.position, CONFIG.keys.playing].filter(Boolean),
      onData: function (envelope) { var np = null; try { np = parse(envelope, opts.keepPaused); } catch (e) {} finish(np); },
      onError: function () { finish(null); }
    });
  } catch (e) {
    finish(null);
    return;
  }
  if (done) { try { if (sub && sub.unsubscribe) sub.unsubscribe(); } catch (e) {} return; }   // answered before we had the handle
  timer = setTimeout(function () { finish(null); }, opts.timeoutMs || CONFIG.timeoutMs);
}

module.exports = { CONFIG: CONFIG, enabled: enabled, parse: parse, read: read, label: label, fmtSeconds: fmtSeconds };

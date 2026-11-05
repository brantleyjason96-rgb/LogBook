'use strict';
// What is playing on the phone, read through the Pebble music plugin, so a bookmark can say
// which track you were on and how far in.
//
// STATUS: the plumbing is tested against a mocked plugin, but the plugin's own details could not
// be checked (its docs were unreachable). Everything unverified is in CONFIG below. The feature
// stays OFF until CONFIG.plugin is set, so shipping this file changes nothing by itself.
// To switch it on: put the music plugin's UUID in CONFIG.plugin and check the other values
// against the plugin's documentation (developer.repebble.com, "Plugins").
//
// Plain ES5, like the rest of the phone-side code.

var CONFIG = {
  plugin: '',                  // the music plugin's UUID. Empty = feature off.
  category: 'media',           // UNVERIFIED: Pebble.subscribeToSource category
  item: 'track',               // UNVERIFIED: Pebble.subscribeToSource item
  keys: {                      // UNVERIFIED: property names in the plugin's data
    title: 'title',
    artist: 'artist',
    position: 'position',
    playing: 'playing'
  },
  positionUnit: 'seconds',     // UNVERIFIED: 'seconds' or 'ms'
  timeoutMs: 1500              // give up waiting after this long; the bookmark is saved without it
};

function enabled() {
  return !!CONFIG.plugin;
}

// One property of one instance: shortText -> string, numericValue / boolean -> value.
function field(props, key) {
  var p = props && props[key];
  if (!p) return undefined;
  var v = p.shortText || p.longText || p.numericValue || p.boolean;
  if (!v) return undefined;
  return v.text !== undefined ? v.text : v.value;
}

// Plugin data -> { title, artist, position (whole seconds, or null), playing } or null when
// nothing is playing or there is no title to show.
function parse(envelope) {
  var inst = envelope && envelope.instances && envelope.instances[0];
  if (!inst) return null;
  var props = inst.properties || {}, k = CONFIG.keys;
  var title = String(field(props, k.title) || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  var playing = field(props, k.playing);
  if (playing === false) return null;                     // paused or stopped: not "what I am listening to"
  var artist = String(field(props, k.artist) || '').replace(/\s+/g, ' ').trim();
  var pos = field(props, k.position);
  var position = null;
  if (typeof pos === 'number' && isFinite(pos) && pos >= 0) {
    position = Math.floor(CONFIG.positionUnit === 'ms' ? pos / 1000 : pos);
  }
  return { title: title, artist: artist, position: position, playing: playing !== false };
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
function read(cb) {
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
      properties: [CONFIG.keys.title, CONFIG.keys.artist, CONFIG.keys.position, CONFIG.keys.playing],
      onData: function (envelope) { var np = null; try { np = parse(envelope); } catch (e) {} finish(np); },
      onError: function () { finish(null); }
    });
  } catch (e) {
    finish(null);
    return;
  }
  if (done) { try { if (sub && sub.unsubscribe) sub.unsubscribe(); } catch (e) {} return; }   // answered before we had the handle
  timer = setTimeout(function () { finish(null); }, CONFIG.timeoutMs);
}

module.exports = { CONFIG: CONFIG, enabled: enabled, parse: parse, read: read, label: label, fmtSeconds: fmtSeconds };

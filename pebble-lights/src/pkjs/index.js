// PKJS half of Home Lights. Reads lights from the Google Home plugin and drives them through its
// turn_on / turn_off / set_brightness actions, using the Pebble plugin API
// (Pebble.subscribeToSource / Pebble.invokeAction). Needs the Google Home plugin installed
// and signed in (plugin settings in the Pebble app).
//
// Watch <-> phone protocol (message keys in package.json):
//   phone -> watch  {total, idx, name, room, state, bright}   one message per light, in order
//                   state: 0 off, 1 on, 2 offline;  bright: 0-100, or -1 if not dimmable
//                   {status: "text"}                          shown when there are no lights
//   watch -> phone  {cmd: 1, idx}                toggle one light
//                   {cmd: 2, idx, value}         set brightness (0-100)
//                   {cmd: 3}                     all lights off
//                   {cmd: 4}                     refresh

var GOOGLE_HOME_PLUGIN = 'd93ea4f2-6bb2-4f51-a766-29dbe481c170';
var MAX_LIGHTS = 24;
var LIGHT_TYPE = /light|bulb|lamp|lightstrip/i;

var lights = [];       // [{id, name, room, type, on, online, bright}]
var subscription = null;
var queue = [];
var sending = false;

function log(m) { console.log('[HomeLights] ' + m); }

function shape(props, key, kind) {
  var p = props && props[key];
  return p && p[kind];
}

/** Turn a plugin envelope into our flat light list. Exported for tests. */
function parseEnvelope(envelope) {
  var out = [];
  ((envelope && envelope.instances) || []).forEach(function (inst) {
    var props = inst.properties || {};
    var name = shape(props, 'name', 'shortText');
    var type = shape(props, 'type', 'shortText');
    var on = shape(props, 'on', 'boolean');
    if (!name || !on) return;                       // not an on/off device
    if (type && type.text && !LIGHT_TYPE.test(type.text)) return;
    var online = shape(props, 'online', 'boolean');
    var room = shape(props, 'room', 'shortText');
    var bright = shape(props, 'brightness', 'numericValue');
    out.push({
      id: inst.instanceId,
      name: name.text,
      room: room ? room.text : '',
      on: !!on.value,
      online: online ? !!online.value : true,
      bright: bright ? Math.round(bright.value) : -1,
    });
  });
  out.sort(function (a, b) {
    return (a.room + '\u0000' + a.name).localeCompare(b.room + '\u0000' + b.name);
  });
  return out.slice(0, MAX_LIGHTS);
}

function selectorFor(light) {
  var args = { name: light.name };
  if (light.room) args.room = light.room;
  return args;
}

function enqueue(msg) {
  queue.push(msg);
  pump();
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var msg = queue[0];
  Pebble.sendAppMessage(msg, function () {
    queue.shift();
    sending = false;
    pump();
  }, function () {
    // Retry once, then drop it so one bad row can't wedge the queue.
    if (msg._retried) queue.shift(); else msg._retried = true;
    sending = false;
    setTimeout(pump, 300);
  });
}

function rowMessage(i) {
  var l = lights[i];
  return {
    total: lights.length,
    idx: i,
    name: l.name.slice(0, 40),
    room: l.room.slice(0, 24),
    state: !l.online ? 2 : (l.on ? 1 : 0),
    bright: l.bright,
  };
}

function sendAll() {
  queue = [];
  if (!lights.length) {
    enqueue({ status: 'No lights found. Check the Google Home plugin.' });
    return;
  }
  lights.forEach(function (_, i) { enqueue(rowMessage(i)); });
}

function onData(envelope) {
  lights = parseEnvelope(envelope);
  log(lights.length + ' light(s)');
  sendAll();
}

function onError(err) {
  log('source error: ' + (err && err.code));
  lights = [];
  queue = [];
  enqueue({ status: 'Google Home: ' + ((err && err.code) || 'error') });
}

function subscribe() {
  if (subscription) subscription.unsubscribe();
  subscription = Pebble.subscribeToSource({
    category: 'home',
    item: 'device',
    plugin: GOOGLE_HOME_PLUGIN,
    properties: ['name', 'room', 'type', 'on', 'online', 'brightness'],
    onData: onData,
    onError: onError,
  });
}

function run(action, args, after) {
  return Pebble.invokeAction({ plugin: GOOGLE_HOME_PLUGIN, action: action, args: args })
    .then(function (result) {
      log(action + (result.ok ? ' ok' : ' failed: ' + result.code + ' ' + (result.message || '')));
      if (!result.ok) { subscribe(); return; }     // re-read the truth
      if (after) after();
    });
}

function toggle(i) {
  var l = lights[i];
  if (!l || !l.online) return;
  var turnOn = !l.on;
  run(turnOn ? 'turn_on' : 'turn_off', selectorFor(l), function () {
    l.on = turnOn;
    enqueue(rowMessage(i));
  });
}

function setBrightness(i, value) {
  var l = lights[i];
  if (!l || !l.online || l.bright < 0) return;
  var args = selectorFor(l);
  args.brightness_pct = Math.max(0, Math.min(100, value | 0));
  run('set_brightness', args, function () {
    l.bright = args.brightness_pct;
    l.on = args.brightness_pct > 0 || l.on;
    enqueue(rowMessage(i));
  });
}

function allOff() {
  run('turn_off', { type: 'light' }, function () {
    lights.forEach(function (l) { l.on = false; });
    sendAll();
  });
}

function onWatchMessage(e) {
  var p = (e && e.payload) || {};
  switch (p.cmd) {
    case 1: toggle(p.idx); break;
    case 2: setBrightness(p.idx, p.value); break;
    case 3: allOff(); break;
    case 4: subscribe(); break;
  }
}

if (typeof Pebble !== 'undefined') {
  Pebble.addEventListener('ready', function () { log('ready'); subscribe(); });
  Pebble.addEventListener('appmessage', onWatchMessage);
}

if (typeof module !== 'undefined') {
  module.exports = { parseEnvelope: parseEnvelope, selectorFor: selectorFor };
}

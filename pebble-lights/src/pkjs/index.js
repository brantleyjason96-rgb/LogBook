// PKJS half of Home Lights 2 ("Rooms"). Reads devices from the Google Home plugin, groups lights by room,
// drives lights and thermostats through the plugin's actions, and turns spoken text into those actions.
// Uses the Pebble plugin API (Pebble.subscribeToSource / Pebble.invokeAction); needs the Google Home plugin
// installed and signed in.
//
// phone -> watch (key "kind" says what the message is):
//   0 begin   {rooms, lights}                                  counts; the watch clears its lists
//   1 room    {idx, name, first, count, thermo, temp, set, mode}   lights of a room are contiguous: first..first+count-1
//   2 light   {idx, name, room, state, bright}                state 0 off / 1 on / 2 offline; bright 0-100 or -1
//   4 result  {ok, text, sub, undo}                            outcome of a voice command
//   5 status  {text}                                           shown when there is nothing to list
//   6 choice  {idx, count, name, sub, text}                    "which one?" options for an ambiguous command
// watch -> phone (key "cmd"):
//   1 toggle light {idx}      2 brightness {idx, value}    3 room on/off {idx=room}    4 refresh
//   5 thermostat set point (deg F) {idx=room, value}       6 thermostat mode {idx=room, value 0 heat 1 cool 2 eco 3 off}
//   7 voice {say, value=room the watch is showing, if any}  8 undo last voice command   9 pick choice {idx}

var GOOGLE_HOME_PLUGIN = 'd93ea4f2-6bb2-4f51-a766-29dbe481c170';
var MAX_ROOMS = 8;
var MAX_LIGHTS = 24;
var LIGHT_TYPE = /light|bulb|lamp|lightstrip/i;
var MODES = ['heat', 'cool', 'eco', 'off'];
var TEMP_MIN = 50, TEMP_MAX = 90;
var STEP = 20;          // "dim" / "brighten" with no number, in percentage points
var WARMER = 2;         // "warmer" / "cooler", in degrees F

var st = { rooms: [], lights: [], thermos: [] };
var subscription = null;
var queue = [];
var sending = false;
var lastUndo = null;
var pendingChoices = null;

function log(m) { console.log('[HomeLights] ' + m); }

// ---------------------------------------------------------------- reading the plugin

function prop(props, key, kind) {
  var p = props && props[key];
  return p && p[kind];
}
function cToF(c) { return Math.round(c * 9 / 5 + 32); }
function modeIndex(text) {
  var t = String(text || '').toLowerCase();
  if (/heat/.test(t)) return 0;
  if (/cool/.test(t)) return 1;
  if (/eco/.test(t)) return 2;
  if (/off/.test(t)) return 3;
  return 0;
}

/** Plugin envelope -> {rooms, lights, thermos}. Exported for tests. */
function parseEnvelope(envelope) {
  var rawLights = [], rawThermos = [];
  ((envelope && envelope.instances) || []).forEach(function (inst) {
    var props = inst.properties || {};
    var name = prop(props, 'name', 'shortText');
    if (!name) return;
    var type = prop(props, 'type', 'shortText');
    var room = prop(props, 'room', 'shortText');
    var online = prop(props, 'online', 'boolean');
    var common = { id: inst.instanceId, name: name.text, rawRoom: room ? room.text : '', online: online ? !!online.value : true };

    var setpoint = prop(props, 'setpoint', 'numericValue');
    var ambient = prop(props, 'ambient_temperature', 'numericValue');
    var mode = prop(props, 'thermostat_mode', 'shortText');
    if (setpoint || mode || (type && /thermostat/i.test(type.text))) {
      common.set = setpoint ? cToF(setpoint.value) : 68;
      common.now = ambient ? cToF(ambient.value) : -1;
      common.mode = modeIndex(mode && mode.text);
      rawThermos.push(common);
      return;
    }
    var on = prop(props, 'on', 'boolean');
    if (!on) return;
    if (type && type.text && !LIGHT_TYPE.test(type.text)) return;
    var bright = prop(props, 'brightness', 'numericValue');
    common.on = !!on.value;
    common.bright = bright ? Math.round(bright.value) : -1;
    rawLights.push(common);
  });

  var names = {};
  rawLights.concat(rawThermos).forEach(function (d) { names[d.rawRoom || 'Home'] = true; });
  var roomNames = Object.keys(names).sort(function (a, b) { return a.localeCompare(b); }).slice(0, MAX_ROOMS);

  var rooms = [], lights = [], thermos = [];
  roomNames.forEach(function (rn, ri) {
    var room = { name: rn, first: lights.length, count: 0, thermo: -1 };
    rawLights.filter(function (l) { return (l.rawRoom || 'Home') === rn; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (l) {
        if (lights.length >= MAX_LIGHTS) return;
        l.room = ri;
        lights.push(l);
        room.count++;
      });
    rawThermos.filter(function (t) { return (t.rawRoom || 'Home') === rn; }).slice(0, 1).forEach(function (t) {
      t.room = ri;
      room.thermo = thermos.length;
      thermos.push(t);
    });
    rooms.push(room);
  });
  return { rooms: rooms, lights: lights, thermos: thermos };
}

// ---------------------------------------------------------------- talking to the watch

function enqueue(msg) { queue.push(msg); pump(); }

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var msg = queue[0];
  Pebble.sendAppMessage(msg, function () {
    queue.shift();
    sending = false;
    pump();
  }, function () {
    if (msg._retried) queue.shift(); else msg._retried = true;   // one retry, then drop it
    sending = false;
    setTimeout(pump, 300);
  });
}

function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '.' : s; }

function roomMsg(i) {
  var r = st.rooms[i], t = r.thermo >= 0 ? st.thermos[r.thermo] : null;
  return { kind: 1, idx: i, name: short(r.name, 40), first: r.first, count: r.count,
           thermo: t ? 1 : 0, temp: t ? t.now : -1, set: t ? t.set : 0, mode: t ? t.mode : 0 };
}
function lightMsg(j) {
  var l = st.lights[j];
  return { kind: 2, idx: j, name: short(l.name, 40), room: l.room, state: !l.online ? 2 : (l.on ? 1 : 0), bright: l.bright };
}
function sendAll() {
  queue = [];
  if (!st.rooms.length) {
    enqueue({ kind: 5, text: 'No lights found. Check the Google Home plugin.' });
    return;
  }
  enqueue({ kind: 0, rooms: st.rooms.length, lights: st.lights.length });
  st.rooms.forEach(function (_, i) { enqueue(roomMsg(i)); });
  st.lights.forEach(function (_, j) { enqueue(lightMsg(j)); });
}
function sendRoomsAndLights(rooms, lights) {
  Object.keys(rooms).forEach(function (i) { enqueue(roomMsg(+i)); });
  Object.keys(lights).forEach(function (j) { enqueue(lightMsg(+j)); });
}
function result(ok, text, sub, undo) {
  enqueue({ kind: 4, ok: ok ? 1 : 0, text: short(text, 48), sub: short(sub || '', 48), undo: undo ? 1 : 0 });
}

// ---------------------------------------------------------------- doing things

function run(action, args) {
  return Pebble.invokeAction({ plugin: GOOGLE_HOME_PLUGIN, action: action, args: args }).then(function (r) {
    log(action + (r.ok ? ' ok' : ' failed: ' + r.code));
    return !!r.ok;
  });
}
/** Run fn over items one after another; resolves to how many succeeded. */
function seq(items, fn) {
  var done = 0;
  return items.reduce(function (p, item) {
    return p.then(function () { return fn(item); }).then(function (ok) { if (ok) done++; });
  }, Promise.resolve()).then(function () { return done; });
}
function lightArgs(l) {
  var a = { name: l.name };
  if (l.rawRoom) a.room = l.rawRoom;
  return a;
}
function thermoArgs(t) {
  var a = { name: t.name };
  if (t.rawRoom) a.room = t.rawRoom;
  return a;
}

function setPower(j, on) {
  var l = st.lights[j];
  return run(on ? 'turn_on' : 'turn_off', lightArgs(l)).then(function (ok) {
    if (ok) l.on = on;
    return ok;
  });
}
function setBright(j, pct) {
  var l = st.lights[j];
  var args = lightArgs(l);
  args.brightness_pct = Math.max(0, Math.min(100, pct | 0));
  return run('set_brightness', args).then(function (ok) {
    if (ok) { l.bright = args.brightness_pct; l.on = l.bright > 0; }
    return ok;
  });
}
function setThermo(k, set, mode) {
  var t = st.thermos[k];
  var args = thermoArgs(t);
  if (set != null) args.temperature_f = Math.max(TEMP_MIN, Math.min(TEMP_MAX, set | 0));
  if (mode != null) args.mode = MODES[mode];
  return run('set_thermostat', args).then(function (ok) {
    if (ok) {
      if (set != null) t.set = args.temperature_f;
      if (mode != null) t.mode = mode;
    }
    return ok;
  });
}

function snapLights(idxs) {
  return idxs.map(function (j) { return { j: j, on: st.lights[j].on, bright: st.lights[j].bright }; });
}
function restoreLights(snap) {
  var rooms = {}, lights = {};
  return seq(snap, function (s) {
    var l = st.lights[s.j];
    var p = l.on !== s.on ? setPower(s.j, s.on) : Promise.resolve(true);
    return p.then(function (ok) {
      if (ok && s.on && s.bright >= 0 && l.bright !== s.bright) return setBright(s.j, s.bright);
      return ok;
    }).then(function (ok) { rooms[l.room] = 1; lights[s.j] = 1; return ok; });
  }).then(function () { sendRoomsAndLights(rooms, lights); });
}

function toggle(j) {
  var l = st.lights[j];
  if (!l || !l.online) return;
  setPower(j, !l.on).then(function (ok) {
    if (ok) { var r = {}; r[l.room] = 1; var li = {}; li[j] = 1; sendRoomsAndLights(r, li); }
    else subscribe();
  });
}
function brightness(j, v) {
  var l = st.lights[j];
  if (!l || !l.online || l.bright < 0) return;
  setBright(j, v).then(function (ok) {
    if (ok) { var r = {}; r[l.room] = 1; var li = {}; li[j] = 1; sendRoomsAndLights(r, li); }
    else subscribe();
  });
}
function roomToggle(i) {
  var room = st.rooms[i];
  if (!room || !room.count) return;
  var idxs = [];
  for (var j = room.first; j < room.first + room.count; j++) if (st.lights[j].online) idxs.push(j);
  var turnOn = !idxs.some(function (j) { return st.lights[j].on; });
  var lights = {}, rooms = {};
  rooms[i] = 1;
  seq(idxs, function (j) { return setPower(j, turnOn).then(function (ok) { lights[j] = 1; return ok; }); })
    .then(function () { sendRoomsAndLights(rooms, lights); });
}
function thermoByRoom(i) {
  var room = st.rooms[i];
  return room && room.thermo >= 0 ? room.thermo : -1;
}
function thermoSet(i, deg) {
  var k = thermoByRoom(i);
  if (k < 0) return;
  setThermo(k, deg, null).then(function (ok) { var r = {}; r[i] = 1; if (ok) sendRoomsAndLights(r, {}); else subscribe(); });
}
function thermoMode(i, m) {
  var k = thermoByRoom(i);
  if (k < 0) return;
  setThermo(k, null, m).then(function (ok) { var r = {}; r[i] = 1; if (ok) sendRoomsAndLights(r, {}); else subscribe(); });
}

// ---------------------------------------------------------------- understanding speech

var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
var STOP = { the: 1, a: 1, an: 1, of: 1, in: 1, my: 1, light: 1, lights: 1, room: 1, please: 1, to: 1, turn: 1, switch: 1, set: 1 };

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/%/g, ' percent ').replace(/°/g, ' degrees ')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}
function has(tokens, w) {
  return tokens.indexOf(w) >= 0 || tokens.indexOf(w + 's') >= 0 || (w.slice(-1) === 's' && tokens.indexOf(w.slice(0, -1)) >= 0);
}
function sig(name) {
  var t = tokenize(name).filter(function (w) { return !STOP[w]; });
  return t.length ? t : tokenize(name);
}
function matches(tokens, name) {
  var need = sig(name);
  return need.length > 0 && need.every(function (w) { return has(tokens, w); });
}
/** First number in the phrase, digits or words ("forty five"), or null. */
function findNumber(tokens) {
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (t === 'half') return 50;
    if (t === 'hundred') return 100;
    if (NUM[t] != null) {
      if (tokens[i + 1] === 'hundred') return NUM[t] * 100;
      var v = NUM[t], nx = NUM[tokens[i + 1]];
      if (v >= 20 && nx != null && nx > 0 && nx < 10) v += nx;
      return v;
    }
  }
  return null;
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

/** Which lights does the phrase mean? -> {lights, label} | {ask:{prompt, options}} | {error}. */
function resolveLights(tokens, ctx, s) {
  var all = s.lights.map(function (_, j) { return j; });
  var anyAll = tokens.some(function (w) { return w === 'all' || w === 'every' || w === 'everything' || w === 'everywhere' || w === 'house' || w === 'whole'; });

  var rooms = [];
  s.rooms.forEach(function (r, i) { if (matches(tokens, r.name)) rooms.push(i); });
  if (anyAll && !rooms.length) return { lights: all, label: 'All lights' };

  var pool = rooms.length
    ? all.filter(function (j) { return rooms.indexOf(s.lights[j].room) >= 0; })
    : all;
  var named = pool.filter(function (j) { return matches(tokens, s.lights[j].name); });
  if (named.length > 1) {   // "floor lamp" also contains "lamp": the longer, more specific name wins
    var best = Math.max.apply(null, named.map(function (j) { return sig(s.lights[j].name).length; }));
    named = named.filter(function (j) { return sig(s.lights[j].name).length === best; });
  }

  if (named.length > 1 && !rooms.length) {
    var opts = named.slice(0, 3).map(function (j) {
      return { label: s.lights[j].name, sub: s.rooms[s.lights[j].room].name, lights: [j] };
    });
    opts.push({ label: 'All of them', sub: plural(named.length, 'light'), lights: named });
    return { ask: { prompt: 'Which one?', options: opts } };
  }
  if (named.length) {
    return { lights: named, label: named.length === 1 ? s.lights[named[0]].name : plural(named.length, 'light') };
  }
  if (rooms.length) {
    return { lights: pool, label: rooms.map(function (i) { return s.rooms[i].name; }).join(' and ') + ' lights' };
  }
  if (ctx >= 0 && s.rooms[ctx]) {
    var r = s.rooms[ctx], mine = [];
    for (var j = r.first; j < r.first + r.count; j++) mine.push(j);
    return { lights: mine, label: r.name + ' lights' };
  }
  return { error: 'Say a room or light name' };
}

/** What does the phrase mean? -> {plan} | {ask} | {error}. Pure, so it can be tested. */
function parseVoice(text, ctx, s) {
  var tokens = tokenize(text);
  if (!tokens.length) return { error: 'Heard nothing' };
  var num = findNumber(tokens);
  var wantsOff = false, wantsOn = false;
  for (var i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i] === 'off' || tokens[i] === 'kill') { wantsOff = true; break; }
    if (tokens[i] === 'on') { wantsOn = true; break; }
  }

  var thermoWord = tokens.some(function (w) {
    return /^(thermostat|heat|heating|heater|cool|cooling|temperature|degrees|warmer|hotter|cooler|colder|ac|furnace|eco)$/.test(w);
  });
  if (thermoWord) {
    if (!s.thermos.length) return { error: 'No thermostat found' };
    var k = -1;
    s.rooms.forEach(function (r, i) { if (k < 0 && r.thermo >= 0 && matches(tokens, r.name)) k = r.thermo; });
    if (k < 0 && ctx >= 0 && s.rooms[ctx] && s.rooms[ctx].thermo >= 0) k = s.rooms[ctx].thermo;
    if (k < 0) k = 0;
    var mode = null;
    if (wantsOff && (has(tokens, 'heat') || has(tokens, 'thermostat') || has(tokens, 'ac'))) mode = 3;
    else if (has(tokens, 'cool')) mode = 1;
    else if (has(tokens, 'eco')) mode = 2;
    else if (has(tokens, 'heat') && (wantsOn || num != null)) mode = 0;
    var plan = { op: 'thermo', k: k };
    if (num != null && num >= TEMP_MIN && num <= TEMP_MAX) plan.set = num;
    else if (num != null && mode == null) return { error: 'Pick 50 to 90 degrees' };
    else if (tokens.some(function (w) { return w === 'warmer' || w === 'hotter'; })) plan.delta = WARMER;
    else if (tokens.some(function (w) { return w === 'cooler' || w === 'colder'; })) plan.delta = -WARMER;
    if (mode != null) plan.mode = mode;
    if (plan.set == null && plan.delta == null && plan.mode == null) return { error: 'Try "set the thermostat to 70"' };
    return { plan: plan };
  }

  var dimUp = has(tokens, 'brighten') || has(tokens, 'brighter') || tokens.indexOf('up') >= 0 && tokens.indexOf('brightness') >= 0;
  var dimDown = has(tokens, 'dim') || has(tokens, 'dimmer') || has(tokens, 'darker');
  var full = has(tokens, 'full') || has(tokens, 'max') || has(tokens, 'maximum') || has(tokens, 'brightest');
  var op;
  if (wantsOff) op = { op: 'power', on: false };
  else if (num != null || dimUp || dimDown || full) {
    op = { op: 'bright' };
    if (num != null) op.value = Math.max(0, Math.min(100, num));
    else if (full) op.value = 100;
    else op.delta = dimDown ? -STEP : STEP;
  } else if (wantsOn) op = { op: 'power', on: true };
  else return { error: 'Try "turn off the kitchen lights"' };

  var target = resolveLights(tokens, ctx, s);
  if (target.error) return { error: target.error };
  if (target.ask) {
    target.ask.options.forEach(function (o) {
      o.plan = { op: op.op, on: op.on, value: op.value, delta: op.delta, lights: o.lights, label: o.label };
    });
    return { ask: target.ask };
  }
  op.lights = target.lights;
  op.label = target.label;
  if (!op.lights.length) return { error: 'No lights match' };
  return { plan: op };
}

function execute(plan) {
  var touchedRooms = {}, touchedLights = {};
  function touch(j) { touchedLights[j] = 1; touchedRooms[st.lights[j].room] = 1; }

  if (plan.op === 'thermo') {
    var t = st.thermos[plan.k];
    var before = { k: plan.k, set: t.set, mode: t.mode };
    var set = plan.set != null ? plan.set : plan.delta != null ? Math.max(TEMP_MIN, Math.min(TEMP_MAX, t.set + plan.delta)) : null;
    return setThermo(plan.k, set, plan.mode != null ? plan.mode : null).then(function (ok) {
      var r = {}; r[t.room] = 1;
      if (!ok) { result(false, 'Thermostat did not respond', 'Nothing changed', false); return; }
      lastUndo = function () {
        return setThermo(before.k, before.set, before.mode).then(function () { sendRoomsAndLights(r, {}); });
      };
      sendRoomsAndLights(r, {});
      var parts = [];
      if (set != null) parts.push('to ' + set + '°');
      if (plan.mode != null) parts.push(MODES[plan.mode]);
      result(true, 'Thermostat ' + parts.join(', '), t.rawRoom || 'Home', true);
    });
  }

  var idxs = plan.lights.filter(function (j) { return st.lights[j].online; });
  if (plan.op === 'bright') idxs = idxs.filter(function (j) { return st.lights[j].bright >= 0; });
  if (!idxs.length) {
    result(false, plan.op === 'bright' ? 'Those lights cannot dim' : 'Lights are offline', plan.label || '', false);
    return Promise.resolve();
  }
  var snap = snapLights(idxs);
  return seq(idxs, function (j) {
    var p;
    if (plan.op === 'power') p = setPower(j, plan.on);
    else {
      var cur = st.lights[j].bright;
      var v = plan.value != null ? plan.value : Math.max(0, Math.min(100, cur + plan.delta));
      p = setBright(j, v);
    }
    return p.then(function (ok) { if (ok) touch(j); return ok; });
  }).then(function (done) {
    if (!done) { result(false, 'Google Home did not respond', 'Nothing changed', false); return; }
    sendRoomsAndLights(touchedRooms, touchedLights);
    lastUndo = function () { return restoreLights(snap); };
    var first = st.lights[idxs[0]];
    var title = plan.op === 'power' ? plan.label + (plan.on ? ' on' : ' off')
      : plan.label + ' to ' + (plan.value != null ? plan.value : first.bright) + '%';
    result(true, title, done < idxs.length ? done + ' of ' + idxs.length + ' changed' : plural(done, 'light') + ' changed', true);
  });
}

function voice(text, ctx) {
  log('heard: ' + text);
  var out = parseVoice(text, ctx, st);
  if (out.error) { result(false, out.error, '“' + short(text, 40) + '”', false); return; }
  if (out.ask) {
    pendingChoices = out.ask.options;
    out.ask.options.forEach(function (o, i) {
      enqueue({ kind: 6, idx: i, count: out.ask.options.length, name: short(o.label, 40), sub: short(o.sub, 40), text: out.ask.prompt });
    });
    return;
  }
  execute(out.plan);
}
function choose(i) {
  var opt = pendingChoices && pendingChoices[i];
  pendingChoices = null;
  if (opt) execute(opt.plan);
}
function undo() {
  if (!lastUndo) { result(false, 'Nothing to undo', '', false); return; }
  var u = lastUndo;
  lastUndo = null;
  u().then(function () { result(true, 'Undone', '', false); });
}

// ---------------------------------------------------------------- wiring

function onData(envelope) {
  st = parseEnvelope(envelope);
  log(st.rooms.length + ' room(s), ' + st.lights.length + ' light(s), ' + st.thermos.length + ' thermostat(s)');
  sendAll();
}
function onError(err) {
  log('source error: ' + (err && err.code));
  st = { rooms: [], lights: [], thermos: [] };
  queue = [];
  enqueue({ kind: 5, text: 'Google Home: ' + ((err && err.code) || 'error') });
}
function subscribe() {
  if (subscription) subscription.unsubscribe();
  subscription = Pebble.subscribeToSource({
    category: 'home',
    item: 'device',
    plugin: GOOGLE_HOME_PLUGIN,
    properties: ['name', 'room', 'type', 'on', 'online', 'brightness', 'setpoint', 'ambient_temperature', 'thermostat_mode'],
    onData: onData,
    onError: onError,
  });
}

function onWatchMessage(e) {
  var p = (e && e.payload) || {};
  switch (p.cmd) {
    case 1: toggle(p.idx); break;
    case 2: brightness(p.idx, p.value); break;
    case 3: roomToggle(p.idx); break;
    case 4: subscribe(); break;
    case 5: thermoSet(p.idx, p.value); break;
    case 6: thermoMode(p.idx, p.value); break;
    case 7: voice(p.say, p.value == null ? -1 : p.value); break;
    case 8: undo(); break;
    case 9: choose(p.idx); break;
  }
}

if (typeof Pebble !== 'undefined') {
  Pebble.addEventListener('ready', function () { log('ready'); subscribe(); });
  Pebble.addEventListener('appmessage', onWatchMessage);
}
if (typeof module !== 'undefined') {
  module.exports = { parseEnvelope: parseEnvelope, parseVoice: parseVoice, findNumber: findNumber, tokenize: tokenize };
}

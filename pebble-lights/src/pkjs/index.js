// PKJS half of Home Lights 3. The phone builds every list the watch shows; the watch only draws rows and reports
// taps. Devices and scenes come from the Google Home plugin (Pebble.subscribeToSource / Pebble.invokeAction), the
// user's layout comes from the settings page (config.html), and spoken text is turned into actions here.
//
// Lists (ids): 0 = Home (the favourites), 1 = All rooms, 10 + n = lights of room n.
// Row types:   0 light, 1 room, 2 scene, 3 thermostat, 4 "more" (opens All rooms), 5 all lights off.
//
// phone -> watch (message key "kind"):
//   10 list     {list, count, text, room}                    start (or restart) a list; room = context room or -1
//   11 row      {list, idx, name, sub, state, type, adj}     state 0 off / 1 on / 2 offline / 3 n/a; adj 1 = hold UP does something
//   12 bright   {idx, value, name, room, adj}                open the brightness screen for light idx (adj = step)
//   13 thermo   {idx, set, temp, mode, name, room, adj}      open the thermostat screen for thermostat idx (adj = step)
//   14 open     {list, text}                                 push a list window; its rows follow
//    4 result   {ok, text, sub, undo}   5 status {text}   6 choice {idx, count, name, sub, text}
// watch -> phone (key "cmd"):
//   1 tap {list, idx}   2 hold UP {list, idx}   3 brightness {idx, value}   4 set point F {idx, value}
//   5 mode {idx, value 0 heat 1 cool 2 eco 3 off}   6 list closed {list}   7 voice {say, value = room or none}
//   8 undo   9 pick choice {idx}   10 refresh

var GOOGLE_HOME_PLUGIN = 'd93ea4f2-6bb2-4f51-a766-29dbe481c170';
var MAX_ROOMS = 8;
var MAX_LIGHTS = 24;
var MAX_FAVS = 20;
var LIGHT_TYPE = /light|bulb|lamp|lightstrip/i;
var MODES = ['heat', 'cool', 'eco', 'off'];
var MODE_LABEL = ['Heat', 'Cool', 'Eco', 'Off'];
var TEMP_MIN = 50, TEMP_MAX = 90;
var STEP = 20;          // "dim" / "brighten" with no number, in percentage points
var WARMER = 2;         // "warmer" / "cooler", in degrees F
var POOL = 6;           // parallel plugin calls when changing many lights (each call pays its own sign-in and lookup)
var RETRY_MS = 600;     // wait before retrying a call Google rate-limited

var st = { rooms: [], lights: [], thermos: [], scenes: [] };
var cfg = defaultConfig();
var subs = [];
var queue = [];
var sending = false;
var lastUndo = null;
var pendingChoices = null;
var active = { 0: true };   // lists the watch currently has open
var sent = {};              // last rows sent per list, to send only what changed
var shown = {};             // last rows (with actions) per list, to resolve taps

function log(m) { console.log('[HomeLights] ' + m); }

// ---------------------------------------------------------------- settings

function defaultConfig() { return { favs: null, names: {}, hidden: {}, step: 10, tstep: 1 }; }

function sanitizeConfig(c) {
  c = c || {};
  var out = defaultConfig();
  if (Array.isArray(c.favs)) {
    var seen = {};
    out.favs = c.favs.filter(function (k) {
      if (typeof k !== 'string' || seen[k]) return false;
      seen[k] = true;
      return true;
    }).slice(0, MAX_FAVS);
  }
  if (c.names && typeof c.names === 'object') {
    Object.keys(c.names).forEach(function (k) {
      var v = String(c.names[k] || '').trim().slice(0, 22);
      if (v) out.names[k] = v;
    });
  }
  if (c.hidden && typeof c.hidden === 'object') {
    Object.keys(c.hidden).forEach(function (k) { if (c.hidden[k]) out.hidden[k] = true; });
  }
  out.step = [5, 10, 20].indexOf(c.step) >= 0 ? c.step : 10;
  out.tstep = c.tstep === 2 ? 2 : 1;
  return out;
}
function loadConfig() {
  try { return sanitizeConfig(JSON.parse(localStorage.getItem('cfg') || 'null')); } catch (e) { return defaultConfig(); }
}
function saveConfig() {
  try { localStorage.setItem('cfg', JSON.stringify(cfg)); } catch (e) { log('could not save settings'); }
}

function lightKey(l) { return 'l:' + l.id; }
function roomKey(r) { return 'r:' + r.name; }
function thermoKey(t) { return 't:' + t.id; }
function sceneKey(s) { return 's:' + s.id; }
function label(key, fallback) { return cfg.names[key] || fallback; }

/** Mark hidden lights after a parse or a settings change. */
function applyHidden() {
  st.lights.forEach(function (l) { l.hidden = !!cfg.hidden[lightKey(l)]; });
}

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

/** Devices envelope -> {rooms, lights, thermos}. Exported for tests. */
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

/** Automations envelope -> the ones that can be run by hand. Exported for tests. */
function parseScenes(envelope) {
  var out = [];
  ((envelope && envelope.instances) || []).forEach(function (inst) {
    var props = inst.properties || {};
    var name = prop(props, 'name', 'shortText');
    var runnable = prop(props, 'manually_runnable', 'boolean');
    if (name && runnable && runnable.value) out.push({ id: inst.instanceId, name: name.text });
  });
  return out.sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 12);
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
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function result(ok, text, sub, undo) {
  enqueue({ kind: 4, ok: ok ? 1 : 0, text: short(text, 48), sub: short(sub || '', 48), undo: undo ? 1 : 0 });
}

// ---------------------------------------------------------------- building lists

function visibleLightIdx(roomIdx) {
  var r = st.rooms[roomIdx], out = [];
  for (var j = r.first; j < r.first + r.count; j++) if (!st.lights[j].hidden) out.push(j);
  return out;
}
function allVisibleLights() {
  var out = [];
  st.lights.forEach(function (l, j) { if (!l.hidden) out.push(j); });
  return out;
}

function rowLight(j) {
  var l = st.lights[j];
  var s = !l.online ? 2 : (l.on ? 1 : 0);
  var right = !l.online ? 'Offline' : (l.on ? (l.bright >= 0 ? l.bright + '%' : 'On') : 'Off');
  return { title: short(label(lightKey(l), l.name), 22), sub: right, state: s, type: 0, adj: l.online && l.bright >= 0 ? 1 : 0, act: { k: 'light', j: j } };
}
function rowRoom(i) {
  var r = st.rooms[i], idxs = visibleLightIdx(i);
  var on = idxs.filter(function (j) { return st.lights[j].on && st.lights[j].online; }).length;
  var t = r.thermo >= 0 ? st.thermos[r.thermo] : null;
  var right = idxs.length ? on + '/' + idxs.length : '';
  if (t && t.now >= 0) right += (right ? ' ' : '') + t.now + '°';
  return { title: short(label(roomKey(r), r.name), 22), sub: right, state: on > 0 ? 1 : 0, type: 1, adj: 1, act: { k: 'room', i: i } };
}
function rowThermo(k) {
  var t = st.thermos[k];
  return { title: short(label(thermoKey(t), t.name), 22), sub: MODE_LABEL[t.mode] + ' ' + t.set + '°', state: 3, type: 3, adj: 1, act: { k: 'thermo', k2: k } };
}
function rowScene(s) {
  return { title: short(label(sceneKey(s), s.name), 22), sub: 'Run', state: 3, type: 2, adj: 0, act: { k: 'scene', s: s } };
}
function rowAllOff() {
  var on = allVisibleLights().filter(function (j) { return st.lights[j].on && st.lights[j].online; }).length;
  return { title: 'All lights off', sub: on ? on + ' on' : '', state: on ? 1 : 0, type: 5, adj: 0, act: { k: 'alloff' } };
}
function rowMore() {
  return { title: 'All rooms', sub: '>', state: 3, type: 4, adj: 0, act: { k: 'nav', list: 1 } };
}

/** The favourite behind a settings key, or null if it no longer exists. */
function rowForKey(key) {
  if (key === 'alloff') return st.lights.length ? rowAllOff() : null;
  var kind = key.slice(0, 2), id = key.slice(2), i;
  if (kind === 'r:') { for (i = 0; i < st.rooms.length; i++) if (st.rooms[i].name === id) return rowRoom(i); }
  else if (kind === 'l:') { for (i = 0; i < st.lights.length; i++) if (String(st.lights[i].id) === id) return rowLight(i); }
  else if (kind === 't:') { for (i = 0; i < st.thermos.length; i++) if (String(st.thermos[i].id) === id) return rowThermo(i); }
  else if (kind === 's:') { for (i = 0; i < st.scenes.length; i++) if (String(st.scenes[i].id) === id) return rowScene(st.scenes[i]); }
  return null;
}

/** What the home screen shows when nothing has been chosen yet. Exported for the settings page and tests. */
function defaultFavs() {
  var keys = ['alloff'];
  st.rooms.slice(0, 4).forEach(function (r) { if (r.count) keys.push(roomKey(r)); });
  if (st.thermos.length) keys.push(thermoKey(st.thermos[0]));
  st.scenes.slice(0, 2).forEach(function (s) { keys.push(sceneKey(s)); });
  return keys;
}

function listTitle(id) {
  if (id === 0) return 'Home';
  if (id === 1) return 'All rooms';
  var r = st.rooms[id - 10];
  return r ? label(roomKey(r), r.name) : '';
}
function listRoom(id) { return id >= 10 && st.rooms[id - 10] ? id - 10 : -1; }

function listRows(id) {
  var rows = [], i;
  if (id === 0) {
    (cfg.favs || defaultFavs()).forEach(function (k) { var r = rowForKey(k); if (r) rows.push(r); });
    rows.push(rowMore());
  } else if (id === 1) {
    st.rooms.forEach(function (r, n) { if (!cfg.hidden[roomKey(r)]) rows.push(rowRoom(n)); });
    st.scenes.forEach(function (s) { if (!cfg.hidden[sceneKey(s)]) rows.push(rowScene(s)); });
  } else if (id >= 10 && st.rooms[id - 10]) {
    visibleLightIdx(id - 10).forEach(function (j) { rows.push(rowLight(j)); });
    if (st.rooms[id - 10].thermo >= 0) rows.push(rowThermo(st.rooms[id - 10].thermo));
  }
  return rows;
}

function rowMsg(id, i, r) {
  return { kind: 11, list: id, idx: i, name: r.title, sub: r.sub, state: r.state, type: r.type, adj: r.adj };
}

/** Send a list to the watch: all of it if it is new or its length changed, otherwise only the rows that differ. */
function pushList(id, force) {
  var rows = listRows(id);
  var json = rows.map(function (r) { return JSON.stringify([r.title, r.sub, r.state, r.type, r.adj]); });
  var prev = sent[id];
  shown[id] = rows;
  if (force || !prev || prev.length !== rows.length) {
    enqueue({ kind: 10, list: id, count: rows.length, text: short(listTitle(id), 40), room: listRoom(id) });
    rows.forEach(function (r, i) { enqueue(rowMsg(id, i, r)); });
  } else {
    rows.forEach(function (r, i) { if (json[i] !== prev[i]) enqueue(rowMsg(id, i, r)); });
  }
  sent[id] = json;
}
function refreshLists(force) {
  Object.keys(active).forEach(function (id) { pushList(+id, force); });
}
function openList(id) {
  active[id] = true;
  enqueue({ kind: 14, list: id, text: short(listTitle(id), 40) });
  pushList(id, true);
}
function listClosed(id) {
  if (id !== 0) { delete active[id]; delete sent[id]; delete shown[id]; }
}

// ---------------------------------------------------------------- doing things

function run(action, args, retried) {
  return Pebble.invokeAction({ plugin: GOOGLE_HOME_PLUGIN, action: action, args: args }).then(function (r) {
    log(action + (r.ok ? ' ok' : ' failed: ' + r.code));
    if (!r.ok && r.code === 'RATE_LIMITED' && !retried) {
      return new Promise(function (resolve) { setTimeout(resolve, RETRY_MS); }).then(function () { return run(action, args, true); });
    }
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
/** Like seq, but POOL at a time, so a whole house does not take 24 round trips in a row. */
function pool(items, fn) {
  var next = 0, done = 0;
  function worker() {
    if (next >= items.length) return Promise.resolve();
    var item = items[next++];
    return Promise.resolve(fn(item)).then(function (ok) { if (ok) done++; }).then(worker);
  }
  var workers = [];
  for (var w = 0; w < Math.min(POOL, items.length); w++) workers.push(worker());
  return Promise.all(workers).then(function () { return done; });
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
  l.on = on;   // optimistic: a quick second tap must see this change, not wait for Google
  return run(on ? 'turn_on' : 'turn_off', lightArgs(l));
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
  return seq(snap, function (s) {
    var l = st.lights[s.j];
    var p = l.on !== s.on ? setPower(s.j, s.on) : Promise.resolve(true);
    return p.then(function (ok) {
      if (ok && s.on && s.bright >= 0 && l.bright !== s.bright) return setBright(s.j, s.bright);
      return ok;
    });
  }).then(function () { refreshLists(false); });
}

function afterChange(ok) {
  if (ok) refreshLists(false); else resubscribe();
}

function toggle(j) {
  var l = st.lights[j];
  if (!l || !l.online) return;
  var p = setPower(j, !l.on);
  refreshLists(false);   // the watch sees the new state now; a failure re-reads the real one
  p.then(function (ok) { if (!ok) resubscribe(); });
}
function brightness(j, v) {
  var l = st.lights[j];
  if (!l || !l.online || l.bright < 0) return;
  setBright(j, v).then(afterChange);
}
/** Turn a set of lights on, or off if any is on (so one tap always does the obvious thing). */
function toggleGroup(idxs) {
  idxs = idxs.filter(function (j) { return st.lights[j].online; });
  if (!idxs.length) return;
  var turnOn = !idxs.some(function (j) { return st.lights[j].on; });
  idxs.forEach(function (j) { st.lights[j].on = turnOn; });   // show the whole result at once, not as the pool starts each call
  var p = pool(idxs, function (j) { return setPower(j, turnOn); });
  refreshLists(false);
  p.then(function (done) { if (done < idxs.length) resubscribe(); });
}
function allOff() {
  var idxs = allVisibleLights().filter(function (j) { return st.lights[j].online && st.lights[j].on; });
  if (!idxs.length) return;
  idxs.forEach(function (j) { st.lights[j].on = false; });
  var p = pool(idxs, function (j) { return setPower(j, false); });
  refreshLists(false);
  p.then(function (done) { if (done < idxs.length) resubscribe(); });
}
function runScene(s) {
  return run('run_automation', { name: s.name }).then(function (ok) {
    lastUndo = null;
    if (ok) result(true, short(label(sceneKey(s), s.name), 40), 'Ran', false);
    else result(false, "Couldn't run " + short(s.name, 30), 'Check Google Home', false);
  });
}

function openBright(j) {
  var l = st.lights[j];
  if (!l || !l.online || l.bright < 0) return;
  enqueue({ kind: 12, idx: j, value: l.bright, name: short(label(lightKey(l), l.name), 40), room: l.room, adj: cfg.step });
}
function openThermo(k) {
  var t = st.thermos[k];
  if (!t) return;
  enqueue({ kind: 13, idx: k, set: t.set, temp: t.now, mode: t.mode, name: short(label(thermoKey(t), st.rooms[t.room].name), 40), room: t.room, adj: cfg.tstep });
}
function thermoSet(k, deg) {
  if (!st.thermos[k]) return;
  setThermo(k, deg, null).then(afterChange);
}
function thermoMode(k, m) {
  if (!st.thermos[k]) return;
  setThermo(k, null, m).then(afterChange);
}

function doTap(act) {
  switch (act.k) {
    case 'light': toggle(act.j); break;
    case 'room': toggleGroup(visibleLightIdx(act.i)); break;
    case 'scene': runScene(act.s); break;
    case 'thermo': openThermo(act.k2); break;
    case 'nav': openList(act.list); break;
    case 'alloff': allOff(); break;
  }
}
function doHold(act) {
  switch (act.k) {
    case 'light': openBright(act.j); break;
    case 'room': openList(10 + act.i); break;
    case 'thermo': openThermo(act.k2); break;
    case 'nav': openList(act.list); break;
  }
}
function rowAct(list, idx) {
  var rows = shown[list];
  return rows && rows[idx] ? rows[idx].act : null;
}

// ---------------------------------------------------------------- understanding speech

var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
var STOP = { the: 1, a: 1, an: 1, of: 1, in: 1, my: 1, light: 1, lights: 1, room: 1, please: 1, to: 1, turn: 1, switch: 1, set: 1,
  run: 1, start: 1, activate: 1, scene: 1, routine: 1 };

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

/** Which lights does the phrase mean? -> {lights, label} | {ask:{prompt, options}} | {error}. */
function resolveLights(tokens, ctx, s) {
  var visible = [], every = [];
  s.lights.forEach(function (l, j) { every.push(j); if (!l.hidden) visible.push(j); });
  var anyAll = tokens.some(function (w) { return w === 'all' || w === 'every' || w === 'everything' || w === 'everywhere' || w === 'house' || w === 'whole'; });

  var rooms = [];
  s.rooms.forEach(function (r, i) { if (matches(tokens, r.name)) rooms.push(i); });
  if (anyAll && !rooms.length) return { lights: visible, label: 'All lights' };

  function inRooms(list) { return list.filter(function (j) { return rooms.indexOf(s.lights[j].room) >= 0; }); }
  // Naming a light always works, even if it is hidden from the watch's lists.
  var named = (rooms.length ? inRooms(every) : every).filter(function (j) { return matches(tokens, s.lights[j].name); });
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
    return { lights: inRooms(visible), label: rooms.map(function (i) { return s.rooms[i].name; }).join(' and ') + ' lights' };
  }
  if (ctx >= 0 && s.rooms[ctx]) {
    var r = s.rooms[ctx], mine = [];
    for (var j = r.first; j < r.first + r.count; j++) if (!s.lights[j].hidden) mine.push(j);
    return { lights: mine, label: r.name + ' lights' };
  }
  return { error: 'Say a room or light name' };
}

/** What does the phrase mean? -> {plan} | {ask} | {error}. Pure, so it can be tested. */
function parseVoice(text, ctx, s) {
  var tokens = tokenize(text);
  if (!tokens.length) return { error: 'Heard nothing' };

  // Scenes: "run goodnight", "start movie night", or just the scene's name.
  var scenes = (s.scenes || []).filter(function (sc) { return matches(tokens, sc.name); });
  if (scenes.length) {
    var verb = tokens.some(function (w) { return w === 'run' || w === 'start' || w === 'activate' || w === 'trigger' || w === 'scene' || w === 'routine' || w === 'play'; });
    var onlyName = tokens.every(function (w) { return STOP[w] || sig(scenes[0].name).indexOf(w) >= 0 || w === 'it' || w === 'mode'; });
    if (verb || onlyName) {
      var bestLen = Math.max.apply(null, scenes.map(function (sc) { return sig(sc.name).length; }));
      var top = scenes.filter(function (sc) { return sig(sc.name).length === bestLen; });
      if (top.length === 1) return { plan: { op: 'scene', scene: top[0], label: top[0].name } };
      return { ask: { prompt: 'Which scene?', options: top.slice(0, 4).map(function (sc) {
        return { label: sc.name, sub: 'Scene', plan: { op: 'scene', scene: sc, label: sc.name } };
      }) } };
    }
  }

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

  var dimUp = has(tokens, 'brighten') || has(tokens, 'brighter') || (tokens.indexOf('up') >= 0 && tokens.indexOf('brightness') >= 0);
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
  if (plan.op === 'scene') return runScene(plan.scene);

  if (plan.op === 'thermo') {
    var t = st.thermos[plan.k];
    var before = { k: plan.k, set: t.set, mode: t.mode };
    var set = plan.set != null ? plan.set : plan.delta != null ? Math.max(TEMP_MIN, Math.min(TEMP_MAX, t.set + plan.delta)) : null;
    return setThermo(plan.k, set, plan.mode != null ? plan.mode : null).then(function (ok) {
      if (!ok) { result(false, 'Thermostat did not respond', 'Nothing changed', false); return; }
      lastUndo = function () { return setThermo(before.k, before.set, before.mode).then(function () { refreshLists(false); }); };
      refreshLists(false);
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
  return pool(idxs, function (j) {
    if (plan.op === 'power') return setPower(j, plan.on);
    var cur = st.lights[j].bright;
    return setBright(j, plan.value != null ? plan.value : Math.max(0, Math.min(100, cur + plan.delta)));
  }).then(function (done) {
    if (!done) { result(false, 'Google Home did not respond', 'Nothing changed', false); return; }
    refreshLists(false);
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

// ---------------------------------------------------------------- settings page

/** Everything the settings page needs to let the user choose and name things (with example state for its preview). */
function catalogue() {
  return {
    shortcuts: st.lights.length ? [{ key: 'alloff', name: 'All lights off', right: rowAllOff().sub }] : [],
    rooms: st.rooms.map(function (r, i) {
      var lights = [];
      for (var j = r.first; j < r.first + r.count; j++) {
        var lr = rowLight(j);
        lights.push({ key: lightKey(st.lights[j]), name: st.lights[j].name, dim: st.lights[j].bright >= 0, right: lr.sub, state: lr.state });
      }
      var room = rowRoom(i);
      var t = r.thermo >= 0 ? st.thermos[r.thermo] : null;
      return { key: roomKey(r), name: r.name, right: room.sub, on: room.state, lights: lights,
               thermo: t ? { key: thermoKey(t), name: t.name, right: MODE_LABEL[t.mode] + ' ' + t.set + '\u00b0' } : null };
    }),
    scenes: st.scenes.map(function (sc) { return { key: sceneKey(sc), name: sc.name }; }),
    defaultFavs: defaultFavs(),
  };
}
function pushCatalogueToPage() {
  try { if (Pebble.sendConfigMessage) Pebble.sendConfigMessage({ type: 'catalogue', catalogue: catalogue(), config: cfg }); } catch (e) { /* page not open */ }
}
function onConfigMessage(e) {
  var m = (e && e.data) || {};
  switch (m.type) {
    case 'get':
      e.respond({ catalogue: catalogue(), config: cfg });
      break;
    case 'save':
      cfg = sanitizeConfig(m.config);
      saveConfig();
      applyHidden();
      refreshLists(false);
      e.respond({ ok: true, config: cfg });
      break;
    case 'reset':
      cfg = defaultConfig();
      saveConfig();
      applyHidden();
      refreshLists(false);
      e.respond({ ok: true, config: cfg, catalogue: catalogue() });
      break;
  }
}

// ---------------------------------------------------------------- wiring

/** Rooms, lights and thermostats by identity, ignoring their current state. */
function shapeOf(s) {
  return JSON.stringify([
    s.rooms.map(function (r) { return [r.name, r.first, r.count, r.thermo]; }),
    s.lights.map(function (l) { return [l.id, l.name, l.online]; }),
    s.thermos.map(function (t) { return [t.id, t.name]; }),
  ]);
}
function onDevices(envelope) {
  var parsed = parseEnvelope(envelope);
  var hadLights = st.rooms.length > 0;
  var before = shapeOf(st);
  st.rooms = parsed.rooms; st.lights = parsed.lights; st.thermos = parsed.thermos;
  applyHidden();
  log(st.rooms.length + ' room(s), ' + st.lights.length + ' light(s), ' + st.thermos.length + ' thermostat(s)');
  if (!st.rooms.length) {
    sent = {};
    enqueue({ kind: 5, text: 'No lights found. Check the Google Home plugin.' });
  } else {
    // The plugin refreshes this source after every action. Send only what changed, and never drop queued messages
    // (a result card may be waiting). Resend whole lists only if the shape of the home changed or we had nothing before.
    var full = !hadLights || shapeOf(st) !== before;
    if (full) sent = {};
    refreshLists(false);
  }
  pushCatalogueToPage();
}
function onScenes(envelope) {
  st.scenes = parseScenes(envelope);
  if (st.rooms.length) refreshLists(false);
  pushCatalogueToPage();
}
function onError(err) {
  log('source error: ' + (err && err.code));
  st.rooms = []; st.lights = []; st.thermos = [];
  sent = {};
  enqueue({ kind: 5, text: 'Google Home: ' + ((err && err.code) || 'error') });
}
function subscribe() {
  subs.forEach(function (s) { s.unsubscribe(); });
  subs = [
    Pebble.subscribeToSource({
      category: 'home', item: 'device', plugin: GOOGLE_HOME_PLUGIN,
      properties: ['name', 'room', 'type', 'on', 'online', 'brightness', 'setpoint', 'ambient_temperature', 'thermostat_mode'],
      onData: onDevices, onError: onError,
    }),
    Pebble.subscribeToSource({
      category: 'home', item: 'automation', plugin: GOOGLE_HOME_PLUGIN,
      properties: ['name', 'manually_runnable'],
      onData: onScenes, onError: function () { /* scenes are optional */ },
    }),
  ];
}
function resubscribe() { subscribe(); }

function onWatchMessage(e) {
  var p = (e && e.payload) || {};
  var act;
  switch (p.cmd) {
    case 1: act = rowAct(p.list, p.idx); if (act) doTap(act); break;
    case 2: act = rowAct(p.list, p.idx); if (act) doHold(act); break;
    case 3: brightness(p.idx, p.value); break;
    case 4: thermoSet(p.idx, p.value); break;
    case 5: thermoMode(p.idx, p.value); break;
    case 6: listClosed(p.list); break;
    case 7: voice(p.say, p.value == null ? -1 : p.value); break;
    case 8: undo(); break;
    case 9: choose(p.idx); break;
    case 10: resubscribe(); break;
  }
}

if (typeof Pebble !== 'undefined') {
  Pebble.addEventListener('ready', function () { log('ready'); cfg = loadConfig(); subscribe(); });
  Pebble.addEventListener('appmessage', onWatchMessage);
  Pebble.addEventListener('configmessage', onConfigMessage);
}
if (typeof module !== 'undefined') {
  module.exports = { parseEnvelope: parseEnvelope, parseScenes: parseScenes, parseVoice: parseVoice, findNumber: findNumber,
    tokenize: tokenize, sanitizeConfig: sanitizeConfig };
}

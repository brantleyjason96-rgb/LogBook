const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const mk = (id, p) => ({
  instanceId: id,
  properties: Object.fromEntries(Object.entries(p).map(([k, [shape, v]]) => [k, { [shape]: shape === 'shortText' ? { text: v } : { value: v } }])),
});
const light = (id, name, room, on, bright, type = 'light', online = true) => mk(id, {
  name: ['shortText', name], room: ['shortText', room], type: ['shortText', type], on: ['boolean', on], online: ['boolean', online],
  ...(bright == null ? {} : { brightness: ['numericValue', bright] }),
});
const therm = (id, name, room, setC, nowC, mode) => mk(id, {
  name: ['shortText', name], room: ['shortText', room], type: ['shortText', 'thermostat'],
  setpoint: ['numericValue', setC], ambient_temperature: ['numericValue', nowC], thermostat_mode: ['shortText', mode],
});
const scene = (id, name, runnable = true) => mk(id, { name: ['shortText', name], manually_runnable: ['boolean', runnable] });

// Sorted: Bedroom[Ceiling 0, Lamp 1] Kitchen[Under cabinet 2] Living room[Ceiling 3, Floor lamp 4, Shelf lights 5, TV backlight 6] Office[Desk light 7, Lamp 8]
const HOME = { instances: [
  light('1', 'Floor lamp', 'Living room', true, 80), light('2', 'Ceiling', 'Living room', true, 100),
  light('3', 'Shelf lights', 'Living room', false, 0), light('4', 'TV backlight', 'Living room', true, 30),
  light('5', 'Lamp', 'Bedroom', false, 0), light('6', 'Ceiling', 'Bedroom', false, 0),
  light('7', 'Under cabinet', 'Kitchen', true, null),
  light('8', 'Lamp', 'Office', true, 60), light('9', 'Desk light', 'Office', true, 100),
  light('10', 'HomePod', 'Kitchen', true, null, 'speaker'),
  therm('11', 'Thermostat', 'Living room', 21, 20, 'HEAT'),
] };
const SCENES = { instances: [scene('a1', 'Goodnight'), scene('a2', 'Movie night'), scene('a3', 'Wake up', false)] };
const ROOM = { Bedroom: 0, Kitchen: 1, 'Living room': 2, Office: 3 };

function load(storage) {
  const sent = [], calls = [], handlers = {}, subs = {}, pushed = [];
  const store = Object.assign({}, storage);
  const Pebble = {
    addEventListener: (n, f) => { handlers[n] = f; },
    sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    sendConfigMessage: (m) => pushed.push(m),
    subscribeToSource: (cfg) => { subs[cfg.item] = cfg; return { unsubscribe() {} }; },
    invokeAction: (c) => { calls.push(c); return Promise.resolve({ ok: !(t.failing && t.failing(c) === false) }); },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const ctx = { Pebble, localStorage, console: { log() {} }, setTimeout, Promise, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8'), ctx);
  const t = { sent, calls, handlers, subs, pushed, store, api: ctx.module.exports, failing: null };
  return t;
}
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function ready(storage, scenes = true) {
  const t = load(storage); t.handlers.ready();
  if (scenes) t.subs.automation.onData(SCENES);   // scenes first, so the home list is sent once
  t.subs.device.onData(HOME);
  await tick();
  return t;
}
const clear = (t) => { t.sent.length = 0; t.calls.length = 0; };
const msg = (t, kind) => t.sent.filter((m) => m.kind === kind);
const rowsOf = (t, list) => msg(t, 11).filter((m) => m.list === list);
const tap = async (t, list, idx) => { clear(t); t.handlers.appmessage({ payload: { cmd: 1, list, idx } }); await tick(60); };
const hold = async (t, list, idx) => { clear(t); t.handlers.appmessage({ payload: { cmd: 2, list, idx } }); await tick(60); };
const say = async (t, text, ctx) => { clear(t); t.handlers.appmessage({ payload: { cmd: 7, say: text, value: ctx } }); await tick(80); };
const result = (t) => msg(t, 4).pop();

test('subscribes to devices and to automations through the Google Home plugin', () => {
  const t = load(); t.handlers.ready();
  assert.equal(t.subs.device.plugin, 'd93ea4f2-6bb2-4f51-a766-29dbe481c170');
  ['setpoint', 'ambient_temperature', 'thermostat_mode', 'room'].forEach((p) => assert.ok(t.subs.device.properties.includes(p), p));
  assert.deepEqual([t.subs.automation.category, t.subs.automation.item], ['home', 'automation']);
});

test('rooms are grouped and sorted, speakers ignored, thermostat in deg F; only runnable scenes kept', () => {
  const { api } = load();
  const s = api.parseEnvelope(HOME);
  assert.deepEqual(s.rooms.map((r) => [r.name, r.first, r.count, r.thermo]), [['Bedroom', 0, 2, -1], ['Kitchen', 2, 1, -1], ['Living room', 3, 4, 0], ['Office', 7, 2, -1]]);
  assert.deepEqual([s.thermos[0].set, s.thermos[0].now, s.thermos[0].mode], [70, 68, 0]);
  assert.deepEqual(api.parseScenes(SCENES).map((x) => x.name), ['Goodnight', 'Movie night']);
});

test('default home: all-off, rooms, thermostat, two scenes, then "All rooms"', async () => {
  const t = await ready();
  assert.deepEqual(msg(t, 10)[0], { kind: 10, list: 0, count: 9, text: 'Home', room: -1 });
  const rows = rowsOf(t, 0).map((r) => [r.name, r.sub, r.state, r.type]);
  assert.deepEqual(rows, [
    ['All lights off', '6 on', 1, 5], ['Bedroom', '0/2', 0, 1], ['Kitchen', '1/1', 1, 1],
    ['Living room', '3/4 68°', 1, 1], ['Office', '2/2', 1, 1], ['Thermostat', 'Heat 70°', 3, 3],
    ['Goodnight', 'Run', 3, 2], ['Movie night', 'Run', 3, 2], ['All rooms', '>', 3, 4]]);
});

test('empty plugin result and plugin errors produce a status message', async () => {
  const t = load(); t.handlers.ready();
  t.subs.device.onData({ instances: [] }); await tick();
  assert.equal(t.sent.at(-1).kind, 5);
  t.subs.device.onError({ code: 'NOT_INSTALLED' }); await tick();
  assert.match(t.sent.at(-1).text, /NOT_INSTALLED/);
});

test('tap: a light toggles, a room toggles together, all-off turns everything off, one change sends only changed rows', async () => {
  const t = await ready();
  await tap(t, 0, 3);                                   // "Living room": something is on -> everything off
  assert.deepEqual(t.calls.map((c) => c.action), ['turn_off', 'turn_off', 'turn_off', 'turn_off']);
  assert.equal(msg(t, 10).length, 0, 'same length: no list restart');
  const changed = rowsOf(t, 0).map((r) => [r.idx, r.name, r.sub, r.state]);
  assert.deepEqual(changed, [[0, 'All lights off', '3 on', 1], [3, 'Living room', '0/4 68°', 0]]);
  await tap(t, 0, 3);                                   // all off -> everything on
  assert.deepEqual(t.calls.map((c) => c.action), ['turn_on', 'turn_on', 'turn_on', 'turn_on']);
  await tap(t, 0, 0);                                   // all lights off
  assert.equal(t.calls.filter((c) => c.action === 'turn_off').length, 7);   // Shelf lights is on again after the room toggle
  assert.deepEqual(rowsOf(t, 0).find((r) => r.idx === 0), { kind: 11, list: 0, idx: 0, name: 'All lights off', sub: '', state: 0, type: 5, adj: 0 });
});

test('hold on a room opens that room, and a light inside toggles or opens brightness', async () => {
  const t = await ready();
  await hold(t, 0, 3);
  assert.deepEqual(msg(t, 14)[0], { kind: 14, list: 12, text: 'Living room' });
  assert.deepEqual(msg(t, 10)[0], { kind: 10, list: 12, count: 5, text: 'Living room', room: 2 });
  assert.deepEqual(rowsOf(t, 12).map((r) => [r.name, r.sub, r.type, r.adj]),
    [['Ceiling', '100%', 0, 1], ['Floor lamp', '80%', 0, 1], ['Shelf lights', 'Off', 0, 1], ['TV backlight', '30%', 0, 1], ['Thermostat', 'Heat 70°', 3, 1]]);

  await tap(t, 12, 1);                                  // Floor lamp
  assert.deepEqual([t.calls[0].action, t.calls[0].args], ['turn_off', { name: 'Floor lamp', room: 'Living room' }]);
  assert.ok(rowsOf(t, 12).some((r) => r.idx === 1 && r.state === 0 && r.sub === 'Off'), 'room list updated');
  assert.ok(rowsOf(t, 0).some((r) => r.idx === 3), 'home list updated too, because both are open');

  await hold(t, 12, 3);                                 // TV backlight -> brightness screen
  assert.deepEqual(msg(t, 12)[0], { kind: 12, idx: 6, value: 30, name: 'TV backlight', room: 2, adj: 10 });
  t.handlers.appmessage({ payload: { cmd: 3, idx: 6, value: 55 } }); await tick();
  assert.equal(t.calls.at(-1).args.brightness_pct, 55);

});

test('a light that cannot dim has no hold action and does not open brightness', async () => {
  const t = await ready();
  await hold(t, 0, 2);
  assert.equal(rowsOf(t, 11)[0].adj, 0);
  await hold(t, 11, 0);
  assert.equal(msg(t, 12).length, 0);
});

test('closing a list stops updates to it', async () => {
  const t = await ready();
  await hold(t, 0, 3);
  t.handlers.appmessage({ payload: { cmd: 6, list: 12 } });
  await tap(t, 0, 3);
  assert.equal(rowsOf(t, 12).length, 0);
});

test('thermostat: tap opens it, set point and mode change the plugin', async () => {
  const t = await ready();
  await tap(t, 0, 5);
  assert.deepEqual(msg(t, 13)[0], { kind: 13, idx: 0, set: 70, temp: 68, mode: 0, name: 'Living room', room: 2, adj: 1 });
  t.handlers.appmessage({ payload: { cmd: 4, idx: 0, value: 95 } }); await tick();
  assert.deepEqual(t.calls[0].args, { name: 'Thermostat', room: 'Living room', temperature_f: 90 });
  t.handlers.appmessage({ payload: { cmd: 5, idx: 0, value: 1 } }); await tick();
  assert.equal(t.calls[1].args.mode, 'cool');
  assert.ok(rowsOf(t, 0).some((r) => r.name === 'Thermostat' && r.sub === 'Cool 90°'));
});

test('tap on a scene runs the automation and shows a result card', async () => {
  const t = await ready();
  await tap(t, 0, 6);
  assert.deepEqual(t.calls[0], { plugin: 'd93ea4f2-6bb2-4f51-a766-29dbe481c170', action: 'run_automation', args: { name: 'Goodnight' } });
  assert.deepEqual([result(t).ok, result(t).text, result(t).undo], [1, 'Goodnight', 0]);
  t.failing = () => false;
  await tap(t, 0, 6);
  assert.equal(result(t).ok, 0);
});

test('"All rooms" lists rooms and scenes; a room there can be toggled', async () => {
  const t = await ready();
  await tap(t, 0, 8);
  assert.deepEqual(msg(t, 14)[0], { kind: 14, list: 1, text: 'All rooms' });
  assert.deepEqual(rowsOf(t, 1).map((r) => r.name), ['Bedroom', 'Kitchen', 'Living room', 'Office', 'Goodnight', 'Movie night']);
  await tap(t, 1, 0);                                   // Bedroom is all off -> on
  assert.deepEqual(t.calls.map((c) => c.action), ['turn_on', 'turn_on']);
});

test('settings: catalogue, saving favourites in order, nicknames, hidden items, steps', async () => {
  const t = await ready();
  let reply; const respond = (r) => { reply = r; };
  t.handlers.configmessage({ data: { type: 'get' }, respond });
  assert.deepEqual(reply.catalogue.rooms.map((r) => r.name), ['Bedroom', 'Kitchen', 'Living room', 'Office']);
  assert.deepEqual(reply.catalogue.rooms[2].lights.map((l) => [l.key, l.dim]), [['l:2', true], ['l:1', true], ['l:3', true], ['l:4', true]]);
  assert.deepEqual([reply.catalogue.rooms[2].thermo.key, reply.catalogue.scenes.map((s) => s.key)], ['t:11', ['s:a1', 's:a2']]);
  assert.ok(reply.catalogue.defaultFavs.includes('alloff'));

  clear(t);
  t.handlers.configmessage({ data: { type: 'save', config: {
    favs: ['s:a1', 'l:1', 'r:Living room', 'nope', 'l:1', 'alloff'], names: { 'l:1': 'Reading lamp', 'r:Office': '  Study  ' },
    hidden: { 'l:3': true, 'r:Kitchen': true, 'l:9': false }, step: 20, tstep: 2 } }, respond });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.config.favs, ['s:a1', 'l:1', 'r:Living room', 'nope', 'alloff'], 'duplicates dropped');
  assert.deepEqual(reply.config.names, { 'l:1': 'Reading lamp', 'r:Office': 'Study' });
  await tick();
  // Home list is now shorter (missing "nope" skipped, "All rooms" appended): restarted
  assert.deepEqual(msg(t, 10)[0], { kind: 10, list: 0, count: 5, text: 'Home', room: -1 });
  assert.deepEqual(rowsOf(t, 0).map((r) => r.name), ['Goodnight', 'Reading lamp', 'Living room', 'All lights off', 'All rooms']);
  assert.deepEqual(JSON.parse(t.store.cfg).step, 20);

  await hold(t, 0, 2);                                  // Living room: hidden Shelf lights is gone, count and rows reflect that
  assert.deepEqual(rowsOf(t, 12).map((r) => r.name), ['Ceiling', 'Reading lamp', 'TV backlight', 'Thermostat']);
  await tap(t, 0, 2);                                   // hidden light is not touched by a room toggle
  assert.equal(t.calls.length, 3);
  await hold(t, 12, 1);
  assert.equal(msg(t, 12)[0].adj, 20);
  await tap(t, 12, 3);
  assert.equal(msg(t, 13)[0].adj, 2);

  await tap(t, 0, 4);                                   // "All rooms" (index 4): hidden Kitchen left out
  assert.deepEqual(rowsOf(t, 1).map((r) => r.name), ['Bedroom', 'Living room', 'Study', 'Goodnight', 'Movie night']);
});

test('settings survive a restart, and bad values are cleaned up', async () => {
  const a = await ready();
  a.handlers.configmessage({ data: { type: 'save', config: { favs: ['r:Office'], step: 7, tstep: 9, names: { x: '' }, hidden: 'no' } }, respond() {} });
  const b = load({ cfg: a.store.cfg }); b.handlers.ready(); b.subs.device.onData(HOME); await tick();
  assert.deepEqual(rowsOf(b, 0).map((r) => r.name), ['Office', 'All rooms']);
  const cfg = JSON.parse(a.store.cfg);
  assert.deepEqual([cfg.step, cfg.tstep, cfg.names, cfg.hidden], [10, 1, {}, {}]);
  const c = load({ cfg: '{not json' }); c.handlers.ready(); c.subs.device.onData(HOME); await tick();
  assert.equal(msg(c, 10)[0].count, 7, 'falls back to defaults');
  let reply;
  a.handlers.configmessage({ data: { type: 'reset' }, respond: (r) => { reply = r; } });
  assert.equal(reply.config.favs, null);
});

test('the settings page is told when devices or scenes change', async () => {
  const t = await ready();
  assert.ok(t.pushed.length >= 1);
  assert.equal(t.pushed.at(-1).type, 'catalogue');
  assert.equal(t.pushed.at(-1).catalogue.scenes.length, 2);
});

// ---------------------------------------------------------------- voice

test('number words', () => {
  const { findNumber, tokenize } = load().api;
  const n = (s) => findNumber(tokenize(s));
  assert.equal(n('to forty'), 40); assert.equal(n('forty five percent'), 45); assert.equal(n('set it to 72'), 72);
  assert.equal(n('one hundred'), 100); assert.equal(n('half'), 50); assert.equal(n('no number'), null); assert.equal(n('30%'), 30);
});

test('phrases -> plans', () => {
  const t = load(); const st = t.api.parseEnvelope(HOME); st.scenes = t.api.parseScenes(SCENES);
  const p = (s, ctx = -1) => t.api.parseVoice(s, ctx, st);
  const lights = (o) => o.plan.lights.map((j) => st.lights[j].name + '@' + st.rooms[st.lights[j].room].name);

  let o = p('turn off the kitchen lights');
  assert.deepEqual([o.plan.op, o.plan.on, o.plan.label], ['power', false, 'Kitchen lights']);
  assert.deepEqual(lights(o), ['Under cabinet@Kitchen']);
  assert.equal(p('kitchen lights off').plan.on, false);
  assert.equal(p('Turn on the bedroom lights.').plan.lights.length, 2);
  o = p('turn off all the lights'); assert.equal(o.plan.lights.length, 9); assert.equal(o.plan.label, 'All lights');
  assert.equal(p('everything off').plan.lights.length, 9);

  o = p('dim the living room to forty percent'); assert.deepEqual([o.plan.op, o.plan.value, o.plan.lights.length], ['bright', 40, 4]);
  o = p('set the floor lamp to 30'); assert.deepEqual([o.plan.value, lights(o)], [30, ['Floor lamp@Living room']]);
  assert.equal(p('bedroom lights to fifty').plan.value, 50);
  assert.equal(p('dim the living room').plan.delta, -20);
  assert.equal(p('brighten the office').plan.delta, 20);
  assert.equal(p('living room lights to full').plan.value, 100);
  assert.equal(p('floor lamp to half').plan.value, 50);

  assert.equal(p('turn them off', 1).plan.label, 'Kitchen lights');
  o = p('dim it to 20', 2); assert.deepEqual([o.plan.value, o.plan.lights.length], [20, 4]);
  assert.match(p('turn it off').error, /room or light/);

  o = p('set the thermostat to 72'); assert.deepEqual([o.plan.op, o.plan.set], ['thermo', 72]);
  assert.equal(p('set the temperature to seventy one degrees').plan.set, 71);
  assert.deepEqual([p('make it warmer').plan.op, p('make it warmer').plan.delta], ['thermo', 2]);
  assert.equal(p('thermostat cooler').plan.delta, -2);
  assert.equal(p('turn the heat off').plan.mode, 3);
  assert.equal(p('turn the heat on').plan.mode, 0);
  o = p('set cool to 74'); assert.deepEqual([o.plan.mode, o.plan.set], [1, 74]);
  assert.equal(p('eco mode on the thermostat').plan.mode, 2);
  assert.match(p('set the thermostat to 20').error, /50 to 90/);
  assert.match(p('thermostat').error, /set the thermostat/);

  o = p('turn off the lamp');
  assert.equal(o.ask.options.length, 3); assert.equal(o.ask.options.at(-1).label, 'All of them');
  assert.deepEqual(o.ask.options.slice(0, 2).map((x) => x.sub), ['Bedroom', 'Office']);
  assert.equal(p('turn off the office lamp').plan.lights.length, 1);

  o = p('run goodnight'); assert.deepEqual([o.plan.op, o.plan.scene.name], ['scene', 'Goodnight']);
  assert.equal(p('start the movie night scene').plan.scene.name, 'Movie night');
  assert.equal(p('movie night').plan.scene.name, 'Movie night');
  assert.equal(p('turn off the bedroom lights').plan.op, 'power', 'a lights command is not mistaken for a scene');

  assert.match(p('').error, /nothing/i);
  assert.match(p('what is the weather').error, /Try/);
});

test('hidden lights are skipped by "all" and by room-wide commands, but can still be named', () => {
  const t = load(); const st = t.api.parseEnvelope(HOME);
  st.lights[5].hidden = true;                           // Shelf lights
  const p = (s) => t.api.parseVoice(s, -1, st);
  assert.equal(p('turn off all the lights').plan.lights.length, 8);
  assert.equal(p('turn off the living room lights').plan.lights.length, 3);
  assert.deepEqual(p('turn off the shelf lights').plan.lights, [5]);
});

test('voice runs the right plugin calls, updates the lists, and undo restores them', async () => {
  const t = await ready();
  await say(t, 'turn off the living room lights', -1);
  assert.deepEqual(t.calls.map((c) => c.args), [
    { name: 'Ceiling', room: 'Living room' }, { name: 'Floor lamp', room: 'Living room' },
    { name: 'Shelf lights', room: 'Living room' }, { name: 'TV backlight', room: 'Living room' }]);
  assert.deepEqual([result(t).ok, result(t).text, result(t).undo], [1, 'Living room lights off', 1]);
  assert.ok(rowsOf(t, 0).some((r) => r.name === 'Living room' && r.state === 0), 'home list refreshed');

  clear(t);
  t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(80);
  assert.deepEqual(t.calls.map((c) => c.args.name).sort(), ['Ceiling', 'Floor lamp', 'TV backlight']);
  assert.ok(!t.calls.some((c) => c.action === 'set_brightness'));
  assert.equal(result(t).text, 'Undone');
  clear(t); t.handlers.appmessage({ payload: { cmd: 8 } }); await tick();
  assert.equal(result(t).ok, 0);
});

test('voice: brightness and its undo, thermostat and its undo, scene, ambiguity', async () => {
  const t = await ready();
  await say(t, 'dim the floor lamp to 10', -1);
  assert.deepEqual(t.calls.map((c) => [c.args.name, c.args.brightness_pct]), [['Floor lamp', 10]]);
  clear(t); t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(60);
  assert.deepEqual(t.calls.map((c) => [c.action, c.args.brightness_pct]), [['set_brightness', 80]]);

  await say(t, 'set the thermostat to seventy four', -1);
  assert.equal(t.calls[0].args.temperature_f, 74);
  assert.equal(result(t).text, 'Thermostat to 74°');
  clear(t); t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(60);
  assert.equal(t.calls[0].args.temperature_f, 70);
  await say(t, 'warmer thermostat', -1);
  assert.equal(t.calls[0].args.temperature_f, 72);

  await say(t, 'run goodnight', -1);
  assert.deepEqual(t.calls.map((c) => [c.action, c.args.name]), [['run_automation', 'Goodnight']]);

  await say(t, 'turn off the lamp', -1);
  assert.deepEqual(msg(t, 6).map((m) => [m.idx, m.count, m.name, m.sub]), [[0, 3, 'Lamp', 'Bedroom'], [1, 3, 'Lamp', 'Office'], [2, 3, 'All of them', '2 lights']]);
  assert.equal(t.calls.length, 0);
  t.handlers.appmessage({ payload: { cmd: 9, idx: 1 } }); await tick(60);
  assert.deepEqual(t.calls.map((c) => c.args), [{ name: 'Lamp', room: 'Office' }]);
});

test('failures are reported and change nothing; dimming a non-dimmable light and offline lights say so', async () => {
  const t = await ready();
  t.failing = () => false;
  await say(t, 'turn off the kitchen lights', -1);
  assert.deepEqual([result(t).ok, result(t).undo], [0, 0]);
  t.failing = null;
  await say(t, 'dim the kitchen to 20', -1);
  assert.match(result(t).text, /cannot dim/);
  const t2 = load(); t2.handlers.ready();
  t2.subs.device.onData({ instances: [light('1', 'Lamp', 'Den', true, 50, 'light', false)] }); await tick();
  await say(t2, 'turn off the den lights', -1);
  assert.match(result(t2).text, /offline/i);
});

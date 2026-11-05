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
const HOME = { instances: [
  light('1', 'Floor lamp', 'Living room', true, 80), light('2', 'Ceiling', 'Living room', true, 100),
  light('3', 'Shelf lights', 'Living room', false, 0), light('4', 'TV backlight', 'Living room', true, 30),
  light('5', 'Lamp', 'Bedroom', false, 0), light('6', 'Ceiling', 'Bedroom', false, 0),
  light('7', 'Under cabinet', 'Kitchen', true, null),
  light('8', 'Lamp', 'Office', true, 60), light('9', 'Desk light', 'Office', true, 100),
  light('10', 'HomePod', 'Kitchen', true, null, 'speaker'),
  therm('11', 'Thermostat', 'Living room', 21, 20, 'HEAT'),
] };

function load() {
  const sent = [], calls = [], handlers = {};
  let sub = null, failing = null;
  const Pebble = {
    addEventListener: (n, f) => { handlers[n] = f; },
    sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    subscribeToSource: (cfg) => { sub = cfg; return { unsubscribe() {} }; },
    invokeAction: (c) => { calls.push(c); return Promise.resolve({ ok: failing ? failing(c) === false ? false : true : true }); },
  };
  const ctx = { Pebble, console: { log() {} }, setTimeout, Promise, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8'), ctx);
  return { sent, calls, handlers, api: ctx.module.exports, getSub: () => sub, fail: (f) => { failing = f; } };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const ready = async () => { const t = load(); t.handlers.ready(); t.getSub().onData(HOME); await tick(); return t; };
const say = async (t, text, ctx) => { t.calls.length = 0; t.sent.length = 0; t.handlers.appmessage({ payload: { cmd: 7, say: text, value: ctx } }); await tick(60); };
const result = (t) => t.sent.filter((m) => m.kind === 4).pop();

test('subscribes to the Google Home device source with thermostat properties', () => {
  const t = load(); t.handlers.ready();
  const s = t.getSub();
  assert.equal(s.plugin, 'd93ea4f2-6bb2-4f51-a766-29dbe481c170');
  ['setpoint', 'ambient_temperature', 'thermostat_mode', 'room'].forEach((p) => assert.ok(s.properties.includes(p), p));
});

test('groups lights into sorted rooms with contiguous ranges; speaker ignored; thermostat in deg F', () => {
  const st = load().api.parseEnvelope(HOME);
  assert.deepEqual(st.rooms.map((r) => [r.name, r.first, r.count, r.thermo]),
    [['Bedroom', 0, 2, -1], ['Kitchen', 2, 1, -1], ['Living room', 3, 4, 0], ['Office', 7, 2, -1]]);
  assert.equal(st.lights.length, 9);
  assert.equal(st.lights[3].name, 'Ceiling'); assert.equal(st.lights[3].room, 2);
  assert.deepEqual([st.thermos[0].set, st.thermos[0].now, st.thermos[0].mode], [70, 68, 0]);
});

test('sends begin, then rooms, then lights', async () => {
  const t = await ready();
  assert.deepEqual(t.sent[0], { kind: 0, rooms: 4, lights: 9 });
  assert.deepEqual(t.sent[1], { kind: 1, idx: 0, name: 'Bedroom', first: 0, count: 2, thermo: 0, temp: -1, set: 0, mode: 0 });
  assert.deepEqual(t.sent[3], { kind: 1, idx: 2, name: 'Living room', first: 3, count: 4, thermo: 1, temp: 68, set: 70, mode: 0 });
  assert.deepEqual(t.sent[5 + 3], { kind: 2, idx: 3, name: 'Ceiling', room: 2, state: 1, bright: 100 });
});

test('empty plugin result and plugin errors produce a status message', async () => {
  const t = load(); t.handlers.ready();
  t.getSub().onData({ instances: [] }); await tick();
  assert.equal(t.sent.at(-1).kind, 5);
  t.getSub().onError({ code: 'NOT_INSTALLED' }); await tick();
  assert.match(t.sent.at(-1).text, /NOT_INSTALLED/);
});

test('number words', () => {
  const { findNumber, tokenize } = load().api;
  const n = (s) => findNumber(tokenize(s));
  assert.equal(n('to forty'), 40); assert.equal(n('forty five percent'), 45); assert.equal(n('set it to 72'), 72);
  assert.equal(n('one hundred'), 100); assert.equal(n('half'), 50); assert.equal(n('no number'), null); assert.equal(n('30%'), 30);
});

test('phrases -> plans', () => {
  const t = load(); const st = t.api.parseEnvelope(HOME);
  const p = (s, ctx = -1) => t.api.parseVoice(s, ctx, st);
  const lights = (o) => o.plan.lights.map((j) => st.lights[j].name + '@' + st.rooms[st.lights[j].room].name);

  let o = p('turn off the kitchen lights');
  assert.deepEqual([o.plan.op, o.plan.on, o.plan.label], ['power', false, 'Kitchen lights']);
  assert.deepEqual(lights(o), ['Under cabinet@Kitchen']);
  assert.equal(p('kitchen lights off').plan.on, false);
  assert.equal(p('Turn on the bedroom lights.').plan.on, true);
  assert.equal(p('turn on the bedroom lights').plan.lights.length, 2);

  o = p('turn off all the lights'); assert.equal(o.plan.lights.length, 9); assert.equal(o.plan.label, 'All lights');
  o = p('everything off'); assert.equal(o.plan.lights.length, 9);

  o = p('dim the living room to forty percent');
  assert.deepEqual([o.plan.op, o.plan.value, o.plan.lights.length], ['bright', 40, 4]);
  o = p('set the floor lamp to 30'); assert.deepEqual([o.plan.value, lights(o)], [30, ['Floor lamp@Living room']]);
  o = p('bedroom lights to fifty'); assert.equal(o.plan.value, 50);
  o = p('dim the living room'); assert.equal(o.plan.delta, -20);
  o = p('brighten the office'); assert.equal(o.plan.delta, 20);
  o = p('living room lights to full'); assert.equal(o.plan.value, 100);
  o = p('floor lamp to half'); assert.equal(o.plan.value, 50);

  // room context from the screen the watch is on
  o = p('turn them off', 1); assert.equal(o.plan.label, 'Kitchen lights');
  o = p('dim it to 20', 3); assert.deepEqual([o.plan.value, o.plan.lights.length], [20, 2]);
  assert.match(p('turn it off').error, /room or light/);

  // thermostat
  o = p('set the thermostat to 72'); assert.deepEqual([o.plan.op, o.plan.set], ['thermo', 72]);
  o = p('set the temperature to seventy one degrees'); assert.equal(o.plan.set, 71);
  o = p('make it warmer'); assert.deepEqual([o.plan.op, o.plan.delta], ['thermo', 2]);
  o = p('warmer thermostat'); assert.equal(o.plan.delta, 2);
  o = p('thermostat cooler'); assert.equal(o.plan.delta, -2);
  o = p('turn the heat off'); assert.equal(o.plan.mode, 3);
  o = p('turn the heat on'); assert.equal(o.plan.mode, 0);
  o = p('set cool to 74'); assert.deepEqual([o.plan.mode, o.plan.set], [1, 74]);
  o = p('eco mode on the thermostat'); assert.equal(o.plan.mode, 2);
  assert.match(p('set the thermostat to 20').error, /50 to 90/);
  assert.match(p('thermostat').error, /set the thermostat/);

  // ambiguity: "lamp" is in Bedroom and Office, "ceiling" in Living room and Bedroom
  o = p('turn off the lamp');
  assert.equal(o.ask.options.length, 3); assert.equal(o.ask.options.at(-1).label, 'All of them');
  assert.deepEqual(o.ask.options.slice(0, 2).map((x) => x.sub), ['Bedroom', 'Office']);
  assert.equal(p('turn off the office lamp').plan.lights.length, 1);   // a room disambiguates

  assert.match(p('').error, /nothing/i);
  assert.match(p('what is the weather').error, /Try/);
});

test('voice command runs the right plugin calls, updates the watch, and can be undone', async () => {
  const t = await ready();
  await say(t, 'turn off the living room lights', -1);
  const offs = t.calls.filter((c) => c.action === 'turn_off');
  assert.deepEqual(offs.map((c) => c.args), [
    { name: 'Ceiling', room: 'Living room' }, { name: 'Floor lamp', room: 'Living room' },
    { name: 'Shelf lights', room: 'Living room' }, { name: 'TV backlight', room: 'Living room' }]);
  let r = result(t);
  assert.deepEqual([r.ok, r.text, r.undo], [1, 'Living room lights off', 1]);
  assert.ok(t.sent.some((m) => m.kind === 1 && m.idx === 2), 'room row refreshed');
  assert.ok(t.sent.some((m) => m.kind === 2 && m.idx === 3 && m.state === 0), 'light row refreshed');

  t.calls.length = 0; t.sent.length = 0;
  t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(80);
  const ons = t.calls.filter((c) => c.action === 'turn_on').map((c) => c.args.name).sort();
  assert.deepEqual(ons, ['Ceiling', 'Floor lamp', 'TV backlight']);             // only what was on before
  assert.ok(!t.calls.some((c) => c.action === 'set_brightness'), 'turning off does not change brightness, so undo only turns on');
  assert.equal(result(t).text, 'Undone');
  t.sent.length = 0; t.handlers.appmessage({ payload: { cmd: 8 } }); await tick();
  assert.equal(result(t).ok, 0);                                                 // second undo has nothing to do
});

test('brightness by voice, thermostat by voice and its undo', async () => {
  const t = await ready();
  await say(t, 'dim the office to thirty percent', -1);
  assert.deepEqual(t.calls.map((c) => [c.action, c.args.name, c.args.brightness_pct]), [['set_brightness', 'Desk light', 30], ['set_brightness', 'Lamp', 30]]);
  assert.equal(result(t).text, 'Office lights to 30%');

  await say(t, 'set the thermostat to seventy four', -1);
  assert.deepEqual(t.calls[0], { plugin: 'd93ea4f2-6bb2-4f51-a766-29dbe481c170', action: 'set_thermostat', args: { name: 'Thermostat', room: 'Living room', temperature_f: 74 } });
  assert.equal(result(t).text, 'Thermostat to 74°');
  assert.equal(t.sent.find((m) => m.kind === 1).set, 74);
  t.calls.length = 0; t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(60);
  assert.equal(t.calls[0].args.temperature_f, 70);

  await say(t, 'warmer thermostat', -1);
  assert.equal(t.calls[0].args.temperature_f, 72);
});

test('ambiguous command asks, then runs the picked option', async () => {
  const t = await ready();
  await say(t, 'turn off the lamp', -1);
  const ch = t.sent.filter((m) => m.kind === 6);
  assert.deepEqual(ch.map((m) => [m.idx, m.count, m.name, m.sub]), [[0, 3, 'Lamp', 'Bedroom'], [1, 3, 'Lamp', 'Office'], [2, 3, 'All of them', '2 lights']]);
  assert.equal(ch[0].text, 'Which one?');
  assert.equal(t.calls.length, 0);
  t.handlers.appmessage({ payload: { cmd: 9, idx: 1 } }); await tick(60);
  assert.deepEqual(t.calls.map((c) => c.args), [{ name: 'Lamp', room: 'Office' }]);
  assert.equal(result(t).text, 'Lamp off');
});

test('failures are reported and change nothing', async () => {
  const t = await ready();
  t.fail(() => false);
  await say(t, 'turn off the kitchen lights', -1);
  assert.deepEqual([result(t).ok, result(t).undo], [0, 0]);
  t.fail(null);
  await say(t, 'turn off the bedroom lights', -1);
  assert.equal(result(t).ok, 1);
  // not dimmable
  await say(t, 'dim the kitchen to 20', -1);
  assert.match(result(t).text, /cannot dim/);
  // offline lights are skipped
  const t2 = load(); t2.handlers.ready();
  t2.getSub().onData({ instances: [light('1', 'Lamp', 'Den', true, 50, 'light', false)] }); await tick();
  await say(t2, 'turn off the den lights', -1);
  assert.match(result(t2).text, /offline/i);
});

test('watch buttons: toggle, brightness, room toggle, thermostat set and mode', async () => {
  const t = await ready();
  t.sent.length = 0; t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 1, idx: 3 } }); await tick();          // Ceiling in Living room, on -> off
  assert.deepEqual([t.calls[0].action, t.calls[0].args], ['turn_off', { name: 'Ceiling', room: 'Living room' }]);
  assert.ok(t.sent.some((m) => m.kind === 2 && m.idx === 3 && m.state === 0));

  t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 2, idx: 7, value: 35 } }); await tick();
  assert.deepEqual([t.calls[0].action, t.calls[0].args.brightness_pct], ['set_brightness', 35]);
  t.handlers.appmessage({ payload: { cmd: 2, idx: 2, value: 35 } }); await tick();   // Under cabinet cannot dim
  assert.equal(t.calls.length, 1);

  t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 3, idx: 0 } }); await tick(60);             // Bedroom all off -> turns on
  assert.deepEqual(t.calls.map((c) => c.action), ['turn_on', 'turn_on']);
  t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 3, idx: 0 } }); await tick(60);             // now on -> off
  assert.deepEqual(t.calls.map((c) => c.action), ['turn_off', 'turn_off']);

  t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 5, idx: 2, value: 95 } }); await tick();
  assert.equal(t.calls[0].args.temperature_f, 90);                                   // clamped
  t.handlers.appmessage({ payload: { cmd: 6, idx: 2, value: 1 } }); await tick();
  assert.equal(t.calls[1].args.mode, 'cool');
  t.calls.length = 0;
  t.handlers.appmessage({ payload: { cmd: 5, idx: 0, value: 70 } }); await tick();   // Bedroom has no thermostat
  assert.equal(t.calls.length, 0);
});

test('undo of a brightness change restores the old level', async () => {
  const t = await ready();
  await say(t, 'dim the floor lamp to 10', -1);
  assert.deepEqual(t.calls.map((c) => [c.args.name, c.args.brightness_pct]), [['Floor lamp', 10]]);
  t.calls.length = 0; t.handlers.appmessage({ payload: { cmd: 8 } }); await tick(60);
  assert.deepEqual(t.calls.map((c) => [c.action, c.args.name, c.args.brightness_pct]), [['set_brightness', 'Floor lamp', 80]]);
});

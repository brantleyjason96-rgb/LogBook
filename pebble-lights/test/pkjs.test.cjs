const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const env = (id, p) => ({
  instanceId: id,
  properties: Object.fromEntries(Object.entries(p).map(([k, [shape, v]]) => [k, { [shape]:
    shape === 'shortText' ? { text: v } : { value: v } }])),
});
const light = (id, name, room, on, bright, type = 'light') => env(id, {
  name: ['shortText', name], room: ['shortText', room], type: ['shortText', type],
  on: ['boolean', on], online: ['boolean', true], ...(bright == null ? {} : { brightness: ['numericValue', bright] }),
});

function load() {
  const sent = [], calls = [], handlers = {};
  let sub = null;
  const Pebble = {
    addEventListener: (n, f) => { handlers[n] = f; },
    sendAppMessage: (m, ok) => { sent.push(m); setImmediate(ok); },
    subscribeToSource: (cfg) => { sub = cfg; return { unsubscribe() {} }; },
    invokeAction: (c) => { calls.push(c); return Promise.resolve({ ok: true }); },
  };
  const ctx = { Pebble, console: { log() {} }, setTimeout, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8'), ctx);
  return { sent, calls, handlers, getSub: () => sub, api: ctx.module.exports };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('subscribes to the Google Home device source', () => {
  const t = load(); t.handlers.ready();
  const s = t.getSub();
  assert.equal(s.plugin, 'd93ea4f2-6bb2-4f51-a766-29dbe481c170');
  assert.equal(s.category, 'home'); assert.equal(s.item, 'device');
});

test('keeps lights, drops speakers/locks, sorts by room then name', () => {
  const t = load();
  const out = t.api.parseEnvelope({ instances: [
    light('1', 'Lamp', 'Office', true, 40),
    light('2', 'Ceiling', 'Bedroom', false, 100),
    light('3', 'HomePod', 'Office', true, null, 'speaker'),
    env('4', { name: ['shortText', 'Door'], locked: ['boolean', true] }),
  ] });
  assert.deepEqual(out.map((l) => l.name), ['Ceiling', 'Lamp']);
  assert.equal(out[1].bright, 40); assert.equal(out[0].on, false);
});

test('sends one message per light, then toggles with name+room', async () => {
  const t = load(); t.handlers.ready();
  t.getSub().onData({ instances: [light('1', 'Lamp', 'Office', true, 40)] });
  await tick();
  assert.deepEqual(t.sent[0], { total: 1, idx: 0, name: 'Lamp', room: 'Office', state: 1, bright: 40 });
  t.handlers.appmessage({ payload: { cmd: 1, idx: 0 } });
  await tick();
  assert.deepEqual(t.calls[0].action, 'turn_off');
  assert.deepEqual(t.calls[0].args, { name: 'Lamp', room: 'Office' });
  assert.equal(t.sent[1].state, 0);   // confirmed row goes back to the watch
});

test('brightness is clamped and all-off targets lights', async () => {
  const t = load(); t.handlers.ready();
  t.getSub().onData({ instances: [light('1', 'Lamp', 'Office', true, 40)] });
  t.handlers.appmessage({ payload: { cmd: 2, idx: 0, value: 250 } });
  t.handlers.appmessage({ payload: { cmd: 3 } });
  await tick();
  assert.equal(t.calls[0].action, 'set_brightness'); assert.equal(t.calls[0].args.brightness_pct, 100);
  assert.deepEqual(t.calls[1], { plugin: 'd93ea4f2-6bb2-4f51-a766-29dbe481c170', action: 'turn_off', args: { type: 'light' } });
});

test('reports a status when the plugin errors or there are no lights', async () => {
  const t = load(); t.handlers.ready();
  t.getSub().onError({ code: 'NOT_INSTALLED' });
  await tick();
  assert.match(t.sent[0].status, /NOT_INSTALLED/);
  t.getSub().onData({ instances: [] });
  await tick();
  assert.match(t.sent.at(-1).status, /No lights/);
});

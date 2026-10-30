// -----------------------------------------------------------------------------
// The answers of DriveBC seen live (a box without any event answers 500 with
// code 1008), the pauses of every kind, restarts with a /data that cannot
// tell the last read, and the guarantees the first review found untested.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DriveBcApp } from '../src/app.js';
import { getJson } from '../src/open511.js';
import { createFileStore, createMemoryStore } from '../src/store.js';
import { normalizeConfig } from '../src/config.js';
import { readEvent } from '../src/open511.js';
import { distanceKm } from '../src/geo.js';
import { matchZone } from '../src/zone.js';
import { realClock } from './kit/clock.mjs';
import {
  CAPTURED_AT,
  EMPTY_1008,
  F,
  FIXTURE,
  HOME,
  HOUR,
  MINUTE,
  SECOND,
  THREE_ZONES,
  createApi,
  createdDevices,
  empty1008,
  event,
  html,
  json,
  page,
  published,
  setup,
} from './helpers/setup.js';

const INTERVAL = 5 * MINUTE;

// --- B1: "no event" is HTTP 500 + code 1008 ------------------------------------

test('a zone without any event (live: 500, code 1008) publishes 0 at once, no pause', async () => {
  const api = createApi((url, a) => empty1008(a));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), [0]);
  assert.deepEqual(published(fake, F(1, 'closures')), [0]);
  assert.deepEqual(published(fake, F(1, 'summary')), ['No event']);
  assert.equal(fake.connectionStatus.connected, true);
  assert.match(fake.connectionStatus.message.en, /^Home: 0 event\(s\), 0 closure\(s\), 0 major/);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2, 'next read at the interval: no pause');
});

test('only the exact 1008 signature is "no event": any other 500 is an outage', async () => {
  const run = (response) => getJson('https://x.test/', { fetchImpl: async () => response });
  const r = (body, init = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 500,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  assert.deepEqual(await run(r(EMPTY_1008)).then((a) => [a.ok, a.empty]), [true, true]);
  // A harmless key added later by DriveBC: still "no event".
  const extra = await run(r({ ...EMPTY_1008, request_id: 'abc', events: [] }));
  assert.deepEqual([extra.ok, extra.empty], [true, true]);
  for (const body of [
    { ...EMPTY_1008, error_code: 1009 },
    { ...EMPTY_1008, error_code: '1008' },
    { ...EMPTY_1008, error: 'Database down' },
    [EMPTY_1008],
    '<html>500 Internal Server Error</html>',
    `{"error_code": 1008, "error": "Error processing OP5 event data${' '.repeat(5000)}"}`,
  ]) {
    const answer = await run(r(body));
    assert.equal(answer.kind, 'server', JSON.stringify(body).slice(0, 60));
  }
  // The same body with another status is not "no event" either.
  const other = new Response(JSON.stringify(EMPTY_1008), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal((await run(other)).kind, 'server');
});

test('three zones, the third without any event: published 0, the others as usual', async () => {
  const api = createApi((url, a) => (url.includes('-120.') ? empty1008(a) : page()));
  const { begin, wait, fake } = await setup({ config: THREE_ZONES, api });
  await begin();
  await wait(2 * 12 * SECOND);
  assert.equal(api.calls.length, 3);
  assert.deepEqual(published(fake, F(3, 'events')), [0]);
  assert.equal(published(fake, F(1, 'events')).length, 1);
  assert.equal(fake.connectionStatus.connected, true);
  assert.doesNotMatch(fake.connectionStatus.message.en, /paused|error/);
});

test('a 1008 on the second page ends the list (an exact multiple of 500)', async () => {
  const full = {
    events: Array.from({ length: 500 }, (_, i) =>
      event(`p${i}`, { geography: { type: 'Point', coordinates: [-123.12, 49.283] } }),
    ),
    pagination: { next_url: '/events?offset=500' },
  };
  const api = createApi((url, a) => (url.includes('offset=500') ? empty1008(a) : full));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(12 * SECOND);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(published(fake, F(1, 'events')), [500]);
});

test('a fall from N events to 0 told by a 1008 is published only at the next matching read', async () => {
  let answer = () => page();
  const api = createApi((url, a) => answer(a));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), [9]);
  answer = empty1008;
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(published(fake, F(1, 'events')), [9], 'held');
  assert.equal(fake.connectionStatus.connected, true);
  assert.match(
    fake.connectionStatus.message.en,
    /Home: DriveBC answers "no event" after 9 event\(s\); 0 is published only if the next read says the same/,
  );
  assert.match(fake.connectionStatus.message.fr, /DriveBC répond « aucun événement » après 9/);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 3, 'no extra request: the next scheduled read');
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0]);
  // Back to events, then a single 1008 again: held again.
  answer = () => page();
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0, 9]);
  answer = empty1008;
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0, 9]);
  // A 1008 then a real answer with events: the held 0 is never published.
  answer = () => page();
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0, 9, 9]);
});

test('after a restart, the count Gladys holds decides whether a 1008 is held', async () => {
  const devices = createdDevices(HOME);
  devices[0].features.find((f) => f.external_id === F(1, 'events')).last_value = 4;
  const api = createApi((url, a) => empty1008(a));
  const { begin, wait, fake } = await setup({ api, devices });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), []);
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [0]);
});

test('a 200 answer whose events are all outside the circle publishes 0 at once', async () => {
  let answer = () => page();
  const api = createApi(() => answer());
  const { begin, wait, fake } = await setup({ api });
  await begin();
  answer = () =>
    page(() => [event('far', { geography: { type: 'Point', coordinates: [-122.4, 49.4] } })]);
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0]);
});

// --- I1: a refusal arriving after a config save or a reconnection ----------------

for (const [name, change] of [
  ['a configuration saved', (app) => app.start({ ...HOME, zone1_radius_km: 31 })],
  [
    'a reconnection',
    async (app) => {
      await app.disconnected();
      await app.connected();
    },
  ],
]) {
  test(`a 429 answered after ${name} still pauses the reads`, async () => {
    let first = true;
    const api = createApi(async (url, a) => {
      if (first) {
        first = false;
        await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 3 * SECOND));
        return html(429, a.clock.wall());
      }
      return page();
    });
    const store = createMemoryStore();
    const { app, wait } = await setup({ api, store });
    await app.start(HOME);
    await wait(SECOND);
    await change(app);
    await wait(3 * SECOND);
    assert.ok(app.pausedFor() > 4 * MINUTE, `${app.pausedFor()}`);
    assert.equal(store.data.pause.level429, 1);
    await wait(INTERVAL - 10 * SECOND);
    assert.equal(api.calls.length, 1, 'nothing during the pause');
    await wait(20 * SECOND);
    assert.equal(api.calls.length, 2);
  });
}

// --- I2: the end of a pause on the real clock --------------------------------------

test('real clock x100: the read after a 5 min pause comes at 5 min, not a round later', async () => {
  const clock = realClock({ speed: 100 });
  const times = [];
  const server = createServer((req, res) => {
    times.push(clock.monotonic());
    const status = times.length === 1 ? 429 : 200;
    res.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'text/html' });
    res.end(status === 200 ? JSON.stringify(FIXTURE.body) : '<html>429</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const gladys = createFakeGladys({ selector: 'drivebc', config: HOME });
  await gladys.connect();
  const quiet = () => {};
  const config = { ...HOME, refresh_minutes: 3 };
  const app = new DriveBcApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    apiBase: `http://127.0.0.1:${server.address().port}`,
  });
  try {
    await app.start(config);
    const deadline = performance.now() + 8000;
    while (times.length < 2 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    await app.stop();
    clock.close();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(times.length, 2);
  const gap = times[1] - times[0];
  assert.ok(gap >= 5 * MINUTE * 0.99 && gap < 5.5 * MINUTE, `${Math.round(gap / 1000)} s`);
});

test('a round woken a little before the end of a pause is armed again, not skipped', async () => {
  const { begin, app, api, wait, fake } = await setup();
  await begin();
  await wait(INTERVAL - SECOND);
  app.cancelTimers();
  app.nextDueMono = app.monotonic();
  app.pauseUntilMono = app.monotonic() + 0.8;
  await app.runCycle(app.gen);
  assert.equal(api.calls.length, 1, 'nothing read before the end');
  assert.doesNotMatch(JSON.stringify(fake.connectionStatus), /pause/);
  await wait(10);
  assert.equal(api.calls.length, 2);
});

// --- I3: restarts when /data cannot tell the last attempt -----------------------

async function storm(makeStore, count = 4) {
  let calls = 0;
  let start = CAPTURED_AT;
  for (let i = 0; i < count; i += 1) {
    const api = createApi(() => page());
    const { app, wait } = await setup({ api, store: await makeStore(), start });
    const started = app.start(HOME);
    await wait(0);
    await wait(30 * SECOND);
    await started;
    calls += api.calls.length;
    const stopped = app.stop();
    await wait(3 * SECOND);
    await stopped;
    start += 30 * SECOND;
  }
  return calls;
}

test('restarts every 30 s with an unreadable /data: no read at all', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'drivebc-storm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  await writeFile(file, '{"lastAttemptAt": 17', 'utf8');
  assert.equal(await storm(async () => createFileStore(file)), 0);
});

test('restarts every 30 s with a /data that cannot be written: no read at all', async () => {
  const calls = await storm(async () => {
    const store = createMemoryStore();
    store.failSave = true;
    return store;
  });
  assert.equal(calls, 0);
});

test('restarts every 30 s with a frozen /data: no read at all', async () => {
  const calls = await storm(async () => {
    const store = createMemoryStore();
    store.hold = new Promise(() => {});
    return store;
  });
  assert.equal(calls, 0);
});

test('restarts every 30 s with a writable /data: one read, the first', async () => {
  const store = createMemoryStore();
  assert.equal(await storm(async () => store), 1);
});

// --- I4: a list of unreadable events is not "no event" --------------------------

test('a list made only of unreadable events is never published as 0', async () => {
  const api = createApi(() => ({ events: [null, 1, 'x', [], {}], pagination: { offset: 0 } }));
  const { begin, fake } = await setup({ api });
  await begin();
  assert.equal(fake.states.length, 0);
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(
    fake.connectionStatus.message.en,
    /Home: DriveBC sends events that cannot be read \(its format may have changed\), nothing published; no data yet/,
  );
});

test('a list where most events cannot be read is refused; a few skipped ones are not', async () => {
  const good = page().events.slice(0, 4);
  let events = [...good, {}, {}, {}, {}, {}];
  const api = createApi(() => ({ events, pagination: { offset: 0 } }));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.equal(fake.states.length, 0);
  events = [...good, {}];
  await wait(INTERVAL);
  assert.equal(published(fake, F(1, 'events')).length, 1);
});

// --- Pauses of every kind (I5, M1, M2) --------------------------------------------

test('a 5xx pauses every read: 2 min, then 4, then 8 (own wording)', async () => {
  const api = createApi((url, a) => json({ error: 'x' }, { status: 503, date: a.clock.wall() }));
  const store = createMemoryStore();
  const config = { ...HOME, refresh_minutes: 3 };
  const { begin, wait, fake, clock } = await setup({ api, store, config });
  await begin();
  assert.ok(Math.abs(store.data.pause.until - clock.wall() - 2 * MINUTE) < SECOND);
  assert.match(
    fake.connectionStatus.message.en,
    /^DriveBC server error \(HTTP 503\): reads paused until Oct 29, 14:19 PT\./,
  );
  assert.match(
    fake.connectionStatus.message.fr,
    /^Erreur du serveur DriveBC \(HTTP 503\) : lectures en pause/,
  );
  assert.doesNotMatch(fake.connectionStatus.message.en, /slow down/);
  await wait(3 * MINUTE);
  assert.equal(api.calls.length, 2, 'the interval (3 min) after a 2 min pause');
  await wait(4 * MINUTE - 10);
  assert.equal(api.calls.length, 2, 'second pause: 4 min, longer than the interval');
  await wait(20);
  assert.equal(api.calls.length, 3);
  await wait(8 * MINUTE - 10);
  assert.equal(api.calls.length, 3, 'third pause: 8 min');
  await wait(20);
  assert.equal(api.calls.length, 4);
});

test('a 403 (or 400, 404) is spaced out like a server error, with its own wording', async () => {
  const api = createApi((url, a) => json({}, { status: 403, date: a.clock.wall() }));
  const config = { ...HOME, refresh_minutes: 3 };
  const { begin, wait, fake } = await setup({ api, config });
  await begin();
  assert.match(
    fake.connectionStatus.message.en,
    /^Unexpected answer from DriveBC \(HTTP 403\): reads paused until/,
  );
  await wait(3 * MINUTE + 4 * MINUTE + 8 * MINUTE + 10);
  assert.equal(api.calls.length, 4, '0, 3, 7, 15 min');
});

// --- M3: an absurd server Date --------------------------------------------------

test('a server Date of 1970 is not believed: every active event counts, never 0', async () => {
  const api = createApi(() => json(page(), { date: 60_000 }));
  const { begin, fake } = await setup({ api });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), [11]);
  assert.equal(fake.sceneEvents.length, 0);
});

test('in effect is judged on the server time, not on a skewed local clock', async () => {
  const api = createApi((url, a) => json(page(), { date: CAPTURED_AT + a.clock.elapsed }));
  const { begin, fake } = await setup({ api, wall: { offset: 6 * HOUR } });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), [9]);
});

// --- I5: the other untested guarantees --------------------------------------------

test('at most 20 scene events per zone and per read', async () => {
  let events = [];
  const api = createApi(() => page(() => events));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  events = Array.from({ length: 25 }, (_, i) => event(`n${i}`));
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 20);
});

test('more than 4 full pages: the zone fails, nothing published, the status says why', async () => {
  const full = {
    events: Array.from({ length: 500 }, (_, i) => event(`p${i}`)),
    pagination: { next_url: '/events?offset=500' },
  };
  const api = createApi(() => full);
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(4 * 12 * SECOND);
  assert.equal(api.calls.length, 4);
  assert.equal(fake.states.length, 0);
  assert.match(
    fake.connectionStatus.message.en,
    /More than 2000 events in the zone, reduce its radius/,
  );
});

test('an event exactly on the circle is inside', () => {
  const ev = readEvent(
    event('edge', { geography: { type: 'Point', coordinates: [-123.3, 49.4] } }),
  );
  const center = { latitude: 49.2827, longitude: -123.1207 };
  const radiusKm = distanceKm(center, ev.lines);
  const zone = { slot: 1, ...center, radiusKm, roads: [] };
  assert.equal(matchZone(zone, [ev], CAPTURED_AT).length, 1);
});

test('a JSON body announced as another type is refused', async () => {
  const response = new Response(JSON.stringify({ events: [] }), {
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(
    (await getJson('https://x.test/', { fetchImpl: async () => response })).kind,
    'format',
  );
});

test('configurations saved in a row: the ones superseded meanwhile are never applied', async () => {
  const { app, gladys, wait } = await setup();
  const names = [];
  const publish = gladys.publishDiscoveredDevices.bind(gladys);
  gladys.publishDiscoveredDevices = (devices) => {
    names.push(devices[0]?.name);
    return publish(devices);
  };
  await Promise.all([
    app.start({ ...HOME, zone1_name: 'A' }),
    app.start({ ...HOME, zone1_name: 'B' }),
    app.start({ ...HOME, zone1_name: 'C' }),
  ]);
  await wait(0);
  assert.deepEqual(names, ['A', 'C']);
});

test('a state file over 1 MB is unreadable (and left untouched)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'drivebc-big-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  await writeFile(file, JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }), 'utf8');
  assert.equal(createFileStore(file).load().status, 'unreadable');
});

test('the fingerprint of a zone is salted: two installs never share it', async () => {
  const zone = normalizeConfig(HOME).zones[0];
  const fp = async (salt) => {
    const store = createMemoryStore({ salt });
    const { begin, store: s } = await setup({ store });
    await begin();
    return s.data.zones['1'].fingerprint;
  };
  const a = await fp('a'.repeat(32));
  const b = await fp('b'.repeat(32));
  assert.notEqual(a, b);
  const unsalted = createHash('sha256')
    .update(JSON.stringify(['', zone.latitude, zone.longitude, zone.radiusKm, zone.roads]))
    .digest('hex')
    .slice(0, 32);
  assert.notEqual(a, unsalted);
});

test('a round woken a little before the interval is armed again, never early', async () => {
  const { begin, app, api, wait } = await setup();
  await begin();
  await wait(INTERVAL - SECOND);
  app.cancelTimers();
  app.nextDueMono = app.monotonic() + 0.8;
  await app.runCycle(app.gen);
  assert.equal(api.calls.length, 1);
  await wait(10);
  assert.equal(api.calls.length, 2);
});

test('restarts with a readable but read-only /data holding an old attempt: no read at once', async () => {
  const calls = await storm(async () => {
    const store = createMemoryStore({ lastAttemptAt: CAPTURED_AT - HOUR });
    store.failSave = true;
    return store;
  });
  assert.equal(calls, 0);
});

test('a pause started by the first zone is said at once; the other zones are not asked', async () => {
  const api = createApi((url, a) => html(429, a.clock.wall()));
  const { begin, wait, fake } = await setup({ config: THREE_ZONES, api });
  await begin();
  await wait(SECOND);
  assert.equal(api.calls.length, 1);
  assert.match(fake.connectionStatus.message.en, /DriveBC zone 2: not read \(pause\)/);
  assert.match(fake.connectionStatus.message.en, /DriveBC zone 3: not read \(pause\)/);
});

test('a page holding more events than the API ever sends is refused', async () => {
  const api = createApi(() => ({
    events: Array.from({ length: 551 }, (_, i) => event(`x${i}`)),
    pagination: { offset: 0 },
  }));
  const { begin, fake } = await setup({ api });
  await begin();
  assert.equal(fake.states.length, 0);
  assert.match(fake.connectionStatus.message.en, /DriveBC answer not readable/);
});

test('a failing zone logs and says no coordinate', async () => {
  const api = createApi(() => 'network');
  const config = { ...HOME, zone1_latitude: 49.123456, zone1_longitude: -123.654321 };
  const { begin, lines, fake } = await setup({ api, config });
  await begin();
  assert.ok(lines.some((line) => /read failed/.test(line)));
  assert.doesNotMatch(JSON.stringify([lines, fake.connectionStatuses]), /49\.123456|123\.654321/);
});

// --- Review r2 ----------------------------------------------------------------

test('with /data unreadable, a config saved again or a reconnection after the first round never reads at once', async () => {
  const store = createMemoryStore(undefined, { status: 'unreadable' });
  const { app, api, wait } = await setup({ store });
  await app.connected();
  await wait(0);
  await wait(3 * MINUTE + 10);
  assert.equal(api.calls.length, 1);
  const first = api.calls[0].at;
  await wait(20 * SECOND);
  await app.start({ ...HOME });
  await wait(10 * SECOND);
  await app.disconnected();
  await app.connected();
  await wait(0);
  await wait(INTERVAL - 31 * SECOND);
  assert.equal(api.calls.length, 1, 'no read before the interval from the first round');
  await wait(2 * SECOND);
  assert.equal(api.calls.length, 2);
  assert.ok(api.calls[1].at - first >= INTERVAL);
});

test('a server Date 23 h off is believed, 25 h off is not', async () => {
  const count = async (offset) => {
    const api = createApi(() => json(page(), { date: CAPTURED_AT + offset }));
    const { begin, fake } = await setup({ api });
    await begin();
    return published(fake, F(1, 'events'))[0];
  };
  const zone = normalizeConfig(HOME).zones[0];
  const events = page().events.map(readEvent).filter(Boolean);
  const at23 = matchZone(zone, events, CAPTURED_AT + 23 * HOUR).length;
  const unknown = matchZone(zone, events, null).length;
  assert.notEqual(at23, unknown, 'the fixture tells them apart');
  assert.equal(await count(23 * HOUR), at23);
  assert.equal(await count(-23 * HOUR), matchZone(zone, events, CAPTURED_AT - 23 * HOUR).length);
  assert.equal(await count(25 * HOUR), unknown);
  assert.equal(await count(-25 * HOUR), unknown);
});

test('exactly half of the events unreadable: the readable half is published', async () => {
  const good = page().events.slice(0, 4);
  const api = createApi(() => ({ events: [...good, {}, {}, {}, {}], pagination: { offset: 0 } }));
  const { begin, fake } = await setup({ api });
  await begin();
  assert.equal(published(fake, F(1, 'events')).length, 1);
});

test('a single unreadable event in a quiet zone: said in the status, no pause, read at the interval', async () => {
  const api = createApi(() => ({ events: [{ id: 'drivebc.ca/X' }], pagination: { offset: 0 } }));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.equal(fake.states.length, 0);
  assert.match(fake.connectionStatus.message.en, /DriveBC sends events that cannot be read/);
  assert.doesNotMatch(fake.connectionStatus.message.en, /paused/);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2);
});

test('a zone moved while a fall to 0 is held starts afresh (no 0 published from the old area)', async () => {
  const devices = createdDevices(HOME);
  devices[0].features.find((f) => f.external_id === F(1, 'events')).last_value = 9;
  let answer = () => page();
  const api = createApi((url, a) => answer(a));
  const { begin, wait, fake, app } = await setup({ api, devices });
  await begin();
  answer = empty1008;
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9], 'held');
  await app.start({ ...HOME, zone1_radius_km: 29 });
  await wait(12 * SECOND);
  assert.equal(api.calls.length, 3);
  // The moved zone knows only the count Gladys holds (9): a new hold.
  assert.deepEqual(published(fake, F(1, 'events')), [9]);
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [9, 0]);
});

test('a held fall to 0 older than 2 h is said stale', async () => {
  let answer = () => page();
  const api = createApi((url, a) => answer(a));
  const { begin, wait, app } = await setup({ api });
  await begin();
  answer = empty1008;
  await wait(INTERVAL);
  await app.stop();
  await wait(2 * HOUR + MINUTE);
  const { connected, message } = app.composeStatus();
  assert.equal(connected, false);
  assert.match(
    message.en,
    /0 is published only if the next read says the same, read .* \(stale, over 2 h\)\./,
  );
});

test('a round woken before its due time is armed again with a 5 ms margin', async () => {
  const { begin, app, wait } = await setup();
  await begin();
  await wait(INTERVAL - SECOND);
  app.cancelTimers();
  const delays = [];
  const schedule = app.scheduleCycle.bind(app);
  app.scheduleCycle = (delay, gen) => {
    delays.push(delay);
    return schedule(delay, gen);
  };
  app.nextDueMono = app.monotonic() + 0.8;
  await app.runCycle(app.gen);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 5 && delays[0] < 6, `${delays[0]}`);
});

test('distances are great-circle ones in every direction, 300 km at 60° N', () => {
  // The exact destination 300 km away at a 60° bearing (spherical formula).
  const R = 6371.0088;
  const d = 300 / R;
  const b = (60 * Math.PI) / 180;
  const lat1 = (60 * Math.PI) / 180;
  const lon1 = (-130 * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  const km = distanceKm({ latitude: 60, longitude: -130 }, [
    [[(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]],
  ]);
  assert.ok(Math.abs(km - 300) < 0.01, `${km}`);
});

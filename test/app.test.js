// -----------------------------------------------------------------------------
// The app on the virtual clock against a scripted DriveBC: pace, pauses,
// restart, status, publication and the scene trigger.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUEST_GAP, REQUEST_TIMEOUT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  CAPTURED_AT,
  F,
  HOME,
  HOUR,
  MINUTE,
  SECOND,
  THREE_ZONES,
  createApi,
  event,
  html,
  json,
  page,
  published,
  setup,
} from './helpers/setup.js';

const INTERVAL = 5 * MINUTE;
const status = (fake) => fake.connectionStatus;

test('the first read comes at once and publishes the counts and the summary', async () => {
  const { fake, begin, api } = await setup();
  await begin();
  assert.equal(api.calls.length, 1);
  assert.deepEqual(published(fake, F(1, 'events')), [9]);
  assert.deepEqual(published(fake, F(1, 'closures')), [1]);
  assert.deepEqual(published(fake, F(1, 'major')), [3]);
  const [text] = published(fake, F(1, 'summary'));
  assert.match(text, /^9 events · /);
  // The summary goes as a text, never as a number.
  const summaryState = fake.states.find((s) => s.device_feature_external_id === F(1, 'summary'));
  assert.equal(summaryState.state, undefined);
  assert.equal(status(fake).connected, true);
  assert.match(
    status(fake).message.en,
    /^Home: 9 event\(s\), 1 closure\(s\), 3 major, read Oct 29, 14:17 PT\. Next read Oct 29, 14:22 PT\.$/,
  );
  assert.match(
    status(fake).message.fr,
    /^Home : 9 événement\(s\), 1 fermeture\(s\), 3 majeur\(s\), lu 29 oct\., 14 h 17 \(heure du Pacifique\)\./,
  );
});

test('a zone not created in Gladys is read but nothing is published for it', async () => {
  const { fake, begin, api } = await setup({ created: false });
  await begin();
  assert.equal(api.calls.length, 1);
  assert.equal(fake.states.length, 0);
  assert.equal(fake.discoveredDevices.length, 1);
});

test('the period: reads at 0, the interval, twice the interval; never sooner', async () => {
  const { begin, api, wait, fake, app } = await setup();
  await begin();
  await wait(INTERVAL - 1);
  assert.equal(api.calls.length, 1, 'never before the interval');
  await wait(1);
  assert.equal(api.calls.length, 2);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 3);
  assert.deepEqual(
    api.calls.map((c) => Math.round(c.at)),
    [0, INTERVAL, 2 * INTERVAL],
  );
  // Discovery and the test button never read.
  await fake.scanRequest();
  app.testConnection();
  await wait(INTERVAL - 1);
  assert.equal(api.calls.length, 3);
});

test('a slow DriveBC never shortens nor stretches the period (measured from the round start)', async () => {
  const api = createApi(async (url, a) => {
    await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 20 * SECOND));
    return page();
  });
  const { begin, wait } = await setup({ api });
  await begin();
  await wait(INTERVAL * 2 + 21 * SECOND);
  assert.deepEqual(
    api.calls.map((c) => Math.round(c.at)),
    [0, INTERVAL, 2 * INTERVAL],
  );
});

test('three zones: one request at a time, 12 s at least between two starts', async () => {
  const api = createApi(async (url, a) => {
    // The second answer is slow: the third request waits for it.
    if (a.calls.length === 2)
      await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 25 * SECOND));
    return page();
  });
  const { begin, wait, fake } = await setup({ config: THREE_ZONES, api });
  await begin();
  await wait(2 * MINUTE);
  assert.equal(api.calls.length, 3);
  assert.equal(api.peak, 1, 'never two requests at once');
  const at = api.calls.map((c) => c.at);
  assert.ok(at[1] - at[0] >= REQUEST_GAP, `${at}`);
  assert.ok(at[2] - at[1] >= 25 * SECOND, `${at}`);
  assert.equal(fake.connectionStatus.connected, true);
  // The second round respects the interval from the first round start.
  await wait(INTERVAL - 2 * MINUTE - 1);
  assert.equal(api.calls.length, 3);
  await wait(1);
  assert.equal(api.calls.length, 4);
});

test('a restart never reads sooner than the interval (time of the last attempt in /data)', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.begin();
  assert.ok(store.data.lastAttemptAt > 0, 'written before the read');
  await first.app.stop();

  const second = await setup({ store, start: CAPTURED_AT + MINUTE });
  await second.begin();
  assert.equal(second.api.calls.length, 0);
  assert.equal(second.fake.states.length, 0, 'nothing stale published at start');
  assert.match(
    second.fake.connectionStatus.message.en,
    /Home: no read yet\. Next read Oct 29, 14:22 PT\./,
  );
  await second.wait(4 * MINUTE - 1);
  assert.equal(second.api.calls.length, 0);
  await second.wait(10);
  assert.equal(second.api.calls.length, 1);
});

test('a date of /data in the future is not believed: the first read waits 3 min after the start', async () => {
  const store = createMemoryStore({ lastAttemptAt: CAPTURED_AT + HOUR });
  const { begin, api, wait, fake } = await setup({ store });
  await begin();
  assert.equal(api.calls.length, 0);
  assert.match(
    fake.connectionStatus.message.en,
    /\/data does not tell when DriveBC was last read: the first read waits 3 min/,
  );
  await wait(3 * MINUTE - 10);
  assert.equal(api.calls.length, 0);
  await wait(20);
  assert.equal(api.calls.length, 1);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2, 'then the interval');
});

test('the attempt time is saved before the request', async () => {
  const store = createMemoryStore();
  let savedBefore = null;
  const api = createApi(() => {
    savedBefore ??= store.data?.lastAttemptAt ?? 0;
    return page();
  });
  const { begin } = await setup({ store, api });
  await begin();
  assert.ok(savedBefore > 0);
});

test('a configuration saved unchanged reads no sooner; a moved zone reads at once', async () => {
  const { begin, api, wait, app } = await setup();
  await begin();
  await wait(MINUTE);
  await app.start({ ...HOME });
  await wait(0);
  assert.equal(api.calls.length, 1, 'unchanged: no read');
  await wait(INTERVAL - MINUTE);
  assert.equal(api.calls.length, 2, 'the period kept');
  await app.start({ ...HOME, zone1_latitude: 49.3 });
  await wait(REQUEST_GAP);
  assert.equal(api.calls.length, 3, 'moved: read at once, after the 12 s gap');
});

test('configurations saved in a row apply one after the other, the last one winning', async () => {
  const api = createApi(() => page());
  const { app, wait, fake } = await setup({ api });
  const a = app.start({ ...HOME, zone1_name: 'A' });
  const b = app.start({ ...HOME, zone1_name: 'B' });
  const c = app.start({ ...HOME, zone1_name: 'C', language: 'fr' });
  await Promise.all([a, b, c]);
  await wait(0);
  assert.equal(fake.discoveredDevices[0].name, 'C');
  assert.equal(api.calls.length, 1, 'one read, for the last configuration');
  await wait(0);
  assert.match(published(fake, F(1, 'summary'))[0], /^9 événements/);
});

test('getConfig() failing on a connection is retried, spaced out, forever; then it starts', async () => {
  const { app, gladys, fake, wait, api } = await setup();
  const real = gladys.getConfig.bind(gladys);
  let failures = 4;
  gladys.getConfig = async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('Gladys busy');
    }
    return real();
  };
  const connected = app.connected();
  await wait(0);
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(
    fake.connectionStatus.message.en,
    /configuration could not be read from Gladys; next try in 5 s/,
  );
  await wait(5 * SECOND);
  assert.match(fake.connectionStatus.message.en, /next try in 10 s/);
  await wait(10 * SECOND);
  assert.match(fake.connectionStatus.message.en, /next try in 20 s/);
  await wait(20 * SECOND);
  assert.match(fake.connectionStatus.message.en, /next try in 40 s/);
  assert.equal(api.calls.length, 0);
  await wait(40 * SECOND);
  await connected;
  await wait(0);
  assert.equal(api.calls.length, 1);
  assert.equal(fake.connectionStatus.connected, true);
});

test('a disconnection stops the config retries and the reads; a reconnection never reads sooner', async () => {
  const { app, gladys, wait, api } = await setup();
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    throw new Error('down');
  };
  app.connected();
  await wait(0);
  await app.disconnected();
  await wait(HOUR);
  assert.equal(calls, 1);
  delete gladys.getConfig;
  await app.connected();
  await wait(0);
  assert.equal(api.calls.length, 1);
  await app.disconnected();
  await app.connected();
  await wait(0);
  assert.equal(api.calls.length, 1, 'a reconnection is not a read');
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2);
});

test('a 429 pauses every read (5 min, doubled), kept in /data across a restart', async () => {
  let limited = true;
  const api = createApi((url, a) => (limited ? html(429, a.clock.wall()) : page()));
  const store = createMemoryStore();
  const { begin, wait, fake, app } = await setup({ config: THREE_ZONES, api, store });
  await begin();
  await wait(MINUTE);
  assert.equal(api.calls.length, 1, 'the other zones are not asked during the pause');
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(
    fake.connectionStatus.message.en,
    /DriveBC asked to slow down \(429\): reads paused until Oct 29, 14:22 PT\./,
  );
  assert.match(
    fake.connectionStatus.message.en,
    /DriveBC zone 2: not read \(pause\); no data yet\./,
  );
  assert.ok(store.data.pause.until > CAPTURED_AT);
  await wait(INTERVAL - MINUTE);
  assert.equal(api.calls.length, 2, 'retried at the end of the pause');
  await wait(9 * MINUTE);
  assert.equal(api.calls.length, 2, 'second pause: 10 min');
  await app.stop();

  // Restart during the pause: still paused.
  const second = await setup({ config: THREE_ZONES, api, store, start: api.clock.wall() });
  await second.begin();
  assert.equal(api.calls.length, 2);
  limited = false;
  await second.wait(MINUTE);
  assert.equal(api.calls.length, 3);
  await second.wait(2 * REQUEST_GAP);
  assert.equal(api.calls.length, 5);
  assert.equal(second.fake.connectionStatus.connected, true);
  assert.equal(store.data.pause.level429, 0, 'a success resets the doubling');
});

test('a 5xx pauses for 2 min (doubled); Retry-After is honored, bounded to 6 h', async () => {
  let answer = (a) => json({ error: 'x' }, { status: 503, date: a.clock.wall() });
  const api = createApi((url, a) => answer(a));
  const { begin, wait } = await setup({ api });
  await begin();
  await wait(2 * MINUTE - 1);
  assert.equal(api.calls.length, 1);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2, 'next read at the interval (longer than the pause)');
  answer = (a) => html(429, a.clock.wall(), { 'retry-after': String(100 * 3600) });
  await wait(INTERVAL);
  assert.equal(api.calls.length, 3, 'third read at 10 min, answered 429 with a 100 h Retry-After');
  await wait(6 * HOUR - 2 * MINUTE - 10);
  assert.equal(api.calls.length, 3);
  await wait(20);
  assert.equal(api.calls.length, 4, 'six hours at most');
});

test('a failed read publishes nothing; the status says where each zone stands', async () => {
  let fail = false;
  const api = createApi((url) => {
    if (fail && url.includes('-121.')) return 'network';
    return page();
  });
  const config = { ...HOME, zone2_name: 'Hope', zone2_latitude: 49.38, zone2_longitude: -121.44 };
  const { begin, wait, fake } = await setup({ config, api });
  await begin();
  await wait(REQUEST_GAP);
  const before = fake.states.length;
  fail = true;
  await wait(INTERVAL);
  await wait(REQUEST_GAP);
  const zone2After = fake.states
    .slice(before)
    .filter((s) => s.device_feature_external_id.includes(':zone:2:'));
  assert.equal(zone2After.length, 0, 'nothing published for the failing zone');
  assert.equal(fake.connectionStatus.connected, true, 'one zone still read');
  assert.match(
    fake.connectionStatus.message.en,
    /Hope: DriveBC could not be reached; last data Oct 29, 14:17 PT, nothing published since\./,
  );
  // Over 2 h without success: said stale.
  await wait(2 * HOUR + INTERVAL);
  assert.match(
    fake.connectionStatus.message.en,
    /Hope: DriveBC could not be reached; last data Oct 29, 14:17 PT, stale, nothing/,
  );
  assert.match(
    fake.connectionStatus.message.fr,
    /Hope : DriveBC injoignable ; dernières données 29 oct\., 14 h 17 \(heure du Pacifique\), périmées/,
  );
});

test('every zone failing is not "connected"', async () => {
  const api = createApi(() => 'network');
  const { begin, fake } = await setup({ api });
  await begin();
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(
    fake.connectionStatus.message.en,
    /^Home: DriveBC could not be reached; no data yet\./,
  );
  assert.equal(fake.states.length, 0);
});

test('a request that never answers is cut at 30 s and the next zone goes on', async () => {
  const api = createApi((url) => (url.includes('-121.') ? page() : 'timeout'));
  const config = { ...HOME, zone2_latitude: 49.38, zone2_longitude: -121.44 };
  const { begin, wait, fake } = await setup({ config, api });
  await begin();
  await wait(REQUEST_TIMEOUT);
  await wait(0);
  assert.equal(api.calls.length, 2);
  assert.match(
    fake.connectionStatus.message.en,
    /Home: DriveBC did not answer in time; no data yet\./,
  );
  assert.deepEqual(published(fake, F(2, 'events')).length, 1);
});

test('pages: a full page is followed (12 s later); a failing page fails the zone, no partial count', async () => {
  const full = () => ({
    events: Array.from({ length: 500 }, (_, i) =>
      event(`p${i}`, { geography: { type: 'Point', coordinates: [-121.44, 49.38] } }),
    ),
    pagination: { next_url: '/events?offset=500' },
  });
  let second = (a) =>
    json({ events: [event('last')], pagination: { offset: '500' } }, { date: a.clock.wall() });
  const api = createApi((url, a) => (url.includes('offset=500') ? second(a) : full(a)));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(REQUEST_GAP);
  assert.equal(api.calls.length, 2);
  assert.ok(api.calls[1].at - api.calls[0].at >= REQUEST_GAP);
  assert.deepEqual(published(fake, F(1, 'events')), [1]);
  second = () => 'network';
  await wait(INTERVAL);
  await wait(REQUEST_GAP);
  assert.equal(api.calls.length, 4);
  assert.deepEqual(published(fake, F(1, 'events')), [1], 'nothing published from half a zone');
});

test('the scene trigger: first read learns, a new fresh event fires once, an old one never', async () => {
  let events = [
    event('old', {
      created: '2026-10-20T10:00:00-07:00',
      updated: '2026-10-20T10:00:00-07:00',
      schedule: { intervals: ['2026-10-20T17:00/'] },
    }),
  ];
  const api = createApi(() => page(() => events));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.equal(fake.sceneEvents.length, 0, 'the first read only learns');
  events = [
    ...events,
    event('new'),
    event('stale', {
      id: 'drivebc.ca/TEST-stale',
      created: '2026-10-27T10:00:00-07:00',
      updated: '2026-10-27T10:00:00-07:00',
      schedule: { intervals: ['2026-10-27T17:00/'] },
    }),
    event('later', { schedule: { intervals: ['2026-10-30T17:00/'] } }),
  ];
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 1);
  assert.deepEqual(fake.sceneEvents[0], {
    key: 'new_event',
    data: {
      device: 'ext:drivebc:zone:1',
      event_id: 'drivebc.ca/TEST-new',
      event_type: 'INCIDENT',
      severity: 'MAJOR',
      closed: true,
      road: 'Highway 99',
      headline: 'INCIDENT',
      description: 'Test event new.',
      distance_km: 0.1,
      delay_minutes: 20,
    },
  });
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 1, 'never twice');
});

test('a planned event starting now is announced when it comes into effect', async () => {
  const planned = event('planned', {
    created: '2026-10-01T10:00:00-07:00',
    updated: '2026-10-01T10:00:00-07:00',
    schedule: { intervals: ['2026-10-29T21:20/2026-10-29T23:00'] },
  });
  const api = createApi(() => page(() => [planned]));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.deepEqual(published(fake, F(1, 'events')), [0]);
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [0, 1]);
  assert.equal(fake.sceneEvents.length, 1);
});

test('no scene event without a readable server time, nor after a moved zone', async () => {
  let events = [];
  let date = true;
  const api = createApi((url, a) =>
    json(
      page(() => events),
      { date: date ? a.clock.wall() : null },
    ),
  );
  const { begin, wait, fake, app } = await setup({ api });
  await begin();
  date = false;
  // Even an event whose times would look fresh against a missing time (0).
  events = [
    event('a'),
    event('epoch', { created: '1970-01-01T00:01:00Z', updated: '1970-01-01T00:01:00Z' }),
  ];
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 0, 'no Date header: nothing said new');
  date = true;
  await app.start({ ...HOME, zone1_radius_km: 31 });
  events = [event('a'), event('b')];
  await wait(REQUEST_GAP);
  assert.equal(fake.sceneEvents.length, 0, 'a moved zone starts a new baseline');
});

test('an unreadable /data is never overwritten; the app runs from memory and says so', async () => {
  const store = createMemoryStore(undefined, { status: 'unreadable' });
  const { begin, fake, wait, api } = await setup({ store });
  await begin();
  assert.equal(api.calls.length, 0, 'never at once: /data cannot tell the last read');
  await wait(3 * MINUTE + 10);
  assert.equal(api.calls.length, 1);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2);
  assert.equal(store.saves, 0);
  assert.match(
    fake.connectionStatus.message.en,
    /state file of \/data is unreadable: left untouched/,
  );
  assert.equal(fake.sceneEvents.length, 0);
});

test('a failing or frozen /data never holds the reads back', async () => {
  const store = createMemoryStore();
  store.failSave = true;
  const { begin, wait, api, fake } = await setup({ store });
  await begin();
  assert.equal(api.calls.length, 0, 'a /data that cannot be written: no read at once');
  await wait(3 * MINUTE + 10);
  assert.equal(api.calls.length, 1);
  assert.match(
    fake.connectionStatus.message.en,
    /could not be written in \/data: a restart may read sooner/,
  );
  store.failSave = false;
  store.hold = new Promise(() => {});
  await wait(INTERVAL);
  await wait(2 * SECOND);
  assert.equal(api.calls.length, 2);
  await wait(INTERVAL + 2 * SECOND);
  await wait(2 * SECOND);
  assert.equal(api.calls.length, 3, 'a frozen save never stops the next rounds');
});

test('/data holds no coordinates in clear; logs and status neither', async () => {
  const store = createMemoryStore();
  const config = { ...HOME, zone1_latitude: 49.123456, zone1_longitude: -123.654321 };
  const { begin, lines, fake } = await setup({ store, config });
  await begin();
  const text = JSON.stringify([store.data, lines, fake.connectionStatuses]);
  assert.doesNotMatch(text, /49\.123456|123\.654321/);
  assert.match(store.data.zones['1'].fingerprint, /^[0-9a-f]{32}$/);
  assert.match(store.data.salt, /^[0-9a-f]{32}$/);
});

test('no valid zone: no read, the status names the field', async () => {
  const { begin, fake, api } = await setup({
    config: { zone1_latitude: 45, zone1_longitude: -73 },
  });
  await begin();
  assert.equal(api.calls.length, 0);
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(
    fake.connectionStatus.message.en,
    /No valid zone.*Field zone1_latitude places the zone outside British Columbia/,
  );
});

test('the test button tells the last read and the next, without reading', async () => {
  const { begin, app, api } = await setup();
  await begin();
  const message = app.testConnection();
  assert.equal(api.calls.length, 1);
  assert.match(message.en, /Home: 9 event\(s\).*Next read Oct 29, 14:22 PT\./);
  assert.match(message.fr, /Prochaine lecture 29 oct\., 14 h 22/);
});

test('Discovery publishes the zones, no feature with options, nothing writable', async () => {
  const { fake, begin } = await setup({ config: THREE_ZONES });
  await begin();
  await fake.scanRequest();
  const devices = fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.external_id),
    ['ext:drivebc:zone:1', 'ext:drivebc:zone:2', 'ext:drivebc:zone:3'],
  );
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Home', 'DriveBC zone 2', 'DriveBC zone 3'],
  );
  for (const device of devices) {
    assert.equal(device.poll_frequency, undefined);
    for (const feature of device.features) {
      assert.equal(feature.read_only, true);
      assert.notEqual(feature.category, 'switch');
      assert.equal(feature.supported_options, undefined);
      assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max));
    }
  }
});

test('a stop leaves no timer and no read behind', async () => {
  const { begin, app, clock, wait, api } = await setup({ config: THREE_ZONES });
  await begin();
  await app.stop();
  assert.equal(clock.pending, 0);
  await wait(HOUR);
  assert.equal(api.calls.length, 1);
});

test('a reconnection republishes the status, even unchanged', async () => {
  const { app, fake, wait } = await setup();
  await app.connected();
  await wait(0);
  const count = fake.connectionStatuses.length;
  await app.disconnected();
  await app.connected();
  await wait(0);
  assert.ok(fake.connectionStatuses.length > count);
  assert.equal(fake.connectionStatus.connected, true);
});

test('a pause of /data longer than 6 h is invalid: ignored', async () => {
  const store = createMemoryStore({
    pause: { until: CAPTURED_AT + 100 * HOUR, level429: 3, level5xx: 0 },
  });
  const { begin, api } = await setup({ store });
  await begin();
  assert.equal(api.calls.length, 1);
});

test('a successful read older than 2 h is stale: not "connected"', async () => {
  const { begin, app, wait } = await setup();
  await begin();
  assert.equal(app.composeStatus().connected, true);
  await app.stop();
  await wait(2 * HOUR + MINUTE);
  const { connected, message } = app.composeStatus();
  assert.equal(connected, false);
  assert.match(message.en, /^Home: 9 event\(s\).* \(stale, over 2 h\)\./);
});

test('a request still in flight from an older configuration delays the next one', async () => {
  let slow = true;
  const api = createApi(async (url, a) => {
    if (slow) {
      slow = false;
      await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 25 * SECOND));
    }
    return page();
  });
  const { app, wait } = await setup({ api });
  await app.start(HOME);
  await wait(0);
  assert.equal(api.calls.length, 1);
  await app.start({ ...HOME, zone1_latitude: 49.3 });
  await wait(20 * SECOND);
  assert.equal(api.calls.length, 1, 'not while the old one is in flight');
  await wait(10 * SECOND);
  assert.equal(api.calls.length, 2);
  assert.equal(api.peak, 1);
  assert.ok(api.calls[1].at >= 25 * SECOND);
});

// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted DriveBC and a virtual
// clock (gladys-testkit `testClock`: each clock read moves 1 µs, timers fire
// only through `advance`). DriveBC answers through a `world(url, api)`
// function: a JSON body (200), a Response, 'timeout' (never answers), 'network'
// (refused), or a promise of one of them (a slow answer).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DriveBcApp } from '../../src/app.js';
import { normalizeConfig } from '../../src/config.js';
import { buildDevices } from '../../src/devices.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from '../kit/clock.mjs';

export const SELECTOR = 'drivebc';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The real answer captured on 2026-10-29 around Vancouver (trimmed). */
export const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/vancouver.json', import.meta.url), 'utf8'),
);
/** The time of the capture (its `Date` header). */
export const CAPTURED_AT = Date.parse(FIXTURE.date);

export const HOME = {
  zone1_name: 'Home',
  zone1_latitude: 49.2827,
  zone1_longitude: -123.1207,
  zone1_radius_km: 30,
};
export const THREE_ZONES = {
  ...HOME,
  zone2_latitude: 49.38,
  zone2_longitude: -121.44,
  zone2_radius_km: 80,
  zone3_latitude: 50.67,
  zone3_longitude: -120.33,
};

export const F = (slot, key) => `ext:${SELECTOR}:zone:${slot}:${key}`;

/** A copy of the fixture body, with the events changed by `edit`. */
export function page(edit = (events) => events) {
  const body = structuredClone(FIXTURE.body);
  body.events = edit(body.events);
  return body;
}

/** A small event at the Vancouver zone center, in effect around the capture. */
export function event(id, over = {}) {
  return {
    id: `drivebc.ca/TEST-${id}`,
    status: 'ACTIVE',
    headline: 'INCIDENT',
    description: `Test event ${id}.`,
    event_type: 'INCIDENT',
    event_subtypes: ['HAZARD'],
    severity: 'MAJOR',
    created: '2026-10-29T14:00:00-07:00',
    updated: '2026-10-29T14:05:00-07:00',
    schedule: { intervals: ['2026-10-29T21:00/'] },
    geography: { type: 'Point', coordinates: [-123.12, 49.283] },
    roads: [
      {
        name: 'Highway 99',
        from: 'A',
        to: 'B',
        direction: 'BOTH',
        state: 'CLOSED',
        '+delay': '20 minutes',
      },
    ],
    areas: [{ id: 'drivebc.ca/1', name: 'Lower Mainland District' }],
    ...over,
  };
}

export function json(body, { status = 200, date, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(date === null ? {} : { date: new Date(date).toUTCString() }),
      ...headers,
    },
  });
}

export function html(status, date, headers = {}) {
  return new Response('<html><body>429 - Too Many Requests</body></html>', {
    status,
    headers: { 'content-type': 'text/html', date: new Date(date).toUTCString(), ...headers },
  });
}

const abortable = (signal, kind) =>
  new Promise((_, reject) => {
    if (kind === 'network') reject(new TypeError('fetch failed'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

/** A scripted DriveBC: every request is recorded with the virtual time. */
export function createApi(world = () => page()) {
  const api = { world, calls: [], open: 0, peak: 0, clock: null };
  api.fetch = async (url, init) => {
    const call = { url: String(url), init, at: api.clock.elapsed, wall: api.clock.wall() };
    api.calls.push(call);
    api.open += 1;
    api.peak = Math.max(api.peak, api.open);
    try {
      const answer = await api.world(call.url, api, call);
      if (answer === 'timeout' || answer === 'network')
        return await abortable(init?.signal, answer);
      if (answer instanceof Response) return answer;
      return json(answer, { date: api.clock.wall() });
    } finally {
      api.open -= 1;
    }
  };
  return api;
}

/** The devices of a configuration as created by the user in Gladys. */
export function createdDevices(config) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  return buildDevices(gladys, normalizeConfig(config));
}

export async function setup({
  config = HOME,
  store = createMemoryStore(),
  api = createApi(),
  created = true,
  start = CAPTURED_AT,
  wall = { offset: 0 },
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config,
    devices: created ? createdDevices(config) : [],
  });
  await gladys.connect();
  const clock = testClock({ start });
  clock.wall = () => clock.now() + wall.offset;
  api.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new DriveBcApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    now: () => clock.wall(),
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: api.fetch,
  });
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle(10);
  };
  const begin = async (cfg = config) => {
    await app.start(cfg);
    await wait(0);
  };
  return { app, gladys, fake: gladys.fake, clock, store, api, wait, begin, lines, wall };
}

/** The values published for a feature, in order. */
export const published = (fake, id) =>
  fake.states
    .filter((s) => s.device_feature_external_id === id)
    .map((s) => (s.text !== undefined ? s.text : s.state));

// -----------------------------------------------------------------------------
// The app on the REAL moving clock (performance.now, Date.now, setTimeout)
// sped up 20 times, against a real local HTTP server playing DriveBC with the
// captured answer: the rounds really start at the interval (measured on the
// method that decides), the requests of two zones are 12 s apart, the
// timers stay bounded.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DriveBcApp } from '../src/app.js';
import { REQUEST_GAP } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/clock.mjs';
import { FIXTURE, HOME, MINUTE } from './helpers/setup.js';

const SPEED = 20;
const REFRESH = 3;

test('real clock x20: one round per interval, requests 12 s apart, bounded timers', async () => {
  const clock = realClock({ speed: SPEED });
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ at: clock.monotonic(), url: req.url, ua: req.headers['user-agent'] });
    res.writeHead(200, { 'content-type': 'application/json', date: new Date().toUTCString() });
    res.end(JSON.stringify(FIXTURE.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = {
    ...HOME,
    zone2_latitude: 49.38,
    zone2_longitude: -121.44,
    refresh_minutes: REFRESH,
  };
  const gladys = createFakeGladys({ selector: 'drivebc', config });
  await gladys.connect();
  const quiet = () => {};
  const app = new DriveBcApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    apiBase: `http://127.0.0.1:${server.address().port}`,
  });
  const spy = spyOn(app, 'runCycle', clock);
  try {
    await app.start(config);
    const gaps = await measurePeriod(spy, { count: 3, period: REFRESH * MINUTE });
    assert.equal(gaps.length, 2);
  } finally {
    await app.stop();
    clock.close();
    spy.restore();
    await new Promise((resolve) => server.close(resolve));
  }
  // Two zones per round: 12 s (simulated) at least between two starts, as
  // seen by the server (a request of the round before may land late, never early).
  assert.ok(requests.length >= 4, `${requests.length} requests`);
  for (let i = 1; i < requests.length; i += 1) {
    const gap = requests[i].at - requests[i - 1].at;
    assert.ok(gap >= 0.9 * REQUEST_GAP, `gap ${Math.round(gap)} ms`);
  }
  assert.match(requests[0].ua, /^gladys-drivebc\//);
  assert.match(requests[0].url, /^\/events\?format=json&status=ACTIVE&bbox=/);
  assert.ok(clock.timersSet < 40, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

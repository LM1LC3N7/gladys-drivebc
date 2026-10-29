import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_BYTES, REQUEST_TIMEOUT, USER_AGENT } from '../src/constants.js';
import {
  eventsUrl,
  getJson,
  inEffect,
  readDateTime,
  readDelay,
  readEvent,
  readEventsPage,
  readHttpDate,
  readIntervals,
  readRetryAfter,
} from '../src/open511.js';
import { testClock } from './kit/clock.mjs';
import { CAPTURED_AT, FIXTURE, event, html, json } from './helpers/setup.js';

test('dates: an offset is honored; none means UTC (the schedule intervals)', () => {
  assert.equal(readDateTime('2026-09-24T11:02:28-07:00'), Date.UTC(2026, 8, 24, 18, 2, 28));
  assert.equal(readDateTime('2026-09-24T18:02'), Date.UTC(2026, 8, 24, 18, 2));
  assert.equal(readDateTime('2026-09-24T18:02:00Z'), Date.UTC(2026, 8, 24, 18, 2));
  assert.equal(readDateTime('2026-03-08T02:30+0530'), Date.UTC(2026, 2, 7, 21, 0));
  for (const bad of ['2026-02-30T10:00', '2026-09-24T24:00', '2026-09-24', '', 'yesterday', 42]) {
    assert.equal(readDateTime(bad), null, String(bad));
  }
});

test('the event created at 11:02 PDT has its interval starting 18:02: the intervals are UTC', () => {
  // As in the live answer (RIDE-102765, 2026-10-29).
  const raw = event('utc', {
    created: '2026-09-24T11:02:28-07:00',
    schedule: { intervals: ['2026-09-24T18:02/'] },
  });
  const read = readEvent(raw);
  assert.ok(Math.abs(read.intervals[0].start - read.created) < 60_000);
});

test('in effect: inside an interval at the server time; unknown time or schedule = in effect', () => {
  const at = Date.UTC(2026, 9, 29, 21, 17);
  const of = (intervals) => readEvent(event('x', { schedule: { intervals } }));
  assert.equal(inEffect(of(['2026-10-29T15:00/2026-10-29T23:00']), at), true);
  assert.equal(inEffect(of(['2026-10-30T15:00/2026-10-30T23:00']), at), false, 'tomorrow');
  assert.equal(inEffect(of(['2026-10-01T15:00/2026-10-29T21:17']), at), false, 'just ended');
  assert.equal(inEffect(of(['2025-12-01T15:00/']), at), true, 'open end');
  assert.equal(inEffect(of(['2026-10-30T15:00/2026-10-30T23:00']), null), true, 'no server time');
  assert.equal(inEffect(of(['tomorrow/']), at), true, 'unreadable: never expired');
  assert.equal(readIntervals({ intervals: [] }), null);
  assert.equal(readIntervals({ intervals: ['a/b/c'] }), null);
  assert.equal(
    readIntervals({ intervals: ['2026-10-29T15:00/'], recurring_schedules: [{}] }),
    null,
    'a recurring schedule is not read: in effect',
  );
});

test('delays: "20 minutes", "1 hour 30 minutes"; empty or other text is unknown, never 0', () => {
  assert.equal(readDelay('20 minutes'), 20);
  assert.equal(readDelay('1 hour 30 minutes'), 90);
  assert.equal(readDelay('2 hours'), 120);
  assert.equal(readDelay(''), null);
  assert.equal(readDelay('unknown'), null);
  assert.equal(readDelay(undefined), null);
});

test('an event without id, with a control byte in its id, or without a place is skipped', () => {
  assert.equal(readEvent(event('a', { id: '' })), null);
  assert.equal(readEvent(event('a', { id: 'drivebc.ca/1\r\nX' })), null);
  assert.equal(readEvent(event('a', { id: 'x'.repeat(121) })), null);
  assert.equal(readEvent(event('a', { geography: null })), null);
  assert.equal(readEvent(event('a', { geography: { type: 'Polygon', coordinates: [] } })), null);
  assert.equal(
    readEvent(event('a', { geography: { type: 'Point', coordinates: [500, 49] } })),
    null,
  );
  assert.equal(readEvent(['not', 'an', 'object']), null);
  // The help page example: a Point wrapped in a list.
  const wrapped = readEvent(
    event('a', { geography: { type: 'Point', coordinates: [[-123, 49]] } }),
  );
  assert.deepEqual(wrapped.lines, [[[-123, 49]]]);
});

test('texts from the API are bounded and cleaned; unknown enums read as UNKNOWN', () => {
  const read = readEvent(
    event('t', {
      description: `a\u0000b ${'x'.repeat(5000)}`,
      event_type: 'ALIENS',
      severity: 'APOCALYPTIC',
      event_subtypes: ['HAZARD', 'bad value', 7],
    }),
  );
  assert.equal(read.type, 'UNKNOWN');
  assert.equal(read.severity, 'UNKNOWN');
  assert.deepEqual(read.subtypes, ['HAZARD']);
  assert.ok(read.description.length <= 2000);
  assert.ok(!read.description.includes('\u0000'));
});

test('the real answer reads in full; an error envelope or an HTML page is not a list', () => {
  const read = readEventsPage(FIXTURE.body);
  assert.equal(read.events.length, FIXTURE.body.events.length);
  assert.equal(read.skipped, 0);
  assert.equal(read.hasMore, false);
  assert.equal(
    readEventsPage({ error: 'Error processing OP5 event data', error_code: 1008 }),
    null,
  );
  assert.equal(readEventsPage('<html>'), null);
  assert.equal(readEventsPage({ events: new Array(600).fill({}) }), null, 'too many on a page');
});

test('a next page is followed only after a full page announcing it (DriveBC: 500 past the end)', () => {
  const full = {
    events: new Array(500).fill(event('p')),
    pagination: { next_url: '/events?offset=500' },
  };
  assert.equal(readEventsPage(full).hasMore, true);
  assert.equal(readEventsPage({ ...full, pagination: { offset: '0' } }).hasMore, false);
  const short = { events: [event('p')], pagination: { next_url: '/events?offset=1' } };
  assert.equal(readEventsPage(short).hasMore, false);
});

test('the URL: active events in a box, 500 per page, the offset only past the first page', () => {
  const url = new URL(eventsUrl([-123.5, 49, -122.7, 49.5], 0));
  assert.equal(url.origin, 'https://api.open511.gov.bc.ca');
  assert.equal(url.searchParams.get('status'), 'ACTIVE');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('bbox'), '-123.5,49,-122.7,49.5');
  assert.equal(url.searchParams.get('limit'), '500');
  assert.equal(url.searchParams.has('offset'), false);
  assert.equal(new URL(eventsUrl([0, 0, 1, 1], 500)).searchParams.get('offset'), '500');
});

test('HTTP dates and Retry-After', () => {
  assert.equal(readHttpDate(FIXTURE.date), CAPTURED_AT);
  assert.equal(readHttpDate('Thu, 29 Oct 2026 21:17:25 GMT'), Date.UTC(2026, 9, 29, 21, 17, 25));
  assert.equal(readHttpDate('2026-10-29'), null);
  assert.equal(readHttpDate(null), null);
  assert.equal(readRetryAfter('120', null), 120_000);
  assert.equal(readRetryAfter('Thu, 29 Oct 2026 21:27:25 GMT', CAPTURED_AT), 600_000);
  assert.equal(readRetryAfter('Thu, 29 Oct 2026 21:27:25 GMT', null), null);
  assert.equal(readRetryAfter('soon', CAPTURED_AT), null);
});

test('one GET: honest User-Agent, explicit JSON Accept, no redirect followed', async () => {
  let seen;
  const answer = await getJson('https://example.test/events', {
    fetchImpl: async (url, init) => {
      seen = init;
      return json({ events: [] }, { date: CAPTURED_AT });
    },
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.serverDate, CAPTURED_AT);
  assert.equal(seen.headers['User-Agent'], USER_AGENT);
  assert.match(
    USER_AGENT,
    /^gladys-drivebc\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-drivebc\)$/,
  );
  assert.doesNotMatch(USER_AGENT, /Mozilla|Chrome|Safari/);
  assert.equal(seen.headers.Accept, 'application/json');
  assert.equal(seen.redirect, 'error');
  assert.equal(seen.method, 'GET');
});

test('statuses: 429 (DriveBC sends an HTML page), 5xx, 404, HTML in 200, bad JSON', async () => {
  const run = (response) => getJson('https://x.test/', { fetchImpl: async () => response });
  const limited = await run(html(429, CAPTURED_AT, { 'retry-after': '600' }));
  assert.deepEqual(
    [limited.ok, limited.kind, limited.status, limited.retryAfter],
    [false, 'rate', 429, 600_000],
  );
  assert.equal(
    (await run(json({ error: 'x' }, { status: 500, date: CAPTURED_AT }))).kind,
    'server',
  );
  assert.equal((await run(json({}, { status: 404, date: CAPTURED_AT }))).kind, 'http');
  assert.equal((await run(html(200, CAPTURED_AT))).kind, 'format');
  const bad = new Response('{"events": [', { headers: { 'content-type': 'application/json' } });
  assert.equal((await run(bad)).kind, 'format');
  assert.equal((await run(Promise.reject(new TypeError('fetch failed')))).kind, 'network');
});

test('an oversized body is cut before it is read in full', async () => {
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 100) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, { headers: { 'content-type': 'application/json' } });
  const answer = await getJson('https://x.test/', { fetchImpl: async () => response });
  assert.equal(answer.kind, 'too_big');
  assert.ok(pulled <= MAX_BODY_BYTES / chunk.byteLength + 3, `${pulled} chunks read`);
  assert.ok(cancelled, 'the rest is never read');
  // A declared length over the bound is refused without reading.
  const declared = new Response('{}', {
    headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) },
  });
  assert.equal(
    (await getJson('https://x.test/', { fetchImpl: async () => declared })).kind,
    'too_big',
  );
});

test('a request that never answers is cut at 30 s: a timeout', async () => {
  const clock = testClock();
  let aborted = false;
  const pending = getJson('https://x.test/', {
    timers: clock.timers,
    fetchImpl: (url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        }),
      ),
  });
  await clock.advance(REQUEST_TIMEOUT - 1);
  assert.equal(aborted, false);
  await clock.advance(1);
  assert.equal((await pending).kind, 'timeout');
  assert.equal(clock.pending, 0, 'no timer left');
});

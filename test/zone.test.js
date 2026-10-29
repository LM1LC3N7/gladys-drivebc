import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { boundingBox, distanceKm, readGeometry } from '../src/geo.js';
import { readEvent, readEventsPage } from '../src/open511.js';
import { counts, matchZone, summary } from '../src/zone.js';
import { formatTime } from '../src/i18n.js';
import { CAPTURED_AT, FIXTURE, HOME, event } from './helpers/setup.js';

const zoneOf = (raw) => normalizeConfig(raw).zones[0];
const HOME_ZONE = zoneOf(HOME);
const fixtureEvents = () => readEventsPage(FIXTURE.body).events;

test('the box holds the whole circle, even at the edge nearest the pole', () => {
  const zone = { latitude: 59, longitude: -129, radiusKm: 300 };
  const [xmin, ymin, xmax, ymax] = boundingBox(zone);
  for (let bearing = 0; bearing < 360; bearing += 5) {
    // A point at the radius, by the exact spherical formula.
    const R = 6371.0088;
    const d = zone.radiusKm / R;
    const b = (bearing * Math.PI) / 180;
    const lat1 = (zone.latitude * Math.PI) / 180;
    const lon1 = (zone.longitude * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(b) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    const lat = (lat2 * 180) / Math.PI;
    const lon = (lon2 * 180) / Math.PI;
    assert.ok(lon >= xmin && lon <= xmax && lat >= ymin && lat <= ymax, `bearing ${bearing}`);
  }
});

test('distances: a point, and a line passing near the center (not only its ends)', () => {
  const center = { latitude: 49, longitude: -123 };
  const north = distanceKm(center, [[[-123, 50]]]);
  assert.ok(Math.abs(north - 111.195) < 0.1, `${north}`);
  // A line from 1° west to 1° east, 0.1° north: about 11.1 km, its ends ~74 km.
  const line = readGeometry({
    type: 'LineString',
    coordinates: [
      [-124, 49.1],
      [-122, 49.1],
    ],
  });
  const near = distanceKm(center, line);
  assert.ok(Math.abs(near - 11.12) < 0.1, `${near}`);
  assert.deepEqual(
    readGeometry({ type: 'MultiLineString', coordinates: [[[-123, 49]], [[-122, 49]]] }),
    [[[-123, 49]], [[-122, 49]]],
  );
  assert.equal(readGeometry({ type: 'LineString', coordinates: [[-123, 'x']] }), null);
});

test('the real answer around Vancouver at the time of the capture', () => {
  const matches = matchZone(HOME_ZONE, fixtureEvents(), CAPTURED_AT);
  assert.deepEqual(counts(matches), { events: 9, closures: 1, major: 3 });
  // Closures first, then major ones, then by distance.
  assert.equal(matches[0].event.id, 'drivebc.ca/RIDE-102273');
  assert.deepEqual(
    matches.slice(1, 4).map((m) => m.event.severity),
    ['MAJOR', 'MAJOR', 'MAJOR'],
  );
  for (const m of matches) assert.ok(m.distanceKm <= 30);
  // The two closures of the capture planned for later are not in effect yet.
  const ids = matches.map((m) => m.event.id);
  assert.ok(!ids.includes('drivebc.ca/RIDE-103943'));
  assert.ok(!ids.includes('drivebc.ca/RIDE-104744'));
});

test('without a server time, no active event is taken as over', () => {
  assert.equal(matchZone(HOME_ZONE, fixtureEvents(), null).length, 11);
});

test('roads: only the named ones, whatever the case or the "Hwy" spelling', () => {
  const zone = zoneOf({ ...HOME, zone1_roads: 'hwy 99' });
  const matches = matchZone(zone, fixtureEvents(), CAPTURED_AT);
  assert.ok(matches.length > 0);
  for (const m of matches) assert.ok(m.event.roads.some((r) => r.name === 'Highway 99'));
  assert.equal(
    matchZone(zoneOf({ ...HOME, zone1_roads: 'Highway 9' }), fixtureEvents(), CAPTURED_AT).length,
    0,
  );
});

test('archived, duplicated and far events are left out', () => {
  const events = [
    readEvent(event('a')),
    readEvent(event('a')),
    readEvent(event('b', { status: 'ARCHIVED' })),
    readEvent(event('c', { geography: { type: 'Point', coordinates: [-121, 49.2] } })),
  ];
  assert.deepEqual(
    matchZone(HOME_ZONE, events, CAPTURED_AT).map((m) => m.event.id),
    ['drivebc.ca/TEST-a'],
  );
});

test('the summary: in the language chosen, bounded, "no event" when empty (never a 0 measure)', () => {
  const matches = matchZone(HOME_ZONE, fixtureEvents(), CAPTURED_AT);
  const en = summary(matches, 'en');
  assert.match(
    en,
    /^9 events · Other Roads: closed, construction, 12 km · Highway 1: construction \(major\), 6\.9 km/,
  );
  const fr = summary(matches, 'fr');
  assert.match(
    fr,
    /^9 événements · Other Roads: fermée, travaux, 12 km · Highway 1: travaux \(majeur\), 6,9 km/,
  );
  assert.equal(summary([], 'en'), 'No event');
  assert.equal(summary([], 'fr'), 'Aucun événement');
  const many = Array.from({ length: 200 }, (_, i) => readEvent(event(`m${i}`)));
  const long = summary(matchZone(HOME_ZONE, many, CAPTURED_AT), 'en');
  assert.ok([...long].length <= 600, `${long.length}`);
  assert.match(long, /^200 events · .* · \d+ more$/);
  assert.match(
    summary(matchZone(HOME_ZONE, [readEvent(event('d'))], CAPTURED_AT), 'en'),
    /delay 20 min/,
  );
});

test('times are shown in Pacific time, across midnight UTC and the November DST change', () => {
  // November 2026: tzdata 2026e keeps British Columbia on UTC-7 (permanent
  // daylight time), older tzdata falls back to UTC-8. The time shown is the
  // one of the tzdata of the running Node, whichever it is.
  for (const hour of [8, 9, 10]) {
    const at = Date.UTC(2026, 10, 1, hour, 30);
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at);
    assert.equal(formatTime(at, 'en'), `Nov 1, ${local} PT`);
  }
  // Midnight UTC is the afternoon before in Vancouver.
  assert.equal(formatTime(Date.UTC(2026, 9, 30, 0, 0), 'en'), 'Oct 29, 17:00 PT');
  assert.equal(
    formatTime(Date.UTC(2026, 9, 30, 0, 0), 'fr'),
    '29 oct., 17 h 00 (heure du Pacifique)',
  );
  // March: 02:30 does not exist; 10:00 UTC is 03:00 PDT.
  assert.equal(formatTime(Date.UTC(2026, 2, 8, 10, 0), 'en'), 'Mar 8, 03:00 PT');
  assert.equal(formatTime(NaN, 'en'), '?');
});

test('an interval in UTC is in effect across midnight UTC (evening in Vancouver)', () => {
  const night = readEvent(
    event('n', { schedule: { intervals: ['2026-10-29T23:00/2026-10-30T07:00'] } }),
  );
  assert.equal(matchZone(HOME_ZONE, [night], Date.UTC(2026, 9, 30, 0, 30)).length, 1);
  assert.equal(matchZone(HOME_ZONE, [night], Date.UTC(2026, 9, 30, 7, 0)).length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, readNumber, readRoads, roadKey } from '../src/config.js';
import { configErrors } from '../src/i18n.js';

test('numbers are strict: blank is absent (never 0), only plain decimals', () => {
  assert.equal(readNumber(''), null);
  assert.equal(readNumber('   '), null);
  assert.equal(readNumber(null), null);
  assert.equal(readNumber(undefined), null);
  assert.equal(readNumber(' 49.2827 '), 49.2827);
  assert.equal(readNumber('-123.1'), -123.1);
  assert.equal(readNumber(12), 12);
  for (const bad of ['1e3', '0x10', '12,5', 'abc', '1.2.3', Infinity, NaN, true, {}]) {
    assert.ok(Number.isNaN(readNumber(bad)), String(bad));
  }
});

test('zone 1 is required; an empty zone 2 or 3 is off; a half-filled one is an error', () => {
  const none = normalizeConfig({});
  assert.deepEqual(none.zones, []);
  assert.deepEqual(none.errors, [{ slot: 1, field: 'zone1_latitude', code: 'required' }]);

  const config = normalizeConfig({
    zone1_latitude: '49.28',
    zone1_longitude: '-123.12',
    zone2_latitude: '49.5',
  });
  assert.deepEqual(
    config.zones.map((z) => z.slot),
    [1],
  );
  assert.deepEqual(config.errors, [{ slot: 2, field: 'zone2_longitude', code: 'required' }]);
  assert.equal(config.zones[0].radiusKm, 25, 'default radius');
  assert.equal(config.refreshMinutes, 5);
  assert.equal(config.language, 'en');
});

test('a zone outside British Columbia, a radius out of bounds, a bad interval are refused', () => {
  const config = normalizeConfig({
    zone1_latitude: 48.85,
    zone1_longitude: 2.35,
    zone2_latitude: 49.3,
    zone2_longitude: -123.1,
    zone2_radius_km: 301,
    zone3_latitude: 49.3,
    zone3_longitude: -123.1,
    zone3_radius_km: '0',
    refresh_minutes: '2',
    language: 'de',
  });
  assert.deepEqual(config.zones, []);
  assert.deepEqual(
    config.errors.map((e) => `${e.field}:${e.code}`),
    [
      'refresh_minutes:refresh',
      'zone1_latitude:outside_bc',
      'zone2_radius_km:radius',
      'zone3_radius_km:radius',
    ],
  );
  assert.equal(config.refreshMinutes, 5, 'the default is used');
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ refresh_minutes: 4.5 }).errors[0].code, 'refresh');
  assert.equal(normalizeConfig({ refresh_minutes: 60 }).refreshMinutes, 60);
});

test('road names: commas or semicolons, unique ignoring case and "Hwy", bounded', () => {
  assert.deepEqual(readRoads(' Highway 1 ;  hwy 99,Highway  99, ,highway 1'), {
    roads: ['Highway 1', 'hwy 99'],
  });
  assert.equal(roadKey('HWY 99'), roadKey('Highway 99'));
  assert.equal(roadKey('Hwy. 99'), 'highway 99');
  assert.notEqual(roadKey('Highway 9'), roadKey('Highway 99'));
  assert.deepEqual(readRoads(''), { roads: [] });
  assert.deepEqual(readRoads(Array.from({ length: 11 }, (_, i) => `Highway ${i}`).join(',')), {
    error: 'roads_too_many',
  });
  assert.deepEqual(readRoads(`${'x'.repeat(61)}`), { error: 'roads_invalid' });
  assert.deepEqual(readRoads('Highway 1\r\nX-Header: y'), { error: 'roads_invalid' });
});

test('a name with a control byte or over 60 characters is refused', () => {
  const base = { zone1_latitude: 49.3, zone1_longitude: -123.1 };
  assert.equal(
    normalizeConfig({ ...base, zone1_name: 'Home\u0007' }).errors[0].code,
    'name_invalid',
  );
  assert.equal(
    normalizeConfig({ ...base, zone1_name: 'é'.repeat(61) }).errors[0].code,
    'name_invalid',
  );
  assert.equal(
    normalizeConfig({ ...base, zone1_name: 'é'.repeat(60) }).zones[0].name,
    'é'.repeat(60),
  );
  assert.equal(normalizeConfig({ ...base, zone1_name: '  ' }).zones[0].name, null);
});

test('an error names the field, never the value typed (the user home)', () => {
  const config = normalizeConfig({ zone1_latitude: '47.123456', zone1_longitude: '-123.987654' });
  const text = JSON.stringify(configErrors(config.errors));
  assert.match(text, /zone1_latitude/);
  assert.doesNotMatch(text, /47\.123456|123\.987654/);
});

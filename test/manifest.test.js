// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  ACTIONS,
  EVENT_TYPES,
  RADIUS_DEFAULT,
  RADIUS_MAX,
  RADIUS_MIN,
  REFRESH_DEFAULT,
  REFRESH_MAX,
  REFRESH_MIN,
  SCENE_TRIGGER,
  SEVERITIES,
  ZONE_SLOTS,
} from '../src/constants.js';
import { LANGUAGES, normalizeConfig, zoneKeys } from '../src/config.js';
import { buildDevices } from '../src/devices.js';
import { THREE_ZONES } from './helpers/setup.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const dockerfile = read('Dockerfile');
const SEMVER = /^\d+\.\d+\.\d+$/;

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics; one version in the four places, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.version, SEMVER);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-drivebc:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(pkg.name, 'gladys-drivebc');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.match(
    pkg.dependencies['@gladysassistant/integration-sdk'],
    /^\^\d+\.\d+\.\d+$/,
    'never pinned',
  );
  assert.deepEqual(manifest.categories, ['transport']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.gladys_version, '>=5.1.0', 'scene_triggers need 5.1.0');
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-drivebc\//,
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the cover is an 800 x 534 PNG', () => {
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the configuration matches the code; no key prefixed gladys_; no secret', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  const expected = ['intro', 'language', 'refresh_minutes'];
  for (const slot of ZONE_SLOTS) {
    const keys = zoneKeys(slot);
    expected.push(`zone${slot}`, keys.name, keys.latitude, keys.longitude, keys.radius, keys.roads);
    assert.equal(fields[keys.latitude].required, slot === 1);
    assert.equal(fields[keys.longitude].required, slot === 1);
    assert.equal(fields[keys.radius].default, RADIUS_DEFAULT);
    assert.equal(fields[keys.radius].min, RADIUS_MIN);
    assert.equal(fields[keys.radius].max, RADIUS_MAX);
    // The example name is not the key.
    assert.doesNotMatch(fields[keys.name].placeholder.en, /zone\d/);
  }
  assert.deepEqual(Object.keys(fields), expected);
  for (const key of Object.keys(fields)) assert.doesNotMatch(key, /^gladys_/i);
  assert.equal(fields.refresh_minutes.default, REFRESH_DEFAULT);
  assert.equal(fields.refresh_minutes.min, REFRESH_MIN);
  assert.equal(fields.refresh_minutes.max, REFRESH_MAX);
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.ok(!manifest.config_schema.some((f) => ['secret', 'password'].includes(f.type)));
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.ok(!('default' in field));
  }
  for (const link of fields.intro.links) assert.match(link.url, /^https:\/\//);
  // The defaults of the manifest are those of the code.
  const defaults = normalizeConfig({ zone1_latitude: 49.3, zone1_longitude: -123.1 });
  assert.equal(defaults.refreshMinutes, fields.refresh_minutes.default);
  assert.equal(defaults.language, fields.language.default);
});

test('actions, scene trigger and handlers agree; read-only', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(index.includes("on('connected'"));
  assert.ok(index.includes('app.connected()'));
  assert.ok(!index.includes('onSetValue'), 'no command: read-only');
  assert.deepEqual(
    manifest.scene_triggers.map((s) => s.key),
    [SCENE_TRIGGER],
  );
  const trigger = manifest.scene_triggers[0];
  const options = (key) => trigger.fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(new Set(options('event_type')), new Set(EVENT_TYPES));
  assert.deepEqual(new Set(options('severity')), new Set(SEVERITIES));
  assert.equal(trigger.fields.find((f) => f.key === 'device').source, 'devices');
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  for (const file of ['src/open511.js', 'src/app.js']) {
    const code = read(file).replace(/\/\/.*$/gm, '');
    for (const word of ["'POST'", "'PUT'", "'DELETE'", 'Mozilla']) {
      assert.ok(!code.includes(word), `${file}: never ${word}`);
    }
  }
});

test('the scene data keys are declared (variables and fields), at most 30', async () => {
  const { sceneData } = await import('../src/app.js');
  const { readEvent } = await import('../src/open511.js');
  const { event } = await import('./helpers/setup.js');
  const data = sceneData('ext:drivebc:zone:1', { event: readEvent(event('x')), distanceKm: 1 });
  const trigger = manifest.scene_triggers[0];
  const declared = new Set([...trigger.fields, ...trigger.variables].map((f) => f.key));
  for (const key of Object.keys(data)) assert.ok(declared.has(key), key);
  assert.ok(Object.keys(data).length <= 30);
  for (const value of Object.values(data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    assert.notEqual(value, undefined);
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    if (typeof value === 'string') assert.ok(value.length <= 1000);
  }
});

test('the published devices follow the core rules on supported_options (none here)', () => {
  const gladys = createFakeGladys({ selector: 'drivebc' });
  for (const device of buildDevices(gladys, normalizeConfig(THREE_ZONES))) {
    for (const feature of device.features) {
      const options = feature.supported_options ?? [];
      // The rules of the core (normalizeSupportedOptions): label a plain
      // non-empty string without outer spaces, value integer or string,
      // unique, no other key. A single error rejects the whole Discovery.
      const values = new Set();
      for (const option of options) {
        assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
        assert.equal(typeof option.label, 'string');
        assert.ok(option.label.length > 0 && option.label === option.label.trim());
        assert.ok(Number.isInteger(option.value) || typeof option.value === 'string');
        assert.ok(!values.has(String(option.value)));
        values.add(String(option.value));
      }
      assert.equal(options.length, 0);
      assert.equal(feature.read_only, true);
    }
  }
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Open Government Licence/);
  assert.match(notices, /DriveBC/);
});

test('the docs say what the data is not', () => {
  for (const file of ['docs/en.md', 'README.md']) {
    assert.match(read(file), /not an official source/i, file);
    assert.match(read(file), /Open Government Licence/, file);
  }
  assert.match(read('docs/fr.md'), /pas une source officielle/i);
});

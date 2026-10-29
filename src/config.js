// -----------------------------------------------------------------------------
// The configuration filled in by the user, read strictly: an empty field is
// absent (never 0), a number is a plain decimal, a zone outside British
// Columbia or a radius out of bounds is an error named by its field, never
// echoed back (the values are the user's home, kept out of logs and status).
// -----------------------------------------------------------------------------

import {
  BC_ENVELOPE,
  RADIUS_DEFAULT,
  RADIUS_MAX,
  RADIUS_MIN,
  REFRESH_DEFAULT,
  REFRESH_MAX,
  REFRESH_MIN,
  ROADS_MAX,
  ROAD_NAME_MAX,
  ZONE_NAME_MAX,
  ZONE_SLOTS,
} from './constants.js';

export const LANGUAGES = ['en', 'fr'];

// Any control character (C0, DEL, C1): never in a name, a road or a header.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The keys of the fields of a zone (manifest `config_schema`). */
export const zoneKeys = (slot) => ({
  name: `zone${slot}_name`,
  latitude: `zone${slot}_latitude`,
  longitude: `zone${slot}_longitude`,
  radius: `zone${slot}_radius_km`,
  roads: `zone${slot}_roads`,
});

const isBlank = (value) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * A number typed by the user: `null` when blank, `NaN` when not a plain
 * decimal (`Number('')` is 0, `Number('1e3')` 1000: both refused here).
 */
export function readNumber(value) {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  return /^[-+]?\d{1,4}(\.\d{1,12})?$/.test(text) ? Number(text) : NaN;
}

/** A free text: `null` when blank, `undefined` when refused (control byte). */
function readText(value) {
  if (isBlank(value)) return null;
  if (typeof value !== 'string' || CONTROL.test(value)) return undefined;
  return value.trim().replace(/\s+/g, ' ');
}

/** The road names of a zone: comma or semicolon separated, unique, bounded. */
export function readRoads(value) {
  if (isBlank(value)) return { roads: [] };
  if (typeof value !== 'string' || CONTROL.test(value)) return { error: 'roads_invalid' };
  const roads = [];
  const seen = new Set();
  for (const part of value.split(/[,;]/)) {
    const road = part.trim().replace(/\s+/g, ' ');
    if (!road) continue;
    if ([...road].length > ROAD_NAME_MAX) return { error: 'roads_invalid' };
    const key = roadKey(road);
    if (seen.has(key)) continue;
    seen.add(key);
    roads.push(road);
  }
  if (roads.length > ROADS_MAX) return { error: 'roads_too_many' };
  return { roads };
}

/**
 * The comparison key of a road name: case, spaces and the "Hwy" / "Highway"
 * spelling ignored ("hwy 99" = "Highway 99").
 */
export function roadKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^hwy\.?(?= )/, 'highway');
}

function readZone(raw, slot) {
  const keys = zoneKeys(slot);
  const lat = readNumber(raw[keys.latitude]);
  const lon = readNumber(raw[keys.longitude]);
  const errors = [];
  if (lat === null && lon === null) {
    // An empty zone is off; the first one is required.
    return slot === 1 ? { errors: [{ slot, field: keys.latitude, code: 'required' }] } : {};
  }
  if (lat === null || lon === null) {
    errors.push({
      slot,
      field: lat === null ? keys.latitude : keys.longitude,
      code: 'required',
    });
  }
  if (Number.isNaN(lat)) errors.push({ slot, field: keys.latitude, code: 'not_a_number' });
  if (Number.isNaN(lon)) errors.push({ slot, field: keys.longitude, code: 'not_a_number' });
  if (errors.length === 0) {
    const inside =
      lat >= BC_ENVELOPE.minLat &&
      lat <= BC_ENVELOPE.maxLat &&
      lon >= BC_ENVELOPE.minLon &&
      lon <= BC_ENVELOPE.maxLon;
    if (!inside) errors.push({ slot, field: keys.latitude, code: 'outside_bc' });
  }
  let radius = readNumber(raw[keys.radius]);
  if (radius === null) radius = RADIUS_DEFAULT;
  if (Number.isNaN(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX) {
    errors.push({ slot, field: keys.radius, code: 'radius' });
  }
  const roads = readRoads(raw[keys.roads]);
  if (roads.error) errors.push({ slot, field: keys.roads, code: roads.error });
  const name = readText(raw[keys.name]);
  if (name === undefined || (name && [...name].length > ZONE_NAME_MAX)) {
    errors.push({ slot, field: keys.name, code: 'name_invalid' });
  }
  if (errors.length > 0) return { errors };
  return {
    zone: {
      slot,
      name: name || null,
      latitude: lat,
      longitude: lon,
      radiusKm: radius,
      roads: roads.roads,
    },
    errors: [],
  };
}

/**
 * The configuration the app runs with. `zones` holds the valid zones only;
 * `errors` names each refused field (never its value).
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const errors = [];
  const language = LANGUAGES.includes(source.language) ? source.language : 'en';
  let refreshMinutes = readNumber(source.refresh_minutes);
  if (refreshMinutes === null) refreshMinutes = REFRESH_DEFAULT;
  if (
    Number.isNaN(refreshMinutes) ||
    !Number.isInteger(refreshMinutes) ||
    refreshMinutes < REFRESH_MIN ||
    refreshMinutes > REFRESH_MAX
  ) {
    errors.push({ slot: null, field: 'refresh_minutes', code: 'refresh' });
    refreshMinutes = REFRESH_DEFAULT;
  }
  const zones = [];
  for (const slot of ZONE_SLOTS) {
    const result = readZone(source, slot);
    if (result.zone) zones.push(result.zone);
    errors.push(...(result.errors ?? []));
  }
  return { language, refreshMinutes, zones, errors };
}

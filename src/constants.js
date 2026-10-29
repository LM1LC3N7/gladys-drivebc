// -----------------------------------------------------------------------------
// The fixed values of the integration: the DriveBC Open511 API, its pace, the
// bounds of what is read, and the keys shared with the manifest.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The public DriveBC Open511 API (Province of British Columbia), no key. */
export const API_BASE = 'https://api.open511.gov.bc.ca';

/** An honest User-Agent naming the integration, never a browser's. */
export const USER_AGENT = `gladys-drivebc/${pkg.version} (+https://github.com/LM1LC3N7/gladys-drivebc)`;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/**
 * DriveBC throttles its API and its 429 page asks to "space your individual
 * requests by 10 seconds or more": 12 s between the starts of two requests,
 * whatever the zone or the page.
 */
export const REQUEST_GAP = 12 * SECOND;
/** One request never lasts longer (connection, answer and body). */
export const REQUEST_TIMEOUT = 30 * SECOND;
/** A body larger than this is cut before it is read in full (memory bound). */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Events per page (the API maximum) and pages per zone. */
export const PAGE_LIMIT = 500;
export const MAX_PAGES = 4;
/** Points read per geometry; the rest of a longer line is ignored. */
export const MAX_POINTS = 5000;

/** The read interval, in minutes (config `refresh_minutes`). */
export const REFRESH_DEFAULT = 5;
export const REFRESH_MIN = 3;
export const REFRESH_MAX = 60;

/** Pauses after a 429 (rate limit) and a 5xx, doubled each time, bounded. */
export const PAUSE_429_FIRST = 5 * MINUTE;
export const PAUSE_5XX_FIRST = 2 * MINUTE;
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;

/** `getConfig()` failing on a connection: retried forever, spaced out. */
export const CONFIG_RETRY_FIRST = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;

/** An event older than this is never announced as new to the scenes. */
export const FRESH_EVENT = 2 * HOUR;
/** Zone data older than this is said stale in the status. */
export const STALE_AFTER = 2 * HOUR;
/** Event ids remembered per zone (scene trigger), and for how long. */
export const SEEN_MAX = 2000;
export const SEEN_KEEP = 7 * 24 * HOUR;
/** Scene events fired per zone and per read, at most. */
export const SCENE_EVENTS_PER_READ = 20;

/** Watch zones (one Gladys device each). */
export const ZONE_SLOTS = [1, 2, 3];
export const RADIUS_DEFAULT = 25;
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 300;
export const ROADS_MAX = 10;
export const ROAD_NAME_MAX = 60;
export const ZONE_NAME_MAX = 60;
/**
 * The envelope a zone center must be in: British Columbia and its borders
 * (DriveBC has no event elsewhere).
 */
export const BC_ENVELOPE = { minLat: 48, maxLat: 60.5, minLon: -139.5, maxLon: -113.5 };

/** Counts are bounded: never more than the API can return for one zone. */
export const MAX_COUNT = PAGE_LIMIT * MAX_PAGES;
/** The summary text published on the zone device, in characters. */
export const SUMMARY_MAX = 600;
/** The texts handed to a scene (the core accepts 1000 characters). */
export const SCENE_TEXT_MAX = 900;

export const DEVICE_TYPE = 'zone';
export const FEATURES = Object.freeze({
  EVENTS: 'events',
  CLOSURES: 'closures',
  MAJOR: 'major',
  SUMMARY: 'summary',
});

export const ACTIONS = Object.freeze({ TEST: 'test' });
export const SCENE_TRIGGER = 'new_event';

export const EVENT_TYPES = Object.freeze([
  'CONSTRUCTION',
  'SPECIAL_EVENT',
  'INCIDENT',
  'WEATHER_CONDITION',
  'ROAD_CONDITION',
]);
export const SEVERITIES = Object.freeze(['MINOR', 'MODERATE', 'MAJOR', 'UNKNOWN']);

/** The time zone of the jurisdiction (Open511 `jurisdiction` resource). */
export const TIME_ZONE = 'America/Vancouver';

export const STATE_FILE = '/data/drivebc-state.json';

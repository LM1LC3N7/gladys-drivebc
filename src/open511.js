// -----------------------------------------------------------------------------
// The DriveBC Open511 API: one page of events around a zone, read with an
// honest User-Agent, an explicit JSON Accept, a bounded time and a bounded
// body (cut before it is read in full), then each event read strictly into a
// small object. Nothing here retries, waits or keeps state: the app paces the
// requests (one at a time, 12 s apart) and decides.
//
// Format, as documented on https://api.open511.gov.bc.ca/help and checked on
// the live API (2026-10-29): `created` / `updated` carry an offset
// (`2026-09-24T11:02:28-07:00`); the schedule intervals carry none and are
// UTC (`2026-09-24T18:02/` for an event created at 11:02 PDT); a road's
// `+delay` is a text (`"20 minutes"`) or empty; a box without any event, and
// an offset past the last event, answer 500 with `error_code` 1008 (read here
// as an empty list); other filters the API does not understand answer 500 too.
// -----------------------------------------------------------------------------

import {
  API_BASE,
  EVENT_TYPES,
  MAX_BODY_BYTES,
  PAGE_LIMIT,
  REQUEST_TIMEOUT,
  SEVERITIES,
  USER_AGENT,
} from './constants.js';
import { readGeometry } from './geo.js';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_EVENTS_PER_PAGE = PAGE_LIMIT + 50;
const TEXT_MAX = 2000;

/** The URL of one page of the active events inside a box. */
export function eventsUrl(bbox, offset = 0, base = API_BASE) {
  const params = new URLSearchParams({
    format: 'json',
    status: 'ACTIVE',
    bbox: bbox.join(','),
    limit: String(PAGE_LIMIT),
  });
  if (offset > 0) params.set('offset', String(offset));
  return `${base}/events?${params}`;
}

/**
 * One GET. Resolves `{ ok: true, json, serverDate }` or `{ ok: false, kind,
 * status?, retryAfter?, serverDate }`, `kind` among `network`, `timeout`,
 * `rate` (429), `server` (5xx), `http` (other status), `format`, `too_big`.
 * Never throws.
 */
export async function getJson(url, { fetchImpl = fetch, timers = globalThis } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = timers.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    timers.clearTimeout(timer);
    return { ok: false, kind: timedOut ? 'timeout' : 'network', serverDate: null };
  }
  const serverDate = readHttpDate(response.headers.get('date'));
  try {
    if (response.status === 429) {
      return {
        ok: false,
        kind: 'rate',
        status: 429,
        retryAfter: readRetryAfter(response.headers.get('retry-after'), serverDate),
        serverDate,
      };
    }
    // DriveBC answers a box without any event with this exact 500 (checked
    // live on 2026-10-29: a sea box and a land box); any other 500 is an outage.
    if (response.status === 500 && (await isEmptyAnswer(response))) {
      return { ok: true, json: { events: [] }, empty: true, serverDate };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        kind: 'server',
        status: response.status,
        retryAfter: readRetryAfter(response.headers.get('retry-after'), serverDate),
        serverDate,
      };
    }
    if (response.status !== 200) {
      return { ok: false, kind: 'http', status: response.status, serverDate };
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/\bjson\b/i.test(type)) return { ok: false, kind: 'format', status: 200, serverDate };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { ok: false, kind: 'too_big', status: 200, serverDate };
    }
    const text = await readBounded(response);
    if (text === null) return { ok: false, kind: 'too_big', status: 200, serverDate };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: 'format', status: 200, serverDate };
    }
    return { ok: true, json, serverDate };
  } catch {
    return { ok: false, kind: timedOut ? 'timeout' : 'network', serverDate };
  } finally {
    timers.clearTimeout(timer);
    // A body left unread is released, never kept open.
    response.body?.cancel?.().catch?.(() => {});
  }
}

/** The signature of "no event in this box": `{"error": "Error processing OP5 event data...", "error_code": 1008}`. */
export const EMPTY_ERROR_CODE = 1008;
const EMPTY_BODY_MAX = 4096;

async function isEmptyAnswer(response) {
  const text = await readBounded(response, EMPTY_BODY_MAX).catch(() => null);
  if (text === null) return false;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    !!json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    json.error_code === EMPTY_ERROR_CODE &&
    typeof json.error === 'string' &&
    json.error.startsWith('Error processing OP5 event data') &&
    Object.keys(json).length === 2
  );
}

/** The body as text, or `null` past `max` bytes (the rest never read). */
async function readBounded(response, max = MAX_BODY_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/** An HTTP date (`Thu, 29 Oct 2026 21:04:53 GMT`) in ms, or `null`. */
export function readHttpDate(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value.trim())
  ) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** `Retry-After` in ms (seconds or an HTTP date read against the server's). */
export function readRetryAfter(value, serverDate) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d{1,6}$/.test(text)) return Number(text) * 1000;
  const at = readHttpDate(text);
  if (at !== null && serverDate !== null) return Math.max(0, at - serverDate);
  return null;
}

const ISO_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * An Open511 date time in ms, or `null`. Without an offset it is UTC (the
 * DriveBC schedule intervals).
 */
export function readDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_OFFSET.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '0', zone] = match;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== +y ||
    check.getUTCMonth() !== +mo - 1 ||
    check.getUTCDate() !== +d ||
    +h > 23 ||
    +mi > 59 ||
    +s > 59
  ) {
    return null;
  }
  if (!zone || zone === 'Z') return utc;
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60000;
  return utc - offset;
}

/**
 * The intervals of a schedule: `[{ start, end }]` (`end` null when open), or
 * `null` when the schedule is absent or holds anything unreadable (then the
 * event is taken as in effect: without a readable time it never expires).
 */
export function readIntervals(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const list = schedule.intervals;
  if (!Array.isArray(list) || list.length === 0 || list.length > 100) return null;
  if (Array.isArray(schedule.recurring_schedules) && schedule.recurring_schedules.length > 0) {
    return null;
  }
  const intervals = [];
  for (const item of list) {
    if (typeof item !== 'string') return null;
    const [from, to, extra] = item.split('/');
    if (extra !== undefined) return null;
    const start = readDateTime(from);
    if (start === null) return null;
    let end = null;
    if (to !== undefined && to.trim() !== '') {
      end = readDateTime(to);
      if (end === null) return null;
    }
    intervals.push({ start, end });
  }
  return intervals;
}

/** Whether an event is in effect at `at` (server time); unknown = in effect. */
export function inEffect(event, at) {
  if (at === null || event.intervals === null) return true;
  return event.intervals.some(({ start, end }) => start <= at && (end === null || at < end));
}

/** A text from the API, bounded, without control bytes; `''` when absent. */
function readString(value, max = TEXT_MAX) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, max).join('');
}

/** `"20 minutes"`, `"1 hour"`, `"1 hour 30 minutes"` in minutes, or `null`. */
export function readDelay(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const match = /^(?:(\d{1,3})\s*(?:hours?|hrs?|h))?\s*(?:(\d{1,4})\s*(?:minutes?|mins?|m))?$/.exec(
    text,
  );
  if (!text || !match || (match[1] === undefined && match[2] === undefined)) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function readRoad(road) {
  if (!road || typeof road !== 'object') return null;
  const name = readString(road.name, 120);
  if (!name) return null;
  const state = readString(road.state, 40).toUpperCase();
  return {
    name,
    from: readString(road.from, 200),
    to: readString(road.to, 200),
    direction: readString(road.direction, 10).toUpperCase(),
    state,
    delayMinutes: readDelay(road['+delay'] ?? road.delay),
  };
}

/** One event, or `null` when it lacks what identifies or places it. */
export function readEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 120 || CONTROL.test(id)) {
    return null;
  }
  const lines = readGeometry(raw.geography);
  if (!lines) return null;
  const type = EVENT_TYPES.includes(raw.event_type) ? raw.event_type : 'UNKNOWN';
  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : 'UNKNOWN';
  const roads = Array.isArray(raw.roads)
    ? raw.roads.slice(0, 20).map(readRoad).filter(Boolean)
    : [];
  const subtypes = Array.isArray(raw.event_subtypes)
    ? raw.event_subtypes
        .slice(0, 20)
        .filter((s) => typeof s === 'string' && /^[A-Z_]{1,40}$/.test(s))
    : [];
  return {
    id,
    status: readString(raw.status, 20).toUpperCase(),
    headline: readString(raw.headline, 200),
    description: readString(raw.description),
    type,
    subtypes,
    severity,
    created: readDateTime(raw.created),
    updated: readDateTime(raw.updated),
    intervals: readIntervals(raw.schedule),
    roads,
    lines,
  };
}

/**
 * One page: `{ events, skipped, raw, hasMore }` or `null` when the envelope
 * is not an Open511 list of events (an error object, an HTML page...) or
 * when more than half of its events cannot be read.
 */
export function readEventsPage(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (!Array.isArray(json.events) || json.events.length > MAX_EVENTS_PER_PAGE) return null;
  const events = [];
  let skipped = 0;
  for (const raw of json.events) {
    const event = readEvent(raw);
    if (event) events.push(event);
    else skipped += 1;
  }
  // A list made mostly of events that cannot be read is not "no event": the
  // format changed, or the answer is broken. Never published as 0.
  if (json.events.length > 0 && skipped * 2 > json.events.length) return null;
  const next =
    json.pagination && typeof json.pagination === 'object' ? json.pagination.next_url : undefined;
  // Only a full page announcing a next one is followed.
  const hasMore = json.events.length >= PAGE_LIMIT && typeof next === 'string' && next !== '';
  return { events, skipped, raw: json.events.length, hasMore };
}

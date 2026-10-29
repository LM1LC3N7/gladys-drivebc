// -----------------------------------------------------------------------------
// What a zone sees in a read: the active events in effect now (server time),
// inside its circle and, when the user named roads, on one of them. Sorted
// closures first, then by severity, then by distance; counted; summed up in a
// short text in the user's language.
// -----------------------------------------------------------------------------

import { MAX_COUNT, SUMMARY_MAX } from './constants.js';
import { roadKey } from './config.js';
import { distanceKm } from './geo.js';
import { inEffect } from './open511.js';
import { t, typeLabel } from './i18n.js';

const SEVERITY_RANK = { MAJOR: 0, MODERATE: 1, UNKNOWN: 2, MINOR: 3 };

export const isClosure = (event) => event.roads.some((road) => road.state === 'CLOSED');

/**
 * The matches of a zone: `[{ event, distanceKm }]`, sorted. `at` is the
 * server time of the answer (`null`: every active event is in effect).
 */
export function matchZone(zone, events, at) {
  const wanted = new Set(zone.roads.map(roadKey));
  const matches = [];
  const seen = new Set();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.status !== 'ACTIVE') continue;
    if (!inEffect(event, at)) continue;
    if (wanted.size > 0 && !event.roads.some((road) => wanted.has(roadKey(road.name)))) continue;
    const distance = distanceKm(zone, event.lines);
    if (!(distance <= zone.radiusKm)) continue;
    matches.push({ event, distanceKm: distance });
  }
  matches.sort(
    (a, b) =>
      Number(isClosure(b.event)) - Number(isClosure(a.event)) ||
      SEVERITY_RANK[a.event.severity] - SEVERITY_RANK[b.event.severity] ||
      a.distanceKm - b.distanceKm ||
      (a.event.id < b.event.id ? -1 : 1),
  );
  return matches;
}

export function counts(matches) {
  const bound = (n) => Math.min(n, MAX_COUNT);
  return {
    events: bound(matches.length),
    closures: bound(matches.filter((m) => isClosure(m.event)).length),
    major: bound(matches.filter((m) => m.event.severity === 'MAJOR').length),
  };
}

/** The road of an event as shown: its first road, else its headline. */
export function roadOf(event) {
  return event.roads[0]?.name ?? event.headline;
}

/** The longest known delay of an event, in minutes, or null. */
export function delayOf(event) {
  const delays = event.roads.map((road) => road.delayMinutes).filter((d) => d !== null);
  return delays.length > 0 ? Math.max(...delays) : null;
}

/** One line per event: "Highway 1: closed, incident (major), 3 km". */
export function describe(match, language) {
  const { event } = match;
  const parts = [];
  if (isClosure(event)) parts.push(t(language, 'closed'));
  parts.push(typeLabel(language, event.type));
  let text = `${roadOf(event)}: ${parts.join(', ')}`;
  if (event.severity === 'MAJOR') text += ` (${t(language, 'majorWord')})`;
  const delay = delayOf(event);
  if (delay !== null && delay > 0) text += `, ${t(language, 'delay', { minutes: delay })}`;
  text += `, ${formatKm(match.distanceKm, language)}`;
  return text;
}

export function formatKm(km, language) {
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${String(rounded).replace('.', language === 'fr' ? ',' : '.')} km`;
}

/** The summary text of a zone, bounded to SUMMARY_MAX characters. */
export function summary(matches, language) {
  if (matches.length === 0) return t(language, 'noEvent');
  const head = t(language, 'eventCount', { count: matches.length });
  let text = head;
  let shown = 0;
  for (const match of matches) {
    const line = describe(match, language);
    const rest = matches.length - shown - 1;
    const tail = rest > 0 ? ` · ${t(language, 'more', { count: rest })}` : '';
    if ([...`${text} · ${line}${tail}`].length > SUMMARY_MAX) break;
    text += ` · ${line}`;
    shown += 1;
  }
  const rest = matches.length - shown;
  if (rest > 0) text += ` · ${t(language, 'more', { count: rest })}`;
  return [...text].slice(0, SUMMARY_MAX).join('');
}

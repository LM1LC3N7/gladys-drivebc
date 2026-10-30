// -----------------------------------------------------------------------------
// Geometry of a watch zone: the bounding box asked to the API (it filters on
// its side, so only the events around the zone travel) and the exact distance
// from the zone center to an event, a point or a line (the box is a square,
// the zone a circle).
// -----------------------------------------------------------------------------

import { MAX_POINTS } from './constants.js';

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;
const KM_PER_DEGREE = EARTH_KM * RAD;

/**
 * The box `xmin,ymin,xmax,ymax` (longitudes, latitudes) holding the whole
 * circle. The longitude span is computed at the latitude of the box edge
 * nearest a pole, where a degree of longitude is the shortest.
 */
export function boundingBox({ latitude, longitude, radiusKm }) {
  const dLat = radiusKm / KM_PER_DEGREE;
  const minLat = Math.max(-89.9, latitude - dLat);
  const maxLat = Math.min(89.9, latitude + dLat);
  const polar = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const dLon = radiusKm / (KM_PER_DEGREE * Math.cos(polar * RAD));
  const round = (value, toward) =>
    (toward < 0 ? Math.floor(value * 1e4) : Math.ceil(value * 1e4)) / 1e4;
  return [
    round(longitude - dLon, -1),
    round(minLat, -1),
    round(longitude + dLon, 1),
    round(maxLat, 1),
  ];
}

const isLonLat = (pair) =>
  Array.isArray(pair) &&
  pair.length >= 2 &&
  Number.isFinite(pair[0]) &&
  Number.isFinite(pair[1]) &&
  Math.abs(pair[0]) <= 180 &&
  Math.abs(pair[1]) <= 90;

/**
 * The points of an Open511 geography: `Point` (`[lon, lat]`, or `[[lon, lat]]`
 * as in the DriveBC help page), `LineString`, `MultiPoint`, `MultiLineString`.
 * `null` when unreadable: such an event cannot be placed in a zone.
 */
export function readGeometry(geography) {
  if (!geography || typeof geography !== 'object') return null;
  const { type, coordinates } = geography;
  if (!Array.isArray(coordinates)) return null;
  let lines;
  if (type === 'Point') {
    lines = [isLonLat(coordinates) ? [coordinates] : coordinates];
  } else if (type === 'LineString' || type === 'MultiPoint') {
    lines = [coordinates];
  } else if (type === 'MultiLineString') {
    lines = coordinates;
  } else {
    return null;
  }
  const out = [];
  let count = 0;
  for (const line of lines) {
    if (!Array.isArray(line)) return null;
    const points = [];
    for (const pair of line) {
      if (count >= MAX_POINTS) break;
      if (!isLonLat(pair)) return null;
      points.push([pair[0], pair[1]]);
      count += 1;
    }
    if (points.length > 0) out.push(points);
  }
  return out.length > 0 ? out : null;
}

/**
 * The distance in km from the zone center to the nearest point of the
 * geometry (segments included). Each point is placed on an azimuthal
 * equidistant plane centered on the zone (great-circle distance and bearing
 * from the center): exact for the points themselves; between two points of a
 * line, the straight segment of that plane is a close approximation.
 */
export function distanceKm(center, lines) {
  const lat0 = center.latitude * RAD;
  const lon0 = center.longitude * RAD;
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);
  const project = ([lon, lat]) => {
    const phi = lat * RAD;
    const dLon = lon * RAD - lon0;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const h = Math.sin((phi - lat0) / 2) ** 2 + cos0 * cosPhi * Math.sin(dLon / 2) ** 2;
    const d = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
    const bearing = Math.atan2(
      Math.sin(dLon) * cosPhi,
      cos0 * sinPhi - sin0 * cosPhi * Math.cos(dLon),
    );
    return [d * Math.sin(bearing), d * Math.cos(bearing)];
  };
  let best = Infinity;
  for (const line of lines) {
    let previous = null;
    for (const pair of line) {
      const point = project(pair);
      best = Math.min(best, Math.hypot(point[0], point[1]));
      if (previous) best = Math.min(best, segmentDistance(previous, point));
      previous = point;
    }
  }
  return best;
}

/** Distance from the origin to the segment a-b. */
function segmentDistance(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(a[0], a[1]);
  const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

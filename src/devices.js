// -----------------------------------------------------------------------------
// One Gladys device per watch zone, read-only. Its id is the slot of the zone
// in the configuration (`zone:1`, `zone:2`, `zone:3`), fixed forever: moving
// the zone keeps the device and its history.
//
// Features: events in effect, road closures, major events (counters) and a
// summary (text). No `poll_frequency`: the app reads DriveBC at its own pace.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, MAX_COUNT } from './constants.js';
import { t, zoneLabel } from './i18n.js';

export const zoneIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

export function buildDevice(gladys, zone, language) {
  const ids = zoneIds(gladys, zone.slot);
  const counter = (key, name) => ({
    name,
    external_id: ids.feature(key),
    category: C.COUNTER_SENSOR,
    type: T.SENSOR.INTEGER,
    min: 0,
    max: MAX_COUNT,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  return {
    name: zoneLabel(zone, language),
    external_id: ids.device,
    params: [{ name: 'zone', value: String(zone.slot) }],
    features: [
      counter(FEATURES.EVENTS, t(language, 'eventsFeature')),
      counter(FEATURES.CLOSURES, t(language, 'closuresFeature')),
      counter(FEATURES.MAJOR, t(language, 'majorFeature')),
      {
        name: t(language, 'summaryFeature'),
        external_id: ids.feature(FEATURES.SUMMARY),
        category: C.TEXT,
        type: T.TEXT.TEXT,
        // The core columns are NOT NULL; a text has no range (0/0 as the core UI).
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

export function buildDevices(gladys, config) {
  return config.zones.map((zone) => buildDevice(gladys, zone, config.language));
}

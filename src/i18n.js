// -----------------------------------------------------------------------------
// Every text the integration writes, in English and French: the summary of a
// zone (in the language of the configuration), the status and the test
// button (both languages, Gladys picks). Times are shown in Pacific time, the
// time zone of the source; DriveBC texts (headlines, roads) stay in English,
// the only language of the API.
// -----------------------------------------------------------------------------

import { TIME_ZONE } from './constants.js';

const TEXTS = {
  en: {
    noEvent: 'No event',
    eventCount: ({ count }) => (count === 1 ? '1 event' : `${count} events`),
    more: ({ count }) => `${count} more`,
    closed: 'closed',
    majorWord: 'major',
    delay: ({ minutes }) => `delay ${minutes} min`,
    zoneDefault: ({ slot }) => `DriveBC zone ${slot}`,
    eventsFeature: 'Events in effect',
    closuresFeature: 'Road closures',
    majorFeature: 'Major events',
    summaryFeature: 'Summary',
  },
  fr: {
    noEvent: 'Aucun événement',
    eventCount: ({ count }) => (count === 1 ? '1 événement' : `${count} événements`),
    more: ({ count }) => `${count} de plus`,
    closed: 'fermée',
    majorWord: 'majeur',
    delay: ({ minutes }) => `retard ${minutes} min`,
    zoneDefault: ({ slot }) => `DriveBC zone ${slot}`,
    eventsFeature: 'Événements en cours',
    closuresFeature: 'Routes fermées',
    majorFeature: 'Événements majeurs',
    summaryFeature: 'Résumé',
  },
};

const TYPES = {
  en: {
    CONSTRUCTION: 'construction',
    SPECIAL_EVENT: 'special event',
    INCIDENT: 'incident',
    WEATHER_CONDITION: 'weather',
    ROAD_CONDITION: 'road condition',
    UNKNOWN: 'event',
  },
  fr: {
    CONSTRUCTION: 'travaux',
    SPECIAL_EVENT: 'événement spécial',
    INCIDENT: 'incident',
    WEATHER_CONDITION: 'météo',
    ROAD_CONDITION: 'état de la route',
    UNKNOWN: 'événement',
  },
};

export function t(language, key, params = {}) {
  const text = (TEXTS[language] ?? TEXTS.en)[key];
  return typeof text === 'function' ? text(params) : text;
}

export function typeLabel(language, type) {
  return (TYPES[language] ?? TYPES.en)[type] ?? TYPES.en.UNKNOWN;
}

/** A time in Pacific time: "Oct 29, 14:05 PT" / "29 oct., 14 h 05 (heure du Pacifique)". */
export function formatTime(ms, language) {
  if (!Number.isFinite(ms)) return '?';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const month = Number(parts.month);
  if (language === 'fr') {
    const months = [
      'janv.',
      'févr.',
      'mars',
      'avr.',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ];
    return `${Number(parts.day)} ${months[month - 1]}, ${parts.hour} h ${parts.minute} (heure du Pacifique)`;
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[month - 1]} ${Number(parts.day)}, ${parts.hour}:${parts.minute} PT`;
}

const ERRORS = {
  required: { en: 'is required', fr: 'est obligatoire' },
  not_a_number: { en: 'is not a number', fr: "n'est pas un nombre" },
  outside_bc: {
    en: 'places the zone outside British Columbia (DriveBC covers BC only)',
    fr: 'place la zone hors de la Colombie-Britannique (DriveBC ne couvre que la C.-B.)',
  },
  radius: { en: 'must be between 1 and 300 km', fr: 'doit être entre 1 et 300 km' },
  roads_invalid: {
    en: 'holds an invalid road name (60 characters at most each)',
    fr: 'contient un nom de route invalide (60 caractères au plus chacun)',
  },
  roads_too_many: { en: 'names more than 10 roads', fr: 'nomme plus de 10 routes' },
  name_invalid: {
    en: 'is invalid (60 characters at most, no control character)',
    fr: 'est invalide (60 caractères au plus, sans caractère de contrôle)',
  },
  refresh: {
    en: 'must be a whole number of minutes between 3 and 60 (5 used)',
    fr: 'doit être un nombre entier de minutes entre 3 et 60 (5 utilisé)',
  },
};

/** "Field zone1_latitude is required" in both languages. */
export function configErrors(errors) {
  const line = (lang) =>
    errors
      .map(
        (e) =>
          `${lang === 'fr' ? 'Le champ' : 'Field'} ${e.field} ${ERRORS[e.code]?.[lang] ?? e.code}`,
      )
      .join('; ');
  return { en: line('en'), fr: line('fr') };
}

const FAILURES = {
  network: { en: 'DriveBC could not be reached', fr: 'DriveBC injoignable' },
  timeout: { en: 'DriveBC did not answer in time', fr: "DriveBC n'a pas répondu à temps" },
  rate: { en: 'DriveBC asked to slow down (429)', fr: 'DriveBC demande de ralentir (429)' },
  server: { en: 'DriveBC server error', fr: 'erreur du serveur DriveBC' },
  http: { en: 'unexpected answer from DriveBC', fr: 'réponse inattendue de DriveBC' },
  format: { en: 'DriveBC answer not readable', fr: 'réponse de DriveBC illisible' },
  too_big: { en: 'DriveBC answer too large', fr: 'réponse de DriveBC trop grande' },
  too_many: {
    en: 'more than 2000 events in the zone, reduce its radius',
    fr: 'plus de 2000 événements dans la zone, réduisez son rayon',
  },
};

export function failure(kind, status, lang) {
  const text = FAILURES[kind]?.[lang] ?? FAILURES.http[lang];
  const full = status && kind !== 'rate' ? `${text} (HTTP ${status})` : text;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

/** The bilingual messages of the status and the test button. */
export const M = {
  starting: {
    en: 'Starting: the first read of DriveBC comes shortly.',
    fr: 'Démarrage : la première lecture de DriveBC arrive sous peu.',
  },
  configRetry: ({ seconds }) => ({
    en: `The configuration could not be read from Gladys; next try in ${seconds} s.`,
    fr: `La configuration n'a pas pu être lue dans Gladys ; nouvel essai dans ${seconds} s.`,
  }),
  noZone: {
    en: 'No valid zone: fill in the latitude and longitude of zone 1.',
    fr: 'Aucune zone valide : renseignez la latitude et la longitude de la zone 1.',
  },
};

export function zoneLabel(zone, language) {
  return zone.name ?? t(language, 'zoneDefault', { slot: zone.slot });
}

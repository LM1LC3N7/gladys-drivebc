# TODO

## Before announcing

- [ ] Install it on a real Gladys 5.1+ and create a zone: device creation, the counters and the summary in the
      dashboard, the scene trigger in the scene editor.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store (after the first release: the store
      validator needs the GHCR image).
- [ ] Store metadata kept out of the manifest (no `keywords` / `countries` fields): countries CA; keywords
      DriveBC, British Columbia, Colombie-Britannique, road closures, traffic, Open511, 511.

## To confirm over time on the live API

- [ ] The pagination (`pagination.next_url`) of a page holding 500 events: never seen (364 active events in the
      whole province on 2026-10-29); the code follows `next_url` only after a full page.
- [ ] Other `+delay` formats than "N minutes" (read as unknown otherwise, never 0).
- [ ] Whether DriveBC ever sends `recurring_schedules` (read as "in effect" when present).
- [ ] The throttling of DriveBC: a 429 came after about 10 requests in 3 s from the VM; its page asks for 10 s
      between requests (12 s used). No `Retry-After` was seen.
- [ ] Times shown in Pacific time follow the tzdata of the image's Node: tzdata 2026e (Node 24 here) keeps BC on
      UTC-7 after 2026-11-01 (permanent daylight time); an older tzdata would show UTC-8. The event times
      themselves come with their offset or in UTC and do not depend on it.

## Decisions

- **Version 0.1.0** set by hand in package.json, package-lock.json, the manifest and its `docker_image`
  (`ghcr.io/lm1lc3n7/gladys-drivebc:0.1.0`).
- **SDK `^0.16.0`**, the latest published (2026-10-25, checked on the npm registry): no change needed for a
  read-only device integration.
- **One device per zone, id = the slot** (`zone:1..3`): moving a zone keeps the device and its history; the scene
  trigger starts a new baseline for a moved zone (salted fingerprint in `/data`).
- **Zones read with `bbox`** (the API filters), then the exact circle on our side: about 15 KB gzipped per zone
  instead of the 400 KB of the whole province. `road_name` is not used on the API side: it is case-sensitive and a
  wrong case answers 500; the roads are matched on our side, case and "Hwy" ignored.
- **"In effect"** judged against the `Date` header of the answer; intervals without offset read as UTC (checked on
  the live API: an event created 11:02 PDT has its interval at 18:02). No server time: every active event counts,
  and no scene event fires.
- **No ETag / Last-Modified** on the events (checked): every round reads them again; the interval is 3 minutes at
  least, 5 by default.
- **No `location: true`** (the house location is sensitive): the zones are typed in the configuration.
- **No widget, no scene action** in 0.1.0.
- **Checked live on 2026-10-29**: the module against the real API from the VM (two zones, Vancouver and Hope), then
  installed in the sandbox Gladys (`gi install`, RUNNING) with two zones: Discovery, status and test button OK;
  the sandbox integration was stopped afterwards so it does not keep polling DriveBC.
- **The summary language is a configuration choice** (English by default): the integration cannot know the
  language of the Gladys user.
- **Test button = last read**: it never reads (the interval holds for it too).
- **Counts of a failed read are never published** (nothing rather than 0); the status says since when.
- **`connected`** shown when the last read of at least one zone succeeded less than 2 hours ago.

# DriveBC (British Columbia road events)

Unofficial integration. It reads the road events that **DriveBC** (Province of British Columbia) publishes on its
public **Open511 API**: closures, construction, incidents, weather and road conditions. No account, no API key.

> This integration is not an official source. Before you drive, check [DriveBC](https://www.drivebc.ca/) itself.
> The data may lag behind the road, and the integration may miss an event.

Contains information licensed under the Open Government Licence – British Columbia.

## What you get

Up to **three watch zones**, each one a Gladys device. A zone is a circle around a point (1 to 300 km), optionally
limited to some roads ("Highway 1, Highway 99").

Each zone device has:

| Feature          | Type    | Meaning                                                       |
| ---------------- | ------- | ------------------------------------------------------------- |
| Events in effect | counter | Active events in effect now inside the zone                   |
| Road closures    | counter | Those with a road marked closed                               |
| Major events     | counter | Those of severity "major"                                     |
| Summary          | text    | The events, closures first, then major ones, then by distance |

The summary is written in the language chosen in the configuration (English or French); the road names and the
DriveBC texts stay in English, the only language of the API.

**In effect** means: an active event whose schedule interval covers the current time, as given by the DriveBC
server (`Date` header). An event planned for later is not counted until its interval starts. Daily hours written only
in the description ("7:00 AM to 7:00 PM, weekdays") are not read: such an event counts for its whole interval. An
event without a readable schedule, or an answer without a readable server time, counts as in effect. A server time
more than a day away from the clock of Gladys is not believed (taken as unreadable).

**No event**: DriveBC answers a box without any event with an HTTP 500 carrying the code 1008 ("Error processing
OP5 event data"), never with an empty list (observed on the live API in October 2026). The integration reads that exact answer as
"no event"; any other 500 is an outage. When a zone that had events falls to "no event" through that answer, 0 is
published only if the next scheduled read says the same (no extra request): one interval later. A first read, or a
zone already at 0, is published at once. A list where more than half of the events cannot be read is never 0: the status says that DriveBC sends events
that cannot be read, nothing is published, and the reads go on at the interval (no pause).

## Scene trigger: "New DriveBC event in a zone"

Fired when an event in effect appears in a zone for the first time and was created, updated or started within the
last 2 hours (server time). Filters: zone, event types, severity. Variables: road, headline and description (English),
type, severity, closed (yes/no), distance from the zone center (km), announced delay (minutes, empty when unknown),
DriveBC event id.

It is not fired by the first read of a zone, nor after you move a zone (new center, radius or roads): that read only
learns what is already there. It is not fired when the answer carries no readable server time. At most 20 events
per zone and per read.

## Configuration

1. **Language of the summary**: English or French.
2. **Read interval**: 3 to 60 minutes (5 by default).
3. **Zone 1** (required), zones 2 and 3 (optional, left empty to turn them off): a name, the latitude and longitude
   of the center (decimal degrees, inside British Columbia), the radius in km (25 by default), and optionally the
   roads to keep, separated by commas, as DriveBC writes them ("Highway 1", "Highway 99"; "Hwy 99" works too; the
   case is ignored). Local roads are named "Other Roads" by DriveBC.

A refused field is named in the status (the value you typed is not repeated there).

The button **Show the last read** tells what the last read of each zone gave and when the next comes. It does not
read DriveBC.

## Pace and courtesy toward DriveBC

DriveBC throttles its API and asks to space requests by 10 seconds or more. The integration:

- sends one request at a time, 12 seconds at least between the starts of two requests (one per zone and per
  round; a zone with more than 500 events takes one more request per 500, up to 2000);
- starts a round every interval, measured from the start of the previous round;
- does not read sooner after a restart, a reconnection to Gladys, a configuration saved unchanged, a Discovery or
  the test button (the time of the last attempt is kept in `/data`, and in memory); moving a zone reads at once,
  12 seconds after the last request;
- when `/data` cannot tell the last attempt (unreadable file, a date in the future, a `/data` that cannot be written
  or does not answer within 2 seconds), waits 3 minutes after the start before the first read, and says so in the
  status; a `/data` that stops being writable later is said in the status too: a restart may then read sooner;
- after a **429** ("too many requests"), pauses every read for 5 minutes, then 10, 20… up to 6 hours; after a
  server error (**5xx**, the "no event" answer apart) or another unexpected status (400, 403, 404…), for 2 minutes,
  then 4, 8… up to 6 hours; a `Retry-After` longer than that is honored, up to 6 hours. A refusal that arrives while
  the configuration is being saved, or Gladys reconnects, still starts the pause. The pause is kept in `/data`
  across restarts; the doubling starts over after a successful read;
- identifies itself with the User-Agent `gladys-drivebc/<version> (+https://github.com/LM1LC3N7/gladys-drivebc)`;
- cuts an answer after 30 seconds or 16 MB.

DriveBC does not offer `ETag` nor `Last-Modified` on its events: every round reads the events again.

## Status

The Configuration screen shows, for each zone, the counts of the last read and its time (Pacific time), or why it
failed and the time of the last data. Data older than 2 hours is said stale. When a read fails, nothing is
published for that zone: the devices keep their last values and the status says since when. A fall to 0 waiting
for its confirmation is said too. The integration is
shown connected when the last read of at least one zone succeeded, less than 2 hours ago.

## Privacy

The coordinates of your zones stay in the Gladys configuration. DriveBC receives, for each zone, the box around
the circle (its center is the middle of the box). The `/data` file holds the time of the last attempt, the pause,
and per zone the ids of the events already seen with a salted fingerprint of the zone, not its coordinates.

## Limits

- British Columbia only (the zone center must be in BC; events near the borders are included).
- Tested against the real DriveBC API on 2026-10-29; not yet tested by a user in British Columbia.
- The texts of DriveBC are in English only.
- "No event" is the HTTP 500 with code 1008 of DriveBC: should DriveBC ever send that exact answer during an outage,
  a zone would show 0 after two such reads in a row (one interval apart).

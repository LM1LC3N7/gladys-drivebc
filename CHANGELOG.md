# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Up to three watch zones in British Columbia, each one a Gladys device: events in effect, road closures, major
  events and a summary, from the DriveBC Open511 API (no account, no key).
- Scene trigger "New DriveBC event in a zone", filtered by zone, event type and severity.
- A button that shows the last read of each zone and the next one.
- Courtesy toward DriveBC: one request at a time, 12 s apart; pauses after a 429 or a 5xx, kept across restarts;
  no read sooner than the interval after a restart.
- "No event" in a zone is the HTTP 500 with code 1008 of DriveBC: read as 0, a fall from events to 0 confirmed by
  the next read.
- Restarts never read at once when `/data` cannot tell the last read; unexpected statuses (403, 404…) are spaced
  out like server errors; a server date more than a day off is not believed.

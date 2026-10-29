# gladys-drivebc

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for **DriveBC**: road events in British
Columbia (closures, construction, incidents, weather and road conditions) read from the public
[DriveBC Open511 API](https://api.open511.gov.bc.ca/help). No account, no API key.

> This integration is not an official source. Before you drive, check [DriveBC](https://www.drivebc.ca/) itself.

Contains information licensed under the Open Government Licence – British Columbia.

- Up to three watch zones (a circle of 1 to 300 km, optionally limited to some roads), one Gladys device each:
  events in effect, road closures, major events (counters) and a summary (text, English or French).
- A scene trigger "New DriveBC event in a zone" (filters: zone, type, severity).
- One request at a time, 12 s apart, every 3 to 60 minutes; pauses after a 429 or a 5xx, kept across restarts.
- Tested against the real DriveBC API on 2026-10-29; not yet tested by a user in British Columbia.

User documentation: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm test               # node --test (virtual clock, scripted DriveBC; one test on the real clock x20)
npm run lint
npm run format:check
node scripts/cover.mjs cover.png
```

Tests never reach the Internet: a real answer of DriveBC captured on 2026-10-29 is in `test/fixtures/`, and the
real-clock test serves it from a local HTTP server.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

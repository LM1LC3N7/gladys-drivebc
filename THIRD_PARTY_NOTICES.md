# Third-party notices

## DriveBC data (Province of British Columbia)

The integration reads, at run time, the DriveBC Open511 API (https://api.open511.gov.bc.ca/), whose use is
governed by the API Terms of Use for Information provided under the OGL-BC, and whose information is licensed
under the Open Government Licence – British Columbia
(https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc).

The test fixture `test/fixtures/vancouver.json` is a trimmed copy of a real answer of that API (2026-10-29).

Attribution statement, as required by the OGL-BC:

> Contains information licensed under the Open Government Licence – British Columbia.

No code of DriveBC is used: the client is written from the API documentation (https://api.open511.gov.bc.ca/help)
and the observed answers. The integration is not endorsed by the Province of British Columbia.

## gladys-testkit

`test/kit/clock.mjs` is copied from gladys-testkit (Apache-2.0, same author as this repository).

## npm dependencies

The only runtime dependency is `@gladysassistant/integration-sdk` (Apache-2.0); its license ships in
`node_modules/@gladysassistant/integration-sdk/LICENSE` of the image.

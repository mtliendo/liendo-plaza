# Family codes

Phones and browsers open `/family` (native: the sign-in screen) and enter one
code. The shared parent code is 6–72 digits; kids have distinct four-digit
codes, suggested as birthdays (MMDD). Parent codes reveal only the parent name
picker when multiple parents exist; selecting a name requires resubmitting the
parent code. Kid codes sign in directly. No family token, QR or PIN prerequisite.

First use after migration shows **Set up Liendo Plaza**, including on an already
signed-in phone/browser. Anyone can perform this initial setup, as requested:
choose the shared parent code twice, optionally set kid codes and choose a
parent. Coordinate the first setup after deployment. A transaction-level
advisory lock and the singleton parent row atomically prevent a second setup.
No default or old PIN is accepted as a new code. Optional unset kids cannot
sign in until a parent sets their code.

## Storage and endpoints

Migration `0005_family_codes.sql` adds only `family_codes`; it does not alter
existing tables/indexes or invalidate deployed main's PIN/session writes.
Rows use `parent` or a kid's person UUID as their primary key. Only bcrypt
hashes (same hashing as PINs) and persistent failed-attempt/lockout metadata
are stored, never codes. A shared lock serializes setup, code edits and sign-in
verification across server instances, including duplicate kid-code checks.

- `GET /api/auth/codes/status`: setup flag; people only before initial setup.
- `POST /api/auth/codes/setup`: `{code, confirmation, personId, kids?:
  [{personId, code}], deviceKind?, cookie?}`. Returns the normal session.
- `POST /api/auth/login`: `{code, personId?, deviceKind?, cookie?}`. Returns
  `{parents}` after a valid shared code if a choice is needed, otherwise the
  normal `{token, person}` device-backed session. No session is issued merely
  for choosing a name.
- `GET /api/auth/codes`: parent-only configured kid IDs / parent-code flag.
- `POST /api/auth/codes`: parent-only `{code, confirmation}` for the shared
  parent code, or `{personId, code}` for a kid. Empty kid code clears it.

The existing in-memory per-IP helper limits sign-in to 20/minute and setup to
10/minute per server instance. Ten consecutive wrong codes also persist a 5-minute
household-wide lockout in Postgres (an unknown code cannot identify a person).
Only a completed parent-code sign-in resets the failure count; kid sign-ins and
the parent name picker do not reset it.
Existing per-person PIN lockouts are respected. A parent already signed in can
reset the shared code to recover. Changes keep existing sessions active;
revoke an individual device separately if needed. Parent actions still require
a live parent session. Legacy PIN login/bootstrap and phone pairing cannot
issue new sessions through the API. Kitchen display claim/poll/approve and
existing live display authorization remain unchanged.

## Local checks

Use dedicated local Postgres databases, migrate them with `pnpm db:migrate`,
then run `pnpm --filter @liendo/web exec tsx scripts/test-family-codes.ts` with
`DATABASE_URL=postgres://…@127.0.0.1:5432/liendo_codes_test_<timestamp>`.
For the browser setup/settings/sign-in flow, start a server on a separate fresh
seeded `liendo_codes_web_test_<timestamp>` database, then run
`pnpm --filter @liendo/web exec tsx scripts/test-family-codes-browser.ts` with
`DATABASE_URL`, `E2E_BASE_URL` and an existing `E2E_ARTIFACTS` directory set.
For native UI tests use a separate local `liendo_codes_ui_test_<timestamp>`
database and server with the same URL. Run:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
LP_API_URL=http://127.0.0.1:3156 \
DESTINATION='platform=iOS Simulator,name=iPhone 17,OS=26.5' \
apps/ios/scripts/ui-tests.sh
```

The UI script resets and seeds its dedicated local database twice. Never point
it at production. This feature does not apply production migrations or modify
Vercel environment variables.

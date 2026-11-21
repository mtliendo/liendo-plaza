# Family codes

Phones and browsers open `/family` (native: the sign-in screen) and enter one
code. Each parent has their own unique 6–72 digit code; kids have distinct
four-digit codes, suggested as birthdays (MMDD). Every code signs its owner in
directly. No parent name picker, family token, QR or PIN prerequisite.

First use after migration shows **Set up Liendo Plaza**, including on an already
signed-in phone/browser. Anyone can perform this initial setup, as requested:
choose which parent you are, enter your code twice, and optionally set the other
parents' and kids' codes. Coordinate the first setup after deployment. Setup is
required only when no parent has a code. A transaction-level advisory lock and
the parent person-ID rows atomically prevent a second setup (HTTP 409).
No default or old PIN is accepted as a new code. Optional unset kids cannot
sign in until a parent sets their code. Unset parents likewise show as Not set
in Family codes and cannot sign in until their code is configured.

## Storage and endpoints

Migration `0005_family_codes.sql` adds only `family_codes`; it does not alter
existing tables/indexes or invalidate deployed main's PIN/session writes.
Code rows use each parent's or kid's person UUID as their primary key. Codes
are stored only as bcrypt hashes (same hashing as PINs), never plaintext.
A dedicated `household` row stores failed-attempt/lockout metadata; its unused
hash is the empty string and is never compared during sign-in. No schema change
or migration 0006 is needed: 0005 remains unchanged and works with the existing
empty production table. A shared lock serializes setup, code edits and sign-in
verification across server instances, including duplicate parent/kid checks.

- `GET /api/auth/codes/status`: setup flag; people only before initial setup.
- `POST /api/auth/codes/setup`: `{code, confirmation, personId, parents?:
  [{personId, code}], kids?: [{personId, code}], deviceKind?, cookie?}`.
  Returns the chosen parent's normal session; optional entries are role-checked.
- `POST /api/auth/login`: `{code, deviceKind?, cookie?}`. Always returns the
  normal `{token, person}` device-backed session. A supplied personId cannot
  select a different identity.
- `GET /api/auth/codes`: parent-only configured person IDs (parents and kids).
- `POST /api/auth/codes`: parent-only `{personId, code, confirmation?}`.
  Any signed-in parent can set/reset/clear any person's code. Nonempty parent
  codes require confirmation. Empty code clears it, except the last remaining
  parent code cannot be cleared (HTTP 409); set a replacement code instead.
  Setup also rejects kid codes that collide with existing kids' codes, even
  when no parent code exists yet.

The existing in-memory per-IP helper limits sign-in to 20/minute and setup to
10/minute per server instance. Ten consecutive wrong codes also persist a 5-minute
household-wide lockout in Postgres (an unknown code cannot identify a person).
Only a completed parent-code sign-in resets the failure count; kid sign-ins and
code edits do not reset it.
Existing per-person PIN lockouts are respected. A parent already signed in can
reset a person's code, but doing so does not bypass the household lockout.
Changes keep existing sessions active;
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

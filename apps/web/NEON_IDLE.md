# Neon idle investigation

Baseline: `origin/main` at `eb044e49c4cc684e6bac24bd9fb7e658fc95dc55`.
Production was not queried or changed for this investigation. The reported
440 active hours and an always-on kitchen display are operational inputs, not
independently verified traffic measurements. The following rates are derived
from the shipped code, per mounted client, excluding retries and navigation.

## Ranked wake sources

1. **Stray pairing on the already-paired kitchen board: about 1,800 requests/hour.**
   `components/display/DisplayApp.tsx` unconditionally mounted `useClaim("display")`.
   `components/pair/useClaim.ts` started a new claim on mount and polled every two
   seconds, without stopping on success. Expired claims restarted automatically
   (roughly six new claims/hour). To disprove the paired-session bypass hypothesis,
   `lib/api.ts` and `lib/pair.ts:createClaim/pollClaim` were checked: neither skips
   the database for a caller that already has a display cookie. Each poll reads
   `pairing_requests`; each renewal expires old claims and inserts a new one.
   This path is reachable even with a paired, hidden board. Whether a particular
   production board remained mounted all month has not been verified from logs.
2. **Snapshot: 60 DB-touching requests/hour per visible kitchen board.**
   `lib/query.tsx:useSnapshot` uses shared `DISPLAY_REFETCH_MS=60000`.
   The dynamic, revalidate=0 API authenticates every request and calls
   `lib/snapshot.ts:buildSnapshot` without a snapshot cache. Weather/calendar have
   their own caches, but chores, meals, stars, people and settings still use SQL.
   Snapshot building runs `9 + N` SQL statements, where N is the number of due
   chore/date pairs in the requested range: `ensureInstances` attempts an insert
   for each, even when the instance already exists. Display authentication adds
   a SELECT and previously two presence UPDATEs. TanStack's default already
   suppresses interval fetching when unfocused; that alone did not stop pairing
   or version polls.
3. **Version/remote refresh: another 60 DB-touching requests/hour per board.**
   `lib/display-refresh.ts:useKitchenReload` used an unconditional setInterval,
   including hidden and dimmed tabs. `/api/version` in `lib/api.ts` calls
   `getDisplayRefreshRequestedAt`, selecting from settings on every request.
   This is not a static build-ID-only endpoint and is not SSE/long-polling.
4. **Conditional device-management screens: 900 requests/hour while open.**
   Web `DevicePanels.tsx`, Expo parent/add-device and native `AddDeviceView.swift`
   poll pending approvals every four seconds. Authentication plus pending-claim
   reads/expiry work touch SQL. These are screen-scoped, not mounted on every
   parent Today screen; actual 24/7 production usage is unverified. Web now
   pauses this loop while hidden. Unpaired native/Expo pairing screens poll at
   two seconds until pairing finishes; those are not signed-in refresh loops.
5. **Expo foreground snapshots: 60 requests/hour per active client.**
   `apps/mobile/lib/query.tsx` uses the same interval and wires AppState into
   TanStack focusManager, so normal backgrounding suppresses it. Native SwiftUI
   Today/Dinner use load/pull-to-refresh, not a persistent snapshot timer.
   A suspended signed-in native iPhone is not a demonstrated 24/7 cause.
6. **Reminder cron: four requests/hour, continuously, previously.**
   `vercel.json` ran every 15 minutes. The route read settings before checking
   whether the reminder was due, so all 96 daily invocations touched SQL.
   Four wakes/hour alone can account for roughly eight active hours/day with a
   five-minute suspension delay, even if there are no clients.

The first three sources together are approximately **1,920 DB-touching requests
per hour per always-on paired board**, plus claim renewals. These rates overlap
in active time; they must not be added as separate active hours.

### Amplifiers, not independent timers

- `auth.ts` wrote device lastSeenAt on each authenticated session request and
  wrote both display pairing/device presence on every display request. These
  writes amplify existing traffic, not create their own requests. Presence is
  now updated only when absent or at least fifteen minutes old; authorization
  still reads live data on every request so revocation remains immediate.
- `lib/db/index.ts` actually uses `pg.Pool` and Drizzle's node-postgres adapter,
  not the installed `@neondatabase/serverless` HTTP driver. The installed pg-pool
  defaults to a **10-second** idle timeout: an indefinitely connected backend
  must not be assumed from the singleton alone. A Fluid-compute freeze delaying
  cleanup is plausible but was not verified in production. The pool now has an
  explicit one-second idle timeout, allowExitOnIdle, a 60-second max lifetime and
  a ten-second connection timeout. Local tests verify idle connections close;
  this does not prove cleanup timing on a frozen Fluid instance.
- DisplayApp's 15-second local clock only sets React state; it does not itself
  call the API. No database LISTEN, SSE or long-poll loop was found.

## Fix and behavior

- A paired board never creates/polls a pairing claim. Pairing stops after
  success and pauses when hidden.
- Board snapshot and version polling stop from **22:00 through 05:59
  America/Chicago**, matching the existing dim hours (there are no quiet-hour
  settings). Hidden boards pause both loops. Normal daytime cadence stays one
  minute. The clock/dimming use local current time, not the last snapshot time.
- Tapping the night overlay wakes polling for the existing five-minute window;
  morning resumes automatically. An initial page load still fetches one
  authenticated snapshot, including at night. Focus/reconnect/manual actions
  may also legitimately wake the DB; no request already in flight is aborted.
- Cron is hourly at minute zero, preserving the existing configured reminder
  hour and the once-in-the-first-quarter-hour behavior. The existing reminder
  minute setting was not honored before and is unchanged. Off-quarter calls
  now return before reading settings. Hourly calls still need settings to know
  the configured reminder hour; no hard-coded hour or stale settings cache was
  introduced.
- No snapshot/auth response cache was added: a short cache would not allow
  five-minute idle periods while authorization still queries every minute.
  Caching authentication or protected snapshots across requests requires
  revocation and mutation invalidation guarantees; this fix does not weaken
  the protected-photo no-store policy or hide daytime edits behind a long TTL.

## Expected active hours, not a free-tier guarantee

Assuming one continuously visible board, a five-minute Neon suspension delay,
no other clients/bots and negligible query duration:

- Before: essentially 24 hours/day (about 720 hours/30 days).
- After: about 16 daytime hours plus eight overnight cron wakes of five minutes:
  **16 hours 40 minutes/day, about 500 hours/30 days or 517 hours/31 days**.
  At a constant 0.25 CU that is roughly 125 CU-hours per 30 days.
- If all clients are hidden/closed, the hourly cron alone is about two active
  hours/day (60 hours/30 days), plus user activity and its idle tails.

This should restore overnight scale-to-zero windows, but **does not guarantee
fitting the free allowance with a permanently visible board**. Reducing below
that floor needs a product decision: a shorter daytime refresh window, delayed
updates while the board is unattended, or a properly invalidated authenticated
snapshot cache/push architecture. Production traffic and Neon suspension should
be checked after deployment; this branch is not deployed to production.

## Checks

Use dedicated local databases only. Apply migrations then run
`pnpm exec tsx scripts/test-idle.ts` against `liendo_idle_test_<digits>`;
the existing photo/pending scripts each enforce their own dedicated DB names.
`test-display-idle.ts` uses `E2E_BASE_URL` on a non-3000 local Next server and
mocked API responses, with virtual clock/visibility changes. It checks paired
daytime cadence, absence of stray claims, hidden/quiet silence, temporary wake,
morning recovery, version failure and pairing completion. The existing
`display-refresh.ts` covers version reload and parent-triggered remote reload.
Typecheck/lint use the normal web package scripts.

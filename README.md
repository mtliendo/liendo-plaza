# Liendo Plaza

The Liendo kitchen board and phones. A wall calendar you can tap: today in Davenport, the family iCloud calendar (read-only), chores with stars, and dinner.

Focus and Jess are parents. Sofia (15), Noah (13), and Xavier (9) are the kids. Each person keeps one color on the board, the chores, and the stars.

## What is here

```
apps/web      Next.js App Router. Kitchen display, a phone-sized web app, and the API.
apps/mobile   Expo + expo-router. iPhone app for TestFlight.
packages/shared   People, types, and date helpers.
```

The kitchen frame opens `/display` full-screen (landscape, 15.6"). A 10" frame can open the same preview URL. Phones use the Expo app, or `/family` in a browser. Parents add, edit, and clear dinners on the Dinner tab, and manage chores (assign, repeat, stars, photo, how-to, steps, and a reference photo) under Manage. Kids tap a chore to read the details, then mark it done or take a photo. A new column set lives in `apps/web/drizzle/0003_chore_details.sql`.

## Architecture

- **API:** Next.js route handlers in `apps/web/app/api`. One router in `lib/api.ts` serves both the board and the phones.
- **Data:** Postgres (Neon in production, local Postgres on this machine) through Drizzle. Migrations live in `apps/web/drizzle`.
- **Calendar:** Server reads `FAMILY_ICAL_URL` (webcal becomes https). The feed is parsed once, cached for about four minutes, and only expanded for the requested window (today through five weeks). Recurring events, EXDATE, all-day dates, and America/Chicago times are expanded in that window only. The URL never goes to a browser. If the env var is empty, a small synthetic `apps/web/data/sample.ics` is used. Real iCloud data is not in the repo.
- **Photos:** Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (private or an unguessable path). Local disk under `apps/web/data/uploads` otherwise. Images are resized and compressed on upload.
- **Auth:** QR pairing, not a typed family code. An unpaired frame or phone shows a QR and a short TV-style code (`AB3-K7M`). A signed-in parent approves it (scan or type the code). New phones can also scan a one-time parent invite (`liendoplaza://` or `/family?invite=`). The first parent phone bootstraps with that parent’s 6-digit PIN when no parent device is paired yet. Kids use 4 digits, parents 6. PINs are bcrypt hashes. Five wrong tries lock that person for 15 minutes. `FAMILY_ACCESS_SECRET` stays on the server for signing; nobody types it. The phone keeps a session token in SecureStore. The kitchen board stores a long-lived httpOnly cookie after pairing. Parents can list and revoke devices.
- **Push:** Expo push tokens. Vercel Cron hits `/api/cron/reminders` every 15 minutes and, at the parent-set hour (default 6 PM Chicago), pings kids who still have open chores. Parents get a ping when a photo is waiting. The kid gets a ping when it is approved.

## Local setup

Needs Node 22, pnpm 10, and Postgres.

```bash
sudo pg_ctlcluster 16 main start   # or your own Postgres
createdb liendo_plaza              # once

cp .env.example .env.local
# set FAMILY_ACCESS_SECRET to a long random string
# openssl rand -hex 32
cp .env.local apps/web/.env.local

pnpm install
pnpm db:migrate   # applies every apps/web/drizzle/*.sql, including pairing, avatars, and meal photos
pnpm db:seed
pnpm dev
```

Seed PINs (change these after first login):

- Focus, Jess: `123456`
- Sofia, Noah, Xavier: `1234`

Open [http://localhost:3000/display](http://localhost:3000/display) on the frame. Open [http://localhost:3000/family](http://localhost:3000/family) for the phone screens.

## Pairing (no typed family secret)

`FAMILY_ACCESS_SECRET` is a server signing key only. Do not send it through chat or type it on the frame.

**Kitchen frame / unpaired browser.** The unpaired screen shows a QR and a short code. A parent who is already signed in scans it, or opens **Add a device** and types the code. The waiting screen polls and receives a long-lived cookie. Codes expire in about ten minutes and are single-use.

**New phone.** A signed-in parent opens **Add a device** and taps **Invite a new phone**. The new phone scans that QR with the camera. The app deep link is `liendoplaza://?invite=...`. The web fallback is `/family?invite=...` (also `/join?invite=...`). That phone is then paired to the family and picks a name + PIN as before.

**First parent device (bootstrap).** If no parent device is paired yet, an unpaired phone can pick Focus or Jess and enter that parent’s 6-digit PIN (same lockout as a normal login). This is physical-presence plus a secret the family already knows. After one parent phone exists, bootstrap closes; new devices need a QR or short-code approval. Revoking every parent device opens bootstrap again.

**Revoke.** Parents see paired phones and frames under **Devices** and can revoke one. That session or display cookie stops working.

## Pair the kitchen display

1. On the frame, open `https://<your-app>/display`.
2. On a parent phone, open **Add a device** (or scan the frame QR).
3. Approve the short code. The board keeps a cookie and remembers the pairing.
4. A public visitor without that cookie sees only the QR.

Deep link for a new phone: `liendoplaza://?invite=...` or `https://<your-app>/family?invite=...`.

## Environment variables (Vercel)

Set these on the Vercel project. Root directory can be the repo root (this `vercel.json` builds `apps/web`) or `apps/web`.

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled URL in production |
| `FAMILY_ACCESS_SECRET` | yes | Server signing key only. Never typed or sent through chat |
| `FAMILY_ICAL_URL` | no | iCloud public-share URL (`webcal://` or `https://`). Leave empty for the sample calendar |
| `BLOB_READ_WRITE_TOKEN` | yes in prod | Vercel Blob |
| `CRON_SECRET` | yes in prod | Protects the reminder cron |
| `NEXT_PUBLIC_APP_URL` | yes | `https://<deployment>` |
| `EXPO_PUBLIC_API_URL` | for the phone build | Same origin as the web app |
| `NEXT_PUBLIC_ALLOW_EVENT_FIXTURES` | no | Set to `1` to allow `?fixture=events-0`, `events-3`, or `events-12` on production-like deploys. Local `next dev` already allows it. |

Do not commit secrets. This repo is public.

## TestFlight (ready, not submitted)

```bash
cd apps/mobile
npx eas login
npx eas init          # writes the real projectId into app.json
npx eas build -p ios --profile preview
npx eas submit -p ios --profile production
```

Bundle id is `com.focusotter.liendoplaza`. Apple Team ID is `QEP46P7WF2`. Universal links use `/.well-known/apple-app-site-association` (`appID` `QEP46P7WF2.com.focusotter.liendoplaza`) and `applinks:` on `liendo-plaza.vercel.app` plus the current preview host. Point `EXPO_PUBLIC_API_URL` at the Vercel URL before the build. This repo does not run EAS builds.

## Scripts

```bash
pnpm --filter @liendo/web build
pnpm --filter @liendo/mobile typecheck
pnpm --filter @liendo/mobile export
pnpm db:migrate
pnpm db:seed
pnpm db:reset && pnpm db:seed && pnpm test:e2e   # e2e expects bootstrap to be open
```

## Design

Kitchen UI follows Hallmark theme **Solstice**: cream paper, Fraunces (SOFT 100, WONK, high opsz) and Figtree, gold hairlines, one vermilion signal. Person colors do the rest. Copy is plain.

## What is stubbed

- Push delivery is implemented, but a simulator or this VM will not show a real lock-screen notification.
- Vercel Blob is used when the token is present; local uploads fall back to disk.
- The committed calendar is a short synthetic `.ics`. Plug the real iCloud URL in env.
- EAS `projectId` and App Store Connect id are placeholders until `eas init`.

# Liendo Plaza

The Liendo kitchen board and phones. A wall calendar you can tap: today in Davenport, the family iCloud calendar (read-only), chores with stars, and dinner.

Focus and Jess are parents. Sofia (15), Noah (13), and Xavier (9) are the kids. Each person keeps one color on the board, the chores, and the stars.

## What is here

```
apps/web      Next.js App Router. Kitchen display, a phone-sized web app, and the API.
apps/mobile   Expo + expo-router. iPhone app for TestFlight.
packages/shared   People, types, and date helpers.
```

The kitchen frame opens `/display` full-screen (landscape, 15.6"). A 10" frame can open the same preview URL. Phones use the Expo app, or `/family` in a browser.

## Architecture

- **API:** Next.js route handlers in `apps/web/app/api`. One router in `lib/api.ts` serves both the board and the phones.
- **Data:** Postgres (Neon in production, local Postgres on this machine) through Drizzle. Migrations live in `apps/web/drizzle`.
- **Calendar:** Server reads `FAMILY_ICAL_URL` (webcal becomes https). The feed is parsed once, cached for about four minutes, and only expanded from today through five weeks. The URL never goes to a browser. If the env var is empty, a small synthetic `apps/web/data/sample.ics` is used. Real iCloud data is not in the repo.
- **Photos:** Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (private or an unguessable path). Local disk under `apps/web/data/uploads` otherwise. Images are resized and compressed on upload.
- **Auth:** A long family code first (`FAMILY_ACCESS_SECRET`). Then a name and PIN. Kids use 4 digits, parents 6. PINs are bcrypt hashes. Five wrong tries lock that person for 15 minutes. The phone keeps a session token in SecureStore. The kitchen board stores a long-lived httpOnly cookie after one pairing. Parent-only writes are checked on the server.
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
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Seed PINs (change these after first login):

- Focus, Jess: `123456`
- Sofia, Noah, Xavier: `1234`

Open [http://localhost:3000/display](http://localhost:3000/display) and paste the family code once. Open [http://localhost:3000/family](http://localhost:3000/family) for the phone screens.

## Pair the kitchen display

1. Set `FAMILY_ACCESS_SECRET` in Vercel (and locally).
2. On the frame, open `https://<your-app>/display`.
3. Type or paste the family code. The board sets a cookie and remembers the pairing.
4. A public visitor without that cookie sees only the pairing form.

To pair again on another frame, use the same code. Deep link for phones: `liendoplaza://?code=...` or `https://<your-app>/join?code=...`.

## Environment variables (Vercel)

Set these on the Vercel project. Root directory can be the repo root (this `vercel.json` builds `apps/web`) or `apps/web`.

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled URL in production |
| `FAMILY_ACCESS_SECRET` | yes | Long random family code |
| `FAMILY_ICAL_URL` | no | iCloud public-share URL (`webcal://` or `https://`). Leave empty for the sample calendar |
| `BLOB_READ_WRITE_TOKEN` | yes in prod | Vercel Blob |
| `CRON_SECRET` | yes in prod | Protects the reminder cron |
| `NEXT_PUBLIC_APP_URL` | yes | `https://<deployment>` |
| `EXPO_PUBLIC_API_URL` | for the phone build | Same origin as the web app |

Do not commit secrets. This repo is public.

## TestFlight (ready, not submitted)

```bash
cd apps/mobile
npx eas login
npx eas init          # writes the real projectId into app.json
npx eas build -p ios --profile preview
npx eas submit -p ios --profile production
```

Bundle id is `com.focusotter.liendoplaza`. Point `EXPO_PUBLIC_API_URL` at the Vercel URL before the build. This repo does not run EAS builds.

## Scripts

```bash
pnpm --filter @liendo/web build
pnpm --filter @liendo/mobile typecheck
pnpm --filter @liendo/mobile export
pnpm db:migrate
pnpm db:seed
pnpm test:e2e
```

## Design

Kitchen UI follows Hallmark theme **Solstice**: cream paper, Yeseva One, Archivo, gold hairlines, one vermilion signal. Person colors do the rest. Copy is plain.

## What is stubbed

- Push delivery is implemented, but a simulator or this VM will not show a real lock-screen notification.
- Vercel Blob is used when the token is present; local uploads fall back to disk.
- The committed calendar is a short synthetic `.ics`. Plug the real iCloud URL in env.
- EAS `projectId` and App Store Connect id are placeholders until `eas init`.

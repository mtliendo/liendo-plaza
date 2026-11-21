# Chore agent

Parents can use **Chores → Ask** to review proposed chore changes before applying them.
The backend uses Vercel AI Gateway with deployment OIDC authentication; local real-model
requests use `AI_GATEWAY_API_KEY` from the process environment. The default model is
`anthropic/claude-haiku-5.5`, with `google/gemini-2.5-flash-lite` as fallback.
Override the primary model with `CHORE_AGENT_MODEL`.

Start the backend with `CHORE_AGENT_FAKE=1 pnpm dev` before running
`apps/ios/scripts/ui-tests.sh`. The script cannot change an already-running server's
environment. Fake mode is deterministic and disabled when `VERCEL_ENV=production`.

# Liendo Plaza · native iPhone pilot

SwiftUI, iOS 17+, no third-party dependencies. This pilot covers first-parent
bootstrap, QR/short-code pairing, invite links, role-based tabs, dinner,
chore completion/undo and photo proof, and parent short-code device approval.

## Open and run

Open `LiendoPlaza.xcodeproj` directly and select the shared **LiendoPlaza**
scheme and an iPhone simulator. The generated project is committed.
`project.yml` is the source of truth; after changing it, run `xcodegen generate`
from this directory.

Start the backend using the root [README](../../README.md). **Gotcha:** database
scripts use tsx, not Next's env loader. From the repository root, run
`set -a; source .env.local; set +a` before `pnpm db:migrate`, `pnpm db:seed`,
or `pnpm db:reset`. Reset deletes sessions/devices, so bootstrap reopens.

The default API is `http://localhost:3000` (the Mac host from the simulator).
On a physical phone use a deployed HTTPS API. Set the Xcode build setting
`LP_API_URL` to that origin, or set the scheme's launch environment variable
`LP_API_URL`; the launch environment takes precedence over Info.plist.
ATS permits local networking only, not arbitrary insecure remote HTTP.

```sh
xcodebuild -project apps/ios/LiendoPlaza.xcodeproj -scheme LiendoPlaza \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  build CODE_SIGNING_ALLOWED=NO
```

Seed PINs: Focus/Jess `123456`, Sofia/Noah/Xavier `1234`.
Session and short-lived family tokens live in Keychain. `-uiTestReset` clears
both and the remembered person at launch (uninstall alone does not reliably clear Keychain). Sign out
keeps a family token, but it expires after 15 minutes; the app re-pairs when
that token is rejected. A first-parent bootstrap returns only a session.

Invite links: `liendoplaza://?invite=…`, or the configured associated domains'
`/family?invite=…` and `/join?invite=…`. Redeeming is one-time.

## Tests

The shared scheme includes Codable/date-filter unit tests and three API-backed
XCUITests. Run model tests alone without resetting backend data:

```sh
xcodebuild -project apps/ios/LiendoPlaza.xcodeproj -scheme LiendoPlaza \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  test -only-testing:LiendoPlazaTests CODE_SIGN_IDENTITY="-"
```

A fully unsigned build (`CODE_SIGNING_ALLOWED=NO`) compiles, but Keychain
requires the simulator's ad-hoc signature at runtime. Simulator builds default
to `CODE_SIGN_IDENTITY="-"`; no Apple signing identity or provisioning profile
is needed. Do not disable signing for simulator runs/tests.

Run the complete, destructive local integration suite from any directory:

```sh
apps/ios/scripts/ui-tests.sh --record "$HOME/friction/ios-uitests.mp4"
```

The backend must already be running, and must use the database configured in
the root `.env.local`. **The script resets and seeds that database twice.**
It checks `/api/health` before doing anything destructive, builds for testing
once, runs bootstrap alone, resets again, bootstraps a curl parent, and runs
the kid complete/undo and parent device-approval tests plus model tests.
Every UI test starts with `-uiTestReset`. Parent authorization is passed through
`TEST_RUNNER_LP_PARENT_TOKEN`; never enable shell tracing or commit this token.
`LP_API_URL` defaults to localhost:3000; `DESTINATION` overrides the default
`platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5`. Recording resolves the
destination's UDID, boots it if necessary, and finishes the MP4 with SIGINT,
including on test failure. Existing video files are not overwritten.
Results/logs are saved in unique `build/ui-*` directories, ignored by Git.
Screenshots are keep-always xcresult attachments:

```sh
xcrun xcresulttool export attachments --path build/ui-*/paired.xcresult \
  --output-path "$HOME/friction/attachments"
```

Choose one concrete result path when more than one run exists. Tests use
30–60 second waits for the slow local snapshot. Debug-only session/family
injection is accepted only alongside `-uiTestReset`; Release ignores it.
If the root `.env.local` is absent, the script also accepts an exported
`DATABASE_URL`, so no backend configuration file needs to be created.

Accessibility IDs include `person.noah`, `pin`, `open`, `pairing.code`, `chore.<title>`,
`status.<title>`, `chore.status`, `chore.complete`, `chore.undo`, `signOut`,
`addDevice`, `addDevice.code`, and `addDevice.approve`.

## Out of scope

Calendar and stars/rewards screens. Parents can edit dinners,
navigate weeks, manage chore schedules and review proof photos.
Groceries uses the Apple Reminders list named "Groceries"; share that list
in Reminders for iCloud sync and Siri. Full Reminders access is required.
Debug UI tests use `-uiTestGroceries` for an isolated in-memory list.
Kids see their star balance and a one-tap chore checkbox.
Photo chores use the camera (photo library on the simulator) and wait for
parent review after upload. Kids receive one local reminder for today's open
chores at the household reminder time (default 6 PM America/Chicago); permission
is requested after sign-in for parents and kids. Local reminders do not update while the
app is closed, and a reminder time that has already passed is not rescheduled.
Snapshot loading is explicit; completion/undo replaces the returned instance
locally without waiting for the slow full snapshot.

## TestFlight

### Native push setup

Enable **Push Notifications** on the explicit Apple Developer App ID
`com.focusotter.liendoplaza` (team `QEP46P7WF2`), then regenerate/refresh
development and App Store distribution provisioning profiles. Xcode automatic
signing may do this with developer-portal access. Debug uses the development
APNs entitlement and sandbox tokens; Release/TestFlight uses production.
No background remote-notification mode is needed for these visible alerts.

Set these server-only Vercel variables, then redeploy:

- `APNS_KEY_P8`: the APNs-enabled `.p8` private key (not the ASC upload key).
- `APNS_KEY_ID`: its Apple key ID.
- `APNS_TEAM_ID=QEP46P7WF2`.
- `APNS_BUNDLE_ID=com.focusotter.liendoplaza`.
- Keep `DATABASE_URL`, `FAMILY_ACCESS_SECRET`, and `CRON_SECRET` configured.

Apply `pnpm --filter @liendo/web db:migrate` to the deployment database before
deploying the new API. `0004_native_push.sql` preserves existing tokens as Expo
tokens. Never expose APNs variables with a `NEXT_PUBLIC_` prefix.

The app requests permission after authenticated identity is known, registers
with Apple on launch/sign-in/activation, and posts token changes to
`POST /api/push/register` with `kind: "apns"` and `environment`.
Sign-out calls `POST /api/push/unregister` before logout (best effort offline).
Native token ownership transfers to the current person on shared phones.
The cached device token is only for unregistering; registration always asks
Apple again. Denied permission can be changed in iOS Settings.

Native **local chore reminders are retained**. The reminder cron continues to
send only to Expo tokens rather than also sending APNs chore reminders,
including while APNs credentials are absent. Proof waiting/review and reward
request/review pushes go to both providers. Missing APNs variables log a skip;
Expo continues working. JWTs are cached for 50 minutes. Invalid APNs tokens
(`410 Unregistered`, `400 BadDeviceToken`) are removed.

An upgrade from the Expo app may retain a working legacy Expo registration for
the same phone. These opaque tokens cannot be matched to APNs tokens, so remove
that phone's legacy registration if it causes duplicate alerts. Other Expo
devices' registrations are deliberately preserved.

APNs signing and physical-device delivery require the real key and provisioned
device build; simulator/model tests cannot certify delivery to TestFlight.

```sh
export ASC_KEY_PATH="/secure/path/AuthKey_YOURKEY.p8"
export ASC_KEY_ID="YOURKEY"
export ASC_ISSUER_ID="YOUR-ISSUER-UUID"
export LP_API_URL="https://liendo-plaza.vercel.app"
export BUILD_NUMBER="1234567890"
apps/ios/scripts/testflight.sh
```

This archives Release for generic iOS, then exports and **uploads** using
`scripts/ExportOptions.plist`, automatic signing, team QEP46P7WF2 and App Store
Connect API-key authentication. Missing settings are listed before any build.
Use a numeric BUILD_NUMBER greater than **every previous EAS/App Store build**
for com.focusotter.liendoplaza; without it the script uses Unix epoch seconds.
The script cannot check existing build numbers without Apple access. Outputs
are under ignored `build/testflight-<build>/`. Do not commit API keys.
You need App Store Connect access to this app/team, a key with upload and
signing permissions, and permission for Xcode to create/download signing
assets. A successful simulator build does not establish device signing access.

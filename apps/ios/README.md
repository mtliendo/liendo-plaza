# Liendo Plaza · native iPhone pilot

SwiftUI, iOS 17+, no third-party dependencies. This pilot covers first-parent
bootstrap, QR/short-code pairing, invite links, Today, chore completion/undo,
and parent short-code device approval.

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
both at launch (uninstall alone does not reliably clear Keychain). Sign out
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

Accessibility IDs include `person.noah`, `pin`, `open`, `pairing.code`, `chore.<title>`,
`status.<title>`, `chore.status`, `chore.complete`, `chore.undo`, `signOut`,
`addDevice`, `addDevice.code`, and `addDevice.approve`.

## Out of scope

Calendar, dinner editing, stars/rewards screens, photos/camera, other parent
management, and APNs push. Photo-required chores display an explanatory note.
Snapshot loading is explicit; completion/undo replaces the returned instance
locally without waiting for the slow full snapshot.

## TestFlight

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

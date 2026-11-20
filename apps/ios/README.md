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

The shared scheme includes Codable/date-filter unit tests and an XCUITest
pairing-launch smoke test. Backend must be running for UI tests:

```sh
xcodebuild -project apps/ios/LiendoPlaza.xcodeproj -scheme LiendoPlaza \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  test CODE_SIGNING_ALLOWED=NO
```

A follow-up step will add the full UI test orchestration script. Accessibility
IDs include `person.noah`, `pin`, `open`, `pairing.code`, `chore.<title>`,
`status.<title>`, `chore.status`, `chore.complete`, `chore.undo`, `signOut`,
`addDevice`, `addDevice.code`, and `addDevice.approve`.

## Out of scope

Calendar, dinner editing, stars/rewards screens, photos/camera, other parent
management, and APNs push. Photo-required chores display an explanatory note.
Snapshot loading is explicit; completion/undo replaces the returned instance
locally without waiting for the slow full snapshot.

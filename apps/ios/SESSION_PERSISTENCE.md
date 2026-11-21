# Build 7 → 8 session investigation (read-only)

The reported production phone last-seen time (04:48Z) is not enough to identify
why the installed app later showed **Pair this phone**. No production database,
Vercel configuration or Michael's device was accessed for this investigation.

## Checked evidence

- The retained build 7 archive and exported build 8 IPA both have
  `LPAPIURL=https://liendo-plaza.vercel.app` and application identifier
  `QEP46P7WF2.com.focusotter.liendoplaza`. No API-origin or signing-prefix change
  was found in these artifacts.
- Comparing main immediately before and after PR #11: `Sources/API.swift` is
  unchanged. Keychain still uses generic passwords, service
  `com.focusotter.liendoplaza`, account `session`, default access group and
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. No explicit
  `keychain-access-groups` entitlement was added or changed. The added
  `aps-environment` entitlement does not itself change that Keychain query.
- `House` still reads `session` on initialization. PR #11's new APNs cache is
  a separate `apns.<environment>` key, not the session key. Registration failure
  does not clear the session.
- `LiendoPlazaApp` presents pairing only when `house.session == nil` in build 8.
  `House.load()` requests `/api/me`, then `/api/snapshot`; a 401 from either
  calls `clearSession()` and deletes the Keychain session. Other HTTP/network
  failures do not deliberately clear it.
- `requireActor` reads the Bearer token; `personFromSession` hashes it and
  requires an unexpired session joined to a person, plus an unrevoked attached
  device. A last-seen timestamp is historical presence, not evidence that this
  installation still has that particular Bearer token or that its joined
  session is still valid.

## Reachable explanations, not a confirmed incident diagnosis

1. A missing/unreadable local Keychain item makes the initial session nil.
   `Keychain.read` returns nil for every Keychain read error, not just absence.
   A reinstall/device restore, different installation history or transient
   protected-storage error is possible; none was observed on Michael's phone.
2. A server 401 on `/me` or `/snapshot` clears an initially present session.
   Expiry, deleted session or revoked device can cause this in the server code.
   Which token/request Michael's installation sent is unverified.
3. Explicit sign-out or a phone invite deep link can clear the session. Both
   paths existed in build 7; there is no evidence either ran in this incident.

The artifact comparison specifically argues against an APNs-induced access
group/key-name or API-origin change; it does not prove either of the remaining
paths ran. Discriminating evidence would be device Keychain OSStatus at launch
and the status/path of the first authenticated request, correlated with that
session's expiry/revocation (never logging the token itself). No speculative
session-storage fix was made. The family-code UI test now checks that a real
session survives terminating/relaunching without the test reset flag, then
checks explicit sign-out and code re-login.

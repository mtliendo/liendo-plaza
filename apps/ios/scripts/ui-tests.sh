#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
API="${LP_API_URL:-http://localhost:3000}"
DESTINATION="${DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5}"
export LP_DESTINATION="$DESTINATION"
RECORD=""
if [[ "${1:-}" == "--record" && $# == 2 ]]; then
  RECORD="$2"
elif [[ $# != 0 ]]; then
  echo "Usage: $0 [--record file.mp4]" >&2
  exit 1
fi
if ! curl --fail --silent --show-error --max-time 10 "$API/api/health" |
  python3 -c 'import json,sys; assert json.load(sys.stdin).get("ok") is True' 2>/dev/null; then
  echo "Backend unavailable: expected {\"ok\":true} at $API/api/health. Start the backend first." >&2
  exit 1
fi
[[ -f "$ROOT/.env.local" ]] || { echo "Missing $ROOT/.env.local (DATABASE_URL required)." >&2; exit 1; }
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
RUN="$ROOT/apps/ios/build/ui-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$RUN"
OPTIONS=(-project "$ROOT/apps/ios/LiendoPlaza.xcodeproj" -scheme LiendoPlaza
  -destination "$DESTINATION" -derivedDataPath "$ROOT/apps/ios/build/DerivedData"
  -parallel-testing-enabled NO CODE_SIGN_IDENTITY=-)
RECORDER=""
cleanup() {
  if [[ -n "$RECORDER" ]]; then
    kill -INT "$RECORDER" 2>/dev/null || true
    wait "$RECORDER" || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ -n "$RECORD" ]]; then
  UDID="$(xcodebuild "${OPTIONS[@]}" -showdestinations 2>/dev/null |
    python3 -c '
import os,re,sys
destination=os.environ["LP_DESTINATION"]
fields=dict(item.split("=",1) for item in destination.split(","))
for line in sys.stdin:
    if "platform:iOS Simulator" not in line or "placeholder" in line: continue
    values=dict(re.findall(r"(\w+):\s*([^,}]+)",line))
    if all(values.get(k,"").strip()==v for k,v in fields.items()):
        print(values["id"].strip()); break
else: sys.exit("Could not resolve recording simulator; use DESTINATION with name/OS or id.")')"
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" -b
  mkdir -p "$(dirname "$RECORD")"
  [[ ! -e "$RECORD" ]] || { echo "Recording already exists: $RECORD" >&2; exit 1; }
  xcrun simctl io "$UDID" recordVideo --codec=h264 "$RECORD" >"$RUN/recording.log" 2>&1 &
  RECORDER=$!
fi
reset_database() (
  cd "$ROOT"
  set -a
  source .env.local
  set +a
  npx --yes pnpm@10.15.0 db:reset
  npx --yes pnpm@10.15.0 db:seed
)
export TEST_RUNNER_LP_API_URL="$API"
unset TEST_RUNNER_LP_PARENT_TOKEN
xcodebuild "${OPTIONS[@]}" build-for-testing >"$RUN/build.log" 2>&1 ||
  { tail -60 "$RUN/build.log"; exit 1; }
reset_database
xcodebuild "${OPTIONS[@]}" test-without-building \
  -only-testing:LiendoPlazaUITests/PilotUITests/testFirstParentBootstrapShowsToday \
  -resultBundlePath "$RUN/bootstrap.xcresult" | tee "$RUN/bootstrap.log"
reset_database
PARENTS="$(curl --fail --silent --show-error "$API/api/pair/status")"
PERSON="$(printf '%s' "$PARENTS" | python3 -c 'import json,sys; print(next(p["id"] for p in json.load(sys.stdin)["parents"] if p["slug"]=="focus"))')"
RESPONSE="$(curl --fail --silent --show-error -H 'Content-Type: application/json' \
  -d "{\"personId\":\"$PERSON\",\"pin\":\"123456\",\"deviceKind\":\"phone\"}" "$API/api/pair/bootstrap")"
TEST_RUNNER_LP_PARENT_TOKEN="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
export TEST_RUNNER_LP_PARENT_TOKEN
unset RESPONSE
xcodebuild "${OPTIONS[@]}" test-without-building \
  -skip-testing:LiendoPlazaUITests/PilotUITests/testFirstParentBootstrapShowsToday \
  -resultBundlePath "$RUN/paired.xcresult" | tee "$RUN/paired.log"
unset TEST_RUNNER_LP_PARENT_TOKEN
echo "Results: $RUN"

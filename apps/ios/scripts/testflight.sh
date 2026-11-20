#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MISSING=()
for NAME in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID LP_API_URL; do
  [[ -n "${!NAME:-}" ]] || MISSING+=("$NAME")
done
if [[ ${#MISSING[@]} != 0 ]]; then
  echo "Missing required environment variables: ${MISSING[*]}" >&2
  echo "Provide an App Store Connect API key and a production HTTPS LP_API_URL." >&2
  exit 1
fi
[[ -f "$ASC_KEY_PATH" ]] || { echo "ASC_KEY_PATH is not a file: $ASC_KEY_PATH" >&2; exit 1; }
[[ "$LP_API_URL" == https://* ]] || { echo "LP_API_URL must be a production HTTPS origin." >&2; exit 1; }
BUILD="${BUILD_NUMBER:-$(date +%s)}"
[[ "$BUILD" =~ ^[0-9]+$ ]] || { echo "BUILD_NUMBER must be numeric." >&2; exit 1; }
OUTPUT="$ROOT/apps/ios/build/testflight-$BUILD"
mkdir -p "$OUTPUT"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
echo "Archiving build $BUILD. Ensure this exceeds every existing EAS/App Store build number."
xcodebuild -project "$ROOT/apps/ios/LiendoPlaza.xcodeproj" -scheme LiendoPlaza \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUTPUT/LiendoPlaza.xcarchive" "${AUTH[@]}" \
  "LP_API_URL=$LP_API_URL" "CURRENT_PROJECT_VERSION=$BUILD" archive
xcodebuild -exportArchive -archivePath "$OUTPUT/LiendoPlaza.xcarchive" \
  -exportPath "$OUTPUT/export" -exportOptionsPlist "$ROOT/apps/ios/scripts/ExportOptions.plist" \
  "${AUTH[@]}"

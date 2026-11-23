#!/usr/bin/env bash
# Runs the smoke test (mobile/ci/SmokeUITests.swift) on an iPhone simulator made for this run, so
# the app is a fresh install with no data. macOS runner, bash 3.2.
#   mobile/ci/smoke.sh <out dir>
# Expects the smoke copy synced into the project (scripts/web.ts --smoke, cap sync ios) and the
# AppSmoke scheme (ci/add-ui-tests.rb). Writes into <out dir>: xcodebuild.log, smoke.txt (the
# SMOKE lines), screenshots/ (each step's), device.txt; and the steps to the run's Summary.
set -uo pipefail

out="$(mkdir -p "$1" && cd "$1" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
project="${here}/../ios/App/App.xcodeproj"
dd="${RUNNER_TEMP:-/tmp}/dd-smoke"
result="${RUNNER_TEMP:-/tmp}/smoke.xcresult"
rm -rf "${result}"

# The newest iOS runtime; a Pro Max like the user's iPhone 14 Pro Max when there is one.
read -r runtime device <<EOF
$(xcrun simctl list -j | python3 -c '
import json, sys
d = json.load(sys.stdin)
rts = [r for r in d["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS")]
rt = max(rts, key=lambda r: [int(x) for x in r["version"].split(".")])
phones = [t for t in rt.get("supportedDeviceTypes", []) if t.get("productFamily") == "iPhone"]
pick = [t for t in phones if t["name"].endswith("Pro Max")] or phones
print(rt["identifier"], pick[-1]["identifier"])')
EOF
udid="$(xcrun simctl create war-game-smoke "${device}" "${runtime}")"
echo "simulator ${udid}: ${device} on ${runtime}" | tee "${out}/device.txt"
cleanup() { xcrun simctl shutdown "${udid}" >/dev/null 2>&1; xcrun simctl delete "${udid}" >/dev/null 2>&1; }
trap cleanup EXIT
xcrun simctl boot "${udid}"
xcrun simctl bootstatus "${udid}" -b >/dev/null

start=$SECONDS
xcodebuild test -project "${project}" -scheme AppSmoke -configuration Debug \
    -destination "id=${udid}" -derivedDataPath "${dd}" -resultBundlePath "${result}" \
    -parallel-testing-enabled NO >"${out}/xcodebuild.log" 2>&1
status=$?
echo "xcodebuild test: exit ${status} after $((SECONDS - start)) s (build and test)"
grep -E '^SMOKE |error:|Test Case .*(passed|failed)|XCTAssert|\*\* TEST' "${out}/xcodebuild.log" | tail -n 80
grep -o 'SMOKE .*' "${out}/xcodebuild.log" >"${out}/smoke.txt" || true

# The screenshots, named by their step.
mkdir -p "${out}/screenshots"
if xcrun xcresulttool export attachments --path "${result}" --output-path "${out}/screenshots" >/dev/null 2>&1; then
    python3 - "${out}/screenshots" <<'PY'
import json, os, sys
d = sys.argv[1]
manifest = os.path.join(d, "manifest.json")
if os.path.exists(manifest):
    for test in json.load(open(manifest)):
        for a in test.get("attachments", []):
            src = os.path.join(d, a["exportedFileName"])
            name = a.get("suggestedHumanReadableName") or a["exportedFileName"]
            if os.path.exists(src):
                os.replace(src, os.path.join(d, name))
PY
else
    echo "::warning::xcresulttool export attachments failed; the screenshots are only in the result bundle"
fi
ls "${out}/screenshots"

app="${dd}/Build/Products/Debug-iphonesimulator/App.app"
if [ -d "${app}" ]; then bash "${here}/check-app.sh" "${app}" smoke || status=1; fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
        echo "### Smoke test ($(cat "${out}/device.txt"))"
        echo
        echo "xcodebuild test exit ${status}, $((SECONDS - start)) s. Steps (seconds from the app's first launch):"
        echo
        echo '```'
        cat "${out}/smoke.txt"
        echo '```'
    } >>"${GITHUB_STEP_SUMMARY}"
fi
exit "${status}"

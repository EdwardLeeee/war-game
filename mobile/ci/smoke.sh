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

# The newest iOS runtime; the user's iPhone 14 Pro Max when the runtime has it, else the newest Pro Max.
read -r runtime device <<EOF
$(xcrun simctl list -j | python3 -c '
import json, sys
d = json.load(sys.stdin)
rts = [r for r in d["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS")]
rt = max(rts, key=lambda r: [int(x) for x in r["version"].split(".")])
phones = [t for t in rt.get("supportedDeviceTypes", []) if t.get("productFamily") == "iPhone"]
model = lambda t: int("".join(c for c in t["name"].split()[1] if c.isdigit()) or 0)
pick = [t for t in phones if t["name"] == "iPhone 14 Pro Max"] or sorted((t for t in phones if t["name"].endswith("Pro Max")), key=model) or phones
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

# The attachments: the test's screenshots (PNG, named by their step) into screenshots/, XCTest's
# own (debug descriptions, UI snapshots) into attachments/; no screen recording (artifacts hold
# screenshots and logs only). Names made safe for an artifact (no " : < > | * ? or line breaks).
raw="${RUNNER_TEMP:-/tmp}/smoke-attachments"
rm -rf "${raw}"
if xcrun xcresulttool export attachments --path "${result}" --output-path "${raw}" >/dev/null 2>&1; then
    python3 - "${raw}" "${out}" <<'PY'
import json, os, re, shutil, sys
raw, out = sys.argv[1], sys.argv[2]
for sub in ("screenshots", "attachments"):
    os.makedirs(os.path.join(out, sub), exist_ok=True)
for test in json.load(open(os.path.join(raw, "manifest.json"))):
    for a in test.get("attachments", []):
        src = os.path.join(raw, a["exportedFileName"])
        name = a.get("suggestedHumanReadableName") or a["exportedFileName"]
        name = re.sub(r"_\d+_[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}", "", name)
        name = re.sub(r'["`:<>|*?\r\n/\\]+', "_", name).strip()
        if not os.path.exists(src) or name.endswith(".mp4"):
            continue
        sub = "screenshots" if name.endswith(".png") else "attachments"
        shutil.copyfile(src, os.path.join(out, sub, name))
PY
else
    echo "::warning::xcresulttool export attachments failed; the screenshots are only in the result bundle"
fi
ls "${out}/screenshots" "${out}/attachments" 2>/dev/null

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

#!/usr/bin/env bash
# Runs the smoke test (mobile/ci/SmokeUITests.swift) on an iPhone simulator made for this run, so
# the app is a fresh install with no data. macOS runner, bash 3.2.
#   mobile/ci/smoke.sh <out dir>
# Expects the smoke copy synced into the project (scripts/web.ts --smoke, cap sync ios) and the
# AppSmoke scheme (ci/add-ui-tests.rb). Writes into <out dir>: xcodebuild.log, smoke.txt (the
# SMOKE lines), screenshots/ (each step's), device.txt; stable-*.txt (按鈕不動) and facts*.txt (the
# web view's screen); and all of it to the run's Summary.
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
    -parallel-testing-enabled NO -skip-testing:AppUITests/SmokeUITests/testViewFacts \
    -skip-testing:AppUITests/SmokeUITests/testViewFactsSafari -skip-testing:AppUITests/SmokeUITests/testStableButtons \
    >"${out}/xcodebuild.log" 2>&1
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
# The Home Screen, the app closed: the name under the icon (an English simulator: "Divide & Crown",
# the user 2026-11-24): whole, or cut short?
mkdir -p "${out}/screenshots"
xcrun simctl terminate "${udid}" com.edwardleeee.wargame >/dev/null 2>&1 || true
sleep 3
xcrun simctl io "${udid}" screenshot "${out}/screenshots/06-home-screen.png" >/dev/null 2>&1 || echo "::warning::no Home Screen screenshot"

# The web view's screen, measured (client 2026-11-27): mobile-diag.js's "mobile-view" line in both
# landscapes, at the system's default and largest text size, and the same page in Safari. Each a
# test run of its own on the built app (test-without-building); failures are warnings only.
# A test of its own on the built app: run <label> <test> [VAR=value for it]; its SMOKE lines into
# <label>.txt, its screenshots (named by the test) into screenshots/; returns xcodebuild's exit.
run() {
    local label="$1" test="$2" r="${RUNNER_TEMP:-/tmp}/$1.xcresult" code=0
    shift 2
    rm -rf "${r}" "${r}.att"
    # The SMOKE lines go to the job's log as they come too: a run cancelled midway uploads no
    # artifact (run 46110331648 lost 50 minutes of 按鈕不動 that way).
    echo "${label}: ${test}"
    env "$@" xcodebuild test-without-building -project "${project}" -scheme AppSmoke \
        -configuration Debug -destination "id=${udid}" -derivedDataPath "${dd}" -resultBundlePath "${r}" \
        -parallel-testing-enabled NO -only-testing:"AppUITests/SmokeUITests/${test}" 2>&1 |
        tee "${out}/${label}.log" | grep --line-buffered -o 'SMOKE .*'
    code=${PIPESTATUS[0]}
    grep -o 'SMOKE .*' "${out}/${label}.log" >"${out}/${label}.txt" || true
    if xcrun xcresulttool export attachments --path "${r}" --output-path "${r}.att" >/dev/null 2>&1; then
        python3 - "${r}.att" "${out}/screenshots" <<'PY'
import json, os, re, shutil, sys
raw, out = sys.argv[1], sys.argv[2]
for test in json.load(open(os.path.join(raw, "manifest.json"))):
    for a in test.get("attachments", []):
        name = re.sub(r"_\d+_[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}", "", a.get("suggestedHumanReadableName") or "")
        name = re.sub(r'["`:<>|*?\r\n/\\]+', "_", name).strip()
        if name.endswith(".png"):
            shutil.copyfile(os.path.join(raw, a["exportedFileName"]), os.path.join(out, name))
PY
    fi
    return "${code}"
}

# 按鈕不動 (ceo 2026-11-27): client's page (client/src/lab/stable-buttons.ts) says where to tap and
# measures; SmokeUITests.testStableButtons taps. A box that moves, a tap that misses or a wrong
# reaction fails the smoke test, and so the release (nothing is uploaded). Required once the game
# built here has the client's module; before that, a page without it is only noted.
# The page's processes (the app, its web content, the test runner): %CPU and memory, for the log.
cpu() {
    ps -Ao pcpu=,rss=,comm= | grep -E 'com\.apple\.WebKit\.WebContent$|/App\.app/App$|AppUITests-Runner' |
        sed -E 's#^ *([0-9.]+) +([0-9]+) +.*/#\1 \2 #' | awk '{printf "%s %s%% %dMB; ", $3, $1, $2 / 1024}'
}

# A watchdog beside each 按鈕不動 run (ceo 2026-11-28: run 46116501545 went silent for 7 minutes
# after step 117, stuck inside an XCUITest call, so the test's own 60 s rule never ran): the page's
# CPU into the log every minute; no new SMOKE line for 120 s: a screenshot, the CPU, then the test
# is stopped, and so fails. Its lines go to the job's log and to <label>-watchdog.txt.
watchdog() { # watchdog <label> <test>
    local log="${out}/$1.log" note="${out}/$1-watchdog.txt" last=-1 n since=$SECONDS beat=$SECONDS
    while sleep 10; do
        n=$(grep -c 'SMOKE ' "${log}" 2>/dev/null || true)
        if [ "${n}" != "${last}" ]; then
            last=${n}
            since=$SECONDS
        elif [ $((SECONDS - since)) -ge 120 ]; then
            echo "SMOKE $1 watchdog: no SMOKE line for 120 s (stuck in the page or in XCUITest); stopping the test. cpu: $(cpu)" | tee -a "${note}"
            xcrun simctl io "${udid}" screenshot "${out}/screenshots/$1-stuck.png" >/dev/null 2>&1
            pkill -f "[x]codebuild test-without-building.*SmokeUITests/$2"
            return
        fi
        if [ $((SECONDS - beat)) -ge 60 ]; then
            beat=$SECONDS
            echo "SMOKE $1 cpu at $((SECONDS - since)) s quiet: $(cpu)" | tee -a "${note}"
        fi
    done
}

# First the tapping side alone, on mobile-diag.js's stand-in (stable=fake): it must always pass.
required=0
[ -f "${here}/../../client/src/lab/stable-buttons.ts" ] && required=1
for check in "stable-self-check mobile-stable-fake 1" "stable-buttons mobile-stable-buttons ${required}"; do
    set -- ${check}
    code=0
    watchdog "$1" testStableButtons &
    dog=$!
    run "$1" testStableButtons TEST_RUNNER_STABLE_LINK="$2" TEST_RUNNER_STABLE_REQUIRED="$3" || code=$?
    kill "${dog}" >/dev/null 2>&1 || true
    wait "${dog}" 2>/dev/null || true
    cat "${out}/$1-watchdog.txt" >>"${out}/$1.txt" 2>/dev/null || true
    echo "SMOKE $1: exit ${code} (required $3)" >>"${out}/stable.txt"
    cat "${out}/$1.txt" >>"${out}/stable.txt"
    if [ "${code}" -ne 0 ]; then
        echo "::error::按鈕不動 ($1): xcodebuild exit ${code}"
        grep -E 'error:|XCTAssert|failed' "${out}/$1.log" | tail -n 20
        status=1
    fi
    xcrun simctl terminate "${udid}" com.edwardleeee.wargame >/dev/null 2>&1 || true
    # After a watchdog stop the test runner may still be there.
    xcrun simctl terminate "${udid}" com.edwardleeee.wargame.smoketests.xctrunner >/dev/null 2>&1 || true
done
cat "${out}/stable.txt"

# The web view's screen, measured (client 2026-11-27): mobile-diag.js's "mobile-view" line in both
# landscapes, at the system's default and largest text size, and the same page in Safari.
# Failures are warnings only.
facts() { # facts <label> <test>
    run "facts-$1" "$2" TEST_RUNNER_VIEW_LABEL="$1" || echo "::warning::view facts $1: xcodebuild exit $?"
    echo "SMOKE facts-$1 text size: $(xcrun simctl ui "${udid}" content_size 2>&1)" >>"${out}/facts.txt"
    cat "${out}/facts-$1.txt" >>"${out}/facts.txt"
}
facts app-default testViewFacts
xcrun simctl terminate "${udid}" com.edwardleeee.wargame >/dev/null 2>&1 || true
xcrun simctl ui "${udid}" content_size accessibility-extra-extra-extra-large || echo "::warning::could not set the text size"
facts app-largest-text testViewFacts
xcrun simctl terminate "${udid}" com.edwardleeee.wargame >/dev/null 2>&1 || true
xcrun simctl ui "${udid}" content_size large >/dev/null 2>&1 || true
python3 -m http.server 8765 --bind 127.0.0.1 --directory "${here}/../ios/App/App/public" >/dev/null 2>&1 &
server=$!
sleep 2
xcrun simctl openurl "${udid}" "http://127.0.0.1:8765/index.html" || echo "::warning::could not open Safari"
sleep 10
facts safari testViewFactsSafari
kill "${server}" >/dev/null 2>&1 || true
cat "${out}/facts.txt"
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
        echo
        echo "按鈕不動 (the stand-in, then client's stable-buttons page):"
        echo
        echo '```'
        cat "${out}/stable.txt" 2>/dev/null
        echo '```'
        echo
        echo "The web view's screen (mobile-view):"
        echo
        echo '```'
        cat "${out}/facts.txt" 2>/dev/null
        echo '```'
    } >>"${GITHUB_STEP_SUMMARY}"
fi
exit "${status}"

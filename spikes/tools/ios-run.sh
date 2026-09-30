#!/usr/bin/env bash
# Runs a spike app on an iOS simulator (macOS runner) and keeps every "SPIKE ..." line.
#   spikes/tools/ios-run.sh <App.app> <bundle id> <process name> <done regex> <timeout s> <out dir>
# Lines are collected from both the app's stdout/stderr (simctl launch --console-pty,
# where Capacitor prints console.log) and the unified log (log stream, where Godot's
# iOS logger writes), each stamped with the host clock.
# 1. Size of the .app.
# 2. Three cold starts: time from `simctl launch` to the first "SPIKE ready" line.
# 3. One full run until a SPIKE line matches <done regex> or the timeout passes.
set -uo pipefail

app="$1"
bundle="$2"
process="$3"
done_re="$4"
limit="$5"
out="$6"
mkdir -p "${out}"

udid="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
phones = [d for rt, ds in devices.items() if "iOS" in rt for d in ds if d["name"].startswith("iPhone")]
print(phones[-1]["udid"])')"
xcrun simctl list devices available | grep "${udid}" | tee "${out}/device.txt"
xcrun simctl boot "${udid}" 2>/dev/null || true
xcrun simctl bootstatus "${udid}" -b >/dev/null
xcrun simctl install "${udid}" "${app}"
echo "SPIKE size app_bytes $(du -sk "${app}" | awk '{print $1 * 1024}')" | tee "${out}/size.txt"

now() { python3 -c 'import time; print(f"{time.time():.3f}")'; }
stamp() {
    python3 -u -c '
import sys, time
for line in sys.stdin:
    print(f"{time.time():.3f} {line}", end="", flush=True)'
}

# run <file>: launch the app with both log sources feeding <file>; sets LAUNCH_PIDS and
# LAUNCH_T0 (host time just before the launch).
run() {
    : >"$1"
    xcrun simctl spawn "${udid}" log stream --style compact --level debug \
        --predicate "process == \"${process}\"" 2>/dev/null | stamp >>"$1" &
    local log_pid=$!
    sleep 2
    LAUNCH_T0="$(now)"
    xcrun simctl launch --console-pty --terminate-running-process "${udid}" "${bundle}" 2>&1 | stamp >>"$1" &
    LAUNCH_PIDS="${log_pid} $!"
}

stop() {
    xcrun simctl terminate "${udid}" "${bundle}" 2>/dev/null || true
    # shellcheck disable=SC2086
    kill ${LAUNCH_PIDS} 2>/dev/null || true
    pkill -f "log stream --style compact" 2>/dev/null || true
    sleep 1
}

wait_for() {
    local end=$((SECONDS + $3))
    while [ "${SECONDS}" -lt "${end}" ]; do
        grep -o "SPIKE .*" "$1" 2>/dev/null | grep -qE -- "$2" && return 0
        sleep 1
    done
    return 1
}

: >"${out}/coldstart.txt"
for i in 1 2 3; do
    run "${out}/launch-${i}.txt"
    if wait_for "${out}/launch-${i}.txt" "^SPIKE ready" 180; then
        ready="$(grep -m1 "SPIKE ready" "${out}/launch-${i}.txt" | awk '{print $1}')"
        echo "SPIKE coldstart run ${i} ready_ms $(python3 -c "print(round((${ready} - ${LAUNCH_T0}) * 1000))")" |
            tee -a "${out}/coldstart.txt"
    else
        echo "SPIKE coldstart run ${i} timeout" | tee -a "${out}/coldstart.txt"
    fi
    stop
done

status=0
run "${out}/run.txt"
if ! wait_for "${out}/run.txt" "${done_re}" "${limit}"; then
    echo "::error::no SPIKE line matched '${done_re}' within ${limit} s"
    status=1
fi
xcrun simctl io "${udid}" screenshot "${out}/screen.png" >/dev/null 2>&1 || true
stop
# The same line can arrive through both sources; keep the first copy of each.
grep -o "SPIKE .*" "${out}/run.txt" | tr -d '\r' | awk '!seen[$0]++' >"${out}/spike.txt" || true
data="$(xcrun simctl get_app_container "${udid}" "${bundle}" data 2>/dev/null || true)"
if [ -n "${data}" ]; then
    find "${data}" -name "*.txt" -size -2M -exec cp {} "${out}/" \; 2>/dev/null || true
fi
echo "$(wc -l <"${out}/spike.txt") SPIKE lines in ${out}/spike.txt"
exit "${status}"

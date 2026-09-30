#!/usr/bin/env bash
# Runs a spike app on the running Android emulator (inside
# reactivecircus/android-emulator-runner) and keeps every "SPIKE ..." log line.
#   spikes/tools/android-run.sh <apk> <package> <done regex> <timeout s> <out dir>
# The launcher activity is looked up from the installed package.
# 1. Size of the APK.
# 2. Three cold starts: force-stop, launch, time from ActivityManager's "Start proc" to the
#    app's "SPIKE ready" line, both on the device clock (logcat -v epoch).
# 3. One full run until a SPIKE line matches <done regex> or the timeout passes.
# Exits non-zero when the full run times out.
set -uo pipefail

apk="$1"
pkg="$2"
done_re="$3"
limit="$4"
out="$5"
mkdir -p "${out}"

adb logcat -G 16M >/dev/null 2>&1 || true
echo "SPIKE device $(adb shell getprop ro.product.model | tr -d '\r') android $(adb shell getprop ro.build.version.release | tr -d '\r') api $(adb shell getprop ro.build.version.sdk | tr -d '\r') abi $(adb shell getprop ro.product.cpu.abi | tr -d '\r')" | tee "${out}/device.txt"
adb install -r "${apk}" >/dev/null || { echo "::error::adb install failed"; exit 1; }
echo "SPIKE size apk_bytes $(stat -c %s "${apk}")" | tee "${out}/size.txt"
component="$(adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "${pkg}" | tr -d '\r' | tail -n 1)"
echo "launcher activity: ${component}"

# wait_for <regex> <seconds>: poll the log until a SPIKE line matches.
wait_for() {
    local end=$((SECONDS + $2))
    while [ "${SECONDS}" -lt "${end}" ]; do
        if adb logcat -d 2>/dev/null | grep -o "SPIKE .*" | grep -qE -- "$1"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

: >"${out}/coldstart.txt"
for i in 1 2 3; do
    adb shell am force-stop "${pkg}"
    adb logcat -c
    adb shell am start -W -n "${component}" >"${out}/am-start-${i}.txt"
    if wait_for "^SPIKE ready" 180; then
        log="$(adb logcat -d -v epoch)"
        start="$(grep -m1 "Start proc [0-9]*:${pkg}" <<<"${log}" | awk '{print $1}')"
        ready="$(grep -m1 "SPIKE ready" <<<"${log}" | awk '{print $1}')"
        if [ -n "${start}" ] && [ -n "${ready}" ]; then
            ms="$(python3 -c "print(round((${ready} - ${start}) * 1000))")"
        else
            ms="unknown"
        fi
        total="$(sed -n 's/^TotalTime: //p' "${out}/am-start-${i}.txt" | tr -d '\r')"
        echo "SPIKE coldstart run ${i} ready_ms ${ms} activity_total_ms ${total:-unknown}" | tee -a "${out}/coldstart.txt"
    else
        echo "SPIKE coldstart run ${i} timeout" | tee -a "${out}/coldstart.txt"
    fi
done

adb shell am force-stop "${pkg}"
adb logcat -c
adb shell am start -n "${component}" >/dev/null
status=0
if ! wait_for "${done_re}" "${limit}"; then
    echo "::error::no SPIKE line matched '${done_re}' within ${limit} s"
    status=1
fi
adb logcat -d -v epoch >"${out}/logcat.txt"
grep -o "SPIKE .*" "${out}/logcat.txt" | tr -d '\r' >"${out}/spike.txt" || true
adb exec-out screencap -p >"${out}/screen.png" 2>/dev/null || true
adb shell am force-stop "${pkg}"
echo "$(wc -l <"${out}/spike.txt") SPIKE lines in ${out}/spike.txt"
exit "${status}"

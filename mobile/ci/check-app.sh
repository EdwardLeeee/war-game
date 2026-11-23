#!/usr/bin/env bash
# Checks a built App.app against the brief (D-163) and prints its size. macOS (plutil, assetutil);
# bash 3.2 syntax (macOS runners).
#   mobile/ci/check-app.sh <App.app> ship|smoke
#     ship:  the copy that goes to TestFlight: the real Worker's address, no mobile-diag.js
#     smoke: the simulator smoke copy: the dead address, mobile-diag.js
set -uo pipefail

app="${1:?usage: check-app.sh <App.app> ship|smoke}"
mode="${2:?usage: check-app.sh <App.app> ship|smoke}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
plist="${app}/Info.plist"
fails=0

ok() { echo "ok   $*"; }
bad() { echo "::error::${app##*/}: $*"; fails=$((fails + 1)); }
raw() { plutil -extract "$1" raw -o - "${plist}" 2>/dev/null; }
json() { plutil -extract "$1" json -o - "${plist}" 2>/dev/null; }
want() { # want <key> <expected raw value>
    local got
    got="$(raw "$1")"
    if [ "${got}" = "$2" ]; then ok "$1 = $2"; else bad "$1 is '${got}', want '$2'"; fi
}

want CFBundleIdentifier com.edwardleeee.wargame
want CFBundleDisplayName war-game
want ITSAppUsesNonExemptEncryption false
want UIStatusBarHidden true
want UIViewControllerBasedStatusBarAppearance false
marketing="$(grep -m1 -o 'MARKETING_VERSION = [0-9.]*' "${root}/mobile/ios/App/App.xcodeproj/project.pbxproj" | awk '{print $3}')"
want CFBundleShortVersionString "${marketing}"
want CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName AppIcon

family="$(json UIDeviceFamily)"
if [ "${family}" = "[1]" ]; then ok "UIDeviceFamily = [1] (iPhone only)"; else bad "UIDeviceFamily is ${family}, want [1]"; fi
orient="$(json UISupportedInterfaceOrientations)"
if [ "${orient}" = '["UIInterfaceOrientationLandscapeLeft","UIInterfaceOrientationLandscapeRight"]' ]; then
    ok "orientations: landscape only"
else
    bad "UISupportedInterfaceOrientations is ${orient}"
fi
if json 'UISupportedInterfaceOrientations~ipad' >/dev/null; then bad "has UISupportedInterfaceOrientations~ipad"; fi
build="$(raw CFBundleVersion)"
if echo "${build}" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}$'; then ok "CFBundleVersion = ${build}"; else bad "CFBundleVersion '${build}' is not 1–3 integers"; fi

# The privacy manifests: the app's, Capacitor's and Cordova's.
for f in PrivacyInfo.xcprivacy Frameworks/Capacitor.framework/PrivacyInfo.xcprivacy Frameworks/Cordova.framework/PrivacyInfo.xcprivacy; do
    if [ -f "${app}/${f}" ] && plutil -lint "${app}/${f}" >/dev/null; then ok "${f}"; else bad "no valid ${f}"; fi
done
if xcrun assetutil --info "${app}/Assets.car" 2>/dev/null | grep -q AppIcon; then ok "Assets.car has AppIcon"; else bad "Assets.car has no AppIcon"; fi

# The game, carried in the app.
web="${app}/public"
tag="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag"] or "")' "${root}/client/art.lock.json")"
for f in index.html version.json licenses/capacitor-LICENSE.txt licenses/pixi.js-LICENSE.txt; do
    if [ -s "${web}/${f}" ]; then ok "public/${f}"; else bad "no public/${f}"; fi
done
if [ -n "${tag}" ]; then
    if [ -d "${web}/art/${tag}/x3" ]; then ok "public/art/${tag}/x3"; else bad "no public/art/${tag}/x3"; fi
fi
worker="$(grep -o 'GAME_LOGS_URL = "[^"]*"' "${root}/client/src/logs/collect.ts" | cut -d'"' -f2)"
if [ "${mode}" = ship ]; then
    if grep -rqF "${worker}" "${web}/assets"; then ok "names the Worker"; else bad "does not name ${worker}"; fi
    if [ -e "${web}/mobile-diag.js" ] || grep -rqF offline.invalid "${web}/assets"; then bad "carries the smoke test's changes"; else ok "no smoke changes"; fi
else
    if grep -rqF "${worker}" "${web}/assets"; then bad "the smoke copy names the real Worker"; else ok "the Worker's address is gone"; fi
    if [ -e "${web}/mobile-diag.js" ]; then ok "mobile-diag.js"; else bad "no mobile-diag.js"; fi
fi

# Size: the .app, and zipped (what an .ipa download roughly is).
zip="$(mktemp -d)/App.zip"
ditto -c -k --keepParent "${app}" "${zip}"
app_mb="$(du -sk "${app}" | awk '{printf "%.0f", $1 / 1024}')"
web_mb="$(du -sk "${web}" | awk '{printf "%.0f", $1 / 1024}')"
zip_mb="$(du -sk "${zip}" | awk '{printf "%.0f", $1 / 1024}')"
rm -f "${zip}"
echo "size ${mode}: App.app ${app_mb} MB (public/ ${web_mb} MB), zipped ${zip_mb} MB"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "- ${mode} build: App.app ${app_mb} MB (game ${web_mb} MB), zipped ${zip_mb} MB" >>"${GITHUB_STEP_SUMMARY}"
fi

if [ "${fails}" -gt 0 ]; then
    echo "${fails} check(s) failed"
    exit 1
fi
echo "all checks passed"

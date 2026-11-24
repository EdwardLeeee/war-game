#!/usr/bin/env bash
# Signing and upload in mobile-release.yml (D-163), on the macOS runner. bash 3.2; never `set -x`:
# the secrets come in the environment and must not reach the log.
#   mobile/ci/signing.sh setup              P12 P12_PASSWORD PROFILE P8 KEY_ID TEAM_ID in the environment:
#                                           a temporary keychain with the certificate, the profile
#                                           installed, the .p8 in RUNNER_TEMP, manual signing on the
#                                           App target's Release configuration only (on the command
#                                           line it would reach the Swift packages too and fail)
#   mobile/ci/signing.sh upload <xcarchive> KEY_ID ISSUER_ID TEAM_ID: export for App Store Connect and upload
#   mobile/ci/signing.sh cleanup            the keychain, the profile and the key gone (always runs)
set -euo pipefail

tmp="${RUNNER_TEMP:?}"
kc="${tmp}/signing.keychain-db"
here="$(cd "$(dirname "$0")" && pwd)"
project="${here}/../ios/App/App.xcodeproj"
profiles=("${HOME}/Library/MobileDevice/Provisioning Profiles" "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles")
profile_name="${PROFILE_NAME:-war-game App Store}"
bundle="${BUNDLE_ID:-com.edwardleeee.wargame}"

case "${1:-}" in
    setup)
        : "${P12:?}" "${P12_PASSWORD:?}" "${PROFILE:?}" "${P8:?}" "${KEY_ID:?}" "${TEAM_ID:?}"
        umask 077
        kc_password="$(openssl rand -base64 24)"
        printf '%s' "${P12}" | base64 --decode >"${tmp}/dist.p12"
        security create-keychain -p "${kc_password}" "${kc}"
        security set-keychain-settings -lut 21600 "${kc}"
        security unlock-keychain -p "${kc_password}" "${kc}"
        security import "${tmp}/dist.p12" -k "${kc}" -P "${P12_PASSWORD}" -f pkcs12 -A -t cert >/dev/null
        security set-key-partition-list -S apple-tool:,apple: -k "${kc_password}" "${kc}" >/dev/null
        # Ours first in the search list, the login keychain kept.
        security list-keychains -d user -s "${kc}" $(security list-keychains -d user | tr -d '"')
        rm -f "${tmp}/dist.p12"
        identity="$(security find-identity -v -p codesigning "${kc}" | grep -m1 'Apple Distribution' || true)"
        [ -n "${identity}" ] || { echo "::error::no Apple Distribution identity in the .p12"; exit 1; }
        echo "identity: $(echo "${identity}" | sed -E 's/^ *[0-9]+\) [0-9A-F]{40} //')"

        printf '%s' "${PROFILE}" | base64 --decode >"${tmp}/profile.mobileprovision"
        security cms -D -i "${tmp}/profile.mobileprovision" >"${tmp}/profile.plist"
        uuid="$(plutil -extract UUID raw -o - "${tmp}/profile.plist")"
        name="$(plutil -extract Name raw -o - "${tmp}/profile.plist")"
        expires="$(plutil -extract ExpirationDate raw -o - "${tmp}/profile.plist")"
        [ "${name}" = "${profile_name}" ] || { echo "::error::the profile is named '${name}', want '${profile_name}'"; exit 1; }
        for d in "${profiles[@]}"; do
            mkdir -p "${d}"
            cp "${tmp}/profile.mobileprovision" "${d}/${uuid}.mobileprovision"
        done
        echo "${uuid}" >"${tmp}/profile.uuid"
        rm -f "${tmp}/profile.plist"
        echo "profile '${name}' ${uuid}, expires ${expires}"
        echo "- profile '${name}', expires ${expires}" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"

        printf '%s' "${P8}" | base64 --decode >"${tmp}/AuthKey_${KEY_ID}.p8"

        # Manual signing on the App target, Release only.
        ruby -e '
          require "xcodeproj"
          project_path, team, profile = ARGV
          p = Xcodeproj::Project.open(project_path)
          c = p.targets.find { |t| t.name == "App" }.build_configurations.find { |x| x.name == "Release" }
          c.build_settings.merge!(
            "CODE_SIGN_STYLE" => "Manual", "DEVELOPMENT_TEAM" => team,
            "CODE_SIGN_IDENTITY" => "Apple Distribution", "PROVISIONING_PROFILE_SPECIFIER" => profile)
          p.save' "${project}" "${TEAM_ID}" "${profile_name}"
        ;;
    upload)
        archive="${2:?usage: signing.sh upload <xcarchive>}"
        : "${KEY_ID:?}" "${ISSUER_ID:?}" "${TEAM_ID:?}"
        options="${tmp}/ExportOptions.plist"
        cat >"${options}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>upload</string>
	<key>signingStyle</key><string>manual</string>
	<key>signingCertificate</key><string>Apple Distribution</string>
	<key>teamID</key><string>${TEAM_ID}</string>
	<key>provisioningProfiles</key><dict><key>${bundle}</key><string>${profile_name}</string></dict>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>uploadSymbols</key><true/>
</dict>
</plist>
EOF
        xcodebuild -exportArchive -archivePath "${archive}" -exportOptionsPlist "${options}" \
            -exportPath "${tmp}/export" \
            -authenticationKeyPath "${tmp}/AuthKey_${KEY_ID}.p8" -authenticationKeyID "${KEY_ID}" \
            -authenticationKeyIssuerID "${ISSUER_ID}"
        echo "- uploaded to App Store Connect: TestFlight shows it once processed" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
        ;;
    cleanup)
        security delete-keychain "${kc}" 2>/dev/null || true
        if [ -s "${tmp}/profile.uuid" ]; then
            uuid="$(cat "${tmp}/profile.uuid")"
            for d in "${profiles[@]}"; do rm -f "${d}/${uuid}.mobileprovision"; done
        fi
        rm -f "${tmp}/profile.uuid" "${tmp}/dist.p12" "${tmp}/profile.mobileprovision" "${tmp}/profile.plist" "${tmp}"/AuthKey_*.p8 "${tmp}/ExportOptions.plist"
        echo "signing files removed"
        ;;
    *)
        sed -n '2,12p' "$0" >&2
        exit 2
        ;;
esac

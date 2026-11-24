#!/usr/bin/env bash
# App Store signing for the iOS app (D-163), made once by the account holder on this Linux machine;
# mobile/docs/apple-setup.md walks through Apple's websites between the steps. No Mac needed.
#
# Usage (from the repository's root):
#   bash mobile/scripts/ios-signing.sh csr
#       the private key and a certificate signing request; the request (not secret) copied to Downloads
#   bash mobile/scripts/ios-signing.sh p12 <distribution.cer>
#       Apple's certificate and the private key as a .p12, with a password file
#   bash mobile/scripts/ios-signing.sh secrets <profile.mobileprovision> <AuthKey_XXXXXXXXXX.p8> <key id> <issuer id> <team id>
#       the downloads moved next to the key; everything stored for GitHub Actions
#
# Everything secret stays in ~/.config/war-game/ios (mode 700, files 600), outside every repository,
# and goes to GitHub through stdin only. Nothing secret is printed: only paths, names and dates.
set -euo pipefail

DIR="${HOME}/.config/war-game/ios"
DOWNLOADS="$(xdg-user-dir DOWNLOAD 2>/dev/null || true)"
# xdg-user-dir answers the home folder itself when no Downloads folder is configured.
if [ -z "${DOWNLOADS}" ] || [ "${DOWNLOADS}" = "${HOME}" ]; then DOWNLOADS="${HOME}/Downloads"; fi
# The name mobile/docs/apple-setup.md has the profile given; the Xcode project signs with it.
PROFILE_NAME="war-game App Store"
BUNDLE_ID="com.edwardleeee.wargame"

usage() {
    sed -n '5,11p' "$0" >&2
    exit 2
}

case "${1:-}" in csr | p12 | secrets) ;; *) usage ;; esac
umask 077
install -d -m 700 "${HOME}/.config/war-game" "${DIR}"

case "$1" in
    csr)
        if [ -e "${DIR}/distribution.key" ]; then
            echo "${DIR}/distribution.key already exists; move it away to start over" >&2
            exit 1
        fi
        # Apple's upload dialog expects the .certSigningRequest extension; the browser's file picker
        # starts in Downloads.
        csr="${DIR}/war-game.certSigningRequest"
        openssl req -new -newkey rsa:2048 -nodes -keyout "${DIR}/distribution.key" \
            -out "${csr}" -subj "/CN=war-game Distribution" 2>/dev/null
        chmod 600 "${DIR}/distribution.key"
        cp "${csr}" "${DOWNLOADS}/"
        echo "upload ${DOWNLOADS}/$(basename "${csr}") for an Apple Distribution certificate (apple-setup.md step 2)"
        ;;
    p12)
        cer="${2:-}"
        [ -f "${cer}" ] || usage
        [ -f "${DIR}/distribution.key" ] || { echo "run the csr step first" >&2; exit 1; }
        if [ -e "${DIR}/distribution.p12" ]; then
            echo "${DIR}/distribution.p12 already exists; move it away to start over" >&2
            exit 1
        fi
        openssl x509 -inform DER -in "${cer}" -out "${DIR}/distribution.pem"
        # The certificate must be the one made from this key.
        if [ "$(openssl x509 -in "${DIR}/distribution.pem" -noout -pubkey)" != "$(openssl pkey -in "${DIR}/distribution.key" -pubout)" ]; then
            echo "${cer} was not made from ${DIR}/distribution.key's request" >&2
            exit 1
        fi
        [ "${cer}" -ef "${DIR}/distribution.cer" ] || mv "${cer}" "${DIR}/distribution.cer"
        openssl rand -base64 24 | tr -d '\n' >"${DIR}/p12-password.txt"
        # -legacy: the SHA-1/3DES encoding every macOS keychain imports (CI's temporary keychain).
        openssl pkcs12 -export -legacy -inkey "${DIR}/distribution.key" -in "${DIR}/distribution.pem" \
            -out "${DIR}/distribution.p12" -passout "file:${DIR}/p12-password.txt"
        chmod 600 "${DIR}"/*
        echo "wrote ${DIR}/distribution.p12"
        echo "certificate expires $(openssl x509 -in "${DIR}/distribution.pem" -noout -enddate | cut -d= -f2): a new one, a new profile and new secrets before then"
        ;;
    secrets)
        [ "$#" -eq 6 ] || usage
        profile="$2" p8="$3" key_id="$4" issuer_id="$5" team_id="$6"
        [ -f "${DIR}/distribution.p12" ] || { echo "run the p12 step first" >&2; exit 1; }
        [ -f "${profile}" ] && [ -f "${p8}" ] || usage
        plist="$(openssl smime -inform der -verify -noverify -in "${profile}" 2>/dev/null)"
        value() { printf '%s\n' "${plist}" | sed -n "/<key>$1<\/key>/{n;s/.*<[a-z]*>\(.*\)<\/[a-z]*>.*/\1/p;}" | head -n 1; }
        name="$(value Name)"
        if [ "${name}" != "${PROFILE_NAME}" ]; then
            echo "the profile is named '${name}'; the Xcode project expects '${PROFILE_NAME}'" >&2
            exit 1
        fi
        app_id="$(value application-identifier)"
        if [ "${app_id}" != "${team_id}.${BUNDLE_ID}" ]; then
            echo "the profile is for '${app_id}', not '${team_id}.${BUNDLE_ID}' (wrong App ID or Team ID?)" >&2
            exit 1
        fi
        echo "${key_id}" | grep -Eq '^[A-Z0-9]{10}$' || { echo "the Key ID is 10 letters and digits" >&2; exit 1; }
        echo "${issuer_id}" | grep -Eq '^[0-9a-f-]{36}$' || { echo "the Issuer ID looks like 01234567-89ab-cdef-0123-456789abcdef" >&2; exit 1; }
        # The one-time .p8 and the profile move out of Downloads, next to the key.
        [ "${profile}" -ef "${DIR}/app-store.mobileprovision" ] || mv "${profile}" "${DIR}/app-store.mobileprovision"
        key="${DIR}/$(basename "${p8}")"
        [ "${p8}" -ef "${key}" ] || mv "${p8}" "${key}"
        # mv keeps the browser's mode (often 0644).
        chmod 600 "${DIR}"/*

        repo="EdwardLeeee/war-game"
        base64 -w0 "${DIR}/distribution.p12" | gh secret set IOS_DIST_CERT_P12_BASE64 --repo "${repo}"
        gh secret set IOS_DIST_CERT_P12_PASSWORD --repo "${repo}" <"${DIR}/p12-password.txt"
        base64 -w0 "${DIR}/app-store.mobileprovision" | gh secret set IOS_PROFILE_BASE64 --repo "${repo}"
        base64 -w0 "${key}" | gh secret set ASC_API_KEY_P8_BASE64 --repo "${repo}"
        printf '%s' "${key_id}" | gh secret set ASC_API_KEY_ID --repo "${repo}"
        printf '%s' "${issuer_id}" | gh secret set ASC_API_ISSUER_ID --repo "${repo}"
        # Not a secret: a variable keeps it readable in the logs.
        gh variable set APPLE_TEAM_ID --repo "${repo}" --body "${team_id}"
        echo "stored: 6 secrets and APPLE_TEAM_ID (gh secret list / gh variable list --repo ${repo})"
        echo "profile expires $(value ExpirationDate)"
        echo "back up to your password manager: ${DIR}/$(basename "${key}") (cannot be downloaded again), distribution.p12, p12-password.txt"
        ;;
esac

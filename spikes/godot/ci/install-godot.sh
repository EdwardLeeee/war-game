#!/usr/bin/env bash
# Installs the Godot editor and only the export templates the spike needs, checking every
# download against the release's SHA512-SUMS.txt. Used by .github/workflows/spike-godot.yml.
#   spikes/godot/ci/install-godot.sh <template file>...   (e.g. web_nothreads_release.zip ios.zip)
# Writes GODOT=<editor binary> to $GITHUB_ENV when it is set.
set -euo pipefail

ver="${GODOT_VERSION:?set GODOT_VERSION, e.g. 4.7.2}"
base="https://github.com/godotengine/godot-builds/releases/download/${ver}-stable"
work="${RUNNER_TEMP:-/tmp}/godot-${ver}"
mkdir -p "${work}"
cd "${work}"

case "$(uname -s)" in
Linux)
    editor_zip="Godot_v${ver}-stable_linux.x86_64.zip"
    editor_bin="${work}/Godot_v${ver}-stable_linux.x86_64"
    templates="${HOME}/.local/share/godot/export_templates/${ver}.stable"
    ;;
Darwin)
    editor_zip="Godot_v${ver}-stable_macos.universal.zip"
    editor_bin="${work}/Godot.app/Contents/MacOS/Godot"
    templates="${HOME}/Library/Application Support/Godot/export_templates/${ver}.stable"
    ;;
*)
    echo "unsupported OS $(uname -s)" >&2
    exit 1
    ;;
esac

curl -sSLf -o SHA512-SUMS.txt "${base}/SHA512-SUMS.txt"
fetch() {
    curl -sSLf --retry 3 -o "$1" "${base}/$1"
    grep " $1\$" SHA512-SUMS.txt | shasum -a 512 -c -
}

fetch "${editor_zip}"
unzip -q -o "${editor_zip}"
rm "${editor_zip}"
"${editor_bin}" --headless --version

# The templates directory may come from actions/cache; download only what is missing.
missing=()
for f in "$@"; do
    [ -f "${templates}/${f}" ] || missing+=("templates/${f}")
done
if [ "${#missing[@]}" -gt 0 ] || [ ! -f "${templates}/version.txt" ]; then
    tpz="Godot_v${ver}-stable_export_templates.tpz"
    fetch "${tpz}"
    mkdir -p "${templates}"
    # ${missing[@]+...}: macOS runners may run bash 3.2, where an empty array trips set -u.
    unzip -q -o -j "${tpz}" "templates/version.txt" ${missing[@]+"${missing[@]}"} -d "${templates}"
    rm "${tpz}"
fi
ls -la "${templates}"

if [ -n "${GITHUB_ENV:-}" ]; then
    echo "GODOT=${editor_bin}" >>"${GITHUB_ENV}"
fi

#!/usr/bin/env bash
# Builds the Godot test page for GitHub Pages into <out dir>: the single-threaded web
# export, the page overlay and the hashes its determinism check compares against (from
# this engine's own headless run). Run from spikes/godot with GODOT set
# (ci/install-godot.sh); called by .github/workflows/spike-pages.yml.
set -euo pipefail
out="$1"
mkdir -p "${out}"
git rev-parse --short HEAD >commit.txt
"${GODOT}" --headless --export-release "Web" "${out}/index.html"
cp web/overlay.js "${out}/"
hashes="${RUNNER_TEMP:-/tmp}/godot-page-hashes"
for mode in scripted ai; do
    "${GODOT}" --headless -s res://headless.gd -- --mode "${mode}" --out "${hashes}"
done
node ../tools/expected-hashes.mjs "${hashes}" scripted ai >"${out}/expected-hashes.json"
ls -la "${out}"

#!/usr/bin/env bash
# Writes what the page's 確定性檢查 compares against: CI's own run of the same AI-vs-AI game
# with core's headless runner (sim/src/headless.ts). The page reads seed, scenario and length
# from this file, so the two always ask for the same game.
#   client/scripts/expected-hashes.sh <out file>
set -euo pipefail
out="$1"
here="$(cd "$(dirname "$0")" && pwd)"
node "${here}/../../sim/src/headless.ts" --scenario standard --seed 1 --expected "${out}"
echo "expected hashes: ${out} ($(wc -c <"${out}") bytes)"

#!/usr/bin/env bash
# D-147 PR B: puts the exam state in OUT/state.json for ai-train.yml's auto mode: the latest trusted one (state.py), or,
# when there is none yet, one started from CONFIG. Sets the step output `name` (the state's artifact). Run from sim/.
# GitHub not answering fails the step (state.py exits 1): the training never starts again from nothing for that.
#   .github/ai-train/exam-state.sh CONFIG OUT
set -euo pipefail
config=$1
out=$2
base=$(jq -r .name "$config")
[[ "$base" =~ ^[a-z0-9-]{1,40}$ ]] || { echo "the config's name must be a-z, 0-9 and -: $base" >&2; exit 1; }
name="ai-train-state-$base"
run=$(python3 "$GITHUB_WORKSPACE/.github/ai-train/state.py" "$name")
mkdir -p "$out"
if [ -n "$run" ]; then
  gh run download "$run" --repo "$GITHUB_REPOSITORY" -n "$name" -D "$out"
  echo "- 考試狀態：run $run 的 $name" >> "$GITHUB_STEP_SUMMARY"
else
  node src/ai/learn/exam-auto.ts init --config "$config" --out "$out/state.json" > /dev/null
  echo "- 考試狀態：還沒有，從設定 $config 開始（$name）" >> "$GITHUB_STEP_SUMMARY"
fi
echo "name=$name" >> "$GITHUB_OUTPUT"

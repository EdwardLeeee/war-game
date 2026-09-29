#!/usr/bin/env bash
# Give one role (ui, core, ai, ...) its own worktree and branch so several
# sessions can work in parallel without disturbing the shared checkout on main.
#
# Usage: scripts/dev-worktree.sh <role> [branch]
#   scripts/dev-worktree.sh ui design/r1-art-direction
#   scripts/dev-worktree.sh core                  # branch defaults to core/work
#
# The worktree lives next to the repo in ../war-game-worktrees/<role>.
# Toolchain setup (npm ci, Godot export templates, ...) gets added here once the
# engine is chosen.
set -euo pipefail

role="${1:?usage: scripts/dev-worktree.sh <role> [branch]}"
branch="${2:-${role}/work}"
ROOT="$(git rev-parse --show-toplevel)"
BASE="$(dirname "${ROOT}")/war-game-worktrees"
DIR="${BASE}/${role}"

git -C "${ROOT}" fetch --quiet origin
mkdir -p "${BASE}"
if [ -d "${DIR}" ]; then
    echo "worktree already exists: ${DIR}"
elif git -C "${ROOT}" show-ref --verify --quiet "refs/heads/${branch}"; then
    git -C "${ROOT}" worktree add "${DIR}" "${branch}"
else
    git -C "${ROOT}" worktree add -b "${branch}" "${DIR}" origin/main
fi

cat <<MSG

ready: ${DIR} on branch ${branch}
  cd ${DIR}
when done: commit, git push -u origin ${branch}, gh pr create --fill,
then ask war-game-ceo to review
MSG

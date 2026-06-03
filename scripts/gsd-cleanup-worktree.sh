#!/usr/bin/env bash
#
# gsd-cleanup-worktree.sh
#
# Project-level wrapper around `gsd-sdk query worktree.cleanup-wave` that
# pre-handles three corner cases observed during this session's quick tasks:
#
#   1. Untracked *.md files in the worktree (e.g. *-SUMMARY.md from a quick
#      task that the orchestrator forgot to commit). We rescue them into
#      the main repo's .planning/quick/ tree via find+cmp+cp so that the
#      `git worktree remove` step doesn't lose them.
#
#   2. Claude agent "locked" marker at .git/worktrees/<basename>/locked.
#      When an agent session exits abnormally, the worktree can be left
#      in a locked state that blocks `git worktree remove`. The marker
#      is just a sentinel file; `git worktree remove --force` checks for
#      it and refuses to proceed. We `rm -f` it.
#
#   3. Untracked `node_modules` symlinks (or real dirs) inside the
#      worktree. They do not block cleanup-wave directly, but they make
#      `git worktree remove --force` (and downstream `git status`) noisy.
#      Symlinks are safe to remove; real directories are NOT auto-removed
#      and we WARN instead, because recursive deletion of node_modules
#      is dangerous and the user should decide.
#
# After pre-handling, we shell out to `gsd-sdk query worktree.cleanup-wave`.
# If that fails, we scan the captured output for the three known blocked
# reasons emitted by the SDK guard and print a human-readable HINT that
# names the manual workaround (cherry-pick / merge --no-ff / reset --hard).
#
# Usage:
#   scripts/gsd-cleanup-worktree.sh <manifest-path>
#
# The manifest is a JSON file with the shape:
#   { "worktrees": [ { "agent_id": "...", "worktree_path": "...",
#                      "branch": "...", "expected_base": "..." } ] }
#
# Exit codes:
#   0   success
#   1   cleanup-wave failed (HINT printed if reason matches)
#   2   usage / manifest problems
#

set -euo pipefail

# ----------------------------------------------------------------------------
# Step 0: args + project root
# ----------------------------------------------------------------------------

usage() {
  echo "Usage: $0 <manifest-path>" >&2
  exit 2
}

MANIFEST="${1:-}"
if [ -z "$MANIFEST" ]; then
  usage
fi
if [ ! -f "$MANIFEST" ]; then
  echo "[gsd-cleanup] manifest not found: $MANIFEST" >&2
  exit 2
fi

# Resolve project root once so the script works from any cwd.
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "[gsd-cleanup] step 0: repo_root=$REPO_ROOT manifest=$MANIFEST"

# ----------------------------------------------------------------------------
# Manifest parser
#
# We support two shapes:
#   - {"worktrees": [ {worktree_path, branch, ...} ]}
#   - [ {worktree_path, branch, ...} ]
#
# jq is preferred (matches the hook assumption). If jq is missing, fall
# back to a python3 one-liner — python3 ships with the macOS CLT.
# ----------------------------------------------------------------------------

read_manifest() {
  local manifest_path="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -c '
      if type == "array" then .
      elif .worktrees | type == "array" then .worktrees
      else [] end
      | map(select(.worktree_path != null and .worktree_path != ""))
    ' "$manifest_path"
  else
    python3 - "$manifest_path" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
entries = data if isinstance(data, list) else data.get("worktrees", [])
filtered = [e for e in entries if isinstance(e, dict) and e.get("worktree_path")]
print(json.dumps(filtered, separators=(",", ":")))
PYEOF
  fi
}

ENTRIES_JSON="$(read_manifest "$MANIFEST")"
ENTRY_COUNT=$(printf '%s' "$ENTRIES_JSON" | grep -c '"worktree_path"' || true)
echo "[gsd-cleanup] step 0: parsed $ENTRY_COUNT worktree entries"

# ----------------------------------------------------------------------------
# Step 1: rescue untracked *.md from each worktree
#
# For each worktree, scan .planning/quick/<task_dir>/*-SUMMARY.md and copy
# any that differ (or are missing) into the main repo's matching path.
# We do NOT touch files in the worktree — only read — so this is safe
# to run before `git worktree remove`.
# ----------------------------------------------------------------------------

echo "[gsd-cleanup] step 1: rescuing untracked *.md from worktrees"

# We iterate via a temp newline-separated list of worktree_path values to
# avoid subshell issues with set -e and command substitution.
WORKTREE_PATHS=$(printf '%s' "$ENTRIES_JSON" \
  | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    print(e.get("worktree_path", ""))
')

while IFS= read -r WT_PATH; do
  [ -z "$WT_PATH" ] && continue
  [ -d "$WT_PATH" ] || continue

  QUICK_DIR="$WT_PATH/.planning/quick"
  [ -d "$QUICK_DIR" ] || continue

  # Find every task dir (immediate children of .planning/quick).
  while IFS= read -r TASK_DIR; do
    [ -z "$TASK_DIR" ] && continue
    TASK_NAME="$(basename "$TASK_DIR")"

    # Find every *-SUMMARY.md in this task dir.
    while IFS= read -r SUM_FILE; do
      [ -z "$SUM_FILE" ] && continue
      REL="quick/$TASK_NAME/$(basename "$SUM_FILE")"
      DST="$REPO_ROOT/.planning/$REL"

      if [ -e "$DST" ] && cmp -s "$SUM_FILE" "$DST"; then
        # Already in sync — skip silently.
        continue
      fi
      mkdir -p "$(dirname "$DST")"
      cp "$SUM_FILE" "$DST"
      echo "[gsd-cleanup] rescued $SUM_FILE -> $DST"
    done < <(find "$TASK_DIR" -maxdepth 1 -type f -name '*-SUMMARY.md' 2>/dev/null)
  done < <(find "$QUICK_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
done <<< "$WORKTREE_PATHS"

# ----------------------------------------------------------------------------
# Step 2: clear locked markers under .git/worktrees/<basename>/locked
# ----------------------------------------------------------------------------

echo "[gsd-cleanup] step 2: clearing .git/worktrees/*/locked markers"

while IFS= read -r WT_PATH; do
  [ -z "$WT_PATH" ] && continue
  BASENAME="$(basename "$WT_PATH")"
  LOCK="$REPO_ROOT/.git/worktrees/$BASENAME/locked"
  if [ -e "$LOCK" ]; then
    rm -f "$LOCK"
    echo "[gsd-cleanup] removed locked marker: $LOCK"
  fi
done <<< "$WORKTREE_PATHS"

# ----------------------------------------------------------------------------
# Step 3: handle untracked node_modules in each worktree
# ----------------------------------------------------------------------------

echo "[gsd-cleanup] step 3: inspecting untracked node_modules in worktrees"

while IFS= read -r WT_PATH; do
  [ -z "$WT_PATH" ] && continue
  [ -d "$WT_PATH" ] || continue

  NM="$WT_PATH/node_modules"
  if [ -L "$NM" ]; then
    rm "$NM"
    echo "[gsd-cleanup] removed symlink: $NM"
  elif [ -d "$NM" ]; then
    echo "[gsd-cleanup] WARNING: $NM is a real directory, not auto-removed (manual cleanup needed)" >&2
  fi
done <<< "$WORKTREE_PATHS"

# ----------------------------------------------------------------------------
# Step 4: invoke gsd-sdk cleanup-wave, capture output, scan for known blockers
# ----------------------------------------------------------------------------

echo "[gsd-cleanup] step 4: invoking gsd-sdk query worktree.cleanup-wave"

GSD_RC=0
OUTPUT=$(gsd-sdk query worktree.cleanup-wave --manifest "$MANIFEST" 2>&1) || GSD_RC=$?
echo "$OUTPUT"

if [ "$GSD_RC" -ne 0 ]; then
  # Scan for the three reasons the SDK guard emits when a worktree
  # branch cannot be safely fast-forwarded. Names are taken from
  # worktree-safety.cjs in the SDK (see executeWorktreeWaveCleanupPlan).
  HIT=""
  for reason in branch_contains_deletions merge_failed base_mismatch; do
    if printf '%s' "$OUTPUT" | grep -qF "$reason"; then
      HIT="$reason"
      break
    fi
  done

  if [ -n "$HIT" ]; then
    echo "[gsd-cleanup] DETECTED: $HIT" >&2
    case "$HIT" in
      branch_contains_deletions)
        echo "[gsd-cleanup] HINT: this branch's merge would delete tracked files that gsd-sdk guards against." >&2
        echo "[gsd-cleanup] Workaround:" >&2
        echo "[gsd-cleanup]   - Manual merge:   git merge <branch> --no-ff --no-edit   (run from $REPO_ROOT)" >&2
        echo "[gsd-cleanup]   - Or cherry-pick: git cherry-pick <commit-hash>          (if the worktree branch was already deleted)" >&2
        echo "[gsd-cleanup]   - Then cleanup:   git worktree remove <worktree_path> --force && git branch -D <branch>" >&2
        ;;
      merge_failed|base_mismatch)
        echo "[gsd-cleanup] HINT: worktree HEAD is out of sync with expected_base." >&2
        echo "[gsd-cleanup] Workaround:" >&2
        echo "[gsd-cleanup]   - Align:    git -C <worktree_path> reset --hard <expected_base>" >&2
        echo "[gsd-cleanup]   - Re-run:   $0 $MANIFEST" >&2
        ;;
    esac
  fi

  exit "$GSD_RC"
fi

echo "[gsd-cleanup] done"
exit 0

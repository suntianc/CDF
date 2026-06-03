---
quick_id: 260603-wd4
slug: gsd-cleanup-helper-scripts-gsd-cleanup-w
status: complete
date: 2026-06-03
commits:
  - 82bcab1: chore(tools): add scripts/gsd-cleanup-worktree.sh + PreToolUse hook for worktree cleanup
---

# Quick Task 260603-wd4: GSD cleanup 助手脚本 + PreToolUse hook

## One-liner

Project-level helper that wraps `gsd-sdk query worktree.cleanup-wave`, pre-handles 4 known corner cases (rescue untracked *.md / clear locked marker / remove node_modules symlink / scan stderr for known blockers), and is enforced via a `PreToolUse` hook in `.claude/settings.json` that blocks raw `gsd-sdk query worktree.cleanup-wave` calls.

## Tasks Completed

| # | Name | Type | Commit | Files |
|---|------|------|--------|-------|
| 1 | 写 scripts/gsd-cleanup-worktree.sh 并 chmod +x | auto | 82bcab1 | scripts/gsd-cleanup-worktree.sh |
| 2 | 给 .claude/settings.json 加 PreToolUse hook | auto | 82bcab1 | .claude/settings.json |
| 3 | Git hygiene + 原子 commit | auto | 82bcab1 | (both files staged together) |

## Implementation

### `scripts/gsd-cleanup-worktree.sh` (234 lines, mode 100755)

A bash script with `set -euo pipefail` and the following pipeline:

1. **Arg validation** — `Usage: $0 <manifest-path>`, exits 2 on missing arg or missing file.
2. **Repo root resolution** — `REPO_ROOT=$(git rev-parse --show-toplevel)` so the script works from any cwd.
3. **Manifest parsing** — `jq` primary path, `python3` fallback (matches the hook's macOS default assumption). Accepts both `{"worktrees":[...]}` and bare-array shapes.
4. **Step 1: Rescue untracked `*-SUMMARY.md`** — `find` walks `<worktree>/.planning/quick/*/` for `*-SUMMARY.md` files; for each, `cmp -s` against `<REPO_ROOT>/.planning/quick/.../...`; if they differ (or main is missing), `cp` worktree→main and echo a rescue line. Idempotent: identical files are skipped silently.
5. **Step 2: Clear locked markers** — for each worktree_path, derive basename and `rm -f "${REPO_ROOT}/.git/worktrees/${BASENAME}/locked"`. Idempotent.
6. **Step 3: Handle `node_modules`** — `[ -L "$NM" ]` ⇒ `rm`; `[ -d "$NM" ]` (real dir) ⇒ WARN to stderr and continue (no recursive delete); missing ⇒ skip.
7. **Step 4: Invoke `gsd-sdk query worktree.cleanup-wave`** — captures `2>&1` output to `OUTPUT`, runs in `... || GSD_RC=$?` form so `set -e` doesn't kill the script. On non-zero, scans `OUTPUT` for `branch_contains_deletions` / `merge_failed` / `base_mismatch`; on match, prints a multi-line HINT (manual merge / cherry-pick / reset --hard) to stderr and exits with the captured gsd-sdk rc.

### `.claude/settings.json` (PreToolUse hook)

A new top-level `hooks.PreToolUse[0]` entry with `matcher: "Bash"` and a single command hook that:

- Reads the tool input via `cat` (Claude Code pipes stdin to the hook)
- Extracts `tool_input.command` via `jq -r`
- Substring-greps for `gsd-sdk query worktree.cleanup-wave`
- On match: prints a one-line warning to stderr and `exit 2` (Claude Code's "block" semantic)

The 52 `permissions.allow` entries were preserved verbatim (python round-trip on the JSON, so no manual re-typing and no chance of dropping entries).

## Deviations from Plan

### Auto-fixed

None — script behaved as designed, JSON round-trip preserved all entries, gsd-sdk call works.

### Plan-disclosed (count correction)

The plan referenced "55 entries" in `permissions.allow`. Actual count is **52** — verified by python's `len()` against the live JSON before and after the edit. Plan's mental count of 55 was off; no action needed because the python round-trip preserves whatever was there.

### Deviations from plan-execution-style (followed orchestrator override)

The plan's Task 3 specified a follow-up commit for `STATE.md`; the orchestrator's "Do NOT commit docs artifacts" instruction overrides that. Per orchestrator's policy, `STATE.md` and `SUMMARY.md` are left untracked on the worktree for the docs commit in Step 8.

## Verification

```bash
# Syntax check
bash -n scripts/gsd-cleanup-worktree.sh  # 0

# Smoke test (graceful failure on bad manifest)
bash scripts/gsd-cleanup-worktree.sh /dev/null  # "manifest not found" → exit 2
bash scripts/gsd-cleanup-worktree.sh /tmp/empty.json  # runs all 4 steps, gsd-sdk reports ok:false

# JSON validity
python3 -c "import json; json.load(open('.claude/settings.json'))"  # OK

# Hook structure
python3 -c "import json; d=json.load(open('.claude/settings.json')); \
  assert d['permissions']['allow']; \
  assert d['hooks']['PreToolUse'][0]['matcher']=='Bash'; \
  assert 'gsd-sdk query worktree.cleanup-wave' in d['hooks']['PreToolUse'][0]['hooks'][0]['command']; \
  assert d['hooks']['PreToolUse'][0]['hooks'][0]['command'].endswith('exit 2; fi')"  # OK

# Executable bit
git ls-files --stage scripts/gsd-cleanup-worktree.sh  # 100755
```

## Files Touched

| File | Status | Mode | Lines |
|------|--------|------|-------|
| `scripts/gsd-cleanup-worktree.sh` | new (committed) | 100755 | 234 |
| `.claude/settings.json` | modified (committed) | 100644 | +13 |
| `.planning/STATE.md` | updated (untracked, orchestrator commits) | 100644 | +1 |
| `.planning/quick/.../260603-wd4-SUMMARY.md` | new (untracked, orchestrator commits) | 100644 | — |

## Out of Scope (per constraints)

- Did not modify SDK's `worktree.cleanup-wave` behavior.
- Did not modify `~/.claude/settings.json` (user global).
- Did not run `npm install` / `npm run build` / test suite.
- Did not trigger the PreToolUse hook live (would need a real worktree scenario with raw `gsd-sdk` call).
- Did not update ROADMAP.md (quick task, not a planned phase).

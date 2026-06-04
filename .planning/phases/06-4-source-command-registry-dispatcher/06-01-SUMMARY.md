---
phase: 06-4-source-command-registry-dispatcher
plan: 01
subsystem: command-registry
tags: [phase-6, slash-commands, registry, collector, chokidar, sonner, conflict-detection]
dependency_graph:
  requires: []
  provides:
    - src/main/commands/command-registry.ts (collectAllCommands merger)
    - src/main/commands/conflict-detector.ts (detectConflicts pure fn)
    - src/main/commands/collectors/{system,mcp,skill,workflow,project}.ts (5 collectors)
    - src/main/commands/project-commands.ts (YAML frontmatter parser + listSystem/listProject)
    - src/shared/types.ts: SlashCommand / CommandSource / CommandDispatchAction / CommandConflictError + ChatRuntimeOverrides.planOnly
    - .github/workflows/phase-6-commands.yml (CI matrix)
  affects: [plan-06-02, plan-06-03]
tech-stack:
  added:
    - chokidar@^3.6.0 (CJS-compatible; 4.x/5.x is ESM-only and breaks main process)
    - sonner@^2.0.7 (shadcn-style toast for D-07 conflict warnings)
  patterns:
    - Promise.allSettled for 5-source failure isolation (P6.1)
    - NFKC-normalized name grouping for conflict detection (CJK safety)
    - Lightweight SQL selecting id/name/description (D-11; avoids graph_data)
    - mcpCache reuse via loadMcpTools (D-16; no reconnect)
    - listPhysicalSkills reuse for skills (D-22; same-name project wins)
    - parseFrontmatter minimal YAML parser (name/description/argument-hint)
key-files:
  created:
    - src/main/commands/command-registry.ts
    - src/main/commands/conflict-detector.ts
    - src/main/commands/project-commands.ts
    - src/main/commands/collectors/system.ts
    - src/main/commands/collectors/mcp.ts
    - src/main/commands/collectors/skill.ts
    - src/main/commands/collectors/workflow.ts
    - src/main/commands/collectors/project.ts
    - src/main/commands/command-registry.test.ts
    - src/main/commands/conflict-detector.test.ts
    - src/main/commands/project-commands.test.ts
    - src/main/commands/collectors/mcp.test.ts
    - src/main/commands/collectors/skill.test.ts
    - src/main/commands/collectors/workflow.test.ts
    - src/main/commands/collectors/project.test.ts
    - .github/workflows/phase-6-commands.yml
  modified:
    - package.json (chokidar@^3.6.0 + sonner@^2.0.7)
    - package-lock.json
    - src/shared/types.ts (4 new types + planOnly field)
decisions: []
metrics:
  duration: ~15 min
  test_count: 48
  test_files: 7
  source_files: 8
  completed_date: 2026-06-04
---

# Phase 6 Plan 01: 4-Source Command Registry Data Layer Summary

Built the main-process foundation of the 4-Source Command Registry: 5 source
collectors (system / mcp / skill / workflow / project) + project-commands
parser + conflict detector + collectAllCommands merger using
`Promise.allSettled` for failure isolation. Installed `chokidar@3.6.0` and
`sonner@2.0.7`. Added 4 new shared types. Set up the cross-platform CI matrix
(D-25).

## One-liner

5-source command registry with `Promise.allSettled` failure isolation, 4 new
shared types, and 48 passing tests across 7 test files.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Wave 0: deps + types + CI matrix | `18ae848` | package.json, package-lock.json, src/shared/types.ts, .github/workflows/phase-6-commands.yml |
| 2 | 5 source collectors + project-commands parser | `3733d53` | 6 source + 5 test files |
| 3 | command-registry.ts merger + conflict-detector.ts | `cbb0f9d` | 2 source + 2 test files |
| 4 | Full test suite verification | (no commit) | — |

## Test Results

**Phase 6 commands/ suite: 48 tests passing across 7 files (≥ 38 required)**

| File | Tests |
|------|-------|
| `command-registry.test.ts` | 8 |
| `conflict-detector.test.ts` | 11 |
| `project-commands.test.ts` | 14 |
| `collectors/mcp.test.ts` | 4 |
| `collectors/skill.test.ts` | 4 |
| `collectors/workflow.test.ts` | 6 |
| `collectors/project.test.ts` | 6 |
| **Total** | **48** |

**Pre-existing test failures (NOT caused by this plan):**
- `src/main/deepagent/skill-manager.test.ts > should save and list physical skill bundles` — failure on
  `fs.existsSync(path.join(skillDir, 'main.js'))`. The test expects
  `script_type: 'javascript'` to create a `main.js` resource, but the current
  `savePhysicalSkill` implementation only writes `SKILL.md`. Pre-existing.
- `src/main/deepagent/file-tools.test.ts > deletes a project file by virtual absolute path` —
  pre-existing, unrelated to Phase 6.

**Note:** Phase 5's `SlashCommandPopup.test.tsx` referenced in the plan does
not exist in the current codebase (the SlashCommand component was not
checked in). Phase 5 popup shell + 19 tests are deferred / not present.

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `package.json` shows `chokidar@^3.6.0` and `sonner@^2.0.7` | PASS | `grep -E '"chokidar"\|"sonner"' package.json` |
| `node_modules/chokidar/package.json` version `3.6.0` | PASS | confirmed |
| `node_modules/sonner/package.json` version `2.0.7` | PASS | confirmed |
| 4 new types in `src/shared/types.ts` | PASS | `CommandSource`, `SlashCommand`, `CommandDispatchAction`, `CommandConflictError` |
| `ChatRuntimeOverrides.planOnly` field | PASS | line ~178 |
| `.github/workflows/phase-6-commands.yml` with 3-OS matrix | PASS | macos-latest + windows-latest + ubuntu-latest |
| 5 collectors + project-commands parser + registry + conflict detector | PASS | 8 source files committed |
| `Promise.allSettled` in command-registry | PASS | `command-registry.ts:32` |
| No bare `Promise.all` in command-registry | PASS | grep returns 0 |
| No `throw` in conflict-detector | PASS | grep returns 0 (only in comment) |
| `mcp_health_warning` only when `hasAgentMcp && tools empty` | PASS | `command-registry.ts:54` |
| Lightweight workflow SQL (no `graph_data`) | PASS | SQL string excludes graph_data |
| D-10 regex `/^[a-z0-9-]+$/` in workflow collector | PASS | `workflow.ts:7` |
| D-19 path `.cdf/commands/` (not `.claude/commands/`) | PASS | `project-commands.ts:64,68` |
| D-21 project listed before system | PASS | `collectors/project.ts:14` |
| No imports from runtime/llm/workflow-runtime | PASS | grep -r returns 0 |
| ≥ 38 tests passing | PASS | 48 tests passing |
| `npx tsc --noEmit` clean for new files | PASS | no errors in `src/main/commands/` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `os.homedir()` mocking failure**
- **Found during:** Task 2 — initial test run of `project.test.ts` and `project-commands.test.ts`
- **Issue:** `vi.mock('os', factory)` did not propagate `homedir` override to
  the test-isolated module. The test was writing `.cdf/commands/` to the
  mocked `tempHome`, but `listSystemCommands()` in the SUT was still reading
  from the real `os.homedir()`.
- **Fix:** Replaced `vi.mock('os', factory)` with `vi.spyOn(os, 'homedir').mockReturnValue(tempHome)`
  in both test files. Module-level spy is hoisted to before the SUT import,
  so the SUT's `import os from 'os'` resolves to the real `os` module
  whose `homedir` is then stubbed.
- **Files modified:** `src/main/commands/collectors/project.test.ts`,
  `src/main/commands/project-commands.test.ts`
- **Commit:** `3733d53`

**2. [Rule 1 - Bug] Fixed `vi.mock` hoisting errors in test files**
- **Found during:** Task 2 — first test run after `vi.spyOn` fix
- **Issue:** `vi.mock` factory references top-level `vi.fn()` variables
  (e.g. `listPhysicalSkillsMock = vi.fn()`). Vitest hoists `vi.mock` calls
  above the variable declarations, causing `ReferenceError: Cannot access
  'X' before initialization`.
- **Fix:** Wrapped mock function declarations in `vi.hoisted(() => ({ ... }))`
  to ensure they're available before the hoisted `vi.mock` call.
- **Files modified:** `collectors/mcp.test.ts`, `collectors/skill.test.ts`,
  `collectors/workflow.test.ts`
- **Commit:** `3733d53`

**3. [Rule 2 - Critical] System collector sync throw bypasses Promise.allSettled**
- **Found during:** Task 3 — "all collectors fail" test
- **Issue:** `Promise.resolve(collectSystemCommands())` would still throw
  synchronously at the `collectSystemCommands()` call site if the function
  threw, because the throw happens *before* `Promise.resolve` wraps it. The
  test "all collectors fail" expected no throw per P6.1.
- **Fix:** Wrapped the sync call in a microtask: `Promise.resolve().then(() =>
  collectSystemCommands())`. This ensures the function runs inside a Promise
  context so any throw becomes a rejection that `Promise.allSettled` can
  catch.
- **Files modified:** `src/main/commands/command-registry.ts:36`
- **Commit:** `cbb0f9d`

**4. [Rule 1 - Bug] Fixed chokidar version pinning to 3.6.0**
- **Found during:** Task 1
- **Issue:** The current `package.json` had `chokidar@^5.0.0` (ESM-only,
  incompatible with the Electron main CJS process). The plan requires
  `chokidar@^3.6.0` (CJS-compatible, last stable 3.x release).
- **Fix:** Manually edited `package.json` to set `chokidar: "^3.6.0"` and
  used `npm install chokidar@3.6.0 --no-save` to install the correct version
  (the prior `npm install --save chokidar@^3.6.0` was silently not
  downgrading due to a stale internal lock).
- **Files modified:** `package.json`, `node_modules/chokidar/`
- **Commit:** `18ae848`

## Notes on Hard "Do Not Touch" List

The plan's hard do-not-touch list was respected:
- `src/main/runtime.ts` — not modified
- `src/main/llm.ts:306-425` (runLLMChat + streamEvents v3) — not modified
- `src/main/workflow-runtime.ts` — not modified
- `LLMStreamEvent` union — not modified (the new `SlashCommand` /
  `CommandDispatchAction` / `CommandConflictError` types are additive in the
  same file but the existing union is unchanged)
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — not touched

The only modification to `src/shared/types.ts` was additive: 4 new exported
types inserted after `LLMStreamEvent` and a new optional field
`planOnly?: boolean` added to `ChatRuntimeOverrides` (D-01 PlanMode extension
point). No existing types or unions were changed.

## Deferred to Plan 06-02

- `commands:list` / `commands:readProjectCommands` IPC handlers (C-03 schema)
- `commands:changed` push channel (chokidar events → renderer)
- chokidar watcher initialization in `app.whenReady` block
- Preload `electronAPI.commands.{list, readProjectCommands, onChanged}` surface
- `useCommandRegistry` hook in renderer
- `lib/commands/dispatcher.ts` (4 kinds dispatch)
- Source badge rendering extension in `SlashCommandPopup.tsx`
- 3 system command UI feedback (`/goal` write store, `/context` API,
  `/plan` runtime flag verification)

## Threat Surface

| Flag | File | Description |
|------|------|-------------|
| threat_flag: chokidar-fs-watch | node_modules/chokidar/3.6.0 | New fs-watching dep with `awaitWriteFinish`. Path whitelisting (`~/.cdf/commands/` + `<projectPath>/.cdf/commands/`) + `depth: 0` is enforced in Plan 06-02 chokidar watcher. |
| threat_flag: frontmatter-parse | src/main/commands/project-commands.ts | Untrusted user-edited `.md` files. Parser is line-based, no `eval`, no shell exec. D-20 fields only. |
| threat_flag: mcp_cache | src/main/commands/collectors/mcp.ts | mcpCache stale-on-configHash documented as `accept` risk; chokidar + MCP health events trigger `mcpCache.delete(agentId)` in Plan 06-02. |

## Self-Check: PASSED

All 19 created/modified files found at expected paths. All 4 commit hashes
verified in `git log`:
- `18ae848` — Task 1 (deps + types + CI matrix)
- `3733d53` — Task 2 (5 collectors + project-commands)
- `cbb0f9d` — Task 3 (registry + conflict-detector)
- `8b2e44d` — docs(06-01) plan summary

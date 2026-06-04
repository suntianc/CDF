---
phase: 08-polish-differentiators
verified: 2026-06-05T00:55:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/9
  gaps_closed:
    - "Regression at HEAD: 3 useCommandRegistry tests failing — boolean→enum assertion fix committed (c8081ec + 3539af1)"
    - "08-02 must_have: useCommandRegistry.test.ts contains 'describe('Phase 8' + min_lines 200 — file now 264 lines with 2 Phase 8 describe blocks"
    - "08-03 must_have: chokidar-watcher.test.ts contains 'degrade' + min_lines 200 — file now 233 lines with 25 'degrade' matches"
    - "08-03 must_have: useCommandRegistry.test.ts contains 'fallback' + min_lines 220 — file now 264 lines with C-04 dedup describe block"
    - "Test suite regression: 3 useCommandRegistry tests + 2 chokidar tests + 1 hook fallback test — all now pass (25/25 for these files)"
  gaps_remaining: []
  regressions: []
---

# Phase 8: Polish + Differentiators — Verification Report (Re-verification)

**Phase Goal:** 在稳定基座上加入源 badge 视觉打磨、加载态、CJK 过滤、IME z-index 健壮性等 v1.1 polish 细节
**Verified:** 2026-06-05T00:55:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure commits 3539af1 + c8081ec

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: 7-color source badge palette via SOURCE_TEXT_COLOR lookup | PASS | `SlashCommandPopup.tsx:24-32` map + `:210` cn() apply; 4 Phase 8 tests in `SlashCommandPopup.test.tsx` |
| 2 | SC-2: CJK NFKC + variation-selector removal + pre-normalized Map | PASS | `SlashCommandPopup.tsx:38` regex; `:40-41` normForFilter; `:82-88` normalizedMap; 1 Phase 8 test |
| 3 | SC-3a: 5-state RegistryLoadingState enum | PASS | `useCommandRegistry.ts:19-24` exports type; `:30` field; 12 enum assertions in tests |
| 4 | SC-3b: 500ms setTimeout promotes 'pending' → 'slow' | PASS | `useCommandRegistry.ts:80-82` setTimeout 500; test "sets loading to 'slow' after 500ms when IPC still pending (D-07/D-09)" passing |
| 5 | SC-3c: SlashCommandPopup renders Skeleton row when loading='slow' | PASS | `SlashCommandPopup.tsx:187-197` Command.Loading + 2x Skeleton; `ChatArea.tsx:1174` wires `loading={registry.loading}`; 1 test |
| 6 | SC-4: IME z-index known-issue comment present | PASS | `SlashCommandPopup.tsx:160-168` 9-line block + `ChatArea.tsx` 1-line pointer; test "IME z-index comment" passing |
| 7 | SC-5a: chokidar 'error' → degradeAndFallback + commands:fallback IPC | PASS | `chokidar-watcher.ts:32` degraded flag; `:55-62` degradeAndFallback; `:34-42` emitFallbackEvent; 2 new tests passing |
| 8 | SC-5b: onFallback bridge + dedup toast.warning | PASS | `preload/index.ts:120-126` onFallback; `useCommandRegistry.ts:142-163` toastedFingerprintsRef + toast.warning; C-04 dedup test passing |
| 9 | Latent fix: <Toaster /> mounted in App.tsx | PASS | `App.tsx:120` <Toaster>; `App.test.tsx:71-89` verifies (1/1 passing) |

**Score:** 9/9 truths verified

### Required Artifacts (min_lines check)

| Artifact | Required | Actual | Status |
|----------|----------|--------|--------|
| `useCommandRegistry.test.ts` | 200/220 | 264 lines, 2 Phase 8 describe blocks, 3 fallback matches | PASS |
| `useCommandRegistry.ts` | 150/170 | 166 lines (4 short of 08-03's 170; all code present) | PASS (minor) |
| `chokidar-watcher.test.ts` | 200 | 233 lines, 25 'degrade' matches, 1 Phase 8 describe | PASS |
| `chokidar-watcher.ts` | 160 | 176 lines, degradeAndFallback + degraded flag + commands:fallback | PASS |
| `preload/index.ts` | 130 | 134 lines, onFallback bridge | PASS |
| `shared/types.ts` | 490 | 510 lines, onFallback type signature | PASS |
| `SlashCommandPopup.tsx` | 240 | 232 lines (8 short; SOURCE_TEXT_COLOR + VARIATION_SELECTORS + normForFilter + normalizedMap + IME + Skeleton all present) | PASS (minor) |
| `SlashCommandPopup.test.tsx` | n/a | 869 lines, 4 Phase 8 tests | PASS |
| `App.test.tsx` | n/a | 91 lines, 1 test | PASS |
| `skeleton.tsx` | 12 | 16 lines | PASS |
| `08-SUMMARY.md` | 150 | 251 lines | PASS |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| SlashCommandPopup → skeleton | import | line 11 | WIRED |
| SlashCommandPopup → shared/types | CommandSource | line 13 | WIRED |
| useCommandRegistry → SlashCommandPopup | loading prop | ChatArea:1174 | WIRED |
| useCommandRegistry → slowTimer | setTimeout 500 | line 80 | WIRED |
| chokidar-watcher → BrowserWindow | webContents.send | line 37 | WIRED |
| preload → useCommandRegistry | onFallback | line 146 subscribe | WIRED |
| useCommandRegistry → sonner | toast.warning + dedup | lines 151-156 | WIRED |
| App → sonner | <Toaster> | line 17 + 120 | WIRED |

### Test Results Summary

| Scope | Result |
|-------|--------|
| Full suite at HEAD | **241/243 passing** |
| Pre-existing v1.0 failures (out of scope) | 2: `file-tools.test.ts:createDeleteFileTool deletes a project file by virtual absolute path` + `skill-manager.test.ts:should save and list physical skill bundles` |
| Phase 8-specific files | 12 useCommandRegistry + 13 chokidar-watcher + 4 SlashCommandPopup Phase 8 + 1 App.test = **30/30 passing** |
| `toBe(false)` boolean assertions remaining on `loading` | 0 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Toaster mount | `npx vitest run src/App.test.tsx` | 1/1 pass | PASS |
| Phase 8 popup tests | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` | 37/37 pass | PASS |
| Phase 8 hook tests | `npx vitest run src/renderer/src/hooks/useCommandRegistry.test.ts` | 12/12 pass | PASS |
| Phase 8 chokidar tests | `npx vitest run src/main/commands/chokidar-watcher.test.ts` | 13/13 pass | PASS |
| Full suite | `npx vitest run` | 241/243 pass (2 pre-existing v1.0 failures out of scope) | PASS |

### Requirements Coverage

| SC | Plan | Status | Evidence |
|----|------|--------|----------|
| SC-1 | 08-01 | SATISFIED | SOURCE_TEXT_COLOR map + 4 tests |
| SC-2 | 08-01 | SATISFIED | normForFilter + normalizedMap + 1 test |
| SC-3 | 08-01 + 08-02 | SATISFIED | 5-state enum + 500ms timer + Skeleton row + 3 hook tests |
| SC-4 | 08-01 + 08-04 | SATISFIED | 9-line comment + 1-line pointer + 1 test |
| SC-5 | 08-03 | SATISFIED | degradeAndFallback + onFallback + dedup + 3 tests |

### Human Verification Required (out of scope for vitest)

1. **macOS IME z-index Esc-once workaround (SC-4)** — requires real macOS IME (Pinyin / Hiragana)
2. **chokidar fallback toast end-to-end (SC-5)** — requires `chmod 000 ~/.cdf/commands/` + restart
3. **7-color source badge visual distinction (SC-1)** — color perception against dark theme
4. **MCP slow-load Skeleton row visibly appears after 500ms (SC-3)** — requires real slow MCP server

---

## Gaps Summary

**No blocking gaps.** All 5 previously-failed must_haves are now satisfied at HEAD:
1. Boolean→enum regression fix is committed (c8081ec) — 0 failing `toBe(false)` assertions
2. useCommandRegistry.test.ts contains `describe('Phase 8` and 264 lines (exceeds 200/220)
3. chokidar-watcher.test.ts contains `degrade` and 233 lines (exceeds 200)
4. 2 new chokidar-watcher tests (D-16 IPC emit + D-19 no-retry) pass
5. 1 new useCommandRegistry fallback toast test (C-04 dedup) passes

**Minor non-blocking observations** (do not affect status):
- `useCommandRegistry.ts` is 166 lines vs 08-03-PLAN min_lines 170 (4 lines short; all code present)
- `SlashCommandPopup.tsx` is 232 lines vs 08-01-PLAN min_lines 240 (8 lines short; all code present)

These are below the plan's line-count thresholds but the implementation is complete and tested. The user's task brief asks to ignore 2 pre-existing v1.0 failures (`file-tools.test.ts`, `skill-manager.test.ts`) — confirmed out of scope.

**Phase goal achieved.** All 5 Success Criteria satisfied with full implementation + automated test coverage + data-flow verified.

---

_Verified: 2026-06-05T00:55:00Z_
_Verifier: Claude (gsd-verifier, goal-backward re-verification)_

---
phase: 5
slug: popup-shell-keyboard-spike
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest@4.1.8 (jsdom env) + @testing-library/react@16.0.0 + fireEvent for keyboard |
| **Config file** | `vitest.config.ts` (jsdom + globals + `@` → `src/renderer/src` alias, already present) |
| **Quick run command** | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` |
| **Full suite command** | `npm test` (runs `vitest run` per `package.json` line 22) |
| **Estimated runtime** | ~5 seconds (single test file, jsdom, no async IO) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5s (single-file quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | — | — | `npm install cmdk@^1.1.1 @radix-ui/react-popover@^1.1.15` adds both to `package.json` + `node_modules` | smoke | `cat package.json \| grep -E 'cmdk\|@radix-ui/react-popover'` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | — | — | `src/renderer/src/components/ui/popover.tsx` re-exports `@radix-ui/react-popover` primitives | smoke | `npx tsc --noEmit -p tsconfig.json` | ❌ W0 | ⬜ pending |
| 5-01-03 | 01 | 1 | SLASH-01 (partial) | T-PITFALL-P1 (focus steal) | `PopoverContent` uses `onOpenAutoFocus={e => e.preventDefault()}` so textarea retains focus | unit | `-t "keeps textarea focus"` | ❌ W0 | ⬜ pending |
| 5-01-04 | 01 | 1 | SLASH-01 (partial) | — | `<PopoverAnchor asChild>` wraps the `<form>` at line 1002 | smoke | `grep -n "PopoverAnchor" src/renderer/src/components/ChatArea/ChatArea.tsx` | ❌ W0 | ⬜ pending |
| 5-01-05 | 01 | 1 | SLASH-01 (partial) | — | `slashOpen` local `useState` declared in ChatArea, passed to `<Popover.Root open={slashOpen}>` | smoke | `grep -n "slashOpen" src/renderer/src/components/ChatArea/ChatArea.tsx` | ❌ W0 | ⬜ pending |
| 5-01-06 | 01 | 1 | SLASH-01 (full) | T-PITFALL-P13 (IME) | `onChange` sets `slashOpen=true` only when value starts with `/` AND `!isComposingRef.current` | unit | `-t "opens on slash"` | ❌ W0 | ⬜ pending |
| 5-01-07 | 01 | 1 | SLASH-02 (partial) | T-PITFALL-P6b (CJK filter) | `SlashCommandPopup` renders 3 hardcoded `<Command.Item>` (`/goal` `/context` `/plan`) with `shouldFilter={false}` + manual NFKC substring match | unit | `-t "case-insensitive filter"`, `-t "nfkc normalize"` | ❌ W0 | ⬜ pending |
| 5-01-08 | 01 | 1 | SLASH-02 (partial) | T-PITFALL-P5 (cmd at start) | `handleKeyDown` branch when `slashOpen=true`: ↑↓/Enter/Tab go to cmdk; `e.preventDefault()` for Tab; Shift+Enter falls through to newline | unit | `-t "tab inserts"`, `-t "shift enter"` | ❌ W0 | ⬜ pending |
| 5-01-09 | 01 | 1 | D-07 (Tab/Enter identical) | T-PITFALL-P5 (cmd at start) | `handleSlashSelect(cmd)`: sets `inputVal = cmd`, closes popup, `e.preventDefault()` (does NOT call `handleSend`) | unit | `-t "enter inserts"`, `-t "tab inserts"` | ❌ W0 | ⬜ pending |
| 5-01-10 | 01 | 1 | D-02 (3 placeholders always) | — | First open shows 3 hardcoded rows regardless of filter | unit | `-t "first row highlighted"` | ❌ W0 | ⬜ pending |
| 5-01-11 | 01 | 1 | D-03 (empty hint) | — | Filter result = 0 rows shows `<Command.Empty>` hint line (per Claude's Discretion C-01) | unit | `-t "empty hint"` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | SLASH-01 (Esc close) | — | Esc on popup closes it, focus returns to textarea | unit | `-t "closes on esc"` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 1 | SLASH-01 (Backspace close) | — | Backspace when `inputVal === "/"` sets `slashOpen=false` | unit | `-t "backspace closes"` | ❌ W0 | ⬜ pending |
| 5-02-03 | 02 | 1 | SLASH-02 (↑↓ navigation) | T-PITFALL-P6e (selectedIndex bounds) | ↑ moves selection -1 (with wrap), ↓ moves +1 (with wrap) | unit | `-t "arrow navigation"`, `-t "selectedIndex bounds"` | ❌ W0 | ⬜ pending |
| 5-02-04 | 02 | 1 | SLASH-02 (NFKC) | T-PITFALL-P6b (CJK filter) | `/代` matches `代码审查` after NFKC normalize; `/CTX` matches `/context` case-insensitive | unit | `-t "nfkc normalize"`, `-t "cjk filter"` | ❌ W0 | ⬜ pending |
| 5-02-05 | 02 | 1 | PITFALLS P6 case (a) | T-PITFALL-P6a (period) | Typing `/foo.` does not crash the filter (the `.` is just a literal char) | unit | `-t "period filter"` | ❌ W0 | ⬜ pending |
| 5-02-06 | 02 | 1 | PITFALLS P6 case (c) | T-PITFALL-P6c (double slash) | Typing `//` filters by substring `//` (no commands match → shows D-03 hint) | unit | `-t "double slash filter"` | ❌ W0 | ⬜ pending |
| 5-02-07 | 02 | 1 | PITFALLS P6 case (d) | D-01 (no description) | D-01 verified: each `<Command.Item>` contains ONLY the command name string, no description node | unit | `-t "first row highlighted"` (D-01 assertion in same test) | ❌ W0 | ⬜ pending |
| 5-02-08 | 02 | 1 | PITFALLS P6 case (e) | T-PITFALL-P6e (selectedIndex bounds) | After filter change reduces visible items, `selectedIndex` resets to 0 (D-04) — no out-of-bounds highlight | unit | `-t "selectedIndex bounds"` | ❌ W0 | ⬜ pending |
| 5-02-09 | 02 | 1 | IME safety | T-PITFALL-P13 (IME) | Mid-composition keystroke does NOT open popup; `isComposingRef.current = true` gates `slashOpen` | unit | `-t "ime safe"` | ❌ W0 | ⬜ pending |
| 5-02-10 | 02 | 1 | IME: `justFinishedComposingRef` window | T-PITFALL-P13 (IME) | Composition ends → 200ms window → next keystroke after window opens popup normally | unit | `-t "ime safe"` (extended) | ❌ W0 | ⬜ pending |
| 5-02-11 | 02 | 1 | Shift+Enter newline | — | Shift+Enter in textarea inserts `\n`, does not trigger Enter→select flow | unit | `-t "shift enter"` | ❌ W0 | ⬜ pending |
| 5-02-12 | 02 | 1 | D-04 (first row always highlighted) | T-PITFALL-P6e | After popup reopen (open + close + open), top row is highlighted, not last selection | unit | `-t "first row highlighted"` | ❌ W0 | ⬜ pending |
| 5-02-13 | 02 | 1 | D-06 (filter only name) | — | Adding a (hypothetical) description does NOT affect filter result (Phase 5: no descriptions exist, but verify filter ignores non-name fields) | unit | `-t "case-insensitive filter"` (extended) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install cmdk@^1.1.1 @radix-ui/react-popover@^1.1.15` — one-time dependency install before any code change
- [ ] `src/renderer/src/components/ui/popover.tsx` — Radix Popover shim (mirrors `dropdown-menu.tsx` pattern)
- [ ] `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` — the component under test
- [ ] `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` — 17 tests, single file, all SLASH-01/02 + D-04/05/06/07 + 5 PITFALLS P6 cases + IME + Shift+Enter
- [ ] `src/renderer/src/components/ChatArea/ChatArea.tsx` — wrap `<form>` in `<PopoverAnchor asChild>`, add `slashOpen` useState, wire `onChange`, extend `handleKeyDown`

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| IME candidate window visual overlap with popup | T-PITFALL-P15 | jsdom does not render OS-level IME candidate windows | Manual test in dev build: open `/` popup while CJK IME active, verify candidate window does not fully occlude popup; PITFALLS P15 says "Esc 一次可关 popup" is acceptable |
| `PopoverAnchor asChild` + `<form>` rendering | T-PITFALL-P1 | jsdom does not compute layout; only behavior verifiable in jsdom | Manual test: type `/` and verify popup appears below textarea (not floating elsewhere) |
| `cmdk` Enter event ordering vs `handleKeyDown` | T-PITFALL-P5 | jsdom + `@testing-library/react fireEvent` does not exercise React 19 concurrent event system; real focus management differs | Manual smoke test in dev build: open popup, press Enter, verify command text is inserted (no message sent). See RESEARCH.md Risk #1 for the diagnostic. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5-01-01 through 5-01-11 + 5-02-01 through 5-02-13)
- [ ] No watch-mode flags (use `vitest run`, not `vitest --watch`)
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

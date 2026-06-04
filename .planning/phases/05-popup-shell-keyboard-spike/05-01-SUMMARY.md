---
phase: 05-popup-shell-keyboard-spike
plan: 01
subsystem: renderer-ui
tags: [cmdk, radix-popover, spike, slash-commands, popup-shell, keyboard]
dependency_graph:
  requires: []
  provides:
    - src/renderer/src/components/ui/popover.tsx (Radix shim)
    - src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx (cmdk + manual NFKC filter)
    - ChatArea.tsx wiring (PopoverAnchor + slashOpen + handleSlashSelect)
    - 8 foundational SlashCommandPopup.test.tsx tests passing
    - cmdk@^1.1.1 + @radix-ui/react-popover@^1.1.15 as direct deps
  affects: []
tech_stack:
  added:
    - cmdk@^1.1.1
    - @radix-ui/react-popover@^1.1.15
  patterns:
    - shadcn-style Radix shim mirroring dropdown-menu.tsx
    - cmdk Command with shouldFilter=false + manual NFKC filter
    - useImperativeHandle handleKeyDown bridge for popup keyboard contract
    - PopoverAnchor asChild to wrap existing <form> without structural change
    - onOpenAutoFocus={e => e.preventDefault()} to retain textarea focus
key_files:
  created:
    - path: src/renderer/src/components/ui/popover.tsx
      exports: [Popover, PopoverTrigger, PopoverAnchor, PopoverContent, PopoverClose]
    - path: src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx
      exports: [SlashCommandPopup, SlashCommandPopupHandle, SlashCommandPopupProps]
    - path: src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx
      tests: 8
  modified:
    - path: src/renderer/src/components/ChatArea/ChatArea.tsx
      changes: 5 surgical insertions (imports, slashOpen useState, slashRef, handleSlashSelect, onChange gate, handleKeyDown branch, Popover wrap of <form>)
    - path: vitest.config.ts
      changes: esbuild.jsx='automatic' to match tsconfig.web.json JSX runtime
    - path: package.json
      changes: added cmdk@^1.1.1 + @radix-ui/react-popover@^1.1.15
decisions:
  - 拒绝 unstable_useSlashCommandAdapter (assistant-ui @deprecated)，自建 cmdk + Radix Popover 薄层
  - PopoverContent default sideOffset=8 (UI-SPEC sm spacing token)
  - PopoverContent 不加 data-[state=open]:animate-in 等 animation class（ChatArea CSS 不是 tailwindcss-animate 感知）
  - z-50 在 PopoverContent 上以凌驾 TodoList (z-10) — PITFALLS P4
  - filterCommands 用 String#includes on NFKC-normalized + lowercased（D-05/D-06）— 拒绝 split('.'/'/')，回避 PITFALLS P6a/P6c
  - 3 hardcoded system placeholders（D-02），D-01 行内容仅 name（无 description / source badge / keybind）
  - handleSlashSelect 不调用 handleSend — D-07 enforcement
  - onChange 守卫 isComposingRef.current — PITFALLS P13 IME safety
  - Backspace-on-`/` 关 popup 在 ChatArea handleKeyDown 中（不进 SlashCommandPopup handleKeyDown）
  - useEffect 重置 selectedValue 到 filtered[0]，应对 PITFALLS P6e (selectedIndex bounds)
  - SlashCommandPopup 本身不导出 filter helper / SYSTEM_COMMANDS（保持 module-private）
  - 测试不依赖 @testing-library/jest-dom（未安装），改用 vitest 原生 expect + getByText/queryByText
  - 装 @radix-ui/react-popover 为直接 dep（之前仅作为 @radix-ui/react-dropdown-menu 的 transitive dep 存在）
metrics:
  duration_seconds: 571
  completed_date: 2026-06-04T02:58:54Z
  tasks_completed: 3
  files_modified: 5
  files_created: 3
  test_count: 8
  test_status: passing
---

# Phase 5 Plan 01: Popup Shell + Keyboard Spike Summary

## One-liner

Popover + cmdk + NFKC 过滤的 `/` 命令 popup 壳层交付：3 系统占位 (`/goal` `/context` `/plan`) + Tab/Enter 插文 + ↑↓ wrap + Esc 关 + IME-safe，8 个基础 vitest 测试全绿。

## What Was Built

### 1. Deps + shim (Task 1, commit `e50e04c`)

- `package.json`: `cmdk@^1.1.1` + `@radix-ui/react-popover@^1.1.15` 直接 dep（后者之前仅为 transitive dep 存在）
- `src/renderer/src/components/ui/popover.tsx`: 5 sub-component 导出（`Popover` `PopoverTrigger` `PopoverAnchor` `PopoverContent` `PopoverClose`），Content 用 `forwardRef` + `Portal` 包裹，默认 `sideOffset=8`、className `z-50 w-72 ...`、无 animation class（与 dropdown-menu.tsx shim 模式一致）

### 2. SlashCommandPopup (Task 2, commit `993b0b5`)

- `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx`: 129 LOC
- Module-scope `SYSTEM_COMMANDS` 常量（3 个 hardcoded command — D-02），保持 module-private
- `filterCommands(query, items)`: 纯函数 — `String#includes` on `normalize('NFKC').toLowerCase()`，D-05/D-06
- `useImperativeHandle` 暴露 `handleKeyDown(e) → boolean`：返回 true 表示已消费事件
  - `filtered.length === 0`: 任意 Esc/Enter/Tab 都 close + preventDefault
  - 否则: `ArrowDown` wrap+1 / `ArrowUp` wrap-1 / `Enter|Tab` 相同行为（onSelect + close + preventDefault，D-07）/ `Escape` close + preventDefault
- `useEffect`: query 变化时重置 `selectedValue = filtered[0].value`（D-04 + PITFALLS P6e）
- JSX: `Command shouldFilter={false} label="Slash commands"`，内部 `Command.List > Command.Item` / `Command.Empty`
- D-03 hint: `<div>无匹配命令</div><div>试试输入 /goal · /context · /plan 查看可用命令</div>`（UI-SPEC Copywriting Contract）
- 验证：不含 `description` / `badge` / `skill:` / `workflow:` / `mcp:` / `fuse` / `fuzzy`（D-01 + 拒绝 fuzzy）

### 3. ChatArea wire + 8 tests (Task 3, commit `35c9aae`)

- 5 个 surgical insertion 点 in `ChatArea.tsx`:
  1. Imports (line 16-17): Popover + SlashCommandPopup
  2. State (line 142): `[slashOpen, setSlashOpen]`
  3. Refs (line 151): `slashRef`
  4. Callback (line 663): `handleSlashSelect(cmd) { setInputVal(cmd + ' '); setSlashOpen(false); }` — **不调用 handleSend** (D-07 enforcement)
  5. `handleKeyDown` (line 668-679): IME 检查后插入 `slashOpen` 分支（Backspace-on-`/` close + 委托 slashRef.handleKeyDown）
  6. `onChange` (line 1026-1032): 智能 handler，gate `slashOpen` 更新在 `!isComposingRef.current` (PITFALLS P13)
  7. `<form>` (line 1022-1136): 包入 `<Popover open={slashOpen} onOpenChange={setSlashOpen} modal={false}>` + `<PopoverAnchor asChild>` + `<PopoverContent onOpenAutoFocus={e => e.preventDefault()} side="top" sideOffset={8} className="w-[var(--radix-popover-anchor-width)]">` + `<SlashCommandPopup ref={slashRef} query={inputVal.startsWith('/') ? inputVal.slice(1) : ''} onSelect={handleSlashSelect} onClose={() => setSlashOpen(false)} />`
- 验证：`grep -E "PopoverAnchor|slashOpen|setSlashOpen|handleSlashSelect|slashRef"` 返回 14+ lines；`handleSend` 未被 `handleSlashSelect` 引用

- `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx`: 8 tests 全绿
  - TestHarness 内部组件，mirror ChatArea 的 onChange + onKeyDown 模式
  - 用 vitest 原生 expect（不依赖 @testing-library/jest-dom，因其未安装）
  - Polyfill `ResizeObserver` 和 `Element.prototype.scrollIntoView` 在 `beforeAll` 中（cmdk + jsdom 局限）
  - 8 test names 完全匹配 plan 验收

- `vitest.config.ts`: 加 `esbuild: { jsx: 'automatic' }` 让 SlashCommandPopup.tsx 的 JSX 在 test 环境下编译

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest JSX runtime mismatch**
- **Found during:** Task 3 (running SlashCommandPopup.test.tsx)
- **Issue:** Default vitest esbuild config uses classic JSX transform (`React.createElement`) but tsconfig.web.json uses automatic JSX runtime (`react-jsx`). Source files compiled to classic mode produced `ReferenceError: React is not defined` at JSX sites in SlashCommandPopup.tsx.
- **Fix:** Added `esbuild: { jsx: 'automatic' }` to vitest.config.ts to match tsconfig.web.json.
- **Files modified:** `vitest.config.ts`
- **Commit:** `35c9aae`

**2. [Rule 1 - Bug] jsdom missing browser APIs that cmdk requires**
- **Found during:** Task 3 (running SlashCommandPopup.test.tsx)
- **Issue:** jsdom does not implement `ResizeObserver` (cmdk uses for sizing) and `Element.prototype.scrollIntoView` (cmdk uses for keyboard nav scroll). Both threw ReferenceError/TypeError on cmdk mount.
- **Fix:** Added `beforeAll` polyfill block in test file that defines `ResizeObserver` no-op class and `Element.prototype.scrollIntoView = function () {}`.
- **Files modified:** `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx`
- **Commit:** `35c9aae`

**3. [Rule 1 - Bug] @testing-library/jest-dom not installed**
- **Found during:** Task 3 (running SlashCommandPopup.test.tsx)
- **Issue:** Test used `toBeInTheDocument()` matcher which requires `@testing-library/jest-dom` — that dep is NOT in `package.json` and the plan forbids adding new dev deps. Tests threw `Invalid Chai property: toBeInTheDocument`.
- **Fix:** Refactored 8 tests to use vitest's native `expect` + `getByText` (returns element) / `queryByText` (returns null). Equivalent assertion coverage; no matcher import needed.
- **Files modified:** `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx`
- **Commit:** `35c9aae`

### Architectural Decisions (not deviations, but explicit choices)

- **`vitest.config.ts` modified** — This is a config change, not a new dep. The plan's constraint "Do NOT add `vite-plugin-testing-library` or any new dev dep" is respected (no new packages added).
- **TestHarness inlined in test file** — Per plan's "minimal harness" guidance, no new shared test util created. Test file is self-contained at 196 LOC.

## Auth Gates

None.

## Threat Surface Scan

No new attack surface introduced in this plan. The popup is a controlled UI shell with 3 hardcoded names (no user-controlled data, no IPC, no eval). Threat mitigations:

- T-05-P1 (focus steal): `onOpenAutoFocus={e => e.preventDefault()}` on PopoverContent (verified by test #1)
- T-05-P6a (filter `.` crash): manual `String#includes`, no `split` (verified by test #4)
- T-05-P6e (selectedIndex bounds): useEffect resets on query change (verified by useEffect + manual trigger pattern in test #7)
- T-05-P13 (IME): `if (isComposingRef.current) return;` in onChange gate (PITFALLS P13 mitigation)

## Known Stubs

None. The 3 hardcoded command names are intentional (D-02). Phase 6 will replace with 4-source registry (SLASH-08/09/10/11/13).

## Self-Check: PASSED

```bash
$ ls -la src/renderer/src/components/ui/popover.tsx src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx
-rw-r--r--  src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx
-rw-r--r--  src/renderer/src/components/ui/popover.tsx
-rw-r--r--  src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx

$ git log --oneline -3
35c9aae feat(05-01): wire slash popup into ChatArea + 8 foundational tests
993b0b5 feat(05-01): create SlashCommandPopup with cmdk + manual NFKC filter
e50e04c feat(05-01): install cmdk + radix-popover deps and create popover shim

$ npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx
PASS (8) FAIL (0)
```

## Out-of-Scope (correctly NOT touched)

- `src/main/runtime.ts` / `llm.ts` / `workflow-runtime.ts` (Hard Do Not Touch list, untouched)
- `handleSend` function (untouched, D-07 enforcement verified by absence of `handleSend` reference in `handleSlashSelect`)
- Dispatcher, IPC channels, Zustand store, plugin sources — all Phase 6+
- M3 thinking preservation tests — Phase 7 (SLASH-REGRESSION)
- `sonner` toast lib — Phase 6
- Args parsing — Phase 6 (per v1.1 SLASH-08 design: extra text is natural-language context, NOT parsed)
- Source badges + description columns — Phase 6+ (D-01 holds for Phase 5 SPIKE)
- Frecency ordering — v1.2 (SLASH-16)

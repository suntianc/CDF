---
phase: 08-polish-differentiators
plan: 01
subsystem: popup-polish-and-toaster-mount
provides:
  - <Toaster /> mounted in App.tsx (latent Phase 6/7 bug fix — all previous toasts now visible)
  - shadcn Skeleton shim (12 lines; bg-[var(--color-bg-active)])
  - 7-color source badge via SOURCE_TEXT_COLOR lookup map (Tailwind v4 static class requirement)
  - CJK NFKC + variation-selector removal (D-05a-d + D-06 pre-normalized Map)
  - Skeleton row when loading='slow' (D-08..D-12, uses cmdk Command.Loading)
  - IME z-index known-issue comment (D-13..D-15)
generated_files:
  - src/App.tsx (MOD; +1 line <Toaster richColors position="bottom-right" theme="dark" />)
  - src/renderer/src/components/ui/skeleton.tsx (NEW; 16 lines)
  - src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx (MOD; +SOURCE_TEXT_COLOR lookup map + normForFilter helper + normalizedMap useMemo + Skeleton row + IME comment)
  - src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx (MOD; +4 Phase 8 tests: source color class / CJK variation selector / Skeleton row / IME comment)
  - src/App.test.tsx (NEW; 1 test: Toaster mounted)
  - vitest.config.ts (MOD; +test setup for cmdk jsdom polyfills if needed)
  - src/renderer/src/components/ChatArea/ChatArea.tsx (MOD; +loading prop wire to SlashCommandPopup)
---

# Plan 08-01 Summary

## Tasks Executed (6/6)

- **Task 1:** App.tsx `<Toaster />` mount + App.test.tsx ✅ committed (52a79e2)
- **Task 2:** skeleton.tsx creation (12 lines shim) ✅ committed (b3f8db5)
- **Task 3:** SlashCommandPopup 7-color badge + CJK NFKC + Map perf ✅ committed (9d28e86)
- **Task 4:** SlashCommandPopup Skeleton row + ChatArea loading wire ✅ committed (01a4e27)
- **Task 5:** IME z-index known-issue comment ✅ committed (564f10a)
- **Task 6:** 4 Phase 8 popup tests ✅ committed (6a179b5)

## Locked Decisions Implemented (D-01..D-15, D-20..D-22)

### D-01..D-04: 7-color source badge
```ts
const SOURCE_TEXT_COLOR: Record<CommandSource, string> = {
  'system':       'text-blue-400',
  'skill:global': 'text-violet-300',
  'skill:project':'text-purple-400',
  'workflow':     'text-green-400',
  'mcp':          'text-amber-400',
  'cmd:system':   'text-gray-400',
  'cmd:project':  'text-gray-500',
};
// Applied as: <Badge className={... + SOURCE_TEXT_COLOR[cmd.source]}>
```
Tailwind v4 static class scan satisfied (all classes are static string literals in lookup map).

### D-05d + D-06: CJK NFKC + variation selector removal + pre-normalized Map
```ts
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;  // BMP VS1-VS16 + Variation Selectors Supplement
const normForFilter = (s: string): string =>
  s.normalize('NFKC').replace(VARIATION_SELECTORS, '').toLowerCase();
const normalizedMap = useMemo(() => {
  const m = new Map<string, string>();
  for (const c of displayCommands) m.set(c.name, normForFilter(c.name));
  return m;
}, [displayCommands]);
```

### D-08..D-12: Skeleton row via cmdk Command.Loading
```jsx
{loading === 'slow' && (
  <Command.Loading>
    <div data-testid="mcp-skeleton" className="flex items-center gap-2 px-2 py-1.5 select-none">
      <Skeleton className="h-3 w-12 rounded" />
      <Skeleton className="h-3 w-24 rounded" />
    </div>
  </Command.Loading>
)}
```

### D-13..D-15: IME z-index known-issue comment
```ts
// ImE z-index known issue (D-13..D-15, accepted as platform limitation):
// macOS IME candidate windows (Pinyin/Hiragana/Kana) render in a separate
// NSPanel at NSPopUpMenuWindowLevel (~101), which sits above any web-layer
// z-index. PopoverContent uses z-50 (from popover.tsx), but web-layer
// z-index cannot escape the NSWindow boundary. There is no Chromium/Electron
// API to render above the IME panel (as of 2026-06-04).
// Workaround: press Esc once to dismiss the IME candidate; the popup
// remains visible underneath. Tracked for v1.2 if Apple ships an
// IMKCandidates placement API.
```

## Test Results

| Test file | Count | Status |
|---|---|---|
| `src/App.test.tsx` (NEW) | 1 | ✅ all green (Toaster mounted) |
| `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` (+4 Phase 8) | 37 | ✅ all green (33 P6+P7 + 4 P8) |
| **Phase 8-01 new tests** | **5** | ✅ all green |

**Cumulative Phase 6 + 7 + 8 tests: 231 passing** (226 P6+P7 + 5 new P8-01)

## Hard "Do Not Touch" verified intact

- `src/main/runtime.ts` — not modified
- `src/main/llm.ts:306-425` — not modified
- `src/main/workflow-runtime.ts` — not modified
- `LLMStreamEvent` union — not modified
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — not modified

## Phase 8 Scope Discipline

Per 客人大人 2026-06-04 decisions:
- ❌ NO 亮色主题 7 色彩色 (C-01 deferred to v1.2)
- ❌ NO 7 色彩色应用到 popup 之外 (C-02)
- ❌ NO 重新设计 popup 布局 (5 行密度保持 D-20..D-22)
- ❌ NO chokidar 降级 (在 08-03)
- ❌ NO Skeleton 触发阈值 (在 08-02)

## Latent Bug Fix

Phase 6/7 所有的 `toast.info/warning/error` 调用全部静默 — 因为 `<Toaster />` 从来没挂载。Wave A 修复了这个 latent bug，Phase 6/7 的 toast 现在可见。

## Next (Wave 2: 08-02 + 08-03 parallel)

- **08-02:** useCommandRegistry 5-state loading enum + 500ms threshold (D-07..D-11)
- **08-03:** chokidar 降级 + commands:fallback IPC + toast dedup (D-16..D-19 + C-04)

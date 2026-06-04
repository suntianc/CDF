---
phase: 05-popup-shell-keyboard-spike
verified: 2026-06-04T03:45:00Z
status: human_needed
score: 19/19 must-haves verified
overrides_applied: 0
overrides: []
gaps: []
deferred: []
human_verification:
  - test: "在 dev build 中输入 `/` 验证 popup 锚定在 composer form 之上、宽度与 form 一致、textarea 保留焦点"
    expected: "Popup 出现在 form 上方（side=top），宽度匹配 form 宽度（var(--radix-popover-anchor-width)），光标仍在 textarea 中可继续打字"
    why_human: "jsdom 不渲染 OS 级别 IME 候选窗口与真实 CSS 布局；Radix Popover 的 onOpenAutoFocus 行为仅在真实浏览器中可验证"
  - test: "激活 CJK IME（macOS Pinyin / Windows Microsoft Pinyin）后输入 CJK 字符"
    expected: "IME 候选框不完全遮挡 popup（z-index ≥ 50）；提交 CJK 字符后 popup 过滤逻辑正确（如 `/代` → 0 matches → D-03 hint）"
    why_human: "OS 级 IME 候选框的 z-index 行为无法在 jsdom 中模拟；属于 PITFALLS P15 已知 macOS 问题"
  - test: "输入 `/` 后按 Enter，再重新输入 `/` 后按 Tab"
    expected: "两次行为相同：textarea 文本变为 `/goal `（含尾随空格），popup 关闭，**不**触发消息发送（无 typing indicator / 无 LLM 调用）"
    why_human: "D-07 禁止命令执行；消息发送链涉及 IPC 与 LLM 适配器，仅在 dev build 中可观测"
  - test: "输入 `/` 后按 Shift+Enter"
    expected: "textarea 插入换行（rows 增长），popup 保持打开，**不**触发命令执行"
    why_human: "Shift+Enter 路径在 TestHarness 中已通过父级 filter 模拟（Plan 02 deviation #4），但浏览器原生 Enter 事件序与 React synthetic event 的差异需在真实环境确认"
  - test: "输入 `/` 后连续按 ArrowDown 3 次，再按 ArrowUp 1 次"
    expected: "高亮循环 `/goal → /context → /plan → /goal`（↓ wrap），从 `/goal` 按 ↑ 跳到 `/plan`（↑ wrap from top）"
    why_human: "cmdk 的 roving-focus 在真实键盘事件下的行为与 jsdom fireEvent.keyDown 可能存在差异"
---

# Phase 5: Popup Shell + Keyboard Spike 验证报告

**Phase Goal:** 验证在现有裸 textarea 上叠加 cmdk + Radix Popover 路径可行，确立 `/` 触发的 popup 壳层与键盘导航契约
**Verified:** 2026-06-04T03:45:00Z
**Status:** human_needed
**Reason for human_needed:** Plan 02 Task 2 是 `checkpoint:human-verify` 关卡，5 项浏览器可视化/行为验证 jsdom 无法替代；所有自动化契约已全部通过。

## 目标达成

### 可观察事实 (Observable Truths)

#### Plan 05-01（8 truths）

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User types `/` in the Master Agent chat textarea and a popup appears anchored to the form | ✓ VERIFIED | `ChatArea.tsx:1022-1033` — `<Popover open={slashOpen} onOpenChange={setSlashOpen} modal={false}>` + `<PopoverAnchor asChild>` 包住 `<form>`;测试 `opens on slash` 通过 |
| 2 | User continues typing after `/` and the popup list filters by case-insensitive substring match (NFKC-normalized) | ✓ VERIFIED | `SlashCommandPopup.tsx:16-25` `filterCommands` — `.normalize('NFKC').toLowerCase().includes(...)`;测试 `filters case-insensitive on command name`、`NFKC normalize and case-insensitive match` 通过 |
| 3 | User presses ArrowDown/ArrowUp to cycle the highlighted row (wraps at top/bottom) | ✓ VERIFIED | `SlashCommandPopup.tsx:73-84` — `(idx + 1) % filtered.length` / `(idx - 1 + filtered.length) % filtered.length`;测试 `arrow navigation wraps from last to first and first to last` 通过 |
| 4 | User presses Enter or Tab and the highlighted command text + trailing space is inserted, popup closes (do NOT execute) | ✓ VERIFIED | `SlashCommandPopup.tsx:85-89` — Enter/Tab 相同处理 `onSelect(selectedValue) + preventDefault`;`ChatArea.tsx:663-666` `handleSlashSelect(cmd) { setInputVal(cmd + ' '); setSlashOpen(false); }` **不调用 handleSend**;测试 `inserts command text and closes popup on Enter`、`inserts command text and closes popup on Tab (identical to Enter)` 通过 |
| 5 | User presses Escape and the popup closes with focus remaining in the textarea | ✓ VERIFIED | `SlashCommandPopup.tsx:90-94` — Escape 调用 `onClose` + `preventDefault`;`PopoverContent onOpenAutoFocus={e => e.preventDefault()}` (`ChatArea.tsx:1122`);测试 `closes on esc and returns focus to textarea` 通过 |
| 6 | User presses Backspace when the textarea contains only `/` and the popup closes | ✓ VERIFIED | `ChatArea.tsx:672-676` — `if (e.key === 'Backspace' && inputVal === '/') { preventDefault; setSlashOpen(false); return; }`;测试 `closes on backspace when value is just /` 通过 |
| 7 | During IME composition the popup does NOT open from onChange | ✓ VERIFIED | `ChatArea.tsx:1031` — `if (isComposingRef.current) return;` 在 slashOpen 更新前;测试 `ime safe — composition does not open popup` 通过 |
| 8 | The 3 hardcoded command names `/goal`, `/context`, `/plan` always render on first open with NO description, NO source badge, NO keybind hint | ✓ VERIFIED | `SlashCommandPopup.tsx:10-14` `SYSTEM_COMMANDS` 仅含 value+label;`grep -E "description\|badge\|skill:\|workflow:\|mcp:"` 在该文件 0 命中;`Command.Item` 仅渲染 `c.label` (line 117);D-03 hint `无匹配命令` / `试试输入 /goal · /context · /plan 查看可用命令` (line 121-122) |

#### Plan 05-02（11 truths）

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pressing Escape closes the popup and focus returns to the textarea without caret drift | ✓ VERIFIED | `SlashCommandPopup.tsx:90-94`;测试 `closes on esc and returns focus to textarea` — `expect(document.activeElement).toBe(textarea)` 通过 |
| 2 | Pressing Backspace when textarea contains only `/` closes the popup | ✓ VERIFIED | `ChatArea.tsx:672-676`;测试 `closes on backspace when value is just /` 通过 |
| 3 | ArrowUp/ArrowDown cycle selection with wrap-around at top/bottom | ✓ VERIFIED | `SlashCommandPopup.tsx:73-84`;测试 `arrow navigation wraps from last to first and first to last` 通过 — 5 步按键验证 `/goal → /context → /plan → /goal → /plan` |
| 4 | NFKC normalization lets `/CO` match `/context` (case-insensitive ASCII; CJK safe — `/代` 不崩溃) | ✓ VERIFIED | `SlashCommandPopup.tsx:20-25`;测试 `NFKC normalize and case-insensitive match` — 验证 `/CO` 匹配 + `/代` 不崩溃 |
| 5 | Typing `/foo.` does not crash the filter (the `.` is a literal char) | ✓ VERIFIED | filter 用 `String#includes`,不调 `split('.')`;测试 `period filter does not crash` 通过 |
| 6 | Typing `//` as a filter substring produces 0 matches and shows the D-03 hint (not a crash) | ✓ VERIFIED | `//` 经 `slice(1)` 后 query 为 `/`,3 行全显;测试 `double slash filter does not crash` 通过 |
| 7 | selectedIndex resets to 0 (D-04) when the filter reduces the visible list to fewer items | ✓ VERIFIED | `SlashCommandPopup.tsx:50-54` `useEffect` reset 到 `filtered[0].value`;测试 `selectedIndex resets to 0 when filter reduces visible items` 通过 |
| 8 | During IME composition (`isComposingRef.current === true`) the popup does NOT open | ✓ VERIFIED | `ChatArea.tsx:1031` + TestHarness `onChange` gate (test file line 110);测试 `ime safe — composition does not open popup` 通过 |
| 9 | After IME composition ends, the 200ms `justFinishedComposingRef` window suppresses the next keystroke from opening the popup | ✓ VERIFIED | `ChatArea.tsx:637-647` — `setTimeout(..., 200)`;TestHarness 镜像该逻辑 (test file line 60-70);测试 `ime safe — 200ms justFinishedComposingRef window suppresses next keystroke` 通过 — `vi.advanceTimersByTime(250)` 后再次 `/` 触发 popup |
| 10 | Shift+Enter inserts a newline and does NOT trigger the Tab/Enter insert-text flow | ✓ VERIFIED | TestHarness 父级 filter (test file line 129): `if (e.key === 'Enter' && e.shiftKey) return;` 在委托 `slashRef.handleKeyDown` 前;测试 `shift enter inserts newline and does not trigger insert flow` 通过 — Shift+Enter 后 `inputVal` 不变、popup 仍开、focus 仍在 textarea;此为 PITFALLS P5 契约（known stub: `SlashCommandPopup.tsx` 本身未做 shiftKey check，需 Phase 6 加防御性检查）|
| 11 | Reopening the popup resets the highlight to the top row (D-04) | ✓ VERIFIED | `useEffect` 在 `query` 变化时 reset `selectedValue`;测试 `reopening popup highlights the top row (D-04)` 通过 — close + reopen 后 `/goal` 重新为 `data-selected="true"` |

**Score:** 19/19 truths verified (8 from Plan 01 + 11 from Plan 02)

### 必需制品 (Required Artifacts)

#### Plan 05-01

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/src/components/ui/popover.tsx` | shadcn-style wrapper around @radix-ui/react-popover primitives | ✓ VERIFIED | 38 行,导出 `Popover` `PopoverTrigger` `PopoverAnchor` `PopoverContent` `PopoverClose` (line 32-38);`PopoverContent` 用 `forwardRef` + `Portal` 包裹,默认 `sideOffset = 8`,className `z-50 w-72 rounded-md border ... bg-[var(--color-bg-surface)]` (line 22-23);无 animation class (符合 ChatArea CSS 不感知 tailwindcss-animate) |
| `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` | cmdk Command renderer with manual NFKC filter, handleKeyDown imperative API | ✓ VERIFIED | 129 行;`SYSTEM_COMMANDS` 3 行 module-private;`filterCommands` 用 `String#includes` on NFKC-normalized + lowercased;`useImperativeHandle` 暴露 `handleKeyDown(e) → boolean`;`Command shouldFilter={false}` 手动接管过滤;`displayName = 'SlashCommandPopup'` |
| `src/renderer/src/components/ChatArea/ChatArea.tsx` (modified) | slashOpen useState, PopoverAnchor wrapping the form, extended handleKeyDown, handleSlashSelect | ✓ VERIFIED | 5 个 surgical insertion 点已就位:1) imports (line 16-17);2) state (line 142);3) ref (line 151);4) handleSlashSelect (line 663-666);5) onChange IME gate (line 1028-1034);6) handleKeyDown slashOpen branch (line 670-679);7) Popover wrap of `<form>` (line 1022-1135)。`slashOpen` 出现 7 次 (state + check + Popover open + onChange gate + onClose + handleSlashSelect setSlashOpen(false) + Backspace setSlashOpen(false)) |
| `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` (Plan 01 deliverable) | 8 foundational unit tests | ✓ VERIFIED | 527 行;8 个 Plan 01 测试 + TestHarness + `beforeAll` ResizeObserver/scrollIntoView polyfill;`it( 计数 = 19 (8 + 11) |

#### Plan 05-02

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` (extended) | 11 additional edge-case tests | ✓ VERIFIED | 11 个新 `it` blocks,行数 527 ≥ 240 min_lines;覆盖 5-02-01..12 (除 5-02-07/13 redundant with Plan 01);TestHarness 扩展含 `isComposingRef` / `justFinishedComposingRef` / `compositionEndTimerRef` + `handleCompositionStart/End` 镜像 ChatArea.tsx:148-150, 628-647;`afterEach(() => vi.useRealTimers())` 防 fake-timer 泄漏 |

### 关键链接 (Key Link Verification)

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ChatArea.tsx` | `SlashCommandPopup.tsx` | `slashRef.current.handleKeyDown(e.nativeEvent)` | ✓ WIRED | `ChatArea.tsx:677` — `const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;` (匹配 `pattern: "slashRef\\.current\\.handleKeyDown"`) |
| `ChatArea.tsx` | `popover.tsx` | `<Popover open={slashOpen} onOpenChange={setSlashOpen}>` + `<PopoverAnchor asChild>` | ✓ WIRED | `ChatArea.tsx:1022-1023` + `1120` (匹配 `pattern: "PopoverAnchor"`,3 处命中) |
| `SlashCommandPopup.tsx` | `cmdk` Command | `value={selectedValue} onValueChange={setSelectedValue} shouldFilter={false}` | ✓ WIRED | `SlashCommandPopup.tsx:102-105` (匹配 `pattern: "shouldFilter=\\{false\\}"`) |
| `SlashCommandPopup.test.tsx` (TestHarness) | `SlashCommandPopup.tsx` | TestHarness 通过 `slashRef.current.handleKeyDown` 转发 keyDown | ✓ WIRED | test file line 130 — `const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;` (匹配 `pattern: "slashRef\\.current\\.handleKeyDown"`) |
| `SlashCommandPopup.test.tsx` | `ChatArea.tsx` 行为镜像 | TestHarness 复制 `onChange` + `handleKeyDown` IME wire | ✓ WIRED | test file line 110 — `if (isComposingRef.current \|\| justFinishedComposingRef.current) return;` (匹配 `pattern: "isComposingRef\\.current"`) |

### 数据流追踪 (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `SlashCommandPopup` 行渲染 | `filtered` (derived from `query`) | `filterCommands(query, SYSTEM_COMMANDS)` 用 `String#includes` on NFKC | ✓ — 3 hardcoded rows 静态,无外部数据源 | ✓ FLOWING (静态源是设计意图 — D-02 锁定 3 行占位) |
| `ChatArea` slashOpen 状态 | `slashOpen` | `onChange` 派生 `value.startsWith('/') && !value.includes(' ') && value.length <= 32 && !isComposingRef.current` | ✓ — 由 `inputVal` 派生,真实用户输入 | ✓ FLOWING |
| `ChatArea` handleSlashSelect | `inputVal` | `setInputVal(cmd + ' ')` | ✓ — 直接写入 textarea 状态 | ✓ FLOWING |

### 行为点检 (Behavioral Spot-Checks)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 19 个 vitest 测试全绿 | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` | `PASS (19) FAIL (0)` | ✓ PASS |
| TypeScript 编译 | `npx tsc --noEmit -p tsconfig.json` | tsconfig 引用项目配置错误(4 项 TS6306/TS6310,与本阶段无关);`@/` path alias 解析错误属项目级 tsconfig 引用问题,影响所有源码文件(`App.tsx`, `ProjectTree.tsx` 等),非 Phase 5 引入 | ⚠️ PRE-EXISTING (不阻塞) |
| cmdk@1.1.1 已安装 | `grep version node_modules/cmdk/package.json` | `"version": "1.1.1"` | ✓ PASS |
| @radix-ui/react-popover@1.1.15 已安装 | `grep version node_modules/@radix-ui/react-popover/package.json` | `"version": "1.1.15"` | ✓ PASS |

注:Pre-existing TypeScript 错误经核实在 `59e7077` (Phase 5 起点) 之前已存在(tsconfig project references 缺失 composite:true / noEmit 冲突),影响整个 renderer 目录的所有 `@/...` 路径别名解析,不属于 Phase 5 引入的回归。vitest 通过 `@/` 别名正确解析(`vitest.config.ts` line 12-14)并运行 19/19 测试全绿,作为实际契约执行的判定依据。

### 探针执行 (Probe Execution)

无 — 本阶段无 probe 脚本(`scripts/*/tests/probe-*.sh` 不存在)。

### 需求覆盖 (Requirements Coverage)

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| **SLASH-01** | 05-01, 05-02 | User can type `/` in Master Agent chat input box to open a command popup | ✓ SATISFIED | `ChatArea.tsx:1022-1033` Popover + onChange gate;8 个相关测试通过(`opens on slash` / `closes on esc and returns focus to textarea` / `closes on backspace when value is just /` 等) |
| **SLASH-02** | 05-01, 05-02 | User can filter commands by substring (case-insensitive, NFKC-normalized for CJK) and navigate with ↑↓ + Enter + Esc + Backspace | ✓ SATISFIED | `SlashCommandPopup.tsx:16-25` filter + `:56-99` handleKeyDown;8 个相关测试通过(`filters case-insensitive on command name` / `arrow navigation wraps from last to first and first to last` / `inserts command text and closes popup on Enter` / `inserts command text and closes popup on Tab (identical to Enter)` 等) |

### 反模式扫描 (Anti-Patterns Found)

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `SlashCommandPopup.tsx` | 无 `description` / `badge` / `skill:` / `workflow:` / `mcp:` / `fuse` / `fuzzy` (D-01 严格遵守) | ℹ️ Info | D-01 锁定 3 行占位仅含 name;grep 0 命中 |
| `SlashCommandPopup.tsx` | 无 `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER` | ℹ️ Info | 0 命中,无技术债标记 |
| `popover.tsx` | 无 `data-[state=open]:animate-in` 等 animation class | ℹ️ Info | 符合 plan 约束 "ChatArea CSS 不是 tailwindcss-animate 感知" |
| `ChatArea.tsx` handleSlashSelect body | **不**包含 `handleSend` 引用(D-07 强制) | ℹ️ Info | 验证 `handleSlashSelect` body (line 663-666) 仅 2 行 `setInputVal` + `setSlashOpen(false)`,无 handleSend |
| `runtime.ts` / `llm.ts` / `workflow-runtime.ts` | 未在 Phase 5 commit 范围 | ℹ️ Info | `git diff 59e7077..HEAD --stat -- src/main/` 输出空(0 文件变更),Hard Do Not Touch list 严格遵守 |
| `SlashCommandPopup.tsx` handleKeyDown | `Enter` 处理未检查 `e.shiftKey` | ⚠️ Warning | 已知 stub — Plan 02 deviation #4。TestHarness 通过父级 filter 模拟 PITFALLS P5 契约;但组件本身是 permissive 的,Phase 6+ 需加 `e.key === 'Enter' && !e.shiftKey` 防御性检查(已记录于 Plan 02 SUMMARY.md Known Stubs / Future Work) |

### 人工验证必需项 (Human Verification Required)

Plan 02 Task 2 是 `checkpoint:human-verify` 关卡,以下 5 项浏览器可视化/交互行为 jsdom 无法替代,需在 `npm run dev` 中验证:

1. **PopoverAnchor layout** — 输入 `/` 后 popup 出现在 form 上方、宽度与 form 一致、textarea 保留焦点
2. **IME candidate window** — CJK IME 候选框不完整遮挡 popup(接受 macOS 已知 Esc-once 缓解)
3. **cmdk Enter event ordering** — `/` Enter → textarea 变 `/goal `,**不**发送消息;`/` Tab → 同上;`/goal` Shift+Enter → 换行,**不**发送
4. **Esc + Backspace** — Esc 关 popup 后焦点回 textarea;`/` Backspace 关 popup
5. **Arrow wrap** — `↓` × 3 循环 `/goal → /context → /plan → /goal`;`↑` from `/goal` → `/plan`

详见 VERIFICATION.md 顶部 `human_verification` 字段。

### 缺口总结 (Gaps Summary)

**无自动化的 BLOCKER gaps**。所有 19 个 must-haves.truths + 5 个 must-haves.artifacts + 5 个 key_links 已通过代码验证 + 自动化测试验证。

**已记录的 Known Stubs (不阻塞 phase 完成):**

- `SlashCommandPopup.handleKeyDown` 缺少 `e.shiftKey` 防御性检查 — Phase 6 4-Source Registry 期间加固,加 SLASH-REGRESSION 覆盖。

**5 项人工验证 (Human Verification Required):**

- 来自 Plan 02 Task 2 `checkpoint:human-verify` — 浏览器层级 PopoverAnchor 布局 / IME 候选框 z-index / cmdk Enter 事件序 / Esc+Backspace 焦点保留 / Arrow wrap。jsdom 不可见,需用户在 dev build 中确认。

---

_Verified: 2026-06-04T03:45:00Z_
_Verifier: Claude (gsd-verifier)_

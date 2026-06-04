# Phase 8: Polish + Differentiators - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

在 Phase 5/6/7 稳定基座上做 v1.1 polish，让 popup 用起来"丝滑"而非"能用"。Phase 8 是 v1.1 最后阶段，没有新 SLASH-XX 需求，专注于 5 个 polish 维度。

**In scope:**
- 7 色彩色 source badge 视觉系统（system/skill:global/skill:project/workflow/mcp/cmd:system/cmd:project）
- CJK NFKC 过滤强化（D-05 + D-06 已锁定的 NFKC normalize 增强）
- MCP 源慢加载 skeleton/spinner（>500ms 阈值）
- IME 候选框 z-index 边界处理（macOS 已知 issue）
- chokidar 失败降级 toast（Phase 6 D-24 log only 升级为 user-visible toast）
- 5 行 popup 视觉密度调整（max-h-64 256px → 待定）

**Out of scope:**
- ❌ Args parser（v1.2 SLASH-15/17 推）
- ❌ 7 命令 source badge 视觉之外的更多 badge 变体（i18n 等）
- ❌ 新 SLASH-XX 需求（Phase 7 已闭合所有 active SLASH）
- ❌ 重新设计 popup 布局（保持 Phase 5/6 7-row layout）

</domain>

<decisions>
## Implementation Decisions

### 7-color source badge palette

- **D-01:** 7 个 source 各用 1 种固定色（与 ROADMAP 描述对齐）：
  - `system` → 蓝 (`#3b82f6`)
  - `skill:global` → 紫灰 (`#a78bfa`，low contrast with bg)
  - `skill:project` → 紫 (`#9333ea`)
  - `workflow` → 绿 (`#22c55e`)
  - `mcp` → 橙 (`#f59e0b`)，badge text = `[mcp:serverId]`（保留 Phase 6 D-08 决定）
  - `cmd:system` → 灰 (`#9ca3af`)
  - `cmd:project` → 深灰 (`#6b7280`)
- **D-02:** 颜色仅作用在 badge 文字色（`text-${color}` class），不改变 badge 背景或边框。保持 5 行 popup 视觉密度（Phase 5/6 锁定）。
- **D-03:** 暗色主题优先（VS Code Dark+ 主题 palette）。亮色主题在 Phase 8 范围内降权（后续可补但不在 v1.1）。
- **D-04:** 颜色通过 Tailwind `text-{color}-{500}` 静态 class 应用，**不**新增 CSS variables（保持 Phase 5/6 主题 CSS 变量体系不变）。

### CJK NFKC filter strengthening

- **D-05:** 当前 `filterCommands` 已用 `String.prototype.normalize('NFKC')` 处理 query 和 item（Phase 5/6 D-05 锁定）。Phase 8 强化：
  - **D-05a:** 半角 / 全角归一化：`.normalize('NFKC')` 已覆盖（半角 → 全角 转换）
  - **D-05b:** Unicode 组合字符归一化：`.normalize('NFKC')` 已覆盖
  - **D-05c:** 大小写不敏感：`.toLowerCase()` 已覆盖
  - **D-05d:** Phase 8 新增 **emoji + 异体字 selector 归一化**（`U+FE0F` 变体选择器去除），确保 `/🎉` 与 `/🎉︎` 匹配一致
- **D-06:** 性能：filter 在 useMemo 中（Phase 5 已实现），`normalize` 重复调用 N=commands.length 次 — Phase 8 优化为「先对每个 cmd.name 预 normalize 进 Map，filter 时直接 Map.get」

### MCP skeleton spinner (slow load)

- **D-07:** Skeleton 触发阈值 = 500ms（ROADMAP 原定值，客人大人 2026-06-04 确认）
- **D-08:** Skeleton 行渲染在 popup 顶部、source 描述位：`<Skeleton className="h-4 w-32" />`（尺寸与单行命令相同，不撑大 popup）
- **D-09:** Skeleton 出现条件：useCommandRegistry hook 触发 `commands:list` IPC 超过 500ms 仍无响应
- **D-10:** Skeleton 消失时机：IPC 响应到达 或 IPC 失败转 `mcp_health_warning` 灰行
- **D-11:** 失败处理：IPC reject / throw → 静默换 `mcp_health_warning` 灰行（**不**静默；与 Phase 6 D-08 一致）
- **D-12:** Skeleton 实现：用 `<Skeleton>` shadcn 组件（已有；`src/renderer/src/components/ui/skeleton.tsx`）

### IME z-index edge case (macOS)

- **D-13:** Popup 当前 z-index = 50（Phase 5/6 锁定；`tailwind z-50`）。macOS IME 候选框 z-index ≈ 9999 候选会覆盖 popup。
- **D-14:** Phase 8 **接受** macOS 已知 issue，不解决（技术限制）。ROADMAP 已说明「候选框期间可 Esc 一次关 popup」作为 workaround。
- **D-15:** Phase 8 改动：在 Phase 5 已知 stub 旁边加注释，提示用户「IME 候选期间 popup 被遮挡，按 Esc 关闭候选框后 popup 仍可见」。

### Chokidar failure toast

- **D-16:** Phase 6 D-24 仅 log（不 toast）。Phase 8 升级为 user-visible toast：
  - 触发：chokidar 初始化失败 / 监听过程中出错
  - 降级：改用 `readdir` 一次扫描获取项目命令静态列表
  - Toast 文案：「项目命令热重载不可用，已降级为静态扫描」
  - Toast duration：5000ms（Phase 7 `/context` toast 用 4000ms；hot-reload 失败是 less critical 略短）
  - Sonner `warning` variant（与 Phase 6 conflict toast 一致）
- **D-17:** 用户点 toast 不关闭，可手动 dismiss
- **D-18:** 系统命令（`/goal` `/context` `/plan`）的初始加载走 `collectSystemCommands`（无 IO，永远不会触发降级），不需 toast 路径
- **D-19:** 降级后 watcher 完全停用，**不**自动重试（避免循环失败日志）

### 5-row popup visual density (Phase 5/6 inherited)

- **D-20:** 维持 Phase 5/6 layout：5 行 max-h-64 = 256px，Command.List + max-h-64 + overflow-y-auto
- **D-21:** Badge 列加 source color 后，行高不变（13px body 字体 + 24px 行高 = 32px row）
- **D-22:** Phase 8 不调整 popup 高度 / 列宽（保持 7-row source badge + name + description + skeleton 的 5 行总览）

### Phase 8 不做的事情（Claude's Discretion）

- **C-01:** 亮色主题 7 色彩色（与暗色对应）—— Phase 8 不做；推 v1.2
- **C-02:** 7 色彩色在 popup 之外的应用（e.g., 气泡中 badge）—— Phase 8 限定 popup
- **C-03:** MCP 慢加载 skeleton 行数（1 行 vs 2 行）—— 1 行（与 popup 行高一致）
- **C-04:** Toast 多次出现的去重策略（同一错误只 toast 1 次 vs 每次都 toast）—— 1 次（用 set 存已 toast 错误）
- **C-05:** Skeleton 颜色（与背景对比度）—— 沿用 shadcn default Skeleton color
- **C-06:** 5 行 popup 视觉密度的微调（行间距 / 内 padding）—— 不调，保持 Phase 5 baseline
- **C-07:** `cmd:project` 优先级（与 `cmd:system` 同色但更深的灰是否要）—— 用 ROADMAP 描述的「深灰」即可

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.1 Milestone Artifacts

- `.planning/PROJECT.md` §"Current Milestone: v1.1" — v1.1 scope
- `.planning/PROJECT.md` §"Validated (v1.1)" — SLASH-01..07/REGRESSION/DISPATCH all validated
- `.planning/REQUIREMENTS.md` §"Active (v1.1)" — *(empty after Phase 7)*
- `.planning/ROADMAP.md` §"Phase 8: Polish + Differentiators" — Goal, 5 Success Criteria, Plan list
- `.planning/STATE.md` — current focus
- `.planning/research/SUMMARY.md` — 4-agent research synthesis
- `.planning/research/FEATURES.md` — D1/D2/D7/D13/D14/D15 polish dimensions
- `.planning/research/PITFALLS.md` — P1/P4/P6 residual concerns
- `.planning/phases/05-popup-shell-keyboard-spike/05-UI-SPEC.md` — Phase 5 11px/13px typography + 256px popup height
- `.planning/phases/06-4-source-command-registry-dispatcher/06-CONTEXT.md` — D-01..D-25 + C-01..C-08
- `.planning/phases/06-4-source-command-registry-dispatcher/06-01-SUMMARY.md` — Phase 6 deferred polish items
- `.planning/phases/07-system-commands-m3-regression-test/07-CONTEXT.md` — D-01..D-19 system commands

### v1.0 Codebase Anchors

- `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` — Phase 5/6 popup shell + source badge
- `src/renderer/src/components/ui/badge.tsx` — existing shadcn `<Badge>` (Phase 6 复用)
- `src/renderer/src/components/ui/skeleton.tsx` — existing shadcn `<Skeleton>` (Phase 8 新用)
- `src/renderer/src/hooks/useCommandRegistry.ts` — Phase 6 IPC consumer (Phase 8 skeleton 集成点)
- `src/renderer/src/stores/sessionStore.ts` — Phase 7 sessionGoals (Phase 8 不动)
- `src/renderer/src/components/ChatArea/ChatArea.tsx` — 5-line sniff (Phase 7 D-14, Phase 8 不动)
- `src/main/commands/chokidar-watcher.ts` — Phase 6 watchSystemCommandsDir + watchProjectCommandsDir (Phase 8 降级)
- `src/main/ipc-handlers.ts:783-810` — commands:list + commands:readProjectCommands (Phase 8 改 start hook)
- `src/main/index.ts:1-25` — `app.whenReady` chokidar init (Phase 8 降级 catch)
- `src/renderer/src/lib/utils.ts` — `cn()` utility

### External Library Docs

- `sonner@2.0.7` — toast (Phase 6 装; Phase 8 复用)
- `cmdk@1.1.1` (Phase 5 装) — `Command.List` rendering
- `tailwindcss` — `text-{color}-{500}` static class application

### Hard "Do Not Touch" List (v1.1 — extends from Phase 7)

- `src/main/runtime.ts` — **untouched in Phase 8** (Phase 7 already finalized Gap 2+3)
- `src/main/llm.ts:306-425` — **untouched**
- `src/main/workflow-runtime.ts` — **untouched**
- `LLMStreamEvent` union — **untouched**
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — **untouched**
- Phase 5/6 popup layout (256px max-h + 7-row + Command.Item) — **untouched structure** (only badge color added)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **shadcn `<Badge>`** (`src/renderer/src/components/ui/badge.tsx`): Phase 6 复用为 source badge。Phase 8 加 `className="text-blue-400"` 等 static class 实现 color。
- **shadcn `<Skeleton>`** (`src/renderer/src/components/ui/skeleton.tsx`): 现成组件，Phase 8 新用于 MCP 慢加载。
- **Sonner toast** (already installed): `toast.warning('message', { description, duration })` pattern.
- **Tailwind palette** (`tailwind.config.js`): standard colors 60-950, 与 dark mode 配合。
- **Theme CSS variables** (`src/renderer/src/styles/theme.css`): `var(--color-bg-surface)`, `var(--color-text-muted)`, `var(--color-accent)` — Phase 8 **不**加新变量。
- **useCommandRegistry hook state**: 已有 `loading` boolean (Phase 6 16-17 行)，可扩展为 `loading: 'idle' | 'pending' | 'ready'` for skeleton gating.

### Established Patterns

- **shadcn-style className** via `cn()` utility
- **Sonner toast for user feedback** (Phase 6/7 模式)
- **MCP 错误处理**: try-catch + `mcp_health_warning` 灰行 (Phase 6 D-08 锁定)
- **Chokidar double-watch pattern** (Phase 6 D-23)
- **vitest + @testing-library/react** for tests
- **vitest useFakeTimers** for skeleton threshold tests

### Integration Points

- **SlashCommandPopup.tsx**:
  - `<Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">{cmd.badge}</Badge>` — Phase 6 已就位, Phase 8 加 `text-{color}-400` class
  - `{hasMcpWarning && (<div data-testid="mcp-health-warning">...)}` — Phase 6 mcp_health_warning row, Phase 8 不动
  - `{isLoadingSlow && (<div data-testid="mcp-skeleton">...)}` — Phase 8 新增 skeleton row
- **useCommandRegistry.ts**:
  - `const [loading, setLoading] = useState(false)` — Phase 6; Phase 8 改为 `useState<'idle' | 'pending' | 'ready' | 'error'>('idle')`
  - `setLoading(true)` → `setLoading('pending')` after IPC
  - IPC reject → `setLoading('error')` + mcp_health_warning trigger
- **chokidar-watcher.ts**:
  - `chokidar.watch()` call wrapped in try-catch; on error, log + call `onDegradedFallback()` (Phase 8 新 helper)
  - `onDegradedFallback()`: readdir + emit `commands:changed` event with `{ source: 'fallback' }`
- **main/index.ts**:
  - `app.whenReady` block: wrap `watchSystemCommandsDir()` in try-catch; on error, show toast via `mainWindow.webContents.send('commands:fallback', ...)`

</code_context>

<specifics>
## Specific Ideas

- **7 色彩色 hex 灵感 (Claude 决定具体值，但 ROADMAP 描述锁定):**
  - system 蓝：`#3b82f6` (Tailwind blue-500)
  - skill:global 紫灰：`#a78bfa` (Tailwind violet-400) — 故意与 skill:project 紫 `#9333ea` 形成 global/project 区分
  - skill:project 紫：`#9333ea` (Tailwind purple-600)
  - workflow 绿：`#22c55e` (Tailwind green-500)
  - mcp 橙：`#f59e0b` (Tailwind amber-500)
  - cmd:system 灰：`#9ca3af` (Tailwind gray-400)
  - cmd:project 深灰：`#6b7280` (Tailwind gray-500)

- **Skeleton 行设计**:
  ```jsx
  <div
    data-testid="mcp-skeleton"
    className="flex items-center gap-2 px-2 py-1.5 select-none"
  >
    <Skeleton className="h-3 w-12 rounded" />
    <Skeleton className="h-3 w-24 rounded" />
  </div>
  ```
  2 个 Skeleton 元素（badge 宽 + name 宽），与真实命令行高 32px 一致。

- **CJK NFKC 强化** (D-05d emoji selector removal):
  ```ts
  // 现有: c.value.normalize('NFKC').toLowerCase()
  // Phase 8: 进一步去除 FE0F 变体选择器
  c.value.normalize('NFKC').replace(/[️︎]/g, '').toLowerCase()
  ```

- **Chokidar 降级 toast** (D-16):
  ```ts
  // chokidar-watcher.ts:
  try {
    const handle = chokidar.watch(dir, { ... });
  } catch (err) {
    log.error('[commands-watcher] chokidar init failed:', err);
    // Phase 8: emit fallback event for renderer toast
    onDegradedFallback(err);
  }
  
  function onDegradedFallback(err: Error) {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('commands:fallback', { error: err.message });
    });
    // Try one-shot readdir as fallback
    try {
      const files = fs.readdirSync(dir);
      onChange();
    } catch (readErr) {
      log.error('[commands-watcher] readdir fallback also failed:', readErr);
    }
  }
  ```

- **Skeleton 阈值测试** (vitest):
  ```ts
  it('shows skeleton after 500ms if commands:list still pending', async () => {
    vi.useFakeTimers();
    // Setup: hang the IPC
    api.list.mockImplementation(() => new Promise(() => {}));
    renderHook(() => useCommandRegistry('p1', 'a1'));
    // Fast-forward 500ms
    act(() => { vi.advanceTimersByTime(500); });
    // Now skeleton should be present
    expect(...).toBeTruthy();
    vi.useRealTimers();
  });
  ```

- **TOAST DEDUPLICATION** (C-04): maintain `Set<errorFingerprint>` in useCommandRegistry; if already shown, skip. Reset on mount.

</specifics>

<deferred>
## Deferred Ideas

### 推 v1.2+

- 亮色主题 7 色彩色（C-01）
- 7 色彩色应用到 popup 之外（气泡中 badge 等）（C-02）
- SLASH-15 (`/goal` SQLite 持久化)
- SLASH-17 (命令别名)

### Phase 8 范围内不重新设计

- 5 行 popup 视觉密度微调（C-06）—— 保持 Phase 5 baseline
- 重新设计 popup layout（ROADMAP 不在范围内）
- 替换 sonner toast 为 MessageItem 气泡（Phase 7 placeholder 是 sonner；Phase 8 polish 可换但客人大人没要求）

</deferred>

---

*Phase: 8-Polish + Differentiators*
*Context gathered: 2026-06-04*

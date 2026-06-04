# Phase 6: 4-Source Command Registry + Dispatcher - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

在 Phase 5 popup 壳层 + 19 个键盘契约测试之上，注入 5 源（system + MCP + Skills × 2 亚源 + Workflows + Custom Commands × 2 亚源）的命令注册表，建立 4 种 `CommandDispatchAction` 分发器骨架，**仅 args 字符串透传**（不解析 flag/option）。插件命令以自然语言重写走 `llm:chat` 现有通路，**不**新增 dispatch IPC 通道。

**In scope:**
- 5 源命令采集 + 4 亚源扫描（global/project × skills/commands）
- 4 种 `CommandDispatchAction` 骨架（SystemSilent / SystemLocal / PluginRewrite / PlanMode）
- 命名冲突检测 + `CommandConflictError` + sonner toast
- chokidar@3.6.0 双路热重载（`~/.cdf/commands/` + `<projectPath>/.cdf/commands/`）
- Workflow 自动注册（仅 `status='active'`，轻量 SQL）
- 2 个新 IPC 通道（`commands:list` + `commands:readProjectCommands`）
- 3 个 system command placeholder 在 dispatcher 内的识别分支（**不**实现 UI 反馈）
- MCP `mcp_health_warning` 降级行

**Out of scope:**
- ❌ seed `/pr-review` demo workflow（**已取消**，理由：v1.0 Phase 4 已有 workflow 能力）
- ❌ args 解析层（flag / named params；Phase 7）
- ❌ 3 个 system command 的具体 UI 反馈（/goal 写 store + 气泡；/context 调 API + 气泡；/plan runtime flag 验证；Phase 7）
- ❌ 7 色彩色 source badge 视觉（Phase 8 polish）
- ❌ skeleton/spinner 加载态（Phase 8）
- ❌ CJK NFKC 强化（Phase 8）
- ❌ chokidar 失败降级 toast（Phase 8）

</domain>

<decisions>
## Implementation Decisions

### CommandDispatchAction 4 种 Kinds

- **D-01:** Phase 6 锁定 4 种 `CommandDispatchAction` 骨架：
  - **`SystemSilent`** — 写 store，**无 LLM 调用，无 UI 反馈**。映射 `/goal`（Phase 7 实现 `setSessionGoals` 写入）
  - **`SystemLocal`** — 调本地 API + 立即占位气泡，**无 LLM 调用**。映射 `/context`（Phase 7 实现 token 用量聚合）
  - **`PluginRewrite`** — 自然语言重写 `请调用 ${tool} 工具，参数：${args}` → `llm:chat` 现有通路。映射 MCP / Skills / Workflows / Custom Commands
  - **`PlanMode`** — LLM 调用 + `payload.overrides = { planOnly: true }` runtime flag。映射 `/plan`

- **D-02:** args 字符串**仅透传**，不解析。`args = value.slice(commandName.length).trim()`。具体 flag 解析在 Phase 7。

- **D-03:** 命名映射：
  | Command name | Kind |
  |---|---|
  | `/goal` | `SystemSilent` |
  | `/context` | `SystemLocal` |
  | `/plan` | `PlanMode` |
  | `/<mcp_tool_name>` | `PluginRewrite` |
  | `/<skill_name>` (global or project) | `PluginRewrite` |
  | `/<workflow_name>` (active only) | `PluginRewrite` |
  | `/<custom_command>` (system or project) | `PluginRewrite` |

  system/MCP/Workflow/CustomCommands 命名空间不重叠；Skills × 2 亚源可重叠 → conflict resolution。

### Conflict Resolution 语义

- **D-04:** priority 字段**仅控制 popup 行排序**。priority 高的行排前面，用户手动选谁就选谁（不强制选 priority 最高的）。
- **D-05:** 冲突时**两行都保留**，各带 source badge。priority 不影响默认高亮（沿用 Phase 5 D-04：每次开 popup 高亮第一行）。
- **D-06:** priority 顺序（保留 ROADMAP 锁定）：
  `system > skill:project > skill:global > workflow > mcp > cmd:project > cmd:system`
- **D-07:** registry 构建期若发现同 name 跨 priority 不同的冲突，抛 `CommandConflictError` 触发 sonner toast。**不**自动 kill 任何行（遵循"两行都保留"）。

### Source Badge 展示

- **D-08:** popup 每行格式 `[source] /name` 或 `[source:name] /name`。Phase 6 复用现有 `<Badge>` 组件，**不**自定 7 色（Phase 8 polish 才决定）。
- **D-09:** MCP tool row 只显示 name（如 `mcp:arxiv_search`），**不**显示 description / param hint（与 Phase 5 D-01 一致；MCP 工具的 inputSchema 复杂度不暴露给 popup）。MCP tool description 仅在 4 源采集时用于内部 log / debug。

### Workflow Source 范围

- **D-10:** 仅 `status='active'` + 名称合法（`/^[a-z0-9-]+$/`）的 workflow 自动注册为 `/${name}` 命令。
- **D-11:** 走轻量 SQL：`SELECT id, name, description FROM workflows WHERE status='active'`。**不**调 `db:getWorkflows`（避免 `graph_data` 重数据）。
- **D-12:** 名称冲突走 D-04..D-07 通用规则；不额外加 workflow 专属 tag。

### Registry 加载时机

- **D-13:** session 启动时拉一次 base registry（5 源全扫描一次）。
- **D-14:** chokidar 事件增量更新（custom commands 目录 + workflow DB listen 后续 Phase 8 polish）。
- **D-15:** popup 打开时**只**读内存中 state，O(1) 响应。**不**在 popup 打开时重拉。

### MCP Source 处理

- **D-16:** MCP 工具通过 `loadMcpTools(agentId, mcpServers)` 复用 `mcpCache`（**不**重连）。Phase 6 注册时机：
  - session 启动时调用一次，注册到 registry
  - MCP 健康事件触发 registry 更新
- **D-17:** MCP tools list 为空（`loadMcpTools` 返回 `[]`）时，popup **不**静默，显示 `mcp_health_warning` 灰行（位置：popup 顶部或底部，由 Claude 决定）。
- **D-18:** MCP args 语义（保留 ROADMAP 锁定）：`/arxiv_search foo bar` → 工具以**无参**方式调用；`foo bar` 作为自然语言上下文附加到 `llm:chat` payload 的 `message.content`（不传给 tool 的 `args`）。

### Custom Commands 2 源

- **D-19:** system commands 读 `~/.cdf/commands/*.md`；project commands 读 `<projectPath>/.cdf/commands/*.md`。**注意路径是 `.cdf/commands/` 不是 `.claude/commands/`**（与 `.cdf/skills/` 对齐）。
- **D-20:** YAML frontmatter 解析字段：`name` `description` `argument-hint`。`$ARGUMENTS` 占位符在 body 内替换后再做自然语言 prompt 重写（PluginRewrite path）。
- **D-21:** 同 name 冲突时 project wins（与 skills 规则一致；priority 表 D-06 反映）。

### Skills 2 源

- **D-22:** global skills 读 `~/.cdf/skills/`；project skills 读 `<projectPath>/.cdf/skills/`。同 name → project wins。

### chokidar 行为

- **D-23:** session 启动时**两路都用** chokidar@3.6.0 + `awaitWriteFinish: { stabilityThreshold: 200 }` 监听：
  - `~/.cdf/commands/*.md`
  - `<projectPath>/.cdf/commands/*.md`
- **D-24:** chokidar 失败时（Phase 6 范围）**只 log error**。降级 toast 推 Phase 8 polish。

### 跨平台 chokidar 测试矩阵

- **D-25:** Phase 6 必须包含 macOS + Windows + Linux 至少各 1 run（CI badge for v1.1 退出标准）。

### Claude's Discretion

- **C-01:** source badge 的具体文案（`[system]` / `[skill:global]` / `[mcp:arxiv]` 等）。Phase 6 沿用 ROADMAP 提议的格式，Phase 8 polish 调视觉。
- **C-02:** `mcp_health_warning` 灰行的位置（popup 顶部 / 底部 / inline）。
- **C-03:** IPC payload schema 细节（`commands:list` 返回结构：`{ system: [...], mcp: [...], skills: { global: [...], project: [...] }, workflows: [...], commands: { system: [...], project: [...] } }`）。
- **C-04:** Phase 6 dispatcher 在 main 进程还是 renderer 进程？默认 main 进程（与 IPC 通信一致）；但可微调。
- **C-05:** 测试策略：vitest unit（registry 纯函数、dispatcher 4 种 kinds）+ 1 个 e2e（`/goal` 写 store + `/context` 调 API + `/plan` 触发 planOnly flag）。
- **C-06:** Phase 6 是否需要把 Phase 5 的 `slashOpen` useState 提到 Zustand store。默认沿用 Phase 5 local state；Phase 8 polish 可重构。
- **C-07:** source badge 颜色（Phase 6 复用 `<Badge>` 默认，Phase 8 polish 才自定义 7 色）。
- **C-08:** chokidar event → renderer 的 IPC push 通道名（建议 `commands:changed`，具体命名由 Claude 决定）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.1 Milestone Artifacts

- `.planning/PROJECT.md` §"Current Milestone: v1.1 基本能力完善" — v1.1 Goal + Target features + Requirements
- `.planning/REQUIREMENTS.md` §"Active (v1.1)" — SLASH-03/04/08/09a/09b/10/11a/11b/12/13 + SLASH-DISPATCH
- `.planning/ROADMAP.md` §"Phase 6: 4-Source Command Registry + Dispatcher" — Goal, Requirements, Success Criteria, Plan list
- `.planning/STATE.md` — current focus, key decisions
- `.planning/research/SUMMARY.md` — 4-agent research synthesis (CMDK + Radix Popover + chokidar + plugin dispatch)
- `.planning/research/ARCHITECTURE.md` — 4-source registry design, payload.overrides extension point at `llm.ts:324`
- `.planning/research/STACK.md` — `chokidar@3.6.0` + `sonner` version verification
- `.planning/research/PITFALLS.md` — P3 (MCP empty tools), P7 (command injection via args), P11 (workflow zombie), P13 (IME safety — already in Phase 5)
- `.planning/phases/05-popup-shell-keyboard-spike/05-CONTEXT.md` — D-01..D-07 + C-01..C-03 + spike rationale
- `.planning/phases/05-popup-shell-keyboard-spike/05-UI-SPEC.md` — popup layout, 7-color badge vision
- `.planning/phases/05-popup-shell-keyboard-spike/05-VERIFICATION.md` — 19/19 must-haves + known P5 stub (handleSlashSelect in ChatArea still inserts text only; Enter/Tab same)
- `.planning/phases/05-popup-shell-keyboard-spike/05-02-SUMMARY.md` — known stub: `SlashCommandPopup.handleKeyDown` lacks `e.shiftKey` defensive check; needs Phase 6 hardening

### v1.0 Codebase Anchors

- `src/renderer/src/components/ChatArea/ChatArea.tsx` — Phase 5 wiring (5 surgical insertions: imports, slashOpen useState, slashRef, handleSlashSelect, onChange IME gate, handleKeyDown branch, Popover wrap). **Phase 6 must extend `handleSlashSelect`**: now the slash path should detect command name + args, call dispatcher.resolve(value), and dispatch.
- `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` — Phase 5 shell. Phase 6 extends `Command.Item` rendering: add source badge column, support rows with description, register `data-source` attribute.
- `src/renderer/src/components/ui/badge.tsx` — existing shadcn-style `<Badge>` for source badges (Phase 6 复用，Phase 8 polish 7 色)
- `src/renderer/src/stores/sessionStore.ts` — Zustand store. Phase 6 写入 `sessionGoals: Map<sessionId, string>` 由 Phase 7 实现；Phase 6 仅占位接口。
- `src/main/llm.ts:306-425` — `runLLMChat` + `streamEvents` v3; **patch-package 层** (Hard Do Not Touch); extension point at `llm.ts:324` for `payload.overrides.planOnly`
- `src/main/llm.ts:324` — extension point for `payload.overrides = { planOnly: true }` (Phase 6 dispatcher 写；Phase 7 验证)
- `src/main/deepagent/mcp-connector.ts` — `loadMcpTools(agentId, mcpServers)` 复用 `mcpCache`
- `src/main/ipc-handlers.ts` — IPC inventory; Phase 6 新增 2 个 channel: `commands:list` + `commands:readProjectCommands`
- `src/preload/index.ts` — electronAPI surface; Phase 6 暴露 `commands.list()` + `commands.readProjectCommands()`
- `src/shared/types.ts` — Phase 6 添加 `SlashCommand`, `CommandDispatchAction`, `CommandSource`, `CommandConflictError` 类型
- `src/renderer/src/hooks/useCommandRegistry.ts` — Phase 6 新建 (registry consumer hook)
- `src/main/commands/command-registry.ts` — Phase 6 新建 (registry 主进程端)
- `src/main/commands/project-commands.ts` — Phase 6 新建 (project .cdf/commands/*.md 解析)
- `src/renderer/src/lib/commands/dispatcher.ts` — Phase 6 新建 (4 种 kinds 分发器)
- `src/main/index.ts` — main 进程入口；Phase 6 chokidar 初始化在 session 启动钩子

### External Library Docs

- `chokidar@3.6.0` — `chokidar.watch(path, { awaitWriteFinish: { stabilityThreshold: 200 } })` 处理 macOS VSCode atomic-write；4.x breaking changes 不需要
- `sonner` — shadcn-style toast (Phase 6 新增 dep, 用于 `CommandConflictError` 反馈)
- `cmdk@1.1.1` (Phase 5 dep) — `Command.Item` 支持多 column 渲染 (Phase 6 扩展为 badge + name)
- `@radix-ui/react-popover@1.1.15` (Phase 5 dep) — `Popover.Content` 内可承载多列布局

### Hard "Do Not Touch" List (v1.1)

- `src/main/runtime.ts` (deepagent runtime) — M3 chain breaks
- `src/main/llm.ts:306-425` (`runLLMChat` + `streamEvents` v3) — patch-package layer
- `src/main/workflow-runtime.ts` — independent runtime
- `LLMStreamEvent` union (13 types) — plugin commands emit existing types only
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — SLASH-REGRESSION it 块为护栏（Phase 7 加入）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`<Badge>` component** (`src/renderer/src/components/ui/badge.tsx`): shadcn-style, accepts className prop, CSS variables. Phase 6 复用为 source badge。
- **Existing `useSlashCommandStore` 概念** — Phase 5 用 local useState；Phase 6 可选提到 Zustand（C-06）。Phase 7 `sessionGoals` Map 必然要 store。
- **IME safety primitives** in ChatArea.tsx — `isComposingRef`, `justFinishedComposingRef`, `isComposingKeyEvent`。Phase 6 的 dispatcher 调用**不**绕过 IME 检测（保留 Phase 5 闸门）。
- **`loadMcpTools(agentId, mcpServers)`** (`src/main/deepagent/mcp-connector.ts`) — 复用 `mcpCache`，不重连。Phase 6 启动钩子调用一次，注入到 registry。
- **`payload.overrides = { planOnly: true }`** 扩展点 (`src/main/llm.ts:324`) — Phase 6 dispatcher 写入，Phase 7 验证。
- **electron-log** (`src/main/logger.ts`) — chokidar 失败时 log（D-24）。

### Established Patterns

- **shadcn-style `cn()` className utility**: import from `src/renderer/src/lib/utils`。
- **Radix primitives wrap pattern**: 每个 Radix 组件在 `src/renderer/src/components/ui/{name}.tsx` 重新 export。Phase 6 不新增 Radix 组件；沿用 `popover.tsx` (Phase 5)。
- **Theme CSS variables**: `var(--color-bg-surface)` 等。source badge 颜色 Phase 8 polish 决定，Phase 6 沿用 `<Badge>` 默认。
- **main↔renderer IPC 模式**: `ipcMain.handle(channel, async (_, args) => ...)` + `preload.exposeInMainWorld('electronAPI', { commands: { list: () => ipcRenderer.invoke('commands:list') } })`。Phase 6 沿用。
- **Zustand store 模式**: `create<State>()((set, get) => ({ ... }))` 在 `src/renderer/src/stores/`。Phase 6 可选新建 `slashCommandStore.ts` (C-06)。

### Integration Points

- **ChatArea.tsx 5 surgical insertions** (Phase 5) — Phase 6 扩展 `handleSlashSelect` (line 663-666)：
  - 现状：`setInputVal(cmd + ' '); setSlashOpen(false);`
  - Phase 6 改造：识别 cmd + args → 调 `dispatcher.resolve(value)` → 按 kind 走 4 种分支
  - 关键：D-07 锁定 — Tab 仍只插文本不触发（保留 Phase 5 D-07）；Enter 分支按 kind 分发。
- **SlashCommandPopup.tsx `Command.Item` 渲染** (Phase 5 line 110-119) — Phase 6 扩展：
  - 增加 source badge 列
  - 增加 description 列（仅 system commands 显示，其他 5 源由 D-09 决定）
  - `data-source` attribute 用于测试
- **MCP 缓存注入点**: `src/main/index.ts` 启动时调用 `loadMcpTools(agentId, mcpServers)` 一次，注册到 registry。
- **chokidar 启动点**: `src/main/index.ts` 启动钩子；watcher 失败时 `electron-log.error`。

</code_context>

<specifics>
## Specific Ideas

- **D-23 跨平台 chokidar 矩阵**: Phase 6 CI 必须包含 macOS + Windows + Linux 至少各 1 run。Windows 上 `chokidar` polling 行为不同，需要测试 fixture。
- **D-18 MCP args 语义**: 客人大人刻意要求 args 不传给 tool，避免 PITFALLS P7（命令注入）。`/arxiv_search foo bar` → 工具无参调用 + `foo bar` 作为 `message.content` 自然语言附加。这与 v1.1 "命令仅在消息开头识别" 的设计哲学一致。
- **D-04 优先级语义极简**: 客人大人否决"priority 影响高亮 / Enter 默认行为"，理由是"两行都保留"已经透明，强制优先级反而是隐藏的复杂性。Phase 6 沿用此极简原则。
- **取消 seed `/pr-review`**: 客人大人明确否决，理由"v1.0 Phase 4 已有 workflow 能力"。PITFALLS P11 担忧消解（zombie workflow 风险 = 0）。
- **Phase 6 = dispatcher 骨架 + args 字符串透传**: 客人大人刻意把具体 3 个 system command 的语义/UI 反馈全部推 Phase 7，避免 Phase 6 范围爆炸。
- **D-15 popup 打开 O(1)**: 客人大人拒绝 lazy 拉取方案（每次开 popup 走 IPC），坚持 session 启动 + chokidar 增量；popup 打开只是 memory read。
- **D-08 source badge 文案**: Phase 6 沿用 ROADMAP 提议的 `[system]` / `[skill:global]` 等格式；具体 7 色在 Phase 8 polish 决定。

</specifics>

<deferred>
## Deferred Ideas

### 取消（不再做）

- ❌ **seed `/pr-review` 3 节点 demo workflow** (原 ROADMAP §Phase 6 #6 + Plan 06-03) — 客人大人明确否决，理由：v1.0 Phase 4 已有 workflow 能力。PITFALLS P11 (zombie workflow) 担忧消解。

### 推 Phase 7

- args 解析层（flag / named params）— 客人大人要求 Phase 6 只透传
- 3 个 system command 的具体 UI 反馈：
  - `/goal` placeholder 气泡 + `setSessionGoals` 写入
  - `/context` placeholder 气泡 + `messages` 表 token 聚合
  - `/plan` 验证 `payload.overrides.planOnly` 触发 reasoning chunk
- SLASH-REGRESSION it 块（6-hunk patch-package 护栏）

### 推 Phase 8 polish

- 7 色彩色 source badge 视觉系统
- skeleton/spinner 加载态
- CJK NFKC 过滤强化
- chokidar 失败降级 toast
- IME 候选框 z-index 边界处理
- 5 行 popup 视觉密度打磨

### 推 v1.2+

- SLASH-15 (`/goal` SQLite 持久化)
- SLASH-17 (命令别名 `/c` for `/context`)

</deferred>

---

*Phase: 6-4-Source Command Registry + Dispatcher*
*Context gathered: 2026-06-04*

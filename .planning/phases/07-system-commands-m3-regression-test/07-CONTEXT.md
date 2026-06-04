# Phase 7: System Commands + M3 Regression Test - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

实现 3 个 system command 的具体 UI 反馈（Phase 6 dispatcher 仅是占位 console.log）+ SLASH-REGRESSION it 块作为 6-hunk patch-package 的护栏。Phase 6 已经搭好 dispatcher 骨架 + IPC 桥接，Phase 7 在此之上接数据 + 加回归测试。

**In scope:**
- `/goal [X]` → 写 `useSessionStore.sessionGoals: Map<sessionId, string>` + `[system] 正在执行 /goal…` placeholder 气泡（200ms 内，**无 LLM 调用**）
- `/context [all]` → placeholder 气泡显示当前 session 全部加载数据 token 用量（对话 + skills + mcp + workflow，**无 LLM 调用**）
- `/plan [X]` → dispatcher 走 `llm:chat` 设置 `payload.overrides = { planOnly: true }`（llm.ts:324 扩展点）；首个 `message_chunk` 必须含 `<think>…plan only…</think>`；**不**触发 `write_file` / `edit_file` / `bash`
- `/plan` placeholder 气泡（样式与 `/goal` 不同 — `[plan]` 标记）
- 命令仅在消息开头识别：`handleSend` 前 5 行 sniff `value.startsWith('/') && selectionStart`
- SLASH-REGRESSION it 块在 `llm-adapter.test.ts` 覆盖 think chunk 首段 + no-tool-call-in-plan-mode 断言

**Out of scope:**
- SLASH-15 (`/goal` SQLite 持久化 — 推 v1.2)
- SLASH-17 (命令别名 `/c` for `/context` — 推 v1.2)
- 任何 source badge 视觉 / 7 色彩色（Phase 8 polish）
- CJK NFKC 强化 / IME z-index 边界（Phase 8 polish）
- chokidar 失败降级（Phase 8 polish）

</domain>

<decisions>
## Implementation Decisions

### `/goal` SystemSilent branch

- **D-01:** Placeholder 气泡内容：`[system] 正在执行 /goal…`（客人大人 2026-06-04 决策）。**不**显示 X 内容。
- **D-02:** 写 `useSessionStore.sessionGoals: Map<sessionId, string>` — 客人大人输入的 X 作为 value，sessionId 作为 key。
- **D-03:** 写入动作在 dispatch 时立即发生（200ms 内），无 async 等待。
- **D-04:** Session 切换时保留所有 session goals（Map 是 sessionId → goal 的映射，不清空）。
- **D-05:** Phase 7 不实现 SQL 持久化（v1.1 in-memory；SLASH-15 推 v1.2）。

### `/context` SystemLocal branch

- **D-06:** `/context` 与 `/context [all]` 行为相同 —— 都返回**当前 session**的 token 用量（客人大人 2026-06-04 决策：`[all]` 标记为 "当前 session 所加载的对话、skills、mcp、workflow 等数据"）。
- **D-07:** Placeholder 气泡显示格式：
  - 当前 session tokens (对话): N
  - Skills tokens: M
  - MCP tools tokens: K
  - Workflows tokens: L
  - **Total: N+M+K+L**
- **D-08:** 数据采集通过新建 IPC 通道 `context:currentSession` 一次性拉全，由 main 进程聚合（renderer 不直接访问 DB）。
- **D-09:** Token 估算用 `String.length * 0.25`（OpenAI 粗估 1 token ≈ 4 字符）；如需精确用 `gpt-tokenizer` 包（v1.2）。

### `/plan` PlanMode branch

- **D-10:** Placeholder 气泡样式与 `/goal` 不同 —— 带 `[plan]` 标记（客人大人 2026-06-04 决策）。
- **D-11:** Placeholder 文案：`[plan] 进入 plan 模式：${X || '(无描述)'}`。
- **D-12:** Dispatcher 已实现 `payload.overrides = { planOnly: true }`（Phase 6）；Phase 7 验证 + SLASH-REGRESSION it 块。
- **D-13:** Plan 模式期间 `write_file` / `edit_file` / `bash` 工具调用全部被 agent runtime 屏蔽（deepagent 端保证；无需 Phase 7 代码改动）。

### 消息开头识别（5 行 sniff）

- **D-14:** 在 `ChatArea.handleSend` 函数最前面 5 行内加 `if (inputVal.startsWith('/') && selectionStart === 0)` 检测：
  - 满足 → 走 dispatcher.resolve + dispatch
  - 不满足 → 走原有 `sendMessage` 路径（普通消息）
- **D-15:** 3 个 case 单测：
  - 开头 `/goal X` → 识别
  - `/foo bar` 中段 `/baz` → **不**识别（selectionStart > 0）
  - `/  foo` → 识别（trim 后空 args 仍走 dispatcher 拿到 plan；plan args = ''）

### SLASH-REGRESSION it 块

- **D-16:** 位置：`src/main/deepagent/llm-adapter.test.ts`（客人大人 2026-06-04 决策）。
- **D-17:** 至少 3 个 it 块：
  - **`/plan` 路径首段 message_chunk 含 `<think>`** — 验证 6-hunk patch-package 锁定 `@langchain/anthropic@1.4.0` 的 reasoning roundtrip
  - **No-tool-call-in-plan-mode** — 验证 plan 模式下 `write_file` / `edit_file` / `bash` 工具都不被调用
  - **Slash 路径不绕过 M3 thinking** — 验证 `/plan` 走 llm:chat 时 M3 thinking chunk 仍作为 `message_chunk` 首段发出
- **D-18:** 测试通过 mock Anthropic SDK 的 `messages.stream` 模拟 `<think>` 块输入 + 验证 patch-package 后的 `stream-accumulator` 输出。
- **D-19:** 这是 6-hunk patch-package 的**负载测试** —— 如果 patch-package 没生效或被 npm install 覆盖，SLASH-REGRESSION 会失败。

### Phase 7 不做的事情（Claude's Discretion）

- **C-01:** 3 个 system command 气泡的具体颜色 / 图标 / 排版 —— 沿用 Phase 5 message item 的样式 + `[system]` / `[plan]` 前缀。Phase 8 polish 可细化。
- **C-02:** `/goal X` 的 X 是否 trim 前后空白 —— `args.trim()` 一致。
- **C-03:** `/plan` 描述是否截断长度 —— 不截断（X 通常较短）。
- **C-04:** 气泡消失时机 —— 用户发下一条消息时自动消失（与现有 chat bubbles 行为一致）。
- **C-05:** Session 切换的 sessionGoals 处理 —— 保留 Map 全部，渲染时按当前 session 过滤。
- **C-06:** 5 行 sniff 的精确位置 —— `handleSend` 函数体内前 5 行（不 import 新 helper）。
- **C-07:** IPC `context:currentSession` 通道签名 —— 接受 `(sessionId: string) => Promise<{ breakdown, total }>`。
- **C-08:** Token 估算精度 —— `String.length * 0.25` 粗估；gpt-tokenizer 推 v1.2。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.1 Milestone Artifacts

- `.planning/PROJECT.md` §"Current Milestone: v1.1 基本能力完善" + Validated (v1.1) section
- `.planning/REQUIREMENTS.md` §"Active (v1.1)" — SLASH-05, SLASH-06, SLASH-07, SLASH-REGRESSION
- `.planning/ROADMAP.md` §"Phase 7: System Commands + M3 Regression Test" — Goal, Requirements, Success Criteria, Plan list
- `.planning/STATE.md` — current focus, key decisions
- `.planning/research/SUMMARY.md` — 4-agent research synthesis
- `.planning/research/ARCHITECTURE.md` — `llm.ts:324` extension point + `payload.overrides.planOnly`
- `.planning/research/STACK.md` — confirmed package versions
- `.planning/research/PITFALLS.md` — PITFALLS P2 (M3 thinking preservation), P5 (slash contract), P7 (args injection prevention)
- `.planning/phases/05-popup-shell-keyboard-spike/05-CONTEXT.md` — D-01..D-07 keyboard contract (Tab vs Enter)
- `.planning/phases/05-popup-shell-keyboard-spike/05-VERIFICATION.md` — 19/19 Phase 5 tests passing
- `.planning/phases/06-4-source-command-registry-dispatcher/06-CONTEXT.md` — D-01..D-25 dispatcher + 4 kinds
- `.planning/phases/06-4-source-command-registry-dispatcher/06-01-SUMMARY.md` — registry data layer
- `.planning/phases/06-4-source-command-registry-dispatcher/06-02-SUMMARY.md` — dispatcher + UI integration

### v1.0 Codebase Anchors

- `src/renderer/src/stores/sessionStore.ts:47` `activeSessionId: string | null;` — sessionId source
- `src/renderer/src/stores/sessionStore.ts:63` `sendMessage: (projectId, content, overrides?) => Promise<void>` — PlanMode passes `{ planOnly: true }` here
- `src/renderer/src/components/ChatArea/ChatArea.tsx:611` `handleSend` — Phase 7 inserts 5-line slash sniff at top
- `src/renderer/src/components/ChatArea/ChatArea.tsx:663-666` `handleSlashSelect` — Phase 6 wired to dispatcher; Phase 7 keeps the same flow
- `src/renderer/src/lib/commands/dispatcher.ts:91-101` — `dispatch(plan)` switch with SystemSilent/SystemLocal/PlanMode placeholders
- `src/main/llm.ts:306-425` — `runLLMChat` + `streamEvents` v3 (**Hard Do Not Touch**)
- `src/main/llm.ts:324` — `payload.overrides.planOnly` extension point
- `src/main/ipc-handlers.ts:783-810` — Phase 6 added `commands:list` + `commands:readProjectCommands`; Phase 7 adds `context:currentSession`
- `src/main/deepagent/llm-adapter.ts` — Anthropic SDK adapter; **6-hunk patch-package** target; `stream-accumulator` lives here
- `src/main/deepagent/llm-adapter.test.ts` — Phase 7 SLASH-REGRESSION it 块 location
- `src/main/deepagent/skill-manager.ts:80-104` `listPhysicalSkills(projectPath)` — reuse for `/context` skills tokens
- `src/main/deepagent/mcp-connector.ts:129` `loadMcpTools(agentId, mcpServers)` — reuse for `/context` mcp tools tokens
- `src/renderer/src/components/MessageItem/` — existing chat bubble render pattern (reuse for system/plan placeholders)

### External Library Docs

- `sonner@2.0.7` — toast notification (Phase 6 already installed; Phase 7 may use for `/goal` confirmation)
- `chokidar@3.6.0` — Phase 6 installed (no Phase 7 dep changes)

### Hard "Do Not Touch" List (v1.1)

- `src/main/runtime.ts` (deepagent runtime) — M3 chain breaks
- `src/main/llm.ts:306-425` (`runLLMChat` + `streamEvents` v3) — patch-package layer
- `src/main/workflow-runtime.ts` — independent runtime
- `src/main/deepagent/llm-adapter.ts` core adapter — patch-package layer (**SLASH-REGRESSION 测试层 not the implementation layer**)
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — **SLASH-REGRESSION tests this; do NOT modify patches**

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`/context [all]` token aggregation**:
  - Conversation: SQL `SELECT SUM(LENGTH(content)) FROM messages WHERE session_id = ?`
  - Skills: `listPhysicalSkills(projectPath)` → sum `SKILL.md` file sizes × 0.25
  - MCP: `loadMcpTools(agentId, mcpServers)` → sum tool inputSchema JSON stringified × 0.25
  - Workflows: SQL `SELECT SUM(LENGTH(graph_data)) FROM workflows WHERE status='active' AND project_id = ?`
- **Placeholder bubble render pattern**: existing `MessageItem` component handles user/assistant bubbles; system/plan placeholders reuse the same component with a `kind` discriminator
- **`useSessionStore` extension**: add `sessionGoals: Map<sessionId, string>` + `setSessionGoal(sessionId, goal)` action
- **`useChatArea` 5-line sniff**: insert at top of `handleSend` before existing IME check
- **D-14 message-start detection**: `selectionStart === 0` (caret at start) check
- **`payload.overrides.planOnly` extension point**: already wired in Phase 6 dispatcher.ts:101; Phase 7 SLASH-REGRESSION verifies the runtime respects it

### Established Patterns

- **shadcn-style `cn()` className utility**: import from `src/renderer/src/lib/utils`
- **sonner toast for system feedback**: `toast.info('[system] Goal set: ' + goal, { description: sessionId })` pattern
- **IPC handler pattern**: `ipcMain.handle('channel:action', async (_evt, args) => ...)` + preload bridge
- **vitest test pattern**: real timers + `vi.spyOn(os, 'homedir')` for fs-related; `vi.hoisted` for mock factories
- **6-hunk patch-package 负载测试 pattern**: mock Anthropic SDK stream, verify `stream-accumulator` outputs `<think>` chunk first

### Integration Points

- **ChatArea.handleSend** (line 611): insert 5-line slash sniff BEFORE the existing IME composition check
- **useSessionStore** (line 47+): add `sessionGoals: Map<sessionId, string>` field + `setSessionGoal` action
- **dispatcher.dispatch** (SystemSilent/SystemLocal/PlanMode cases): Phase 6 had `console.log` placeholders; Phase 7 wires actual implementations
- **ipc-handlers.ts** (line 783+): add `context:currentSession` handler alongside `commands:list` (single file, no new file)
- **preload/index.ts** (line 101+): add `context: { currentSession: ... }` namespace alongside `commands:`
- **llm-adapter.test.ts** (new it blocks): add SLASH-REGRESSION suite at the end

</code_context>

<specifics>
## Specific Ideas

- **5-line sniff in handleSend** (D-14): The 客人大人 asked for a specific 5-line implementation. Sample shape:
  ```ts
  if (inputVal.startsWith('/') && (inputVal.length === 1 || inputVal[1] !== ' ')) {
    // dispatch to slash handler
    const plan = dispatcherResolve(inputVal, registry.commands);
    if (plan) { /* dispatch */ return; }
  }
  ```
  But the precise implementation should handle:
  - `/goal X` (with space + args) — starts with `/` but is a command
  - `/  foo` — starts with `/` then space (no command name); should be a regular message after trim
  - `hello/world` — does NOT start with `/`; regular message
  - `/foo bar /baz` mid-text — the command at end is NOT a command (text-insert via Tab is fine)
  - selectionStart > 0 — caret not at start; never a command

- **`/context` 气泡 design** (D-07): Inspiration: Claude Code's `/context` shows a vertical breakdown table. CDF's popup will be more compact:
  ```
  [system] 上下文
  ────────────────
  对话:     1,234 tokens
  Skills:   567 tokens (5 个)
  MCP:      89 tokens (3 个)
  Workflows: 234 tokens (2 个)
  ────────────────
  Total:    2,124 tokens
  ```
  Rendered in a system-message bubble via `MessageItem` with a custom `kind="system-context"`.

- **`/plan` placeholder bubble design** (D-10): 带 `[plan]` 标记 + 描述预览。例：
  ```
  [plan] 进入 plan 模式：write tests
  ```
  与 `/goal` `[system] 正在执行 /goal…` 的区别：plan 的气泡是**会持续存在**（直到 LLM 返回第一个 message_chunk），goal 的气泡是**瞬时**（store 写完即消失）。

- **SLASH-REGRESSION 3 个 it 块顺序** (D-17):
  1. `it('first message_chunk in plan mode contains <think>', ...)` — mock Anthropic stream with `<think>` block, verify `stream-accumulator` outputs `message_chunk` with `text` starting with `<think>`
  2. `it('plan mode does not invoke write_file/edit_file/bash tools', ...)` — mock agent runtime; verify no tool_call events emitted
  3. `it('slash /plan preserves M3 thinking chain (regression for 6-hunk patch-package)', ...)` — combined: full plan-mode roundtrip preserves thinking

- **sessionGoals Map persistence**: in-memory only (Phase 7 v1.1); SLASH-15 pushes SQLite migration to v1.2. Phase 7 just adds the field + setter.

- **Token estimation accuracy**: `String.length * 0.25` is OpenAI's rough heuristic (1 token ≈ 4 chars). For Chinese, it's more like 1 token ≈ 1.5 chars. Phase 7 uses the simple `.25` for now; gpt-tokenizer (or tiktoken via dynamic import) deferred to v1.2.

</specifics>

<deferred>
## Deferred Ideas

### 推 Phase 8 polish

- Source badge 视觉打磨（7 色彩色）
- Skeleton/spinner 加载态（`/context` 等待 IPC 期间）
- CJK NFKC 强化（在 `/context` breakdown 文本上）

### 推 v1.2+

- SLASH-15 (`/goal` SQLite 持久化 — migrate `useSessionStore.sessionGoals` to `session_goals` table)
- SLASH-17 (命令别名 `/c` for `/context`, `/g` for `/goal`, `/p` for `/plan`)
- 精确 token 计数（gpt-tokenizer / tiktoken 替换 `.length * 0.25` 粗估）

### 取消（不再做）

- ~~Demo workflow seed~~（客人大人 2026-06-04 取消 — Phase 6 锁定）
- ~~3 system command 7 色彩色气泡~~（Phase 8 polish 范围内）

</deferred>

---

*Phase: 7-System Commands + M3 Regression Test*
*Context gathered: 2026-06-04*

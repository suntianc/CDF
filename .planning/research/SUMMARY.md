# Research Summary: v1.1 `/` Command Popup for CDF

**Project:** Agent 开发工作站 (CDF) — Electron + React 19 desktop Agent workstation
**Milestone:** v1.1 (基本能力完善)
**Synthesized:** 2026-06-04
**Confidence:** HIGH

---

## Executive Summary

CDF v1.1 ships a Claude Code-style `/` command popup anchored to the existing bare `<textarea>` in `ChatArea.tsx`. The defining research finding is that **`@assistant-ui/react@0.14.5` is installed but never rendered** — the composer is a custom textarea, not `ComposerPrimitive`. The right v1.1 path is therefore a **thin, self-built popup layer** rather than the `unstable_useSlashCommandAdapter` route, which would force a ComposerPrimitive adoption and refactor the entire `streamEvents v3` + M3-thinking pipeline. Recommended stack: `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15`, mirroring the existing shadcn `dropdown-menu.tsx` wrapper pattern.

M3-thinking preservation is the most important architectural constraint. **Plugin commands must flow through the existing `llm:chat` IPC** (so `runtime.agent.streamEvents v3` + the 6-hunk `patch-package` on `@langchain/anthropic@1.4.0` are untouched) — this means we add **only 2 new IPC channels** (`commands:list`, `commands:readProjectCommands`) and reuse `llm:chat` for plugin dispatch. `/plan` is a **runtime flag** (`payload.overrides = { planOnly: true }` at the existing `llm.ts:324` extension point) — never a new code path through `streamEvents`.

The 4-source command registry (system / MCP / skill / workflow / project) is the central data structure. Three system commands (`/goal`, `/context`, `/plan`) are local renderer branches; four plugin sources are read-only metadata, dispatched as natural-language user messages into `llm:chat`. Naming conflicts between sources are resolved with **source badges + both-rows-kept** (no silent overwrite, no priority kill) plus a registry-build-time `CommandConflictError` toast.

---

## Key Decisions (Lead with These)

### 1. Stack: `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15`
- **cmdk** (`^1.1.1`) — command list, fuzzy/substring filter, ↑↓/Enter/Esc handling, roving focus, ~8 kB gzipped. Peer `react ^18 || ^19` verified.
- **@radix-ui/react-popover** (`^1.1.15`) — already in `node_modules` (transitive), promote to direct dep. `PopoverAnchor` wraps the `<form>` so popup floats above textarea.
- **Pattern:** `<PopoverAnchor asChild><form>...<textarea/></form></PopoverAnchor>` with `onOpenAutoFocus={e => e.preventDefault()}` (critical — cmdk's input would otherwise steal focus from textarea).
- **No** assistant-ui primitives, fuse.js, framer-motion, or Mantine Spotlight.

### 2. **No `assistant-ui` slash adapter** (the biggest trap)
- `unstable_useSlashCommandAdapter` + `ComposerPrimitive.Unstable_TriggerPopover` are marked `@deprecated Under active development`. They require `<AssistantRuntimeProvider>` + custom `ChatModelAdapter` + ComposerPrimitive adoption — i.e. **rewrite the entire `ChatArea` composer**, then watch the 6-hunk patch-package break.
- assistant-ui#3823 (slash API redesign) was **abandoned**; #3767/#3834 reshuffled mention/slash into one `TriggerPopover` concept. API churn is the norm in 0.14.x.
- Decision: **build popup on the existing bare textarea**. IME safety (`isComposingRef` + 200ms `justFinishedComposingRef`) is already handled in `ChatArea.tsx`.

### 3. **M3 thinking preservation: 2 new IPC channels only**
```
Renderer ─► commands:list ─► main/commands/command-registry.ts
                (merges 5 sources: 3 system + 4 plugin)

Renderer ─► commands:readProjectCommands ─► main/commands/project-commands.ts
                (read .cdf/commands/*.md metadata only)
```
**Reuse** `llm:chat` (existing), `workflow:run` (existing), `db:getMcpServers` (existing). **Do NOT** add `commands:execute` — that path would bypass `streamEvents v3` and strip reasoning from plugin output. `/plan` is **NOT** a new dispatch path. It's a `payload.overrides = { planOnly: true }` flag (extension point at `src/main/llm.ts:324`).

### 4. **4-source command registry** (5 sources after grouping system)

| Source | Acquisition | Storage |
|---|---|---|
| **system** (3 hardcoded) | static array in `commandRegistry.ts` | renderer |
| **mcp** | reuse `loadMcpTools(agentId, mcpServers)` at `mcp-connector.ts:129` (uses `mcpCache` — no re-connect) | main |
| **skill** | reuse `listPhysicalSkills(projectPath)` at `skill-manager.ts:89` | main (fs) |
| **workflow** | **new lightweight SQL** (`SELECT id, name, description FROM workflows WHERE status='active'`) — do NOT call `db:getWorkflows` (returns `graph_data`, too heavy) | main (sqlite) |
| **project** | **new module** `main/commands/project-commands.ts`, mirrors `listPhysicalSkills`, reads `<projectPath>/.cdf/commands/*.md` frontmatter | main (fs) |

`mcpCache` is the key perf boundary — `commands:list` does not re-connect to MCP servers.

### 5. **Naming conflicts: badges + both-rows, no overwrite**
- Priority for execution when registry-build detects a same-`name` collision: **system > skill > workflow > mcp > project**.
- **Never** silent-overwrite (Claude Code bugs #61857, #62409, #64422). Build-time `CommandConflictError` + non-blocking toast (add shadcn `sonner` as dep).
- **Source badge on every row**: `[system]` `[skill]` `[workflow]` `[mcp:serverId]` `[project]`. CJK NFKC-normalize for collision detection.

### 6. **Plugin command dispatch: rewrite as natural-language prompt**
`/${mcp_tool_name} ${args}` is **NOT** sent as raw. Dispatcher rewrites to: `"请调用 ${tool} 工具，参数：${args}"`. Master Agent's reasoning chunk emits `<think>…call the ${tool} tool…</think>`, then `tool_start` fires. ChatArea's existing `MarkdownRenderer` + `ToolMessageCard` render both — **zero new event types**, **zero new dispatch IPC channels**.

---

## Architecture Snapshot

```
RENDERER (React 19 + Zustand, 现有 ChatArea 不动 composer)
  ChatArea.tsx (existing)
   ├─ <textarea> + onChange (sniff /, set slashOpen)
   ├─ <PopoverAnchor><form>...<textarea/></form></PopoverAnchor>
   ├─ <SlashCommandPopup> (NEW) — cmdk + Radix Popover
   └─ dispatcher.resolve(value) → CommandDispatchPlan
        ├─ kind: 'local-silent' (/goal) → set session goal
        ├─ kind: 'local-reply'  (/context) → static bubble
        ├─ kind: 'plan-mode'    (/plan) → sendMessage + overrides
        └─ kind: 'llm-chat'     (plugins) → sendMessage (rewrite args as natural language)
              ↓
         useSlashCommandStore + useCommandRegistry hook
            └─ IPC commands:list(projectId)

PRELOAD (add 2 methods)
   - commands.list(projectId, agentId?)
   - commands.readProjectCommands(projectId)

MAIN
   main/commands/command-registry.ts (NEW ~80 lines)
     ├─ collectMcpCommands(agentId)   → loadMcpTools (existing)
     ├─ collectSkillCommands(project) → listPhysicalSkills (reuse)
     ├─ collectWorkflowCommands(project) → new lightweight SQL
     └─ collectProjectCommands(project) → project-commands.ts
   main/commands/project-commands.ts (NEW, mirrors skill-manager)

Reused unchanged:
   mcp-connector.ts (loadMcpTools + mcpCache)
   skill-manager.ts (listPhysicalSkills + parseFrontmatter)
   llm.ts (runLLMChat + streamEvents v3 + consumeReasoning)
   runtime.ts (createDeepAgentRuntime — DO NOT MODIFY)
```

**Hard "do not touch" list:**
- `runtime.ts` (deepagent runtime) — M3 chain breaks
- `llm.ts:306-425` (`runLLMChat` + `streamEvents` v3) — patch-package layer
- `workflow-runtime.ts` — independent runtime, untouched
- `LLMStreamEvent` union (13 types) — plugin commands emit existing types only

---

## 13 SLASH Requirements → Phase Mapping

| Requirement | Phase | Notes |
|---|---|---|
| **SLASH-01** `/` 触发 popup | Phase 1 (spike) | PoC verifies bare-textarea + cmdk + Radix Popover path; rejects `unstable_useSlashCommandAdapter` early |
| **SLASH-02** 字母过滤 + ↑↓ + Enter | Phase 1 | cmdk built-in; PITFALLS P6 spike (`.` / CJK / `//` / description 截断 5 case) |
| **SLASH-03** 命令注册表 | Phase 2 | system 静态 + 4 源 plugin 动态；conflict 检测 + source badge |
| **SLASH-04** 命令分发层 | Phase 2 | 4 `CommandDispatchAction` kinds; PITFALLS P5 开头识别 + P4 system 反馈 |
| **SLASH-05** `/goal [condition]` | Phase 3 | `local-silent` branch; session-level Map; placeholder 气泡 |
| **SLASH-06** `/context [all]` | Phase 3 | `local-reply` branch; static 气泡; 不走 LLM |
| **SLASH-07** `/plan [description]` | Phase 3 | `plan-mode` branch; `payload.overrides = { planOnly: true }`; PITFALLS P2 regression test 必须含 `<think>` chunk |
| **SLASH-08** MCP 工具自动注册 | Phase 2 | `/${mcp_tool_name}` 走 `llm:chat`; PITFALLS P7 args 注入 → v1.1 不传 args，只注册 |
| **SLASH-09** Skills 自动注册 | Phase 2 | 复用 `listPhysicalSkills`; CJK NFKC normalize |
| **SLASH-10** Workflows 自动注册 | Phase 2 | **必须先 seed 1 个 `/pr-review` demo workflow**（PITFALLS P11），否则 zombie code |
| **SLASH-11** 项目级自定义 | Phase 2 | `main/commands/project-commands.ts`; `.cdf/commands/*.md` frontmatter parse; `$ARGUMENTS` 替换 |
| **SLASH-12** 命名空间冲突处理 | Phase 2 | source badge + `CommandConflictError` toast; priority `system > skill > workflow > mcp > project` |
| **SLASH-13** 插件注册时机 | Phase 2 | session 启动 + `chokidar` 监听 `.cdf/commands/` (PITFALLS P10); MCP 启停事件 |

---

## Critical Pitfalls (Carry into Every Phase)

| # | Pitfall | Phase | Prevention |
|---|---|---|---|
| **P1** | `assistant-ui` `unstable_useSlashCommandAdapter` 引爆整个 composer | Phase 1 spike | PoC 显式拒绝; 6 路径 keyboard 验证 IME + Shift+Enter + Esc + ↑↓ + Enter |
| **P2** | v3 streamEvents + M3 thinking 是 6-hunk patch; `/plan` 不能改 invocation shape | Phase 3 (SLASH-07) | `payload.overrides` 扩展点; `llm.test.ts` 加 1 it 覆盖「`/plan` 后首 chunk 含 `<think>`」 |
| **P3** | 命名空间冲突静默覆盖 (Claude Code #61857 #62409) | Phase 2 (SLASH-03/12) | registry 构建期 `throw`; source badge 始终可见; MCP 空 tools 不静默 |
| **P4** | popup 关后 system 命令无反馈 vs 插件命令有 typing indicator | Phase 2 (SLASH-04) | system 命令塞 `[system] 正在执行…` 占位气泡; popup z-index ≥ 50 |
| **P5** | 命令仅在消息开头识别, 但 textarea 不知"开头"在哪 | Phase 2 (SLASH-04) | `handleSend` 前 5 行 sniff: `value.startsWith('/') && selectionStart` 校验; 3 case 单测 |
| **P6** | 5 公开键盘/字符 bug (`.` `#65047` / CJK `#64941` / 选区跳 `#65014` / `//` `#65050` / 描述截断 `#64606`) | Phase 1 PoC | 5 it 块作为契约; NFKC normalize; `String#includes` 不做 split; `selectedIndex % list.length` |
| **P7** | MCP args 透传 = 命令注入表面 | Phase 2 (SLASH-08) | v1.1 **不传 args** (只注册 `/${mcp_tool_name}`); args 走 deepagents tool_use schema 校验 |
| **P10** | chokidar 跨平台差异 | Phase 2 (SLASH-13) | `awaitWriteFinish: { stabilityThreshold: 200 }`; catch 失败降级 readdir 一次 |
| **P11** | Workflows 表 v1.0 实际 0 条 | Phase 2 (SLASH-10) | seed 1 个 `/pr-review` 3 节点 demo workflow 作为 e2e contract |

---

## Suggested Phase Structure (4 phases for v1.1)

### Phase 1 — **Popup Shell + Keyboard Spike** (SLASH-01/02)
**Rationale:** Must prove the bare-textarea + cmdk + Radix Popover path works **before** committing to dispatcher architecture. Reject `unstable_useSlashCommandAdapter` here (PITFALLS P1).
**Delivers:** Working popup that opens on `/`, filters by substring, supports ↑↓/Enter/Esc/Backspace, IME-safe.
**Stack:** `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15` (new deps).
**Files:** `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx`, `src/renderer/src/components/ui/popover.tsx`, `src/renderer/src/stores/slashCommandStore.ts`, `src/renderer/src/components/ChatArea/ChatArea.tsx` (anchor + handleKeyDown extension).
**Acceptance:** 5 keyboard path tests (IME / Shift+Enter / Esc / ↑↓ / Enter) + 5 PITFALLS P6 case tests (`.` / CJK / `//` / description / selectedIndex wrap).

### Phase 2 — **4-Source Command Registry + Dispatcher** (SLASH-03/04/08/09/10/11/12/13)
**Rationale:** Shell exists; now populate it. Build dispatcher first (4 `CommandDispatchAction` kinds), then 4 plugin source loaders, then conflict detection, then chokidar.
**Delivers:** 3 system commands render as local branches; 4 plugin sources auto-register; naming conflicts surface as badges + toast; project command files hot-reload.
**Stack:** reuse `mcpCache`, `listPhysicalSkills`, `loadMcpTools`; new lightweight SQL for workflows.
**Files (new):** `src/main/commands/command-registry.ts`, `src/main/commands/project-commands.ts`, `src/renderer/src/hooks/useCommandRegistry.ts`, `src/renderer/src/lib/commands/dispatcher.ts`.
**Files (modified):** `src/main/ipc-handlers.ts` (+2 handlers), `src/preload/index.ts` (+2 methods), `src/shared/types.ts` (+SlashCommand, +CommandDispatchAction), `src/renderer/src/components/ChatArea/ChatArea.tsx` (sniff in handleSend).
**Acceptance:** 5 conflict cases; chokidar test on macOS + Windows + Linux; 1 e2e: `/arxiv_search foo` flows through `llm:chat` with M3 reasoning intact.

### Phase 3 — **System Commands + M3 Regression Test** (SLASH-05/06/07)
**Rationale:** System commands depend on the dispatcher's 3 local-action kinds from Phase 2. `/plan` is the most fragile — must prove M3 thinking is preserved (PITFALLS P2).
**Delivers:** `/goal` sets session goal in `useSessionStore.sessionGoals: Map<sessionId, string>` (v1.1 in-memory, v1.2+ persist); `/context` renders static bubble reading `messages` token count; `/plan` sets `payload.overrides.planOnly = true`.
**Acceptance:**
- `/goal X` → placeholder bubble `[system] 正在执行 /goal…` → 200ms later: `setSessionGoal` (no LLM call)
- `/context` → static bubble with token usage stats (no LLM call)
- `/plan X` → `llm:chat` with overrides → first `message_chunk` contains `<think>…plan only…</think>`; **no `write_file`/`edit_file`/`bash` tool call**

### Phase 4 — **Polish + Differentiators** (D1/D2/D7/D13/D14/D15, FEATURES.md)
**Rationale:** Stable base → polish makes it feel "great", not "OK".
**Delivers:** Source badge styling, args hint visible in row, loading state for slow MCP sources, CJK NFKC normalize across filter, special-char robustness, system command placeholders, chokidar health degradation.

### Phase Ordering Rationale
- Phase 1 first: spike verifies the cmdk + Radix Popover path on the bare textarea before any architectural commitment.
- Phase 2 next: registry + dispatcher form the core data flow; 4 plugin sources can be added in any order once dispatcher exists.
- Phase 3 third: system commands depend on dispatcher's 3 local-action kinds.
- Phase 4 last: polish meaningless without stable base.
- **No external dependencies; all 4 phases within v1.1 scope.**

---

## Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Stack | **HIGH** | cmdk 1.1.1 + Radix Popover 1.1.15 versions verified; `assistant-ui@0.14.5` inspected; `ChatArea.tsx` 1097 lines confirmed custom textarea |
| Features | **HIGH** | Triangulated Claude Code 95 commands + Cursor + Linear + Raycast + Slack; v1.1 MVP = 24 features map 1:1 to 13 SLASH-XX |
| Architecture | **HIGH** | All IPC channel names + file paths grep-verified in `ipc-handlers.ts` (780 lines), `mcp-connector.ts`, `skill-manager.ts`, `runtime.ts`, `llm.ts:124-431` |
| Pitfalls | **MEDIUM** | 24 Claude Code GitHub issues cited (numbers confirmed); 6-hunk patch-package layer is fragile; `langchain` `streamEvents v3` docs scattered |

**Overall confidence: HIGH** (with caveats: `/plan` runtime semantics need Phase 1 validation; MCP schema shape needs Phase 2 validation; v3 streamEvents edge cases need regression test).

---

## 10 Open Questions for Phase 1 (MUST resolve before/during Phase 1)

1. **Project commands path**: `.cdf/commands/*.md` (parallel to `.cdf/skills/`, ARCHITECTURE.md recommended) vs `.claude/commands/*.md` (PROJECT.md says this). **Recommend `.cdf/commands/`** for consistency with skills.
2. **`/plan` mode persistence**: session-level flag (persists across turns) or turn-level (only this response)? PROJECT.md 暗示 session-level, but needs Phase 3 verification.
3. **MCP `argsHint` schema source**: Is MCP tool's `inputSchema` zod (matches `@langchain/mcp-adapters@1.1.3` zod-4) or JSON Schema? Inspect `loadMcpTools` return shape in Phase 2.
4. **chokidar version + config**: Use `chokidar@3.x` (stable) or `chokidar@4.x`? Need `awaitWriteFinish: { stabilityThreshold: 200 }` for macOS VSCode atomic-write. **Recommend chokidar@3.6.0**.
5. **Naming conflict UI granularity**: Same-name `verify` in skill + workflow — one row with `[skill|workflow]` tabs, or two rows with separate badges? **Recommend two rows with badges + same label** (v1.1 simpler, both invokable).
6. **`/goal` storage**: In-memory `useSessionStore.sessionGoals: Map<sessionId, string>` (v1.1) vs SQLite `session_goals` table (v1.2+)? **Recommend in-memory for v1.1**.
7. **MCP dynamic re-registration (SLASH-13)**: Re-fetch tools on MCP health transitions? Subscribe to existing `checkMcpServerHealth` events from `mcp-connector.ts`? **Recommend yes — reuse existing health event bus.**
8. **Toast library for D11 conflict notification**: shadcn `sonner` (not in deps yet) vs existing notification mechanism? **Recommend adding `sonner` as a dep (low cost, single source of truth).**
9. **IME 候选框 z-index**: Claude Code 实测 z-index 9999; macOS 输入法候选框可能更高. Accept 偶尔需要 Esc 一次关掉 popup. **Recommend z-9999 for popup + accept known issue.**
10. **`/plan` "session-level" UX**: When in plan mode, should popup show `[plan mode]` badge in textarea placeholder? Should `sendMessage` show warning if user sends natural-language message? **Recommend placeholder text `[plan mode] describe task…` + no warning for natural-language (LLM still responds, just with plan-only behavior).**

---

## Gaps to Address (Beyond Phase 1)

- **M3 reasoning roundtrip regression test**: must add to `llm-adapter.test.ts` or `llm.test.ts` covering "slash command path emits `<think>` chunk as first message_chunk". This is the load-bearing test for PITFALLS P2.
- **Workflow seeding**: v1.0 has 0 workflows in DB. Phase 2 SLASH-10 must seed at least 1 demo workflow (`/pr-review` 3-node) as e2e contract.
- **MCP empty-tools warning**: If `tools/list` returns `[]` (PITFALLS P3 #64669), send a `mcp_health_warning` event to renderer panel, not silent.
- **CJK skill e2e**: Phase 2 must seed a Chinese-named skill (e.g. `代码审查`) and verify NFKC normalization end-to-end.
- **Cross-platform chokidar test matrix**: macOS / Windows / Linux each at least 1 run; CI badge for "v1.1 slash popup cross-platform" in v1.1 exit criteria.

---

## Sources (Aggregated)

**HIGH confidence (direct source inspection):**
- `node_modules/@assistant-ui/react/dist/unstable/useSlashCommandAdapter.{js,d.ts}` — `@deprecated` confirmed
- `src/renderer/src/components/ChatArea/ChatArea.tsx:991-1093` — bare textarea + handleKeyDown at line 658
- `src/main/llm.ts:124-431` — LLMStreamEvent union (13 types) + `payload.overrides` extension at 324
- `src/main/deepagent/mcp-connector.ts:11-12, 129` — mcpCache + loadMcpTools
- `src/main/deepagent/skill-manager.ts:29-45, 89, 142-174` — parseFrontmatter + listPhysicalSkills + scope logic
- `src/main/ipc-handlers.ts:474, 531, 656, 780` — existing channel inventory
- `src/main/workflow/workflow-runtime.ts:473-499` — registerWorkflowIpcHandlers
- `src/main/deepagent/runtime.ts:488-587` — createDeepAgentRuntime tool registration
- `npm view cmdk peerDependencies` + `npm view @radix-ui/react-popover version` — versions verified
- Claude Code commands doc (https://code.claude.com/docs/en/commands) — 95 commands, popup UX, registration model
- `.planning/PROJECT.md` — 13 SLASH-XX requirements + 3 system + 4 plugin + 极简设计
- `.planning/STATE.md` — 6-hunk patch-package on `@langchain/anthropic@1.4.0`, 8 quick tasks shipped 2026-06-03

**MEDIUM confidence (GitHub issues confirmed, bodies partially read):**
- anthropics/claude-code #61857, #62072, #62091, #62409, #63396, #64422, #64539, #64606, #64669, #64941, #65014, #65047, #65050, #65099
- assistant-ui PR #3767, #3823 (abandoned), #3834

**LOW confidence (needs Phase 1/2 validation):**
- LangGraph `streamEvents v3` complete event contract (JS docs scattered, redirected)
- `payload.overrides.planOnly` runtime semantics in deepagent — Phase 3 must verify
- chokidar@3.6.0 cross-platform behavior on Windows + Linux — Phase 2 CI matrix

---

*Synthesis complete. SUMMARY ready for roadmap creation.*
*Recommendation: 4-phase structure (Spike → Registry+Dispatcher → System Commands → Polish); 10 Phase 1 open questions must be answered before SLASH-01 PoC commits.*
*Highest-risk decision: rejecting `assistant-ui` slash adapter (avoids 6-hunk patch fragility).*
*Highest-leverage decision: 4-source command registry with 2 new IPC channels (preserves M3 thinking).*

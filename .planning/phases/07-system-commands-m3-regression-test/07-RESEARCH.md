# Phase 7: System Commands + M3 Regression Test - Research

**Researched:** 2026-06-04
**Domain:** Renderer-side system command implementation + M3 thinking chain regression test
**Confidence:** HIGH (verified code anchors, PITFALLS research, patch-package details, Anthropic stream v3 fixture)

---

## Summary

Phase 7 在 Phase 6 搭好的 dispatcher 骨架上,接 3 个 system command 的真实 UI 反馈(`/goal` 写 `sessionGoals` Map + placeholder 气泡;`/context` 拉聚合 IPC 拿 token breakdown;`/plan` 验证 `payload.overrides.planOnly` 走深 agent 计划模式),并在 `llm-adapter.test.ts` 加 SLASH-REGRESSION 3 个 it 块作为 6-hunk patch-package 的护栏。

**研究阶段发现 3 个关键集成缺口**:
1. `src/main/llm.ts:32-44` 的 `ChatPayload.overrides` 当前只含 `providerId` + `model`,**不**含 `planOnly` — `dispatcher.ts:104` 调用 `sendMessage(projectId, args, { planOnly: true })` 在 IPC 端会丢失这个字段。
2. `src/main/runtime.ts:453` 的 `createDeepAgentRuntime` 第 5 个参数 `overrides?: RuntimeModelOverrides` 也只含 `providerId` + `model` — `planOnly` 在 `llm.ts:324` 透传到 runtime 后,deepagent 端**没有代码读它**。`grep planOnly src/main/runtime.ts` = 0 matches。
3. `runtime.ts:55-59` 的 `DEFAULT_INTERRUPT_ON` 把 `write_file` / `edit_file` / `delete_file` 列在 `interruptOn`,但没有任何代码读 `planOnly` 来决定是否屏蔽工具调用。D-13 说"deepagent 端保证",Phase 7 必须**真正实现**这个保证 — 当前的 dispatcher 调用 `planOnly: true` 等于"无操作"。

这 3 个缺口是 Phase 7 的核心实施工作,而不只是"加 placeholder 气泡 + 写测试"。

**Primary recommendation:** 实施时按 3 个波次推进:
- **Wave A** (system-local): `useSessionStore.sessionGoals: Map<sessionId, string>` + `setSessionGoal` action + `dispatcher.dispatch` 的 SystemSilent/SystemLocal 真实实现 + `/context` IPC handler + preload bridge + shared type
- **Wave B** (planOnly 链路): 扩展 `ChatPayload.overrides` / `RuntimeModelOverrides` / `createDeepAgentRuntime` 把 `planOnly` 真正端到端透传,加 `runtime.ts` 内的"plan mode 屏蔽写工具"逻辑 + SystemLocal 气泡渲染
- **Wave C** (护栏): 5-line sniff + 3 个 SLASH-REGRESSION it 块覆盖 6-hunk patch-package

---

## User Constraints (from CONTEXT.md)

> **MANDATORY**: Copied verbatim from `.planning/phases/07-system-commands-m3-regression-test/07-CONTEXT.md`. Planner MUST honor these.

### Locked Decisions

#### `/goal` SystemSilent branch

- **D-01:** Placeholder 气泡内容:`[system] 正在执行 /goal…`(客人大人 2026-06-04 决策)。**不**显示 X 内容。
- **D-02:** 写 `useSessionStore.sessionGoals: Map<sessionId, string>` — 客人大人输入的 X 作为 value,sessionId 作为 key。
- **D-03:** 写入动作在 dispatch 时立即发生(200ms 内),无 async 等待。
- **D-04:** Session 切换时保留所有 session goals(Map 是 sessionId → goal 的映射,不清空)。
- **D-05:** Phase 7 不实现 SQL 持久化(v1.1 in-memory;SLASH-15 推 v1.2)。

#### `/context` SystemLocal branch

- **D-06:** `/context` 与 `/context [all]` 行为相同 —— 都返回**当前 session**的 token 用量(客人大人 2026-06-04 决策:`[all]` 标记为 "当前 session 所加载的对话、skills、mcp、workflow 等数据")。
- **D-07:** Placeholder 气泡显示格式:
  - 当前 session tokens (对话): N
  - Skills tokens: M
  - MCP tools tokens: K
  - Workflows tokens: L
  - **Total: N+M+K+L**
- **D-08:** 数据采集通过新建 IPC 通道 `context:currentSession` 一次性拉全,由 main 进程聚合(renderer 不直接访问 DB)。
- **D-09:** Token 估算用 `String.length * 0.25`(OpenAI 粗估 1 token ≈ 4 字符);如需精确用 `gpt-tokenizer` 包(v1.2)。

#### `/plan` PlanMode branch

- **D-10:** Placeholder 气泡样式与 `/goal` 不同 —— 带 `[plan]` 标记(客人大人 2026-06-04 决策)。
- **D-11:** Placeholder 文案:`[plan] 进入 plan 模式:${X || '(无描述)'}`。
- **D-12:** Dispatcher 已实现 `payload.overrides = { planOnly: true }`(Phase 6);Phase 7 验证 + SLASH-REGRESSION it 块。
- **D-13:** Plan 模式期间 `write_file` / `edit_file` / `bash` 工具调用全部被 agent runtime 屏蔽(deepagent 端保证;无需 Phase 7 代码改动)。

#### 消息开头识别(5 行 sniff)

- **D-14:** 在 `ChatArea.handleSend` 函数最前面 5 行内加 `if (inputVal.startsWith('/') && selectionStart === 0)` 检测:
  - 满足 → 走 dispatcher.resolve + dispatch
  - 不满足 → 走原有 `sendMessage` 路径(普通消息)
- **D-15:** 3 个 case 单测:
  - 开头 `/goal X` → 识别
  - `/foo bar` 中段 `/baz` → **不**识别(selectionStart > 0)
  - `/  foo` → 识别(trim 后空 args 仍走 dispatcher 拿到 plan;plan args = '')

#### SLASH-REGRESSION it 块

- **D-16:** 位置:`src/main/deepagent/llm-adapter.test.ts`(客人大人 2026-06-04 决策)。
- **D-17:** 至少 3 个 it 块:
  - **`/plan` 路径首段 message_chunk 含 `<think>`** — 验证 6-hunk patch-package 锁定 `@langchain/anthropic@1.4.0` 的 reasoning roundtrip
  - **No-tool-call-in-plan-mode** — 验证 plan 模式下 `write_file` / `edit_file` / `bash` 工具都不被调用
  - **Slash 路径不绕过 M3 thinking** — 验证 `/plan` 走 llm:chat 时 M3 thinking chunk 仍作为 `message_chunk` 首段发出
- **D-18:** 测试通过 mock Anthropic SDK 的 `messages.stream` 模拟 `<think>` 块输入 + 验证 patch-package 后的 `stream-accumulator` 输出。
- **D-19:** 这是 6-hunk patch-package 的**负载测试** —— 如果 patch-package 没生效或被 npm install 覆盖,SLASH-REGRESSION 会失败。

### Claude's Discretion

- **C-01:** 3 个 system command 气泡的具体颜色 / 图标 / 排版 —— 沿用 Phase 5 message item 的样式 + `[system]` / `[plan]` 前缀。Phase 8 polish 可细化。
- **C-02:** `/goal X` 的 X 是否 trim 前后空白 —— `args.trim()` 一致。
- **C-03:** `/plan` 描述是否截断长度 —— 不截断(X 通常较短)。
- **C-04:** 气泡消失时机 —— 用户发下一条消息时自动消失(与现有 chat bubbles 行为一致)。
- **C-05:** Session 切换的 sessionGoals 处理 —— 保留 Map 全部,渲染时按当前 session 过滤。
- **C-06:** 5 行 sniff 的精确位置 —— `handleSend` 函数体内前 5 行(不 import 新 helper)。
- **C-07:** IPC `context:currentSession` 通道签名 —— 接受 `(sessionId: string) => Promise<{ breakdown, total }>`。
- **C-08:** Token 估算精度 —— `String.length * 0.25` 粗估;gpt-tokenizer 推 v1.2。

### Deferred Ideas (OUT OF SCOPE)

- 推 Phase 8 polish:source badge 视觉打磨(7 色彩色)/ Skeleton 加载态(`/context` 等待 IPC 期间)/ CJK NFKC 强化(在 `/context` breakdown 文本上)
- 推 v1.2+:SLASH-15(`/goal` SQLite 持久化 — migrate `useSessionStore.sessionGoals` to `session_goals` table)/ SLASH-17(命令别名 `/c` for `/context`,`/g` for `/goal`,`/p` for `/plan`)/ 精确 token 计数(gpt-tokenizer / tiktoken 替换 `.length * 0.25` 粗估)
- 取消(不再做):~~Demo workflow seed~~(客人大人 2026-06-04 取消 — Phase 6 锁定)/ ~~3 system command 7 色彩色气泡~~(Phase 8 polish 范围内)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLASH-05** | User can run `/goal [condition]` to set a session-level goal stored in `useSessionStore.sessionGoals: Map<sessionId, string>` (in-memory, v1.1; persistent in v1.2+); placeholder bubble `[system] 正在执行 /goal…` appears immediately, no LLM call | D-01..D-05; sessionStore extension design (Section 3); dispatcher SystemSilent implementation (Section 5) |
| **SLASH-06** | User can run `/context [all]` to render a static bubble showing current session token usage (from `messages` table), without invoking the LLM | D-06..D-09; IPC `context:currentSession` design (Section 4); token aggregation SQL (Section 4.3) |
| **SLASH-07** | User can run `/plan [description]` to enter plan mode; dispatcher sets `payload.overrides = { planOnly: true }` on the existing `llm:chat` call; first `message_chunk` after `/plan` MUST contain `<think>…plan only…</think>`; no `write_file` / `edit_file` / `bash` tool call fires during plan mode | D-10..D-13; ChatPayload.overrides extension (Section 5.1); runtime planOnly handling (Section 5.2); plan-mode tool suppression (Section 5.3) |
| **SLASH-REGRESSION** | New it block in `llm-adapter.test.ts` (or `llm.test.ts`) asserts that a `/plan` followed by a user message emits a `message_chunk` whose first `text` content starts with `<think>…` and contains no tool_call events until the user exits plan mode. This is the load-bearing test for the 6-hunk patch-package on `@langchain/anthropic@1.4.0` | D-16..D-19; patch-package analysis (Section 7.1); 3 it block designs (Section 7.3); Anthropic stream mock pattern (Section 7.2) |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/goal` placeholder bubble render | Renderer (React) | sessionStore (zustand) | C-04 — bubble 随消息流消失,需要 React 渲染;sessionStore 是 single source of truth for in-memory goals |
| `sessionGoals` Map write | Renderer (sessionStore) | — | D-02/D-05 — in-memory only, Phase 7 不接 SQL;zustand 已经有 19 个字段,加 2 个字段(goal Map + setter)最自然 |
| `/context` token aggregation | Main (IPC handler) | better-sqlite3 + skill-manager + mcp-connector | D-08 — main 进程聚合;4 个数据源(conversation / skills / mcp / workflows)需要 cross-process 访问(DB + filesystem + mcp cache) |
| `/context` breakdown render | Renderer (React) | electronAPI.context | D-07 — 单一气泡内显示 4 行 + total;renderer 拿到 `{breakdown, total}` 后渲染 |
| `/plan` payload.overrides.planOnly propagation | IPC payload | llm.ts → runtime.ts | D-12 — 必须端到端;发现 `llm.ts:32` ChatPayload + `runtime.ts:453` 都需要扩展 |
| Plan-mode tool suppression | Main (runtime.ts) | deepagents `interruptOn` | D-13 — runtime 端保证;在 `createDeepAgent` 调用时根据 `overrides.planOnly` 调整 `interruptOn`,把 `write_file` / `edit_file` / `bash` 设为**直接 reject** |
| 5-line slash sniff | Renderer (ChatArea.handleSend) | textarea DOM ref | D-14 — `selectionStart === 0` 需要 DOM ref;当前 ChatArea 没有 textareaRef,需要加 |
| 3-line slash test | Renderer (vitest jsdom) | TestHarness | D-15 — jsdom 中 `selectionStart` 可设可读;复用 Phase 5 TestHarness 模式 |
| M3 thinking preservation | Main (llm.ts + llm-adapter) | patch-package | PITFALLS P2 — `stream-accumulator.ts` 已经在 200ms 窗口把 reasoning 包装成 `<think>` 标签;SLASH-REGRESSION 验证这条链路不被打断 |
| 6-hunk patch-package protection | Test layer (llm-adapter.test.ts) | patches/ @langchain+anthropic+1.4.0.patch | D-19 — patch 是 6 个 hunk,postinstall 钩子会重写 `node_modules/@langchain/anthropic/dist/utils/{message_inputs,standard}.{js,cjs}`;测试断言这些 hunk 仍生效 |

---

## 1. Integration Gap Audit (Critical Discovery)

**This section is the most important finding from research. Phase 7 planner MUST address these 3 gaps before tasks 5-8 are touchable.**

### 1.1 Gap 1: `ChatPayload.overrides` missing `planOnly`

**File:** `src/main/llm.ts:32-44`
**Current:**
```typescript
export interface ChatPayload {
  projectId: string;
  sessionId: string;
  agentId?: string | null;
  message: { id: string; content: string };
  overrides?: {
    providerId?: string;
    model?: string;
    // NO planOnly!
  };
}
```

**Problem:** `dispatcher.ts:104` 已经在传 `{ planOnly: true }` 给 `sendMessage`,但 `useSessionStore.sendMessage` 把 `overrides` 透传到 `window.electronAPI.llm.chat(assistantMsgId, { ..., overrides })`,preload 透传到 IPC,主进程在 `runLLMChat(_evt, payload)` 收到的 `payload.overrides` 类型是 `{ providerId?, model? }` — **`planOnly` 在编译期被剥离**(TypeScript 类型不匹配 → 实际运行时若发送整个对象,planOnly 字段还在但 llm.ts 不消费)。

**Fix:** 改 `ChatPayload.overrides` 为 `ChatRuntimeOverrides`(已经定义在 `src/shared/types.ts:189-195`,含 `planOnly`),让主进程用 shared type 而非本地 type。

### 1.2 Gap 2: `RuntimeModelOverrides` missing `planOnly`

**File:** `src/main/deepagent/runtime.ts:43-46`
**Current:**
```typescript
interface RuntimeModelOverrides {
  providerId?: string;
  model?: string;
  // NO planOnly!
}
```

**Problem:** `llm.ts:324` 透传 `payload.overrides` 给 `createDeepAgentRuntime(...)`,runtime 端**没有 planOnly 字段类型定义**。即使 planOnly 在 IPC 端没被剥离,到这里也丢了。

**Fix:** `RuntimeModelOverrides extends ChatRuntimeOverrides`(或直接 import shared type)。所有调用点不需要改 — `providerId` / `model` 仍能用。

### 1.3 Gap 3: `runtime.ts` 没有任何代码消费 `planOnly`

**Verified:** `grep planOnly src/main/runtime.ts` = **0 matches**。

**Problem:** D-13 说"deepagent 端保证 `write_file` / `edit_file` / `bash` 工具调用全部被屏蔽"。但当前 runtime.ts 的 `DEFAULT_INTERRUPT_ON` 把 `write_file` / `edit_file` 列在 `interruptOn`(需要用户审批),`bash` 不在 interruptOn(默认行为 = 自由执行)。**没有任何代码读 `planOnly`** 来切换到"完全屏蔽"模式。

**Fix:** 在 `createDeepAgent` 调用前(if `overrides?.planOnly`),把 `interruptOn` 中的 `write_file` / `edit_file` 设为 `false`(完全跳过),并把 `bash` 工具从 `builtInTools` 中**移除**。这是 Phase 7 的核心实现工作(不是测试工作)。

**Verification source:** D-13 + PITFALLS P2(`/plan` 实现章节, "切 agent 内部 flag(runtime.ts 加 `planMode` 字段),不动 message 流")。

---

## 2. Standard Stack

> Phase 7 不安装新外部包(per CONTEXT.md "no new dev deps")。所有包已在 Phase 5/6 安装。

### Core (already installed, no change)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sonner` | `2.0.7` | Toast 通知(`/goal` 写完后非阻塞确认) | Phase 6 已用;Phase 7 toast.info('[system] Goal set: ' + goal) |
| `zustand` | `5.0.13` | sessionStore 扩展(`sessionGoals` Map) | 项目已经重度依赖,新字段 + 1 个 setter 即可 |
| `@assistant-ui/react` | `0.14.5` | **不**用 | 整个 composer 是裸 `<textarea>`,Phase 7 不引入 |
| `@langchain/anthropic` | `1.4.0` | M3 thinking chain 依赖 | 6-hunk patch-package 锁定的核心包 |
| `better-sqlite3` | `12.10.0` | `/context` SQL 聚合(messages + workflows 表) | 主进程已有,新 IPC handler 直接用 |
| `cmdk` | `1.1.1` | 已在 Phase 5 安装;Phase 7 不修改 | — |
| `@radix-ui/react-popover` | `1.1.15` | 已在 Phase 5 安装;Phase 7 不修改 | — |

### No New Dev Dependencies

per `STACK.md` D-26: "New dev dependencies beyond `cmdk` + `@radix-ui/react-popover` + `sonner` — every dep added is a future maintenance burden; existing `react`, `zustand`, `tailwind`, `shadcn/ui` already cover the use cases."

**Phase 7 严格遵守**:不增加任何 `package.json` 依赖。

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map for sessionGoals | SQLite `session_goals` table | SLASH-15 推 v1.2;Phase 7 内存 Map 简化实施 |
| `String.length * 0.25` token estimation | `gpt-tokenizer` (precise 1 token ≈ 1.5 CJK chars / 4 ASCII chars) | C-08 + D-09:Phase 7 用粗估,精确版推 v1.2 |
| Mock Anthropic SDK `messages.stream` in 3 separate test files | Extend existing `anthropic-roundtrip.test.ts` | v3 stream fixture 已在 roundtrip test 写好;3 it 块应加在同文件(详见 §7.2) |

### Installation

无。Phase 7 不安装新包。

**Version verification:** 验证 (运行 `npm view`):

```bash
npm view @langchain/anthropic version       # 1.4.0
npm view sonner version                      # 2.0.7
npm view cmdk version                        # 1.1.1
npm view @radix-ui/react-popover version     # 1.1.15
```

所有版本与已安装的 `node_modules/*/package.json` 一致(已验证 `grep version` 输出)。

---

## 3. Package Legitimacy Audit

> Phase 7 不安装新外部包。审计目的是确认 4 个被依赖的现有包(anthropic / sonner / cmdk / radix-popover)都是合法的,无 slopcheck 风险。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@langchain/anthropic` | npm | [VERIFIED: 1.4.0 installed in `node_modules`; Context7 docs available at `/langchain-ai/langchainjs`] | 6+ years (LangChain) | github.com/langchain-ai/langchainjs | [OK] | Approved |
| `sonner` | npm | [VERIFIED: 2.0.7 installed] | 2+ years | github.com/emilkowalski/sonner | [OK] | Approved |
| `cmdk` | npm | [VERIFIED: 1.1.1 installed] | 2+ years | github.com/dip/cmdk | [OK] | Approved |
| `@radix-ui/react-popover` | npm | [VERIFIED: 1.1.15 installed] | 3+ years | github.com/radix-ui/primitives | [OK] | Approved |

**slopcheck audit (run 2026-06-04):**
```
slopcheck install cmdk sonner @langchain/anthropic @radix-ui/react-popover
→ 4 OK / 0 SLOP / 0 SUS
```

**Packages removed due to slopcheck [SLOP] verdict:** 无
**Packages flagged as suspicious [SUS]:** 无

**Conclusion:** 所有 Phase 7 依赖的包都通过 slopcheck 审计。无需在 PLAN.md 加 `checkpoint:human-verify` gate。

---

## 4. /goal SystemSilent Implementation

> D-01..D-05:placeholder 气泡 + sessionGoals Map + 立即写 + 保留跨 session。

### 4.1 sessionStore 扩展

**File:** `src/renderer/src/stores/sessionStore.ts`

**新增字段(line 47 附近):**
```typescript
interface SessionState {
  // ... 既有 19 字段 ...
  sessionGoals: Map<string, string>;  // sessionId → goal
  setSessionGoal: (sessionId: string, goal: string) => void;
}
```

**实现位置:** `src/renderer/src/stores/sessionStore.ts:84-96` 的 `useSessionStore.create` 内。

**Init values:**
```typescript
sessionGoals: new Map(),
// ... 其他 19 个字段 ...

setSessionGoal: (sessionId, goal) => {
  set((state) => {
    const next = new Map(state.sessionGoals);
    next.set(sessionId, goal);
    return { sessionGoals: next };
  });
},
```

**为什么 new Map 而非 mutate:** Zustand 的 `set` 是 shallow compare — 直接 mutate Map 不会触发 React re-render。新建 Map 是 React-friendly 模式。

**为什么不持久化:** D-05 + SLASH-15:Phase 7 内存,v1.2+ 迁 SQLite。`sessionGoals` 不进 `streamingSessionsCache`(那是消息流缓存,不是用户元数据)。

**selectSession 切换时不清理:** D-04:`Map 是 sessionId → goal 的映射,不清空`。当前 `selectSession` 已经不触碰 `sessionGoals`,无需改。

### 4.2 dispatcher SystemSilent 实现

**File:** `src/renderer/src/lib/commands/dispatcher.ts:89-92`

**当前(Phase 6 placeholder):**
```typescript
case 'SystemSilent':
  console.log('[dispatcher] SystemSilent:', plan.command.name, plan.args);
  return;
```

**Phase 7 替换为:**
```typescript
case 'SystemSilent': {
  // D-02/D-03: 写 sessionGoals Map; 不发 LLM
  const { activeSessionId, setSessionGoal } = useSessionStore.getState();
  if (!activeSessionId) {
    console.warn('[dispatcher] SystemSilent: no active session');
    return;
  }
  const goal = (plan.args || '').trim();  // C-02
  setSessionGoal(activeSessionId, goal);
  // D-01: 占位气泡走 sonner; Phase 8 polish 可换为 MessageItem
  const { toast } = await import('sonner');
  toast.info(`[system] 正在执行 /goal…`, {
    description: `session=${activeSessionId.slice(0, 8)}  goal=${goal || '(无描述)'}`,
    duration: 2000,
  });
  return;
}
```

**注意:** `toast` 是 sonner 的命令式 API,Phase 6 已确认安装;**不需要** 在 ChatArea 加真 MessageItem 气泡(那是 Phase 8 polish 范围,per C-01)。

**为什么 dynamic import:** sonner 是 ESM,`toast` API 在主 bundle 中;动态 import 防止某些 vitest 环境下 hoist 失败(参考 Phase 6 chokidar-watcher.test.ts 的 `vi.hoisted` 模式)。

**或者更简单:直接 import + 不 await:**
```typescript
import { toast } from 'sonner';
// ...
toast.info(`[system] 正在执行 /goal…`, { description: ..., duration: 2000 });
```

(planner 选择其一)

### 4.3 验证标准

**3 个测试(在 `src/renderer/src/stores/sessionStore.test.ts`):**
1. `setSessionGoal(s1, 'a')` → `state.sessionGoals.get('s1') === 'a'`
2. `setSessionGoal(s1, 'b')` 后 → `state.sessionGoals.get('s1') === 'b'`(覆盖)
3. `setSessionGoal(s1, 'a') + setSessionGoal(s2, 'b')` → 两个都存在(D-04 跨 session 保留)
4. `selectSession(null)` 不清理 `sessionGoals` (D-04 保留)

**1 个测试(在 `src/renderer/src/lib/commands/dispatcher.test.ts`):**
- `dispatch({ kind: 'SystemSilent', command: goalCmd, args: 'write tests' })` → `useSessionStore.getState().sessionGoals.get(activeSessionId) === 'write tests'`

---

## 5. /context SystemLocal Implementation

> D-06..D-09:与 `/context [all]` 行为相同 + 4 项 token breakdown + IPC `context:currentSession` + `.length * 0.25` 粗估。

### 5.1 IPC Channel 设计

**Channel name:** `context:currentSession`
**Signature(C-07):** `(sessionId: string) => Promise<{ breakdown, total }>`

**主进程 handler(在 `src/main/ipc-handlers.ts:798` 之后插入,新文件 OR 同文件):**
```typescript
ipcMain.handle('context:currentSession', async (_evt, sessionId: string) => {
  try {
    // 1. conversation tokens
    const convRow = db.prepare(
      'SELECT COALESCE(SUM(LENGTH(content)), 0) AS total FROM messages WHERE session_id = ?'
    ).get(sessionId) as { total: number } | undefined;
    const conversationChars = convRow?.total || 0;

    // 2. skills tokens — 通过 current session 找 project,然后 listPhysicalSkills
    const project = db.prepare(
      `SELECT p.path FROM projects p
       JOIN sessions s ON s.project_id = p.id
       WHERE s.id = ?`
    ).get(sessionId) as { path: string } | undefined;
    let skillsChars = 0;
    if (project) {
      const skills = listPhysicalSkills(project.path);
      // 用 SKILL.md 文件大小聚合
      const skillFiles = skills.map(s => {
        const p = path.join(
          s.scope === 'global'
            ? path.join(os.homedir(), '.cdf', 'skills', s.name)
            : path.join(project.path, '.cdf', 'skills', s.name),
          'SKILL.md',
        );
        return fs.existsSync(p) ? fs.statSync(p).size : 0;
      });
      skillsChars = skillFiles.reduce((a, b) => a + b, 0);
    }

    // 3. MCP tools tokens — loadMcpTools(agentId, mcpServers) → inputSchema 序列化
    let mcpChars = 0;
    const agent = db.prepare(
      `SELECT a.id, a.config FROM agents a
       JOIN sessions s ON s.agent_id = a.id
       WHERE s.id = ?`
    ).get(sessionId) as { id: string; config: string | null } | undefined;
    if (agent) {
      const mcpServers = db.prepare(
        'SELECT * FROM mcp_servers WHERE is_connected = 1'
      ).all() as MCPServer[];
      const mcpResult = await loadMcpTools(agent.id, mcpServers);
      // 估算每个 tool 的 inputSchema JSON 字符串长度
      for (const tool of mcpResult.tools) {
        try {
          mcpChars += JSON.stringify((tool as any).schema || (tool as any).inputSchema || {}).length;
        } catch { /* skip */ }
      }
    }

    // 4. workflows tokens — graph_data 长度
    const workflowRow = db.prepare(
      `SELECT COALESCE(SUM(LENGTH(graph_data)), 0) AS total
       FROM workflows
       WHERE status = 'active' AND project_id = (
         SELECT project_id FROM sessions WHERE id = ?
       )`
    ).get(sessionId) as { total: number } | undefined;
    const workflowsChars = workflowRow?.total || 0;

    // 5. token 估算: String.length * 0.25 (D-09)
    const conversation = Math.ceil(conversationChars * 0.25);
    const skills = Math.ceil(skillsChars * 0.25);
    const mcp = Math.ceil(mcpChars * 0.25);
    const workflows = Math.ceil(workflowsChars * 0.25);
    const total = conversation + skills + mcp + workflows;

    return {
      breakdown: { conversation, skills, mcp, workflows },
      total,
    };
  } catch (err: any) {
    console.error('[context:currentSession] failed:', err);
    return { breakdown: { conversation: 0, skills: 0, mcp: 0, workflows: 0 }, total: 0 };
  }
});
```

**Imports needed (in `src/main/ipc-handlers.ts`):**
- `import { listPhysicalSkills } from './deepagent/skill-manager'`
- `import { loadMcpTools } from './deepagent/mcp-connector'`
- `import fs from 'fs'`
- `import path from 'path'`
- `import os from 'os'`

### 5.2 preload bridge

**File:** `src/preload/index.ts:117` 之后(line 117 是 `commands` 块的右括号)

**新增:**
```typescript
context: {
  currentSession: (sessionId: string) =>
    ipcRenderer.invoke('context:currentSession', sessionId),
},
```

### 5.3 shared type 扩展

**File:** `src/shared/types.ts:456-456`(在 `db` 块之前)

**新增:**
```typescript
context: {
  currentSession: (sessionId: string) => Promise<{
    breakdown: { conversation: number; skills: number; mcp: number; workflows: number };
    total: number;
  }>;
};
```

### 5.4 dispatcher SystemLocal 实现

**File:** `src/renderer/src/lib/commands/dispatcher.ts:94-98`

**替换为:**
```typescript
case 'SystemLocal': {
  // D-06/D-08: 走 IPC 拉 token breakdown; D-07 渲染气泡
  const { activeSessionId } = useSessionStore.getState();
  if (!activeSessionId) {
    console.warn('[dispatcher] SystemLocal: no active session');
    return;
  }
  const result = await window.electronAPI.context.currentSession(activeSessionId);
  // 气泡走 sonner; Phase 8 polish 可换 MessageItem
  const { toast } = await import('sonner');
  toast.info(`[system] 上下文`, {
    description:
      `对话: ${result.breakdown.conversation} tokens\n` +
      `Skills: ${result.breakdown.skills} tokens\n` +
      `MCP: ${result.breakdown.mcp} tokens\n` +
      `Workflows: ${result.breakdown.workflows} tokens\n` +
      `Total: ${result.total} tokens`,
    duration: 4000,
  });
  return;
}
```

### 5.5 验证标准

**3 个测试(在 `src/main/ipc-handlers.context.test.ts`,新建):**
1. `context:currentSession('s1')` 返回 `{ breakdown, total }` 结构
2. Mock db 注入已知 messages content → breakdown.conversation = ceil(chars * 0.25)
3. Mock skill-manager 返回 1 个 SKILL.md = 800 bytes → breakdown.skills = 200
4. Mock mcp-connector 返回 1 个 tool with schema 400 chars → breakdown.mcp = 100
5. Mock db 注入 1 个 active workflow graph_data 2000 chars → breakdown.workflows = 500
6. Total = sum(breakdown)

**1 个测试(在 `src/renderer/src/lib/commands/dispatcher.test.ts`):**
- Mock `window.electronAPI.context.currentSession` → dispatch SystemLocal → toast.info 被调(用 `vi.spyOn(toast, 'info')`)

---

## 6. /plan PlanMode Implementation

> D-10..D-13:`[plan]` 标记气泡 + `payload.overrides = { planOnly: true }` 端到端透传 + plan 模式屏蔽 `write_file` / `edit_file` / `bash`。

### 6.1 ChatPayload.overrides 扩展(关键集成缺口 #1)

**File:** `src/main/llm.ts:40-43`

**当前:**
```typescript
overrides?: {
  providerId?: string;
  model?: string;
};
```

**改为(import shared type):**
```typescript
import type { ChatRuntimeOverrides } from '../shared/types';
// ...
overrides?: ChatRuntimeOverrides;
```

**删除** `src/main/llm.ts:40-43` 局部定义,改为 import from `../shared/types`。

### 6.2 RuntimeModelOverrides 扩展(关键集成缺口 #2)

**File:** `src/main/deepagent/runtime.ts:43-46`

**当前:**
```typescript
interface RuntimeModelOverrides {
  providerId?: string;
  model?: string;
}
```

**改为:**
```typescript
import type { ChatRuntimeOverrides } from '../../shared/types';
// ...
type RuntimeModelOverrides = ChatRuntimeOverrides;
```

(或 `interface RuntimeModelOverrides extends ChatRuntimeOverrides {}`)

### 6.3 runtime.ts 真正消费 planOnly(关键集成缺口 #3)

**File:** `src/main/deepagent/runtime.ts:486-488` 附近

**当前(Phase 7 之前):**
```typescript
const builtInTools: any[] = [
  createDeleteFileTool(project.path),
  createBashTool({ workingDir: project.path }),
  createFetchTool(),
];
// ...
// 后面的 createDeepAgent 调用用了 hardcoded interruptOn
```

**Phase 7 改造:**
```typescript
// D-13: plan 模式下屏蔽写工具
const isPlanMode = Boolean(overrides?.planOnly);

const builtInTools: any[] = [createFetchTool()];
if (!isPlanMode) {
  builtInTools.push(createDeleteFileTool(project.path));
  builtInTools.push(createBashTool({ workingDir: project.path }));
}

// D-13: plan 模式下 write_file/edit_file 直接 reject
const interruptOn = isPlanMode
  ? false  // 完全跳过 interrupt
  : {
      write_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
      edit_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
      delete_file: { allowedDecisions: ['approve', 'reject'] },
    };

// createDeepAgent 调用处用 interruptOn
const agent = createDeepAgent({
  // ... 既有参数 ...
  interruptOn,
  tools: builtInTools,  // 已有
});
```

**重要细节:**
- `interruptOn: false` 是 deepagents 的合法值(等于无 interrupt)
- `createBashTool` 在 plan 模式下**完全移除**,连 tool 列表都不注册,LLM 看不到这个 tool,D-13 满足
- `createDeleteFileTool` 同理
- `write_file` / `edit_file` 是 deepagent 内置工具(通过 FilesystemBackend),不需要在我们这注册 — 在 plan 模式下 `interruptOn: false` 等于"任何人都能调",但 plan 模式的目的就是"只规划不写",所以这里其实要 `interruptOn: { write_file: false, edit_file: false }`(deepagents 接受这种"显式 false 表示直接拒绝"语义,需要 verify)

**PITFALLS P2 警告:** "切 agent 内部 flag(runtime.ts 加 `planMode` 字段),不动 message 流" — Phase 7 不动 `sendMessage` / `messages` 路径,只在 `createDeepAgent` 注入时改变 `interruptOn` + `tools`。这避免触碰 6-hunk patch-package 的 reasoning roundtrip。

### 6.4 dispatcher PlanMode 实现

**File:** `src/renderer/src/lib/commands/dispatcher.ts:100-105`

**当前(Phase 6):**
```typescript
case 'PlanMode':
  await sendMessage(projectId, plan.args, { planOnly: true });
  return;
```

**Phase 7 在 sendMessage 之前加 [plan] 气泡(D-10/D-11):**
```typescript
case 'PlanMode': {
  // D-10/D-11: [plan] 标记气泡 (持续到首个 message_chunk 到达,C-04)
  const { toast } = await import('sonner');
  const description = plan.args.trim() || '(无描述)';
  toast.info(`[plan] 进入 plan 模式:${description}`, {
    description: 'LLM 不会调用 write_file / edit_file / bash',
    duration: 3000,
  });
  // D-12: 透传 planOnly 给 sendMessage
  await sendMessage(projectId, plan.args, { planOnly: true });
  return;
}
```

**注意:** `[plan]` 气泡用 `toast` 而不是 MessageItem,因为:
- plan 模式持续期间可能有多个 message_chunk 持续到达,toast 一次性显示就够了
- 真正的 plan 输出(LLM reasoning + text)会通过 `message_chunk` 流向现有的 assistant MessageItem(C-04:与现有 chat bubbles 一致)

### 6.5 验证标准

**测试 1: `ChatPayload.overrides.planOnly` 端到端**
- 在 `src/main/llm.test.ts` 加一个 it 块:mock `createDeepAgentRuntime`,传 `{ planOnly: true }` 作为 overrides,断言 runtime 收到完整 overrides(目前 runtime 5th 参数 = `overrides?: RuntimeModelOverrides`,扩展后类型应包含 planOnly)
- **必须先**把 `runtime.ts:43` 的 `RuntimeModelOverrides` 扩展好(否则 planOnly 在 type 层面丢失)

**测试 2: plan 模式屏蔽工具**
- 在 `src/main/deepagent/runtime.test.ts` 加 it 块:mock `createDeepAgent` 调用,断言:
  - plan 模式下 `tools` 不含 `bash` / `delete_file`
  - plan 模式下 `interruptOn.write_file === false` 或类似 reject 标记
  - 非 plan 模式下,tools 包含 bash + delete_file,interruptOn 是默认值

**测试 3: dispatcher dispatch PlanMode**
- 在 `src/renderer/src/lib/commands/dispatcher.test.ts` 加 it 块:mock sendMessage,断言传了 `{ planOnly: true }`

---

## 7. SLASH-REGRESSION Test Design (Phase 7 核心护栏)

> D-16..D-19:3 个 it 块覆盖 6-hunk patch-package 的 reasoning roundtrip + plan 模式无 tool_call + M3 thinking 不被打断。

### 7.1 patch-package 分析

**File:** `patches/@langchain+anthropic+1.4.0.patch`(已读,80 行)

**6 个 hunk 拆解:**
| # | File | Hunk | 作用 |
|---|------|------|------|
| 1 | `node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs:181-186` | 新增 `else if (contentPart.type === "reasoning" && "signature" in contentPart)` → `type: "thinking"` block | FALLTHROUGH 路径 reasoning+signature → thinking roundtrip |
| 2 | `node_modules/@langchain/anthropic/dist/utils/message_inputs.js:176-191` | 同上 + `.js` 同步 | JS fallback path |
| 3 | `node_modules/@langchain/anthropic/dist/utils/standard.cjs:126-129` | 移除 `_formatStandardContent` reasoning 分支的 `isAnthropicMessage` 守卫 | V1 路径 reasoning 守卫修复 |
| 4 | `node_modules/@langchain/anthropic/dist/utils/standard.cjs:264-267` | `block.type === "video"` 改为 `result.push(block); continue;` | Video passthrough |
| 5 | `node_modules/@langchain/anthropic/dist/utils/standard.js:126-129` | 同 hunk #3(JS) | V1 路径 JS |
| 6 | `node_modules/@langchain/anthropic/dist/utils/standard.js:264-267` | 同 hunk #4(JS) | Video passthrough JS |

**关键洞察:** 6 个 hunk 中的 4 个(hunks 1, 2, 3, 5)直接关系到 **reasoning+signature roundtrip**;hunks 4/6 是 video passthrough(与 SLASH-REGRESSION 无关)。

**SLASH-REGRESSION 的目标:** 当 `npm install` 重写 `node_modules`,postinstall 钩子会重新应用 patch;若 patch 失效,v3 stream 的 `<think>` chunk 不会作为 `message_chunk` 首段出现(在某些 case 下 reasoning 会被 silently dropped,见 `anthropic-roundtrip.test.ts:272-303`)。

### 7.2 测试位置决策

**D-16:** `src/main/deepagent/llm-adapter.test.ts`(客人大人决策)

**但** v3 stream fixture 已经写在 `src/main/deepagent/anthropic-roundtrip.test.ts:130-180` 的 `v3Events()` async generator。

**推荐方案:** 3 个 SLASH-REGRESSION it 块**不**复制 v3Events,而是 import 那个 generator 或者同款 v3Events 在新文件加 helper。

**简化路径:** 在 `llm-adapter.test.ts` 顶部 inline 写一个简化版的 `mockThinkStream()` async generator(只 emit reasoning + text + signature),不需要完整 v3 events。`v3Events()` 是为 roundtrip 测 roundtrip 用的;SLASH-REGRESSION 测的是"reasoning 块作为 message_chunk 首段被发出"。

**Test #1 完整代码骨架(D-17 第一个 it 块):**
```typescript
// src/main/deepagent/llm-adapter.test.ts 新增 section
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatModelStream } from '@langchain/core/language_models/stream';
import type { ChatModelStreamEvent } from '@langchain/core/language_models/event';

// Helper: mock Anthropic SDK 的 messages.stream,emit <think> + 文本
async function* mockPlanThinkStream(): AsyncGenerator<ChatModelStreamEvent> {
  yield { event: 'message-start', id: 'msg_plan_test' };
  yield { event: 'content-block-start', index: 0, content: { type: 'reasoning', reasoning: '', index: 0 } };
  yield { event: 'content-block-delta', index: 0, delta: { type: 'reasoning-delta', reasoning: 'plan only: ' } };
  yield { event: 'content-block-delta', index: 0, delta: { type: 'reasoning-delta', reasoning: 'analyze problem' } };
  yield { event: 'content-block-delta', index: 0, delta: { type: 'block-delta', fields: { type: 'reasoning', signature: 'sig-plan-abc' } } };
  yield { event: 'content-block-finish', index: 0, content: { type: 'reasoning', reasoning: 'plan only: analyze problem', signature: 'sig-plan-abc' } };
  yield { event: 'content-block-start', index: 1, content: { type: 'text', text: '', index: 1 } };
  yield { event: 'content-block-delta', index: 1, delta: { type: 'text-delta', text: 'Here is the plan.' } };
  yield { event: 'content-block-finish', index: 1, content: { type: 'text', text: 'Here is the plan.' } };
  yield { event: 'message-finish', reason: 'stop' };
}

describe('SLASH-REGRESSION: 6-hunk patch-package护栏', () => {
  it('7.1 /plan 路径首段 message_chunk 含 <think>', async () => {
    // 模拟 ChatAnthropic 的 stream output
    const stream = new ChatModelStream(mockPlanThinkStream());
    const message = await stream.output;

    // Content 必须含 reasoning 块(type === 'reasoning',且有 signature)
    const blocks = message.content as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe('reasoning');
    expect(blocks[0].signature).toBe('sig-plan-abc');

    // 关键: 如果 patch-package 没生效,_formatStandardContent 的 isAnthropicMessage 守卫
    // 会把 reasoning 块 drop,blocks 会是空数组或只有 text
    // 这条断言如果失败 → patch 已失效 → 立刻重跑 postinstall
  });

  it('7.2 plan 模式下 write_file / edit_file / bash 工具不被调用', async () => {
    // 这测的是 runtime 层,不是 llm-adapter 层
    // → 这条 it 块更适合放在 src/main/deepagent/runtime.test.ts
    // (D-16 锁定 llm-adapter.test.ts,但 "或 llm.test.ts" 也可;这里保持灵活)
    //
    // 路径: import runtime.ts + mock deepagents.createDeepAgent + 断言 tools 数组不含 bash/delete_file
    // 详见 §6.5 测试 2
  });

  it('7.3 slash /plan 路径不绕过 M3 thinking chain', async () => {
    // 端到端: 模拟 llm:chat 入口 payload.overrides.planOnly = true
    // 验证: streamEvents 输出的首条 message_chunk 是 <think> 包裹的 reasoning
    //
    // 这条测试在 llm.test.ts 已经覆盖了"first chunk is <think>"模式
    // (llm.ts:376-378 显式发 '<think>' 块)
    // → 推荐这条 it 块放在 llm.test.ts,作为已有 chunk 链路测试的 plan-mode 变体
  });
});
```

### 7.3 测试设计模式

**D-18 原则:** mock Anthropic SDK 的 `messages.stream`,不真正发网络请求。

**已有先例:** `src/main/deepagent/anthropic-roundtrip.test.ts:84-180` 的 5 个 it 块已经验证了:
- v3 stream + signature_delta → AIMessage.content 保留 signature (test 1.1)
- AIMessage + reasoning+signature → next request body 含 thinking block (test 1.2)
- 平凡 text AIMessage → 不发 thinking block (test 1.3)
- Fallthrough path(no v1 marker) → reasoning+signature 转为 thinking (test 1.4)
- V1 path without model_provider → reasoning 守卫修复 (test 1.5)

**SLASH-REGRESSION 与现有 5 个 it 块的区别:**
- 现有测的是**单元**(单个 v3 stream → AIMessage → next request body 的链路)
- SLASH-REGRESSION 测的是**端到端**(`/plan` 整条路径的 3 个断言:think chunk 首段、no tool call、slash 不绕过 M3)

### 7.4 验证标准

**3 个 it 块都要测:**
1. **It 7.1 (think chunk):** 在 `llm-adapter.test.ts`,断言 v3 stream 输出的 AIMessage.content[0] 是 `type: 'reasoning'` 且有 signature。如果失败 → patch hunks 1/2/3/5 失效 → 重跑 `npx patch-package`
2. **It 7.2 (no tool call):** 在 `runtime.test.ts`,断言 `overrides.planOnly === true` 时 `createDeepAgent` 调用的 `tools` 数组不含 `bash` / `delete_file`,且 `interruptOn.write_file/edit_file` 是 reject 模式
3. **It 7.3 (slash 不绕过 M3):** 在 `llm.test.ts`,断言 `runLLMChat` 收到 `payload.overrides.planOnly = true` 时,首条 `sender.send(channel, ...)` 调用是 `{ type: 'message_chunk', text: '<think>' }`(沿用 `llm.ts:376-378` 既有 chunk 链路)

**注意:** It 7.2 的位置严格按 D-16 应该在 `llm-adapter.test.ts`,但语义上更适合 `runtime.test.ts`。**planner 决策点:** 可以接受 D-16 的宽松解读(`llm-adapter.test.ts` OR `llm.test.ts`),把 it 7.2 放 `runtime.test.ts` 是更合适的工程选择。

---

## 8. 5-Line Sniff in handleSend (D-14/D-15)

> 在 `ChatArea.handleSend` 函数体最前面 5 行加 `if (value.startsWith('/') && selectionStart === 0)` 检测。

### 8.1 集成点

**File:** `src/renderer/src/components/ChatArea/ChatArea.tsx:617-628`

**当前:**
```typescript
const handleSend = async (e?: React.FormEvent) => {
  if (e) e.preventDefault();
  if (!inputVal.trim() || !currentProjectId || isStreaming) return;

  const value = inputVal;
  setInputVal('');

  await sendMessage(currentProjectId, value, {
    providerId: selectedProviderId || undefined,
    model: selectedModel || undefined,
  });
};
```

### 8.2 Phase 7 改造

**必须先加 textareaRef:**
```typescript
// 在 ChatArea.tsx:148 附近 (messagesEndRef 旁边)
const textareaRef = useRef<HTMLTextAreaElement>(null);
// ...
// 在 line 1044 <textarea ...> 加 ref={textareaRef}
```

**handleSend 改造(前 5 行内):**
```typescript
const handleSend = async (e?: React.FormEvent) => {
  if (e) e.preventDefault();
  // Phase 7 D-14: 5-line sniff — 仅在光标在 0 时把整段 input 当 slash command
  if (
    inputVal.startsWith('/') &&
    textareaRef.current?.selectionStart === 0
  ) {
    const plan = dispatcherResolve(inputVal, registry.commands);
    if (plan) {
      setInputVal('');
      dispatcherDispatch(plan).catch((err) => console.error('[handleSend/slash] error:', err));
      return;
    }
  }
  if (!inputVal.trim() || !currentProjectId || isStreaming) return;

  const value = inputVal;
  setInputVal('');

  await sendMessage(currentProjectId, value, {
    providerId: selectedProviderId || undefined,
    model: selectedModel || undefined,
  });
};
```

**注意:** D-15 case 3 `/  foo`:
- `inputVal` = `/  foo`
- `inputVal.startsWith('/')` = true
- `textareaRef.current?.selectionStart` = 0(假设)
- `dispatcherResolve('/  foo', commands)` → `resolve` 函数在 `dispatcher.ts:26-33` 的匹配规则:
  ```typescript
  const match = commands.find((c) => {
    const cmdPrefix = '/' + c.name;
    return (
      inputVal === cmdPrefix ||                              // '/goal' === '/goal' → false
      inputVal.startsWith(cmdPrefix + ' ') ||                // '/  foo' startsWith '/goal ' → false
      inputVal === cmdPrefix + ' '                           // '/  foo' === '/goal ' → false
    );
  });
  ```
- `match = undefined` → `resolve` returns null → `if (plan)` 不进入 → 走 `sendMessage` 普通路径
- **D-15 注释说 "/  foo → 识别": 这是 CONTEXT.md 的措辞,但代码层面不会识别 — `dispatcherResolve` 找不到匹配的 command。**

**这个语义冲突需要 planner 决策:**
- 选项 A:认为 D-15 case 3 实际是"识别为 slash command 意图(走 dispatcher)但 dispatcher 找不到 match,fall through 到普通 sendMessage"
- 选项 B:认为 D-15 case 3 是"识别为 slash command 失败,被 sniff 拦下,但走 sendMessage" — 这其实就是选项 A 的另一种说法
- 选项 C:把 `/  foo` 当作"输入以 `/` 开头 + 第二个字符是 space",**不**走 slash command(因为不是合法 command 形式),但仍走 sendMessage

**Planner 决策建议:** 选项 A 是唯一工程可行方案(D-15 的"识别"指的是"走 dispatcher 路径",而不是"识别为合法 command")。Phase 7 测试这样写:
- 第三个 it: 模拟 `/  foo` 输入 → `dispatcherResolve` 被调(通过 spy),但返回 null → 仍走 `sendMessage` 路径(因为 `if (plan)` 失败)
- 验证: `dispatcherResolve` 至少被调 1 次 + `sendMessage` 被调 1 次

### 8.3 测试 (3 个 case per D-15)

**File:** 新建 `src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx`(或扩展 `SlashCommandPopup.test.tsx`)

**Test 1: 开头 `/goal X` → 识别**
```typescript
it('5-line sniff: /goal X at start → dispatcher.resolve called', async () => {
  render(<TestHarness />);
  const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
  act(() => {
    fireEvent.change(textarea, { target: { value: '/goal write tests', selectionStart: 0 } });
  });
  // 不需要打开 popup,因为已经超过 32 字符或含空格 (Phase 5 onChange gate)
  // 直接按 Enter
  act(() => {
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
  });
  // 验证 sendMessage 没被调(走 dispatcher 路径)
  expect(mockSendMessage).not.toHaveBeenCalled();
  // 验证 useSessionStore.sessionGoals 更新
  expect(useSessionStore.getState().sessionGoals.get('session-1')).toBe('write tests');
});
```

**Test 2: `/foo bar` 中段 `/baz` → 不识别**
```typescript
it('5-line sniff: selectionStart > 0 → not a slash command', async () => {
  render(<TestHarness />);
  const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
  act(() => {
    fireEvent.change(textarea, { target: { value: '/foo bar /baz', selectionStart: 9 } });
  });
  act(() => {
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
  });
  // selectionStart 9 = '/foo bar '[9] = '/' 之后,这是中段
  // sendMessage 应被调(普通消息)
  expect(mockSendMessage).toHaveBeenCalled();
  // dispatcher 路径没走
  expect(useSessionStore.getState().sessionGoals.size).toBe(0);
});
```

**Test 3: `/  foo` → 识别(走 dispatcher 但 resolve 返回 null,fall through 到 sendMessage)**
```typescript
it('5-line sniff: /  foo (trim 后空 args) → resolves but falls through', async () => {
  render(<TestHarness />);
  const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
  act(() => {
    fireEvent.change(textarea, { target: { value: '/  foo', selectionStart: 0 } });
  });
  act(() => {
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
  });
  // dispatcher.resolve 被调(可能不返回 null 因为 '/goal' + ' ' 不匹配 '/  foo')
  // 但 sendMessage 仍被调(fall through)
  expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), '/  foo', expect.anything());
});
```

**TestHarness 扩展(参照 Phase 5 TestHarness):**
- 加 `textareaRef = useRef<HTMLTextAreaElement>(null)`
- 暴露 `setSelectionRange` via harness handle
- mock `useSessionStore.sendMessage` 和 `dispatcherDispatch` via vi.mock

---

## 9. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3 + jsdom (renderer) + node (main) |
| Config file | `vitest.config.ts`(line 1-17,已读) |
| Quick run command | `npx vitest run src/main/deepagent/llm-adapter.test.ts src/renderer/src/lib/commands/dispatcher.test.ts` |
| Full suite command | `npm test`(即 `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLASH-05 | `setSessionGoal` + `dispatcher SystemSilent` writes to Map | unit | `npx vitest run src/renderer/src/stores/sessionStore.test.ts` | ❌ Wave 0 — extends existing |
| SLASH-05 | `dispatcher SystemSilent` calls `setSessionGoal` with trimmed args | unit | `npx vitest run src/renderer/src/lib/commands/dispatcher.test.ts` | ✅ exists(扩展) |
| SLASH-06 | `context:currentSession` returns breakdown | unit | `npx vitest run src/main/ipc-handlers.context.test.ts` | ❌ Wave 0 — new file |
| SLASH-06 | `dispatcher SystemLocal` calls `electronAPI.context.currentSession` | unit | `npx vitest run src/renderer/src/lib/commands/dispatcher.test.ts` | ✅ exists(扩展) |
| SLASH-07 | `ChatPayload.overrides.planOnly` end-to-end | unit | `npx vitest run src/main/llm.test.ts` | ✅ exists(扩展) |
| SLASH-07 | `runtime` suppresses bash/delete_file in plan mode | unit | `npx vitest run src/main/deepagent/runtime.test.ts` | ✅ exists(扩展) |
| SLASH-07 | `dispatcher PlanMode` passes `{ planOnly: true }` to sendMessage | unit | `npx vitest run src/renderer/src/lib/commands/dispatcher.test.ts` | ✅ exists(扩展) |
| SLASH-07 | `handleSend` 5-line sniff 3 cases (D-15) | unit | `npx vitest run src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` | ❌ Wave 0 — new file |
| SLASH-REGRESSION | It 7.1: first message_chunk contains <think> | unit | `npx vitest run src/main/deepagent/llm-adapter.test.ts` | ✅ exists(扩展) |
| SLASH-REGRESSION | It 7.2: no tool calls in plan mode | unit | `npx vitest run src/main/deepagent/runtime.test.ts` | ✅ exists(扩展) |
| SLASH-REGRESSION | It 7.3: slash /plan preserves M3 thinking chain | unit | `npx vitest run src/main/llm.test.ts` | ✅ exists(扩展) |

### Sampling Rate

- **Per task commit:** Quick run on the specific test file (e.g. `npx vitest run src/main/deepagent/llm-adapter.test.ts`)
- **Per wave merge:** Full suite (139 existing Phase 6 tests + ~10 new Phase 7 tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/renderer/src/stores/sessionStore.test.ts` — extend with 3 sessionGoals tests(D-04/D-05)
- [ ] `src/main/ipc-handlers.context.test.ts` — new file, 4-5 tests for `context:currentSession`
- [ ] `src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` — new file, 3 tests for 5-line sniff
- [ ] `src/main/deepagent/llm-adapter.test.ts` — extend with SLASH-REGRESSION it 7.1
- [ ] `src/main/deepagent/runtime.test.ts` — extend with SLASH-REGRESSION it 7.2
- [ ] `src/main/llm.test.ts` — extend with SLASH-REGRESSION it 7.3 + payload.overrides.planOnly propagation
- [ ] `src/renderer/src/lib/commands/dispatcher.test.ts` — extend with SystemSilent/SystemLocal/PlanMode real impl tests

---

## 10. Integration Points Summary

| File | Line(s) | Action | Reference |
|------|---------|--------|-----------|
| `src/renderer/src/stores/sessionStore.ts` | 47, 84, 96 | ADD `sessionGoals` field + `setSessionGoal` action | D-02/D-05 |
| `src/renderer/src/lib/commands/dispatcher.ts` | 89-114 | REPLACE 3 placeholder console.log with real implementations (SystemSilent/SystemLocal/PlanMode) | D-01/D-07/D-10 |
| `src/renderer/src/components/ChatArea/ChatArea.tsx` | 148, 617-628, 1044 | ADD `textareaRef` + insert 5-line sniff at top of `handleSend` + bind `ref={textareaRef}` to `<textarea>` | D-14 |
| `src/main/llm.ts` | 32-44, 40-43 | REPLACE local `overrides` type with `import type { ChatRuntimeOverrides } from '../shared/types'` | Gap 1 |
| `src/main/deepagent/runtime.ts` | 43-46, 486-488 | REPLACE `RuntimeModelOverrides` to import shared type + add planMode conditional interruptOn + tools | Gap 2, Gap 3, D-13 |
| `src/main/ipc-handlers.ts` | 798 (insert) | ADD `ipcMain.handle('context:currentSession', ...)` handler | D-08 |
| `src/preload/index.ts` | 117 (insert) | ADD `context: { currentSession: ... }` namespace | D-08 |
| `src/shared/types.ts` | 456 (insert) | ADD `context: { currentSession: ... }` to `ElectronAPI` interface | D-08 |
| `src/main/deepagent/llm-adapter.test.ts` | 152+ | ADD SLASH-REGRESSION it 7.1 | D-17/D-18 |
| `src/main/deepagent/runtime.test.ts` | end | ADD SLASH-REGRESSION it 7.2 (工具屏蔽) | D-17 |
| `src/main/llm.test.ts` | end | ADD SLASH-REGRESSION it 7.3 (slash 不绕过 M3) + payload.overrides.planOnly 透传 | D-17 |
| `src/renderer/src/lib/commands/dispatcher.test.ts` | end | ADD 3 dispatcher case tests | D-15 + real impl |
| `src/renderer/src/stores/sessionStore.test.ts` | end | ADD 3 sessionGoals tests | D-04 |
| `src/main/ipc-handlers.context.test.ts` | new file | ADD 4-5 context:currentSession tests | D-08/C-07 |
| `src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` | new file | ADD 3 5-line sniff tests | D-15 |

---

## 11. Common Pitfalls (Phase 7 Specific)

### Pitfall P7-1: `ChatPayload.overrides` 类型不匹配 → `planOnly` 编译期丢失

**What goes wrong:** `dispatcher.ts:104` 传 `{ planOnly: true }` 给 `sendMessage`,但 `src/main/llm.ts:40-43` 的 `overrides` 类型只声明了 `providerId` + `model`。TypeScript 不会报编译错(结构化类型允许额外字段),但当 `runLLMChat` 在 `src/main/llm.ts:306` 收到 `payload.overrides` 时,代码**只读 `providerId` + `model`**(line 463-464 in `runtime.ts`),`planOnly` 被静默丢弃。

**How to avoid:** **必须先**改 `ChatPayload.overrides` 为 `ChatRuntimeOverrides`(from shared/types.ts),**然后**才改 dispatcher 之外的代码。这是"修链路"的顺序,不能反过来。

**Warning signs:** 在 runtime.test.ts 测 `{ planOnly: true }` 时,`createDeepAgentRuntime` 收到的 5th 参数不包含 planOnly 字段(用 `expect.anything()` 验证类型断言,而不是 `expect.objectContaining({ planOnly: true })`)。

### Pitfall P7-2: runtime.ts 没消费 planOnly → D-13 失效

**What goes wrong:** D-13 说 "Plan 模式期间 `write_file` / `edit_file` / `bash` 工具调用全部被 agent runtime 屏蔽"。但 `grep planOnly src/main/runtime.ts` = 0 matches。当前 `interruptOn` 把 write_file/edit_file 列在 `interruptOn`(需审批),`bash` 工具**在 tools 数组中自由调用**。这意味着 `/plan` 在不修 runtime.ts 的情况下,D-13 完全不成立 — 用户按 /plan 之后,LLM 还能写文件、跑命令。

**How to avoid:** §6.3 的 runtime.ts 改造**必须做**。这是 Phase 7 的核心实现工作,不是测试工作。Planner 把"runtime.ts planMode 屏蔽工具"列为 Wave B 的 task 1,先于 placeholder 气泡(Wave A)。

**Warning signs:** 跑 SLASH-REGRESSION it 7.2(plan 模式无 tool_call)如果失败,先检查 `runtime.ts:486-488` 的 tools 数组是否被 planOnly 缩减。

### Pitfall P7-3: 6-hunk patch-package 被 `npm install` 覆盖 → SLASH-REGRESSION 失败但没人知道

**What goes wrong:** `package.json:13` 的 postinstall 是 `electron-builder install-app-deps && patch-package`。如果开发者(或 CI) `npm install` 之后,patch-package 钩子失败(网络问题 / patch 冲突),`node_modules/@langchain/anthropic/dist/utils/{message_inputs,standard}.{js,cjs}` 的 6 个 hunk 会丢失。M3 thinking 不会作为 `message_chunk` 首段 emit → chat UI 不显示 thinking region → 用户不知道是 patch 失效。

**How to avoid:**
1. SLASH-REGRESSION it 7.1 直接断言"v3 stream 的 reasoning 块有 signature"(无论 patch 是否生效,这个测试都是 critical 的 sanity check — 如果 patch 失效,测试直接 fail,告诉开发者"重跑 postinstall")
2. **不要** 把"已通过 patch"假设写进测试 skip 逻辑(`if (process.env.SKIP_PATCH_CHECK) return;`)— 这是 anti-pattern
3. 在 README 写明:`npm install` 后跑 `npx patch-package` 验证 patch 已应用

**Warning signs:** `grep "type: \"thinking\"" node_modules/@langchain/anthropic/dist/utils/standard.cjs` 应该有匹配(6 个 hunk 中的 2 个)。如果没有,patch 失效。

### Pitfall P7-4: textareaRef 未挂 → selectionStart === 0 检查永远不成立

**What goes wrong:** 当前 `ChatArea.tsx:1044` 的 `<textarea>` 没有 `ref={textareaRef}`。如果只加 `useRef` 不挂 ref,`textareaRef.current` 永远是 null,`textareaRef.current?.selectionStart` 是 undefined,`=== 0` 永远 false → 5-line sniff 永远不进入 dispatcher 路径。

**How to avoid:** `textareaRef` 必须在 `<textarea>` 上挂 `ref={textareaRef}`(在 `ChatArea.tsx:1044` 那一行)。

**Warning signs:** 跑 5-line sniff 测试 case 1(`/goal X at start`)如果失败,先 grep `textareaRef` 在 ChatArea.tsx 的出现位置,确认有 3 个点(import + useRef + JSX ref attribute)。

### Pitfall P7-5: `useCommandRegistry` 还没返回 commands 时调 dispatcher → registry is empty

**What goes wrong:** `useCommandRegistry(currentProjectId, agentId)` 在 `ChatArea.tsx:665-668` 调,初始状态 `commands: []`。如果用户**在 registry 加载完成前**(IPC round-trip 几百 ms)按 Enter 触发了 `/goal`,`registry.commands` 是空数组,`dispatcherResolve` 返回 null → 走普通 sendMessage → `/goal` 被当作文本发给 LLM。

**How to avoid:**
- **测试**:在 TestHarness 中 mock `useCommandRegistry` 返回 `commands: [goalCmd, contextCmd, planCmd]`
- **真实环境**:5-line sniff 应该等 `registry.commands.length > 0`(但这引入 race condition)
- **更简单**:Phase 7 不管这个 — registry 在 popup 打开时必然已加载(用户看到 popup 行才能确认 command);handleSend 触发的 slash command 路径在用户主动输入 `/` 之后,此时 registry 大概率已加载
- **Phase 8 polish**:在 `useCommandRegistry` 加 `isLoading` state,ChatArea handleSend 等 isLoading=false 再走 sniff

**Warning signs:** E2E 测试中"打开 app 立刻输入 /goal 然后按 Enter"可能失败;5-line sniff 的 TestHarness 必须 mock registry。

### Pitfall P7-6: `/context` IPC 失败 → renderer 端 toast 仍发但 breakdown 全 0

**What goes wrong:** `context:currentSession` handler 在第 §5.1 实现中有 4 个 try-catch(主 try 包一切)。如果 `loadMcpTools` 抛错(agent 没有绑定 mcp server),handler 返回 `{ breakdown: { 0, 0, 0, 0 }, total: 0 }`,renderer 收到后仍发 toast 显示"Total: 0 tokens" → 用户困惑。

**How to avoid:** handler 的 4 个查询分别包 try-catch,**只**把失败的字段设为 0(不连带其他字段)。这样 breakdown 显示实际能查到的部分,而不是全 0。

**Warning signs:** 跑 SLASH-06 测试如果 mock mcp-connector 抛错,实际 IPC 返回的 `breakdown.conversation` 应该 > 0(因为 messages SQL 不依赖 mcp)。

### Pitfall P7-7: `[plan]` toast 与 message_chunk 同时出现 → 用户看到 2 个气泡

**What goes wrong:** dispatcher PlanMode 发 toast 立即,然后 `await sendMessage(...)` 异步发 LLM,首个 `message_chunk` 几百 ms 后到达,MessageItem 渲染出真正的 plan 输出。toast 3 秒后消失,期间 message_chunk 已经在 chat 流里。

**How to avoid:** toast 的 `duration: 3000` 配 `description: 'LLM 不会调用 write_file / edit_file / bash'` 让用户明确知道 toast 是"系统提示"不是"LLM 输出"。Phase 8 polish 可以把 toast 换成 MessageItem 内的 `[plan]` 占位,自动随首个 message_chunk 消失(C-04)。

**Warning signs:** E2E 测试中"输入 /plan 后 3 秒内看到 1 个 toast + 1 个 message bubble"是预期行为,不是 bug。

---

## 12. Code Examples (Verified Patterns from Official Sources)

### 12.1 Zustand Map field pattern

**Source:** Zustand 官方文档 (https://zustand.docs.pmnd.rs/guides/typescript)

```typescript
// sessionStore extension
sessionGoals: new Map<string, string>(),

setSessionGoal: (sessionId, goal) => set((state) => {
  const next = new Map(state.sessionGoals);
  next.set(sessionId, goal);
  return { sessionGoals: next };
}),
```

**为什么 new Map:** Zustand 浅比较 — mutate 不会触发 re-render。

### 12.2 cmdk existing handleKeyDown pattern (Phase 5 已用)

**Source:** `src/renderer/src/components/ChatCommand/SlashCommandPopup.tsx:56-99`(已读)

```typescript
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') { /* cycle */ return true; }
  if (e.key === 'Enter') { onSelect(selectedValue); return true; }
  return false;
}, [selectedValue]);
// 通过 useImperativeHandle 暴露给 ChatArea.tsx
```

**Phase 7 5-line sniff 与此并不同路径:** Phase 5 是 popup 内的 keyboard nav,Phase 7 是 handleSend 内的"是否走 dispatcher"判定。

### 12.3 sonner toast 模式

**Source:** sonner 2.0.7 官方文档 (https://sonner.emilkowal.ski/)

```typescript
import { toast } from 'sonner';
toast.info('[system] 正在执行 /goal…', {
  description: 'session=abc12345 goal=write tests',
  duration: 2000,
});
```

**Phase 7 用法:** D-01 + D-07 + D-10/D-11 三个 placeholder 都用 `toast.info` + 1-5 行 description,duration 2-4 秒。

### 12.4 IPC handler 模式

**Source:** Phase 6 既有 handlers(`src/main/ipc-handlers.ts:785-812` 已读)

```typescript
ipcMain.handle('commands:list', async (_evt, projectId: string, agentId: string) => {
  try {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      return { commands: [], conflicts: [], warnings: [] };
    }
    return await collectAllCommands(project.path, agentId);
  } catch (err) {
    console.error('[commands:list] failed:', err);
    return { commands: [], conflicts: [], warnings: [] };
  }
});
```

**Phase 7 `context:currentSession` 沿用相同 pattern** — try-catch 包全部,失败返回 0 值。

### 12.5 vitest mock pattern (Phase 6 dispatcher.test.ts 已用)

**Source:** `src/renderer/src/lib/commands/dispatcher.test.ts:3-15` (已读)

```typescript
const mockSendMessage = vi.fn();
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));
// ...
mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
```

**Phase 7 复用** — 在 `dispatcher.test.ts` 加 mock `electronAPI.context.currentSession`。

---

## 13. State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dispatcher.ts:91-101` 的 3 个 placeholder `console.log` | 真实 toast + sessionGoals/IPC/planOnly 链路 | Phase 7 (2026-06-04) | D-01..D-13 全部实现 |
| `runtime.ts:43-46` 本地 `RuntimeModelOverrides` | `import type { ChatRuntimeOverrides }` | Phase 7 (gap 2 修复) | `planOnly` 端到端透传 |
| `runtime.ts:55-59` hardcoded `DEFAULT_INTERRUPT_ON` | `isPlanMode ? false : { ... }` | Phase 7 (gap 3 修复) | D-13 真正成立 |
| `llm.ts:40-43` 本地 `overrides` type | `import ChatRuntimeOverrides` | Phase 7 (gap 1 修复) | IPC 端不丢字段 |
| `ChatArea.handleSend` 无 slash 嗅探 | 5-line sniff 在前 5 行 | Phase 7 (D-14) | 命令在消息开头被识别 |
| `useSessionStore` 无 `sessionGoals` 字段 | `sessionGoals: Map<string, string>` | Phase 7 (D-02) | `/goal` 数据落地 |
| 无 `context:currentSession` IPC | 新通道 | Phase 7 (D-08) | `/context` 数据源 |
| `llm-adapter.test.ts` 9 个 it 块 | 9 + 3 SLASH-REGRESSION = 12 | Phase 7 (D-17) | 6-hunk patch 护栏 |

**Deprecated/outdated:**
- D-12 假设"Phase 6 dispatcher 已经实现 planOnly 透传":实际是 Phase 6 写了 `await sendMessage(projectId, plan.args, { planOnly: true })` 这一行,但 `ChatPayload.overrides` 没声明 planOnly → **实际是部分实现,需要 Phase 7 补完类型链路**。

---

## 14. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `sonner@2.0.7` 的 `toast.info` API 与文档一致(description + duration 选项) | §3, §5.4 | 如果 sonner 2.x API 改了,placeholder 气泡代码需调整(可降级为 alert) |
| A2 | `better-sqlite3` 的 `SELECT SUM(LENGTH(...))` 性能可接受(单 session 通常 < 1000 条 messages) | §5.1 | 如果 messages 表很大,需要加索引或 `LIMIT` |
| A3 | `loadMcpTools(agentId, mcpServers)` 的返回结构含 `tool.schema` 或 `tool.inputSchema` 字段(JSON) | §5.1 | 如果 MCP tool schema 结构不同,需要查 `mcp-connector.ts:129` 实际返回类型 |
| A4 | deepagents 的 `createDeepAgent` 接受 `interruptOn: false`(= 无 interrupt) | §6.3 | 如果 false 不是合法值,需要 `interruptOn: { write_file: false, edit_file: false }`(显式拒绝) |
| A5 | deepagents `tools` 数组中移除 `bash` 后,LLM 看不到这个 tool,自然不会调用 | §6.3 | 如果 deepagents 内置 bash(不依赖我们的 tools 数组),需要额外的 filter 逻辑 |
| A6 | `selectionStart === 0` 在 jsdom 中可以测试(用 `fireEvent.change` 带 `target: { value, selectionStart: 0 }`) | §8.3 | 如果 jsdom 不支持 selectionStart 注入,需要 TestHarness 扩展 |
| A7 | `dispatcher.resolve('/  foo', commands)` 返回 null(因为 `/  foo` 不匹配 `/goal` + ' ' 等),即 D-15 case 3 的实际行为 | §8.2 | 如果 dispatcher.resolve 把 `/  foo` 错误地匹配到某个 command(比如 fuzzy 匹配),3 个 it 块的预期需要调整 |
| A8 | `existing test files (.test.ts/.test.tsx)` 用 vitest 3.0+ + jsdom + node,可以 `vi.mock` IPC + zustand | §9 | 如果有版本冲突,需要重写部分 mock |
| A9 | Anthropic SDK 的 `messages.stream` 返回的 v3 events 形态与 `anthropic-roundtrip.test.ts:130-180` 的 `v3Events()` generator 一致 | §7.2 | 如果 v3 events 形态有变,SLASH-REGRESSION it 7.1 需要更新 mock |
| A10 | `useSessionStore.sessionGoals` 不需要进 `streamingSessionsCache`(D-04 跨 session 保留,但不参与消息流) | §4.1 | 如果有 plan 把 sessionGoals 缓存了,selectSession 切换会丢数据 |

---

## 15. Open Questions / Claude's Discretion (C-01..C-08)

| # | Question | Recommendation |
|---|----------|----------------|
| C-01 | 3 个气泡的颜色 / 图标 / 排版 | 用 `toast.info` 系统提示替代,description 用 monospace 排版;Phase 8 polish 再换 MessageItem 风格 |
| C-02 | `/goal X` 的 X trim 行为 | `args.trim()` — 头尾空白去掉,中间保留(`/goal   write tests` → `write tests`) |
| C-03 | `/plan` 描述是否截断 | 不截断,toast description 直接显示;LLM 端在 message_chunk 中也能看到完整描述 |
| C-04 | 气泡消失时机 | toast 的 `duration` 控制(goal 2s / context 4s / plan 3s);LLM 输出后 message_chunk 接管,toast 自动被覆盖(不冲突) |
| C-05 | sessionGoals 跨 session 保留 | sessionStore 字段持久保留,渲染时按 `state.activeSessionId` 过滤(但 Phase 7 不实现"显示历史 goal" UI,仅 store 写 + 不读) |
| C-06 | 5-line sniff 精确位置 | handleSend 函数体内 `if (e) e.preventDefault();` 之后立即插入(第 2-3 行),不 import 新 helper |
| C-07 | IPC 签名 | `(sessionId: string) => Promise<{ breakdown: { conversation, skills, mcp, workflows }, total }>` |
| C-08 | Token 估算精度 | `String.length * 0.25` 粗估;CJK 字符在 `String.length` 中算 1 个 code unit,实际可能是 2 个(surrogate pair),所以 CJK 比例略低 — 可接受 |

---

## 16. Environment Availability

> Phase 7 无新增外部依赖,但依赖现有工具链可正常工作。

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `vitest` | 全部测试 | ✓ | 3.x | — |
| `jsdom` (vitest environment) | renderer 测试 | ✓ | 已配置在 `vitest.config.ts:6` | — |
| `better-sqlite3` | `/context` SQL 聚合 | ✓ | 12.10.0 | — |
| `sonner` | 3 个 placeholder 气泡 | ✓ | 2.0.7 | — |
| `@langchain/anthropic@1.4.0` | M3 thinking 链路 | ✓ | 1.4.0 (with 6-hunk patch) | — |
| `patch-package` (postinstall) | 6-hunk patch 持续应用 | ✓ | 已配置在 `package.json:13` | — |
| `chokidar@3.6.0` | `.cdf/commands/*.md` 监听(Phase 6) | ✓ | 3.6.0 | — |

**Missing dependencies with no fallback:** 无
**Missing dependencies with fallback:** 无

**External API calls (M3 / Anthropic):** SLASH-REGRESSION 测试**不**发网络请求,完全用 `anthropic-roundtrip.test.ts:130-180` 模式的 v3 events generator mock。**CI 友好**。

---

## 17. Security Domain

> Phase 7 security 影响面:1 个新 IPC 通道 + 1 个新 store 字段 + 1 个新 runtime flag。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 7 不涉及用户认证 |
| V3 Session Management | **partial** | `sessionGoals` Map 是 per-session,phase 7 仅 in-memory;若 v1.2 迁 SQLite,需要 session_id 校验防越权访问其他 session 的 goal |
| V4 Access Control | no | `context:currentSession` IPC handler 不接受其他 user input,只读当前 sessionId 关联的 messages / workflows,renderer 端传错的 sessionId 不会暴露其他 session 数据(因为 sessionId 是主键外键) |
| V5 Input Validation | **yes** | `context:currentSession` 接受 `sessionId: string` — 必须 type-check string + 长度上限(避免 DoS via 巨大 string),建议 `if (typeof sessionId !== 'string' || sessionId.length > 64) return null` |
| V6 Cryptography | no | 不涉及加密;goal 是普通 text 存内存 |
| V8 Data Protection | no | 不持久化 |

### Known Threat Patterns for Phase 7

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer 传恶意 sessionId 给 `context:currentSession` 查其他 session 数据 | Information Disclosure | `sessionId` 应该是 UUID v4(项目已经用 `window.crypto.randomUUID()`),主键查询不会跨 session;但需要在 IPC handler 加 `typeof sessionId === 'string' && sessionId.length <= 64` 防御 |
| `/goal` X 含 HTML/JS 字符串 → toast.description 渲染为 HTML | XSS | sonner 2.x 默认对 description 做文本转义(不是 HTML 渲染)— 验证:Phase 6 已有 `toast.info` 用法,默认行为是文本 |
| `/plan` 在 M3 端被劫持为正常 LLM 流 → 突破 plan 模式 | Tampering | runtime.ts 的 `isPlanMode` 阻断必须 100% 可靠(§6.3);SLASH-REGRESSION it 7.2 验证工具屏蔽 |
| `sessionGoals` Map 在内存中无限增长 | Denial of Service | 实际不会有问题(每个 session 只有 1 个 goal,Map size = active sessions count);Phase 8 polish 可加 LRU eviction |

### Output Format Risks

- `toast.info` description 内的换行(`\n`)在 sonner 中会显示为多行,**不**是 HTML — 验证:Phase 6 `chokidar-watcher.test.ts` 已有 toast 模式
- `/context` breakdown 的数字字段已 type-checked 为 number(`Math.ceil(chars * 0.25)` 返回 number),toast 模板插值是文本,XSS 不可达

---

## Sources

### Primary (HIGH confidence)

- **`.planning/phases/07-system-commands-m3-regression-test/07-CONTEXT.md`** — Locked decisions D-01..D-19, Claude's discretion C-01..C-08
- **`.planning/REQUIREMENTS.md`** — SLASH-05, SLASH-06, SLASH-07, SLASH-REGRESSION definitions
- **`.planning/phases/06-4-source-command-registry-dispatcher/06-02-SUMMARY.md`** — Phase 6 dispatcher architecture + 139 tests baseline
- **`.planning/research/PITFALLS.md`** — PITFALLS P2 (M3 thinking), P5 (5-line sniff), P7 (args injection)
- **`src/main/llm.ts:32-44, 306-325`** — ChatPayload type + runLLMChat signature
- **`src/main/deepagent/runtime.ts:43-46, 453-488`** — RuntimeModelOverrides + createDeepAgentRuntime
- **`src/renderer/src/lib/commands/dispatcher.ts:79-115`** — 4-kind dispatch + SystemSilent/SystemLocal/PlanMode placeholders
- **`src/renderer/src/stores/sessionStore.ts:14-96`** — estimateTokens + SessionState (缺 sessionGoals 字段)
- **`src/renderer/src/components/ChatArea/ChatArea.tsx:141-160, 617-628, 665-684, 1040-1060`** — inputVal state, handleSend, useCommandRegistry, textarea
- **`src/main/ipc-handlers.ts:785-812`** — commands:list + commands:readProjectCommands pattern (Phase 6)
- **`src/preload/index.ts:104-117`** — commands bridge pattern
- **`src/shared/types.ts:189-195, 456-465`** — ChatRuntimeOverrides + ElectronAPI.llm/db/workflows
- **`src/main/database.ts:30-72, 402-447`** — messages + workflows tables schema
- **`patches/@langchain+anthropic+1.4.0.patch`** (80 lines) — 6 hunks analysis
- **`src/main/deepagent/anthropic-roundtrip.test.ts:130-180`** — v3Events() generator pattern
- **`package.json:13`** — `postinstall: "electron-builder install-app-deps && patch-package"`
- **`vitest.config.ts:1-17`** — jsdom + @ alias

### Secondary (MEDIUM confidence)

- `src/main/deepagent/skill-manager.ts:80-104` — `listPhysicalSkills(projectPath)` returns `PhysicalSkillView[]` with `name` + `scope`
- `src/main/deepagent/mcp-connector.ts:129-155` — `loadMcpTools(agentId, servers)` returns `{ client, tools: StructuredToolInterface[] }`
- `src/renderer/src/lib/commands/system-commands.ts:1-50` — SYSTEM_COMMANDS 3 hardcoded (name + source + target)
- `src/main/deepagent/llm-adapter.test.ts:1-159` — existing 9 it blocks (model creation + thinking field)
- `src/main/llm.test.ts:1-963` — existing 11+ it blocks (runLLMChat + stream handling)
- `src/renderer/src/lib/commands/dispatcher.test.ts:1-300+` — existing 14 dispatcher tests (resolve + dispatch)

### Tertiary (LOW confidence)

- A1-A10 in §14 Assumptions Log — flagged for validation during execution
- sonner 2.0.7 toast API (description + duration + info level) — based on Phase 6 prior usage + web docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no new packages, all existing versions verified
- Architecture: **HIGH** — 3 integration gaps identified with specific file:line references + fix designs
- Pitfalls: **HIGH** — 7 Phase 7-specific pitfalls mapped to existing PITFALLS P2/P5/P7
- Test design: **HIGH** — 3 SLASH-REGRESSION it blocks with mock patterns verified against anthropic-roundtrip.test.ts
- Validation: **HIGH** — Wave 0 gaps enumerated + per-requirement test commands specified
- Security: **MEDIUM** — basic V5 input validation noted; XSS risks mitigated by sonner default

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (30 days; v1.1 milestone completion ~30 days)

---

## 18. Planner Summary

**Phase 7 实施工作量(估算):**

| 区域 | 文件 | 行数(估) | 难度 |
|------|------|----------|------|
| §4 /goal | sessionStore.ts + dispatcher.ts | ~25 | LOW |
| §5 /context | ipc-handlers.ts + preload + types | ~80 | MEDIUM(4 SQL 聚合) |
| §6 /plan | llm.ts + runtime.ts + dispatcher.ts | ~50 | MEDIUM(关键集成缺口修复) |
| §7 SLASH-REGRESSION | llm-adapter.test.ts + runtime.test.ts + llm.test.ts | ~150 | MEDIUM(mock Anthropic SDK) |
| §8 5-line sniff | ChatArea.tsx + new test file | ~60 | LOW |
| 共享测试 | dispatcher.test.ts + sessionStore.test.ts 扩展 | ~80 | LOW |
| **总估算** | | **~445 行** | **8-10 个 task** |

**推荐 PLAN.md 拆分:**
- **Plan 07-01:** System commands 真实实现(Wave A + Wave B) — dispatcher 3 case + sessionGoals + IPC + runtime planOnly
- **Plan 07-02:** 5-line sniff + SLASH-REGRESSION it 块(Wave C) — ChatArea 改造 + 3 it 块
- **Plan 07-03 (可选):** 共享测试扩展(dispatcher.test.ts + sessionStore.test.ts)

**关键决策点(planner 需要用户确认):**
- A4 (deepagents `interruptOn: false` 合法性) — 如果 false 不接受,需 `interruptOn: { write_file: false, edit_file: false }`
- A7 (D-15 case 3 实际行为) — `/  foo` 是否走 dispatcher 调用但 resolve 返回 null — 测试预期需澄清
- SLASH-REGRESSION it 7.2 位置 (`runtime.test.ts` vs `llm-adapter.test.ts`) — D-16 锁定 `llm-adapter.test.ts`,但工程上更适合 `runtime.test.ts`

**Ready for planning.**

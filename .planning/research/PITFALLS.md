# Pitfalls Research: v1.1 `/` Command System for CDF

**Domain:** Adding `/` command popup to existing Electron + React chat with 3-source plugin auto-registration
**Researched:** 2026-06-04
**Confidence:** MEDIUM — real product bugs cited from Claude Code + assistant-ui source verified in node_modules; v3 streamEvents coverage LOW (LangGraph docs scattered)
**Target audience:** Roadmap phase design for v1.1 SLASH-01 ~ SLASH-13

---

## Critical Pitfalls

### Pitfall 1: `assistant-ui` `useSlashCommandAdapter` 是 `@deprecated` + API 不稳 — 不要直接 hook 进项目

**What goes wrong:**
- `@assistant-ui/react@0.14.5` 暴露的 `unstable_useSlashCommandAdapter` 在 JSDoc 写明 `@deprecated Under active development and may change without notice.`
- 配套的 `ComposerTriggerPopover` 在源码里实际叫 `ComposerPrimitive.TriggerPopover`（`char` + `adapter` + 必须嵌入 `Unstable_TriggerPopoverRoot`，并强制只能挂 `<TriggerPopover.Directive>` 或 `<TriggerPopover.Action>` 二选一）。JSDoc 例子里的写法与实际 API 表面有出入。
- 上游 `assistant-ui/assistant-ui#3823` 「feat: redesign slash commands API」被 **abandoned**，后续 PR (#3767, #3834) 才把 mention/slash 统一到 TriggerPopover 概念。意味着 0.14.x 期间的 API 仍可能再变。
- **致命点**：CDF 当前 `ChatArea.tsx` 完全没引 `assistant-ui` 的 ComposerPrimitive —— 用的就是裸 `<textarea>`。强行套 trigger popover 要么重写整个 composer，要么在原生 textarea 上另搭一套 popup，付出远大于收益。

**Why it happens:**
- PROJECT.md 把 assistant-ui 描述为「chat framework」，但实际只用了依赖里存在但未渲染的 primitives。
- 选型时未与项目实际 composer 实现核对。

**Consequences:**
- 把 composer 改成 assistant-ui primitives → 大改 2 个 textarea + 配套 IME / send 逻辑 → 引入黑屏 / 输入抖动回归。
- 不改 composer 但仍调 `unstable_useSlashCommandAdapter` → 它要求在 `<ComposerInput>` 内注册 `<ComposerPrimitive.Unstable_TriggerPopover>`，否则会抛 `useTriggerPopoverScopeContext must be used within ComposerPrimitive.TriggerPopover`。
- 下次升级 `@assistant-ui/react` → 适配代码 + 命令注册代码双双重写。

**How to avoid:**
- **不要碰 assistant-ui 的 slash 适配层**。在现有 `inputVal` state 之上**自建 popup 层**（类似 `useState` + `<div>` 浮层 + keydown 路由）。项目 12,950 LOC 的自有 composer 已经稳定，自建 popup 比强行替换低 10× 风险。
- 任何想把 assistant-ui 拉进来的设计，必须先在 spike 里跑通：保留 `handleKeyDown` 中 IME（`isComposingRef` + 200ms `justFinishedComposingRef`）+ Shift+Enter 换行 + Esc 取消 + ↑↓ 选择 + Enter 执行 这六条主路径。

**Warning signs:**
- 设计里出现 `<ComposerPrimitive.Unstable_TriggerPopover>`、`useSlashCommandAdapter`、`@assistant-ui/react` composer 类组件。
- 计划将现有 `<textarea>` 替换为 `<ComposerInput>`。

**Phase to address:** 必须在 SLASH-01/02 phase 早期 spike 中以 PoC 验证"裸 textarea + 自建 popup"可行性；如果误选 assistant-ui 适配，**整 phase 全部推倒**。

---

### Pitfall 2: v3 streamEvents + M3 thinking 是 fragile patch — 任何 `sendMessage` 路径改动都要回放 reasoning

**What goes wrong:**
- `src/main/llm.ts:338` 的 `runtime.agent.streamEvents(nextInput, { version: 'v3', ... })` 走的是 deepagents 的 LangGraph 流。`msg.reasoning` 在 v3 下类型为「不是 null/undefined/空数组」才会触发 think 块包裹逻辑（`hasReasoningSource = msg.reasoning != null && !Array.isArray(msg.reasoning)`，见 llm.ts:412）。
- **最近 5 个 quick task 都在修 thinking**：
  - `260603-s29` M3 thinking 开关
  - `260603-se4` thinking + temperature 互斥
  - `260603-soe/tiy` M3 reasoning roundtrip patch（v1 路径 OK，fallthrough `type === "reasoning"` 被 silently dropped）
  - `260603-u6w` v1 路径 isAnthropicMessage 守卫（`response_metadata.model_provider === "anthropic"` 守卫在 deepagents checkpoint 一圈后失效）
  - `260603-vht` video patch `.cjs` parity
- 这意味着 reasoning block 的 serialize / re-emit 链路在 patch-package 层被反复调过；任何「构造 message 时塞入 reasoning 签名」的新代码都可能撞到同一种 `silently dropped` 失败模式。
- **v1.1 风险场景**：把 `/plan` 切到 "只规划不执行" 模式时，常见的实现是发一条 "user instruction" + 切 agent loop flag。这条 user message 不能携带上一轮 reasoning 签名（必须新生成）；而 agent 第一轮 reasoning 是否出来，取决于 `model` 是否启用了 thinking，以及 `modelConfig` 是否有 `temperature/top_p/top_k`（se4 修复点）。**任何 `/plan` 的实现如果显式给 LLM 注入 temperature，会立即触发 se4 回归**。

**Why it happens:**
- v3 streamEvents 的 reasoning 流是「按 token 异步 emit 字符串 + 一次性 think 包裹」而不是结构化 block。
- Anthropic extended thinking 协议对 request 形态有硬约束（不能同时设 temperature 和 thinking）。
- 团队靠 patch-package 把 M3 推理 roundtrip 补齐，patch 层级（6 hunks）比代码层级更容易被遗忘。

**How to avoid:**
- **`/plan` 不发 LLM 调用**：在 `sessionStore.sendMessage` 的 client 端拦截 `/plan` → 切 flag → 改 `nextInput` 里的 system message + 把 message 流标记为 `plan-mode`，等首轮响应结束后再走正常的 thinking 流。这样 patch-package 不需要支持新代码路径。
- **不要在 `sendMessage` 内部重新构造 `HumanMessage`**：直接走当前 `messages` 路径，把 `/plan description` 解析后透传成 "treat as plan only" 的 system 注入。`llm-adapter.ts` 已经有 `modelConfig` 清理逻辑，复用即可。
- 新增 slash command 路径前，先在 `runtime.test.ts` / `llm.test.ts` 加 1 个 it 块覆盖 "slash command 路径下 reasoning 仍 emit"，避免 patch 重做时没回归测试。

**Warning signs:**
- `sendMessage` 流程里出现 `new HumanMessage({ content: [...] })` 字面构造。
- 在 slash command 处理逻辑里 import `modelConfig` / `temperature`。
- `runtime.test.ts` 跑过但没覆盖 "slash command 触发后第一次 chunk 是否含 `<think>`"。

**Phase to address:** SLASH-04（命令分发层）和 SLASH-07（`/plan`）必须包含一个 it 块：「发完 `/plan x` 后首条 message_chunk 含 `<think>` 标签」。在 quick task 260603-u6w 的测试基础上扩展，不重写。

---

### Pitfall 3: 命名空间冲突静默覆盖 — 4 源插件全注册时必然撞名

**What goes wrong:**
- v1.1 一次引入 4 个插件源（系统 / MCP / Skills / Workflows / `.claude/commands/*.md`），每个源都用「去掉前缀的裸名」当 command id。
- **真实案例**（anthropics/claude-code GitHub issues）：
  - **#61857** "Custom user command silently shadows built-in alias with no warning at creation or invocation time" — built-in `/release-notes` 被 plugin skill 静默替代，调用时无任何提示。
  - **#62409** "Slash command name collision: plugin skill shadows built-in /release-notes"。
  - **#64422** "LSP plugin extension conflict resolves silently — losing plugin appears enabled but server never spawns"。
  - **#64669** "All official plugin slash commands unavailable" — `plugin.json` 缺 `commands`/`skills` 字段时，**整个插件的命令全消失**且无错误。
- 撞名场景在 CDF 必然出现：
  - Skill 叫 `run`，同时 system 命令有 `/run`（Claude Code 里有），同时 `.claude/commands/run.md` 是常用命名。
  - Workflow 叫 `plan`，system 命令有 `/plan`。
  - MCP tool 名 `arxiv_search` 几乎一定与某个 project-level custom command `arxiv` 撞名。

**How to avoid:**
- **注册期显式检测 + 来源标签**（PROJECT.md SLASH-12 已意识到这一点，但没写「冲突时谁赢」的策略）。建议优先级：**系统 > Skills > Workflows > MCP > `.claude/commands/`**，且**不允许同名覆盖**——遇到冲突就在 registry 构建阶段抛 `CommandConflictError`，UI 弹一个非阻塞的 toast（"插件 X 的命令 Y 与系统命令冲突，未注册"）。
- **来源标签**作为 fallback 提示，而不是「重新命名」。Claude Code 的做法是在 popup 列表项右侧加 [skill] / [workflow] 标记，保留原名。
- **缺字段防御**：MCP server 启动时如果 `tools` 是空（对应 #64669 的 plugin.json 缺失），**不要静默启动**——send 一条 `mcp_health_warning` 给渲染层，开发者面板可见。
- **运行时再次检测**：会话启动时拉一次 + MCP `tools/list` 变更时再拉一次 + `chokidar` 监听 `.claude/commands/*.md` 变化。**不要相信任何 manifest 一次就够**。

**Warning signs:**
- 注册逻辑里出现 "if (exists) skip" 而不是 "throw"。
- 命令列表只显示 id，不带 source 标签。
- `plugin.json` 解析失败被 catch 后只 `console.warn`。

**Phase to address:** SLASH-03（命令注册表）必须包含冲突检测单元测试；SLASH-13（注册时机）必须包含 MCP 动态监听 + chokidar 监听 `.claude/commands/`，**不能只在 session 启动时拉一次**。

---

### Pitfall 4: popup 位置 = bottom-anchored 但消息流是 top-anchored — 滚动状态会骗用户

**What goes wrong:**
- CDF 的 composer 固定在底部（`ChatArea.tsx:991` "absolute bottom-0"），消息流 absolute inset-0 + overflow-y-auto。`/plan` 触发后 30 秒以上的长任务期间，消息流会持续滚动，但 composer 不动。
- Claude Code 真实案例：
  - **#65099** "Stop hook keeps blocking turn termination after the goal is cancelled" — `/goal` 触发的状态挂在 agent 而非 UI，用户看到 popup 消失以为结束，其实 hook 仍在跑。
  - **#58677** "/goal evaluator fires during background-shell wait windows" — popup 与执行状态脱钩。
- 同样地，CDF popup 关闭（用户按 Enter）后，slash command 实际进入的是：
  - 系统命令 `/plan` / `/goal` / `/context` → renderer 静默执行（无 LLM 流）→ 用户看不到任何反馈，**如果 2 秒内没结果，UX 是「按了没反应」**。
  - 插件命令 → 走 `sendMessage` → 进入 LLM 流 → 出现 typing indicator → OK。
- **「本地静默 vs 注入 LLM」的差异化反馈**是 popup 关闭后第一秒最容易出问题的环节。

**How to avoid:**
- popup 关闭 + 系统命令触发时，**强制在消息流里塞一条 `[system] 正在执行 /plan...` 占位消息**，命令结束后再更新为结果。这条消息不是 LLM chunk（不走 thinking 流），是 renderer 本地消息，避免和 stream events v3 撞车。
- 插件命令触发时，**不要**塞占位（让 typing indicator 接管）。
- popup 浮层 z-index 必须高于 todo list + 任务展板（`z-10` 不够，建议 `z-50`）。Claude Code 实际 bug #65014 "Autocomplete selection resets when navigating" 部分原因就是 popup 容器被外层 re-render 顶掉。

**Warning signs:**
- popup 关闭后无任何视觉反馈。
- 系统命令与插件命令走同一条 `sendMessage` 路径。
- popup z-index < 10。

**Phase to address:** SLASH-04（命令分发层）必须区分 "本地静默 / Master Agent 注入 / IPC" 三类出口；SLASH-01（popup 组件）z-index 与动画规范在 PoC 阶段就锁定。

---

### Pitfall 5: Slash command 仅在消息开头识别 — 但 textarea 不知道 "开头" 是哪里

**What goes wrong:**
- PROJECT.md 明确说"命令仅在消息开头识别"（参考 Claude Code 的 `/clear` 设计）。但 textarea 是一个连续字符串，光标在中间时按 Enter 会把 `/goal` 当成普通文字发给 LLM。
- **场景**：用户在 chat 中输入了 `帮我 /goal 设置一下 X` —— 期望是执行 /goal，但 textarea 的开头是「帮我」，不是 `/`。
- Claude Code 的处理：command 字符必须在光标所在「行」的开头（不是整个 message 的开头），且光标之后到下一个空格之前是 command id 区域。
- **CDF 现状**：`handleKeyDown` 只看 Enter + IME + Shift，不区分 command vs 普通文字。按 Enter 后 `sendMessage` 把整段 `帮我 /goal 设置一下 X` 发出去，LLM 看到的是普通中文 prompt。

**How to avoid:**
- **检测规则**：在 `handleSend` 触发前，先 `slice(0, textarea.selectionStart)` 拿到光标前的文本；只有当它匹配 `^/$|^/[a-z]+$/`（即 `光标前最后一个 token 是一个完整 command 形式`）时才走 command 分发路径。
- 折中：模仿 Claude Code 简化版——`textarea.value.trim().startsWith('/')` 且 command 后是空格分隔的参数。这是 PROJECT.md 暗示的设计。
- **必须在 IME 合成结束后再做判断**：当前 `justFinishedComposingRef` 已经处理了合成态，但要确认合成时按 Enter 不会误触发 command。

**Warning signs:**
- `handleSend` 直接 `await sendMessage(value)`，没有 command 嗅探。
- popup 只看 textarea 值，不看光标位置。

**Phase to address:** SLASH-04（分发层）。在 `sessionStore.sendMessage` 调用前的 `ChatArea.handleSend` 加 5 行嗅探逻辑即可，但必须写单测覆盖"中间含 `/xxx`"、"光标不在开头"、"光标在 command 中间"三种 case。

---

### Pitfall 6: 真实键盘 / 字符缺陷 — 5 个公开 bug 都有 CDF 复现路径

**What goes wrong（每个都有 Claude Code 真实 issue）**：

| Bug | Claude Code issue | CDF 复现路径 |
|-----|-------------------|------------|
| **`.` 在 query 里把整个菜单打空** | #65047 | 用户输 `/goal.test` 或带 `.` 的 MCP tool 名 → popup 全空。 |
| **CJK 命令名不可见** | #64941 | Skill 名是中文（如 `/代码审查`）→ popup 永远空。 |
| **选区跳回首项** | #65014 | 按 ↓ 时，selected index 总重置为 0。 |
| **`//` 过滤被破坏** | #65050 | 当用户输 `//` 想过滤"以 `/` 开头的 skill"时崩。 |
| **skill 描述被截断，路由失败** | #64606（closed not planned） | Skill description 写超长 → 静默截断 → popup 仍显示但 invocation 时找不到。 |

**Why it happens（通用根因）**：
- **过滤是 substring 而非 fuzzy**——但 query 解析时某些字符被当 token 边界误删（如 `.`）。
- **CJK 字串的 `toLowerCase()` 在 JS 里安全但 `includes()` 大小写不敏感在某些 V8 版本上对 surrogate pair 处理不同**——issue 描述是 macOS 回归，说明很可能是字符串规范化（`String.prototype.normalize("NFKC")`）缺失。
- **React 受控组件 + 列表 re-render** 顺序：每次 keystroke 都重建 filtered 数组，selected index 引用旧的 list 但 list key 重置。
- **description 截断无 warning**：popup 列表里 description 永远显示完整，但底层 skill 注册时已被截。

**How to avoid:**
- **过滤实现**：用 `cmd.id.toLowerCase().includes(lower)` + `cmd.label?.toLowerCase().includes(lower)` + `cmd.description?.toLowerCase().includes(lower)` 三个 OR（与 assistant-ui 的 `matchesQuery` 一致，见 `useSlashCommandAdapter.js:63-72`）。**不要写 fuzzy**——复杂度高、对 slash command 场景收益小。
- **CJK 支持**：在 filter 前对 query 和 cmd.id 双方都 `normalize("NFKC")`。
- **`.` 不当 token 边界**：直接用 `String#includes`，不做 split。
- **selected index 必须基于当前 filtered list 长度取模**，不能用绝对 index，否则 list 变化时跳。
- **description 长度限制**：popup 显示截断到 ~60 字符，但底层注册时**不截**——以避免 Claude Code #64606 那种"显示有但调用无"的鬼影。
- **`//` 不特殊处理**：当作普通字符串。如果想支持「以 `/` 开头的 skill」就用 `/` 单字符触发并允许 query 为空时显示全部 + query 含 `/` 时按 substring 匹配即可。

**Warning signs:**
- filter 函数里有 `query.split('.')` / `query.split('/')`。
- 没用 `String.prototype.normalize`。
- selected index 用 `setState(prev => prev + 1)` 而非 `(prev + 1) % list.length`。
- description 在 `savePhysicalSkill` 入口被 `.slice(0, 100)`。

**Phase to address:** SLASH-01/02 popup 组件 PoC 必须把这 5 个 case 写成单测（即使将来删也要在 commit history 留 5 个 it 块作为契约）。

---

### Pitfall 7: MCP 工具自动注册 = 任意代码执行表面

**What goes wrong:**
- SLASH-08 要求把 MCP tool 名字直接作为 command 注册。`src/main/deepagent/bash-tool.ts:39-76` 的 `executeCommand` 直接用 `execAsync(command, { ... })`，参数拼成字符串执行。**MCP tool 的 args 如果有任何字符串字段被用户输到 textarea 再透传给 bash，会被 shell 解析**。
- 即使 bash 工具本身在 deepagents 里有审批机制，**slash command 路径下的 args 也走 LLM 工具调用约定**——这意味着 `/${mcp_tool_name} foo; rm -rf /` 这种伪 command 不会执行（因为 mcp 工具不是 shell），但 `${mcp_tool_name}` 的 args **会作为 tool args 进入 deepagents 工具调用层**。
- **真实案例**：
  - #62072 "MCP tools bind silently dropped" — `--mcp-config` 静默丢 → 表面上没工具可用，但**用户没感知**。
  - #62091 "Agent deleted user's main project repo via gh repo fork --fork-name rename behavior" — 命令行参数被错误地转写到 gh fork，导致项目被重命名/删除。
  - #64539 "Harness-injected control text and tool-result content share one untagged channel" — 工具返回里如果有 `</system>` 之类的字符串，会被 LLM 误读为指令。

**How to avoid:**
- **command args 严格 schema 化**：MCP tool 暴露的参数 schema（来自 `tools/list` 的 `inputSchema`）必须在 popup 里**渲染为结构化表单**（input / select / checkbox），而不是把整段 `foo bar baz` 空格分隔透传。这同时避免命令注入 + 提升 UX。
- **参数值不做 shell 拼接**：bash-tool 的 `executeCommand` 应该是 `argv` 数组而不是拼接字符串。如果改不了，至少在 slash command → bash 工具的入口加白名单（只允许 `git status` 这类预登记安全命令）。
- **MCP 工具 args 走 deepagents 的 tool_use 而不是直接调 MCP**——这样 deepagents 自己的审批 + schema 校验会自动套上。
- **tool_result 渲染转义**：renderer 收到 `tool_result` 文本后必须用 `MarkdownRenderer` 的转义路径，不要 raw HTML（这是 MessageItem.tsx 已经在做的事，但要确认 ToolMessageCard 没绕开）。

**Warning signs:**
- slash command → MCP tool 调用走的是「手动 spawn child_process」而不是 deepagents tool_use。
- popup 显示 args 是单个 textarea。
- args 字符串里含 `;` `&&` `|` `$(` 没被 strip。

**Phase to address:** SLASH-08（MCP 注册）+ SLASH-04（分发层）。强烈建议在 v1.1 不实现 args 解析，**v1.1 仅注册 `/${mcp_tool_name}` 不带 args**，v1.2 再加 schema 表单（已 Out of Scope 中）。否则 args 注入是真实风险。

---

## Moderate Pitfalls

### Pitfall 8: Skill 描述截断 + 路由失败（#64606 闭环）

- 原因：popup 显示的 description 和 invocation 时的 description 是同一个源，但底层 deepagents 的 skill description 在 `savePhysicalSkill` 入口可能被截。
- 预防：description 在 popup 渲染前**只截显示，不截存储**；且 description 长度上限设为 200 字符（而不是 Claude Code 的默认 ~1024）以便 popup 单行展示。

### Pitfall 9: `unstable_useMentionAdapter` 与 slash 冲突

- assistant-ui 的 mention `@` 触发与 slash `/` 触发是同一个 `TriggerPopoverRoot` 下的两个 char。**如果在 v1.1 之后想加 `@file` 引用文件，popover 根只有一个，会撞**。
- 预防：v1.1 阶段**不要碰 `TriggerPopoverRoot` 概念**，继续用裸 textarea + 自建浮层。如果以后要加 mention，**重写整套浮层**而不是基于现有 slash 浮层扩展。

### Pitfall 10: chokidar / fs.watch 监听 `.claude/commands/*.md` 在 Electron 下行为不一致

- macOS: `fs.watch` 对编辑器（VSCode 原子写）不友好，需要 `chokidar` + `awaitWriteFinish: { stabilityThreshold: 200 }`。
- Windows: 同上 + 路径大小写不敏感。
- 跨平台白名单 + 错误降级（监听失败 → 退化为「只在 session 启动时拉一次」+ toast 提示）。
- 参考 #61866 "Project-scoped plugins not automatically enabled in git worktrees" —— 路径依赖发现是普遍问题。

### Pitfall 11: Workflows 自动注册 — 但 v1.0 实际 0 个 workflow 存在

- PROJECT.md SLASH-10 要求把 workflow 自动注册为 `/${workflow_name}`，但 STATE.md 显示 v1.0 没有真实 workflow 落地（计划 6 个 phase 都跑完了但 workflow 注册是个空表）。
- 风险：注册逻辑写完后没法 e2e 测试 → 写成 zombie code → 第一次真有 workflow 时炸。
- 预防：SLASH-10 phase 必须**先 seed 1 个示例 workflow**（如 `/pr-review` 自动跑一个 3 节点的 demo）作为 contract。

---

## Minor Pitfalls

### Pitfall 12: popup 渲染性能 — 大 plugin 列表 + 每次 keystroke re-render

- 当前规模（MCP 1 + Skills 6 + Workflows 0 + 系统 3 = 10）不会有问题，但 MCP server 一旦有 5+ 个、每个 10+ tool，就是 50+ 行。
- 预防：`useMemo` 包 filter 结果；popup 内部用 `React.memo` 包裹 list item；不为每一项计算 description 截断（提到 filter 之前预算一次）。

### Pitfall 13: IME 合成期按 Enter 误触发 command

- 当前 `justFinishedComposingRef` 200ms 窗口保护了 Enter；但 `/` 在合成期输入（中文输入法打 `/` 选词）会被识别为"光标前是 /"——这通常是 OK 的，但中文输入法按 Enter **上屏**时也会被拦。
- 预防：在 popup trigger 检测里也用 `isComposingRef`（popup 触发逻辑在 `onChange` 里就判断，避开 IME 合成中的 `/`）。

### Pitfall 14: 空 args vs 未指定 args 在 system 命令上行为不一致

- `/goal` 没 args、`/goal` 加 args、`/context` vs `/context all` —— system 命令的「参数语义」要在 v1.1 一开始定。
- 预防：v1.1 system 命令的参数表提前写在 registry 里（`{ name: 'goal', requiredArgs: false, default: 'X' }`），而不是 LLM 自己猜。

### Pitfall 15: popover 在 IME 输入法候选框下层显示

- macOS 输入法候选框 z-index 极高，可能盖过 popup。
- 预防：popup z-index 至少 9999（Claude Code 实测值），但接受中文用户偶尔需要 Esc 一次关掉 popup。

---

## Integration Gotchas (v3 streamEvents 角度)

| 集成点 | 常见错误 | 正确做法 |
|--------|---------|---------|
| `sendMessage` 入口 | 把 user text 直接发 LLM，没嗅探 command | 在 `handleSend` 加 5 行 sniff：`if value.startsWith('/') && value.split(' ')[0] in registry → 走分发` |
| Slash command 注入 LLM | 把 `/goal foo` 原文发出去，LLM 看到的是普通 text | 分发层把 `/goal foo` 转成「系统消息: 进入 goal 模式 + 用户原话: foo」两条 message |
| 系统命令 `/plan` | 走 LLM 一遍再说"这是 plan" | 切 agent 内部 flag（runtime.ts 加 `planMode` 字段），不动 message 流 |
| Workflow 自动注册 | 把 workflow name 当 string 发 LLM | 调用 `createWorkflowTools(projectId, workflowId)`（runtime.ts 已建）走 tool_use |
| 跨平台 chokidar | 跨平台差异忘了处理 | 用 `chokidar` 而非 `fs.watch`，且 catch 失败降级 |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 每次 keystroke 重新构建 commands 数组 | 50+ plugin 时输入卡顿 | `useMemo` 缓存注册结果，仅在 source 变化时重建 | 50+ commands |
| filter 每次创建新数组 | 50+ items × 每次按键 = 大量 GC | `useMemo(() => filter(...), [commands, query])` | 100+ commands |
| popup 浮层动画掉帧 | 命令列表滚动卡 | `will-change: transform` 关闭 + `transform: translateY(0)` 避免 layout | 长 list + 慢 GPU |
| MCP `tools/list` 阻塞 | session 启动慢 | 异步 + 健康检查并行；超时 2s 后 fallback 到空列表 | MCP server 5+ |
| Slash command + LLM 流并发 | 上一条 slash 流未完，下一条 | 复用现有 `isStreaming` gate，`sendMessage` 入口已守 |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| args 用空格分隔直接透传 shell | 命令注入（bash-tool.ts 走 execAsync） | 走 deepagents tool_use，不走 shell；args 用结构化 schema |
| Plugin command 静默覆盖系统命令 | 用户以为执行 `/goal`（系统），实际跑 plugin | 注册期检测冲突 + 来源标签 + 不允许覆盖 |
| Skill body 当指令信任 | 任何 `.claude/commands/*.md` 里的内容被 LLM 当 system prompt | skill body 只作为 LLM 的额外上下文（user role），不直接当 system |
| MCP tool 任意 args | tool schema 不强制时 args 自由 | 强制 `inputSchema` 校验，缺 schema 的 tool 不注册 |
| `chokidar` 监听根目录递归 | 误触发整个项目 reindex | 仅监听 `.claude/commands/`，且加白名单文件类型 |
| Slash command 返回值含 HTML | XSS | 走现有 MarkdownRenderer 转义路径 |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| popup 关闭后无任何反馈 | 用户以为没触发 | 系统命令：塞占位 message；插件命令：走 typing indicator |
| 命令名撞名无提示 | 用户输 `/plan` 跑的是某个 skill | 列表项右侧加 source 标签 [skill] [workflow] [mcp] |
| popup 锚定 textarea 但消息流被压住 | 长 list 时浮层覆盖关键内容 | popup max-height = 50vh，溢出滚动 |
| Enter 触发但 IME 仍在 | 中文用户选词时被吞 | `isComposingRef` + 200ms 窗口保护 |
| Esc 关闭但下次按 `/` 重新打开 | 中文输入法连按 `/` 反复弹 | 用 `value` vs `previousValueRef` 抑制同次按 `/` 的二次弹 |
| CJK skill 名不可见 | 大量本地化 skill 找不到 | `normalize("NFKC")` 后 substring 匹配 |
| 选中项视觉与背景对比不够 | 暗色主题看不清 | 走现有 CSS 变量 `var(--color-accent)` |

---

## "Looks Done But Isn't" Checklist

- [ ] **命令注册表**：仅在 session 启动时拉一次 — verify 监听 `chokidar` 持续更新
- [ ] **冲突处理**：仅在内存里检查一次 — verify 每次注册都跑冲突检测 + UI 标签
- [ ] **键盘导航**：仅支持 ↑↓ Enter — verify 支持 Esc / Tab / Backspace（在 `/` 位置 backspace 应关 popup）
- [ ] **IME 兼容**：仅测试英文 — verify 测日文 / 中文 / 韩文输入法的 `/` 和 Enter
- [ ] **CJK command**：测了几个英文 skill — verify 至少 seed 一个中文 skill 走 e2e
- [ ] **Plugin args**：popup 接受任意字符串 — verify 实际 args 走 schema 校验或直接 ban
- [ ] **MCP 动态**：MCP 启动后命令更新 — verify 测试在 session 中途 add MCP server 的 case
- [ ] **`.claude/commands/` 监听**：仅在 session 启动时 readdir — verify chokidar 真的在监听
- [ ] **`/plan` 走 LLM**：看似正常 — verify 实际切 flag 而非依赖 LLM 自我约束
- [ ] **popup z-index**：10 — verify 测了 todo list 展开 + 任务展板 + 错误 banner 三种叠加情况

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| assistant-ui 适配器 API 变了 | HIGH | 回滚 composer 改回裸 textarea + 自建 popup |
| M3 thinking 链路又掉 | MEDIUM | 复用 patch-package 经验（260603-tiy / u6w），在 `llm-adapter.test.ts` 加 1 个 it |
| 命名冲突导致命令丢 | LOW | 重启 session，registry 重建会再 throw；用户看到 toast 重命名即可 |
| chokidar 在某平台失败 | LOW | 退化为「session 启动时 readdir 一次 + 提示用户重启」 |
| Skill body 内容注入 LLM | MEDIUM | 把 skill body 从 system role 降到 user role（re-render 即可） |
| Popup 看不见 | LOW | z-index 改 9999 + 加 `console.warn` 提示 |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1 (assistant-ui deprecation) | SLASH-01 PoC | Spike commit 验证裸 textarea + 自建 popup 跑通 5 个键盘路径 |
| P2 (v3 streamEvents thinking) | SLASH-04 + SLASH-07 | `llm.test.ts` 加 1 个 it 覆盖 `/plan` 后首条 chunk 含 `<think>` |
| P3 (命名冲突) | SLASH-03 + SLASH-12 | `registry.test.ts` 加 5 个冲突 case（同名 / 跨源 / 系统优先 / 来源标签） |
| P4 (popup 位置) | SLASH-04 + SLASH-01 | E2E 测长任务 + system command 触发时占位 message 出现 |
| P5 (开头识别) | SLASH-04 | `handleSend.test.ts` 加 "光标不在开头" / "command 在中间" / "空 command" 3 个 case |
| P6 (5 公开 bug) | SLASH-01/02 PoC | 5 个 it 块：`.` / CJK / 选区跳 / `//` / description 截断 |
| P7 (MCP 注入) | SLASH-08（建议降级为不传 args） | 走 deepagents tool_use + schema 校验 |
| P8 (description 截断) | SLASH-03 | description 渲染前只截显示，存储不截 |
| P9 (mention 预留) | 架构决策 | docs 里写明 "v1.1 不预留 mention，v1.2 重写浮层" |
| P10 (chokidar 平台差) | SLASH-13 | macOS / Windows / Linux 各跑 1 次 `.claude/commands/` 改动触发 |
| P11 (workflows 空表) | SLASH-10 前置 | seed 1 个 `/pr-review` demo workflow |
| P12-P15 (次要) | 各 phase 内 | 5 个 it 块 + e2e |

---

## Sources

**HIGH confidence（实际查证）**：
- `/Users/suntc/project/CDF/node_modules/@assistant-ui/react/dist/unstable/useSlashCommandAdapter.{js,d.ts}` — `@deprecated Under active development` 标注 + `ComposerTriggerPopover` 在源码中实际名为 `ComposerPrimitive.TriggerPopover`
- `/Users/suntc/project/CDF/node_modules/@assistant-ui/react/dist/primitives/composer/trigger/TriggerPopover.js:62-66` — 多 behavior 警告 + 必须 `Unstable_TriggerPopoverRoot` 包裹
- `/Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx:991-1093` — 当前 composer 是裸 textarea，未引 assistant-ui primitives
- `/Users/suntc/project/CDF/src/main/llm.ts:335-348, 408-419` — v3 streamEvents + reasoning 拼接逻辑
- `/Users/suntc/project/CDF/src/main/deepagent/bash-tool.ts:1, 39-76` — `execAsync` 命令执行
- `/Users/suntc/.claude/projects/-Users-suntc-project-CDF/d76e715f-8ae3-4602-8b1b-892e16002231/tool-results/bke4wrnx4.txt` — Claude Code 95 命令全表

**MEDIUM confidence（GitHub issues 真实存在但未读完整 body）**：
- anthropics/claude-code issues #65047, #65050, #65014, #64941, #64606, #64669, #62409, #61857, #64422, #62138, #62072, #62091, #64539, #62728, #63396, #58677, #65099, #60506, #60705, #59107, #61866, #60725, #62421, #61102, #61931, #61461
- assistant-ui PR #3767（mention→trigger popover 推广）、#3823（slash API 重设计 — abandoned）、#3834（v2 统一）

**LOW confidence（依赖训练数据）**：
- LangGraph streamEvents v3 完整事件契约（JS 文档当前重定向到 overview 页面，原 v3 细节不可直接查证）
- v3 相对 v1/v2 的具体差异点（仅靠 js.langchain.com 现状 + 代码上下文推断）

---

*Pitfalls research for: CDF v1.1 `/` command system*
*Researched: 2026-06-04*
*Confidence: MEDIUM — 真实 bug 引用 + 源码核对，但 v3 streamEvents 边角料 LOW*

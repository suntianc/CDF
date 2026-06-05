# Agent 开发工作站

## What This Is

基于 **deepagents.js**（LangChain 开源 Agent Harness）的离线桌面全栈 Agent 开发工作站。开发者通过 Master Agent 对话界面描述需求，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills 构建自动化开发流程。底层使用 LangGraph 运行时提供流式执行、持久化、子Agent 委托和上下文管理能力。支持多项目管理、工作流可视化编排、Agent 资产库管理。

## Core Value

开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

## Current Milestone: v1.1 基本能力完善 ✅ SHIPPED 2026-06-04

**Goal:** 在 Master Agent 对话输入框实现 Claude Code 风格的 `/` 命令 popup，覆盖"3 系统命令 + 4 源插件自动注册"的极简设计，让用户用 `/` 探索和触发系统所有能力。

**Delivered:**
- `/` 触发命令 popup（字母过滤 + 键盘导航 + IME 安全 + CJK NFKC）— Phase 5
- 3 系统命令：`/goal`, `/context`, `/plan` — Phase 7
- 7 源插件命令自动注册：system / skill:global / skill:project / workflow / mcp / cmd:system / cmd:project — Phase 6
- 4 种 CommandDispatchAction kinds：SystemSilent / SystemLocal / PluginRewrite / PlanMode — Phase 6
- chokidar@3.6.0 双路热重载（system `~/.cdf/commands/` + project `<projectPath>/.cdf/commands/`）— Phase 6
- 降级：chokidar 失败 → readdir 一次扫描 + `commands:fallback` IPC + sonner toast（C-04 dedup）— Phase 8
- 加载态机：5 状态（idle / pending / slow@500ms / ready / error） + Skeleton row — Phase 8
- 7 色 source badge 视觉打磨 + Toaster mount 修 Phase 6/7 静默 toast 隐患 — Phase 8

**Reference:** Claude Code 的 95 命令文档（已 webfetch 调研）— 参考 popup UX + skill/command 注册模式

## Next Milestone: v1.2 (TBD)

Likely candidates (per ROADMAP.md next-milestone section):
- SQLite-backed sessions (SLASH-15: `/goal` 从内存 Map 迁 SQLite)
- Deferred v1.0 cleanup (draft workflow 测试, work history UI polish)
- 跨平台 CI matrix（macOS + Windows + Linux chokidar coverage 各 ≥1 run）

## Requirements

### Validated (v1.0)

- [x] **v1-MVP**: Agent 对话界面（Master Agent 与用户多轮对话） — Phase 2
- [x] **v1-MVP**: 模型供应商配置（支持多种 LLM 提供者） — Phase 2
- [x] **v1-MVP**: Agent 资产管理（定义 Agent 角色，构建可复用资产库） — Phase 3.1
- [x] **v1-MVP**: Skills 管理（创建/编辑/执行/版本） — Phase 3.1
- [x] **v1-MVP**: MCP 管理（Model Context Protocol 服务器配置与健康检查） — Phase 3.2
- [x] **v1-MVP**: 工作流管理（可视化编排，节点支持并行/串行执行） — Phase 4
- [x] **v1-MVP**: 主题切换 — Phase 1
- [x] **v1-MVP**: 项目管理（多代码仓库项目管理） — Phase 1

### Validated (v1.1)

- [x] **SLASH-01**: `/` 触发命令 popup（renderer 输入框层） — Phase 5
- [x] **SLASH-02**: 字母过滤 + ↑↓ 选择 + Enter 触发的键盘导航 — Phase 5
  - *Note:* Phase 5 是 SPIKE，仅交付壳层 + 键盘契约；实际命令执行（含 Enter 触发）延后到 Phase 6 dispatcher。当前 D-07 行为：Tab/Enter 插入 `cmd + ' '` 到 textarea 但**不**触发消息发送。
- [x] **SLASH-03**: 命令注册表（系统命令静态 + 插件命令动态注入） — Phase 6
- [x] **SLASH-04**: 命令分发层（4 kinds: SystemSilent / SystemLocal / PluginRewrite / PlanMode） — Phase 6
- [x] **SLASH-08**: MCP 工具自动注册为 `/${mcp_tool_name}` 命令 — Phase 6
- [x] **SLASH-09a/09b**: Skills 自动注册为 `/${skill_name}` 命令（global + project × 2 亚源） — Phase 6
- [x] **SLASH-10**: Workflows 自动注册为 `/${workflow_name}` 命令（仅 `status='active'`） — Phase 6
- [x] **SLASH-11a/11b**: 项目级自定义命令支持（`.cdf/commands/*.md` × 2 亚源） — Phase 6
- [x] **SLASH-12**: 命名空间冲突处理（priority 排序 + source badge + CommandConflictError toast） — Phase 6
- [x] **SLASH-13**: 插件命令注册时机（session 启动 + chokidar 热重载 + MCP 健康事件） — Phase 6
- [x] **SLASH-DISPATCH**: 插件命令以自然语言重写 `请调用 ${tool} 工具，参数：${args}` 走 `llm:chat`（D-18: args 走 `message.content` 不传 tool schema） — Phase 6
- [x] **SLASH-05**: `/goal [condition]` 系统命令（写 `useSessionStore.sessionGoals` Map + `[system] 正在执行 /goal…` toast，无 LLM 调用） — Phase 7
- [x] **SLASH-06**: `/context [all]` 系统命令（当前 session token breakdown: conversation + skills + mcp + workflows + total） — Phase 7
- [x] **SLASH-07**: `/plan [description]` 系统命令（`[plan]` toast + `payload.overrides.planOnly` + runtime strips bash/delete_file + interruptOn=false） — Phase 7
- [x] **SLASH-REGRESSION**: 6-hunk patch-package 护栏 it 块（it 7.1 llm-adapter + it 7.2 runtime + it 7.3 llm） — Phase 7

### Active (v1.1)

*Phase 7 closed all 4 active SLASH requirements. Phase 8 is polish — no new SLASH-XX required; addresses D-priority from FEATURES.md.*

**v1.1 milestone shipped 2026-06-04 with 15/15 SLASH requirements validated.** No active v1.1 requirements remain. See `.planning/milestones/v1.1-ROADMAP.md` for archived milestone details.

### Validated (Phase 08.2 — v1.1 hotfix, 2026-06-06)

基于 Claude Code + Codex 桌面版调研，重构 4 核心 slash command 的执行原则。Phase 08.2 是 v1.1 紧急插单（在 2026-06-05 v1.1 ship 后），4 plans / 4 waves / 27 commits 全部完成。

- [x] **D-01..D-10**: 完整 frontmatter 字段执行（yaml@2.9.0 解析 4 字段 + arguments list）
  - `disable-model-invocation: true` → skill-manager 过滤（不暴露给 LLM）
  - `user-invocable: false` → SlashCommandPopup 过滤（不显示）
  - `allowed-tools: [...]` → dispatcher 透传 runtime overrides
  - `when_to_use: "..."` → description 追加（LLM 自觉）
  - `$ARGUMENTS` / `$0` / `$1` / `$2` / `$name` 字符串替换（pure transform）
  - `.md body` 按需 lazy load（commands:readBody IPC + path-traversal 守卫）
- [x] **C1-01..C1-05**: `/goal` 真正"驱动 agent 直到完成" — useGoalJudge hook + 20-turn cap + 4 状态气泡（工作中/达成/已暂停/judge 失败）
- [x] **C2-01..C2-04**: `/context` 升级 Claude Code 完整版 modal（11 类 breakdown = 7 真实 + 4 v1.2 placeholder；autocompact buffer 15%；dual entry = `/context` slash + 常驻 ContextButton 📊）
- [x] **C3-01..C3-05**: `/plan` 升级 Codex 风格弹窗 + modify loop（usePlanPopupStore 状态机 + 20-turn cap + 「修改计划」/「立即执行」两按钮）
- [x] **F-01**: per-command UI surface 区分（`/goal` 系统气泡 / `/context` modal / `/plan` 弹窗）
- [x] **G-01**: LLM 始终在 loop（无 plugin direct tool call 旁路）

**Phase 08.2 delivery:** 4/4 plans, 4/4 waves, 27 commits, 39 files changed (+4304 / -141 LOC), 73/73 new tests pass, 358/364 total (6 pre-existing v1.0 failures). Hard Do Not Touch（`llm.ts` / `llm-adapter.ts` / `runtime.ts`）完整保留。Code review: 0 Critical / 8 Warning / 5 Info（v1.2+ follow-up）。

### Out of Scope (v1.1 → v1.2+)

- 自定义 skill body 内容生成（`/run-skill-generator`）
- voice input, mobile, desktop bridge
- 复杂 dynamic workflow（`/batch` 多 agent 编排）
- Anthropic cloud scheduling (`/schedule`, `/routines`)
- v1.0 partial deliverables 收尾（draft workflow 测试、work history UI polish）— 推 v1.2

### Out of Scope (永远)

- 云端同步功能 — 离线优先设计
- 团队协作/权限管理 — v1 单开发者使用
- 实时协作编辑 — 桌面应用定位

## Context

**v1.0 state (archived):**
- 6 phases, 21 plans, 39 tasks
- 12,950 LOC TypeScript/TSX
- 395 git commits, 15 days (2026-05-19 → 2026-06-03)
- 6-hunk patch-package lock on `@langchain/anthropic@1.4.0`
- 8 post-milestone quick tasks (M3 chain + tooling) shipped 2026-06-03

**v1.1 starting state:**
- 4 source of plugin commands available:
  - MCP: arxiv (and any future)
  - Skills: code-review, simplify, run, verify, debug, etc.
  - Workflows: 0 currently (need to design sample workflows for v1.0 first)
  - Project-level: 0 (need to seed example commands)
- `assistant-ui` is the chat framework (compatible with input adornments)
- Master Agent uses `runtime.agent.streamEvents v3` — plugin commands need to flow through this without breaking reasoning

**v1.1 state (shipped 2026-06-04):**
- 4 phases, 10 plans, 50 commits
- 7 source aggregators: system / skill:global (`~/.cdf/skills/`) / skill:project (`<projectPath>/.cdf/skills/`) / workflow / mcp / cmd:system (`~/.cdf/commands/`) / cmd:project (`<projectPath>/.cdf/commands/`)
- 241/243 tests passing (2 pre-existing v1.0 failures out of scope: file-tools.test.ts, skill-manager.test.ts)
- chokidar@3.6.0 + cmdk@1.1.1 + @radix-ui/react-popover@1.1.15 + sonner@2.0.7 added as direct deps
- SLASH-REGRESSION it blocks at llm-adapter.test.ts / llm.test.ts / runtime.test.ts protect 6-hunk patch-package
- macOS IME 候选框 z-index 已知 issue 文档化（pointer comment in ChatArea + "Esc 关一次" work-around）
- 3 system commands implemented (no LLM call: `/goal` `/context`; with LLM but planOnly: `/plan`)

**Reference materials (already loaded):**
- Claude Code slash commands doc (https://code.claude.com/docs/en/commands) — 95 commands, popup UX, registration model
- Claude Code skills doc — `.claude/skills/*/SKILL.md` registration pattern
- LangChain `BaseChatModel` tool/function calling — for `/${mcp_tool_name}` MCP tool invocation

## Constraints

- **离线优先**：所有数据本地存储，不依赖网络
- **Electron 桌面应用**：跨平台桌面环境
- **技术栈**：Electron + React + Vite | assistant-ui（对话组件）| ReactFlow（工作流组件）| Tailwind + Shadcn UI
- **Anthropic extended thinking 协议握手**：thinking 启用时 temperature/top_p/top_k 必须 unset（client-side invariant baked into 260603-se4）
- **命令仅在消息开头识别**：参考 Claude Code 的设计（`/clear` 后面的内容是参数，不破坏 LLM 流）
- **插件命令严格 passthrough**：参数空格分隔直接给底层 tool/skill/workflow，不做 wrapper 智能

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 离线优先架构 | 开发者环境需要稳定可靠，不依赖外部服务 | ✓ Good (v1.0) |
| deepagents.js 作为底层引擎 | LangChain 开源 Agent Harness，内置 Skills/MCP/子Agent | ✓ Good (Phase 3+) |
| 上下文总结策略（85% 阈值）| 避免上下文压缩导致信息失真 | ✓ Good (Phase 2) |
| Electron + React + Vite | 成熟的桌面应用技术栈 | ✓ Good (v1.0) |
| assistant-ui 对话组件 | 官方推荐，对话场景开箱即用 | ✓ Good (Phase 2) |
| ReactFlow 工作流组件 | 可视化编排能力强，生态成熟 | ✓ Good (Phase 4) |
| LangGraph 运行时 | deepagents 底层，提供流式/持久化/检查点 | ✓ Good (Phase 4) |
| safeStorage 加密 API key | 委托 OS Keychain/libsecret/DPAPI；明文从不落盘 | ✓ Good (Phase 2) |
| patch-package 永久化 LangChain 修复 | M3 video + reasoning roundtrip; 跨 npm install 自动应用 | ✓ Good (v1.0) |
| GSD PreToolUse hook 强制 cleanup helper | 用机器强制代替人记；未来 quick task 受益 | ✓ Good (v1.0) |
| **v1.1: `/` 命令极简设计**（3 系统 + 7 源插件聚合） | 拒绝 95 命令全谱系（CLI 专属能力 50+ 不适用）；插件自动注册 = 零额外配置 | ✓ Good (v1.1 shipped) |
| **v1.1 / Spike-first Phase 5** | Phase 5 仅交付 popup 壳层 + 19 个键盘契约测试；拒绝在 spike 中承诺 dispatcher 架构 | ✓ Good (Phase 5 shipped) |
| **v1.1 / 拒绝** `unstable_useSlashCommandAdapter` | `@deprecated Under active development`；要求 ComposerPrimitive adoption 会引爆 6-hunk patch-package（M3 thinking 链） | ✓ Good — 拒绝对了，slashed popup 走 `cmdk` + 手写 dispatcher |
| **v1.1 / 接受** cmdk@1.1.1 + Radix Popover + sonner@2.0.7 | peer react ^18 \|\| ^19 兼容；Radix Popover 已是 transitive dep，promote to direct；sonner 单 source of truth | ✓ Good (Phase 5) |
| **v1.1 / 接受** chokidar@3.6.0（**非** 4.x） | `awaitWriteFinish: { stabilityThreshold: 200 }` 处理 macOS VSCode atomic-write；4.x breaking changes 没必要 | ✓ Good (Phase 6) |
| **v1.1 / 接受** 命名冲突策略：source badge + 两行都保留 + 优先级 `system > skill:project > skill:global > workflow > mcp > cmd:project > cmd:system` | 防止 Claude Code #61857/#62409/#64422 同类静默覆盖 bug | ✓ Good (Phase 6) |
| **v1.1 / 接受** 插件命令以自然语言 prompt 重写走 `llm:chat`（**不**新增 dispatch IPC） | 维护 M3 thinking 链；零新事件类型 | ✓ Good (Phase 6) |
| **v1.1 / 接受** `/plan` 为 `payload.overrides.planOnly` 运行时 flag（**不**新 dispatch 路径） | 走 llm.ts:324 现有扩展点；新增 SLASH-REGRESSION it 块保护 | ✓ Good (Phase 7) |
| **v1.1 / 接受** `/goal` 内存存储（`useSessionStore.sessionGoals: Map<sessionId, string>`） | v1.1 范围；v1.2+ 迁 SQLite（SLASH-15） | ⚠️ Revisit in v1.2 (memory-only persistence) |
| **v1.1 / 接受** 取消 `/pr-review` 3 节点 demo workflow seed | v1.0 Phase 4 已有 workflow 能力；PITFALLS P11 担忧消解 | ✓ Good — 避免 zombie code |
| **v1.1 / 拒绝** v1.0 partial deliverable cleanup 混入 v1.1 | 推 v1.2；v1.1 激光聚焦 `/` 命令系统 | ✓ Good (scope discipline) |
| **v1.1 hotfix / 接受** `.md body` 懒加载 + `$ARGUMENTS`/`$0`/`$1`/`$name` 替换 + body 作为 user message 代替原命令 | 对标 Claude Code skills `body loads only when it's used`；lazy load 减 registry 启动时间；body 替换走 LLM 视野避免 args 进 tool schema（PITFALLS P7） | ✓ Good (Phase 08.2) |
| **v1.1 hotfix / 接受** `/goal` 升 judge agent loop（专用内置 agent + 复用当前模型） | 对标 Claude Code `/goal` 完整机制（专用 judge + Stop hook wrapper + first message + reason loop） | ✓ Good (Phase 08.2) |
| **v1.1 hotfix / 接受** `/context` 升 Claude Code 完整版 modal（11 类 = 7 真实 + 4 v1.2 推） | 11 类完整化是渐进过程；v1.1 落地 7 类（`conversation` / `skills` / `mcp` / `workflows` / `projectCommandBodies` / `mcpPerTool` / `freeSpace` + `autocompactBuffer`），4 类 v1.2 推（`systemPrompt` / `systemTools` / `customAgents` / `memoryFiles`）；不虚假承诺 | ✓ Good (Phase 08.2) |
| **v1.1 hotfix / 接受** `/plan` 升 Codex 弹窗模式（plan-then-execute + modify loop） | 拒持久权限模式（plan + execute 阶段分明）；modify loop 让用户审阅 + 修改 + 立即执行 | ✓ Good (Phase 08.2) |
| **v1.1 hotfix / 接受** 完整 frontmatter 字段（`disable-model-invocation` / `user-invocable` / `allowed-tools` / `when_to_use`）全代码层强制 | 4 字段对标 Claude Code skill frontmatter；类型层 seam + 运行时硬过滤（D-09 全部） | ✓ Good (Phase 08.2) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-06 after Phase 08.2 (v1.1 hotfix) completion*



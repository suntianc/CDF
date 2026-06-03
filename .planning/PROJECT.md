# Agent 开发工作站

## What This Is

基于 **deepagents.js**（LangChain 开源 Agent Harness）的离线桌面全栈 Agent 开发工作站。开发者通过 Master Agent 对话界面描述需求，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills 构建自动化开发流程。底层使用 LangGraph 运行时提供流式执行、持久化、子Agent 委托和上下文管理能力。支持多项目管理、工作流可视化编排、Agent 资产库管理。

## Core Value

开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

## Current Milestone: v1.1 基本能力完善

**Goal:** 在 Master Agent 对话输入框实现 Claude Code 风格的 `/` 命令 popup，覆盖"3 系统命令 + 4 源插件自动注册"的极简设计，让用户用 `/` 探索和触发系统所有能力。

**Target features:**
- `/` 触发命令 popup（字母过滤 + 键盘导航）
- 3 系统命令：`/goal`, `/context`, `/plan`
- 4 源插件命令自动注册：
  - MCP tools → `/${mcp_tool_name}` params
  - Skills → `/${skill_name}` params
  - Workflows → `/${workflow_name}` params（v1.0 phase 4 已建工作流）
  - 项目级自定义 → `/${custom_name}` params（`.claude/commands/*.md`）

**Reference:** Claude Code 的 95 命令文档（已 webfetch 调研）— 参考 popup UX + skill/command 注册模式

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

### Active (v1.1)

- [ ] **SLASH-01**: `/` 触发命令 popup（renderer 输入框层）
- [ ] **SLASH-02**: 字母过滤 + ↑↓ 选择 + Enter 触发的键盘导航
- [ ] **SLASH-03**: 命令注册表（系统命令静态 + 插件命令动态注入）
- [ ] **SLASH-04**: 命令分发层（本地静默 / Master Agent 注入 / 弹层 / IPC）
- [ ] **SLASH-05**: `/goal [condition]` 系统命令
- [ ] **SLASH-06**: `/context [all]` 系统命令
- [ ] **SLASH-07**: `/plan [description]` 系统命令（Master Agent 切只规划不执行）
- [ ] **SLASH-08**: MCP 工具自动注册为 `/${mcp_tool_name}` 命令
- [ ] **SLASH-09**: Skills 自动注册为 `/${skill_name}` 命令
- [ ] **SLASH-10**: Workflows 自动注册为 `/${workflow_name}` 命令
- [ ] **SLASH-11**: 项目级自定义命令支持（`.claude/commands/*.md` 读取）
- [ ] **SLASH-12**: 命名空间冲突处理（plugin source 标签显示）
- [ ] **SLASH-13**: 插件命令注册时机（session 启动时拉取 + MCP 动态监听）

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
| **v1.1: `/` 命令极简设计**（3 系统 + 4 源插件） | 拒绝 95 命令全谱系（CLI 专属能力 50+ 不适用）；插件自动注册 = 零额外配置 | — Pending (v1.1) |

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
*Last updated: 2026-06-04 at v1.1 milestone start*



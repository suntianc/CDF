# Agent 开发工作站

## What This Is

基于 **deepagents.js**（LangChain 开源 Agent Harness）的离线桌面全栈 Agent 开发工作站。开发者通过 Master Agent 对话界面描述需求，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills 构建自动化开发流程。底层使用 LangGraph 运行时提供流式执行、持久化、子Agent 委托和上下文管理能力。支持多项目管理、工作流可视化编排、Agent 资产库管理。

## Core Value

开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

## Current State

**Milestone v1.0 shipped 2026-06-03** — Agent 개발工作站 MVP. See `.planning/MILESTONES.md` for full archive and `.planning/milestones/v1.0-ROADMAP.md` for shipped phase details. Ready to plan next milestone.

## Core Value

开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

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

### Active (v1.1 candidates)

- [ ] **Partial v1**: 工作流执行历史 + 导出 (foundation laid by 260602-0ed, needs UI polish)
- [ ] **Partial v1**: draft workflow 隐藏 + 防御性 status 校验 (Suntc 君手工加, 待补测试)

### Known Gaps (from v1.0 audit at close)

5 unchecked v1 requirements (per REQUIREMENTS.md traceability):
- AGNT-01/02: Agent 资产管理 — partially delivered via 03.1; full UI polish pending
- SKIL-01/02/03: Skills 版本/日志 — basic creation shipped, version mgmt deferred
- MCP-01/02/03/04: MCP connection/health — config shipped, connection/disconnect mgmt partial
- WFLO-01: ReactFlow 可视化工作流编辑器 — shipped, advanced layout features pending

### Out of Scope (still valid)

- 云端同步功能 — 离线优先设计
- 团队协作/权限管理 — v1 单开发者使用
- 实时协作编辑 — 桌面应用定位

## Context

**Shipped v1.0 state:**
- 6 phases, 21 plans, 39 tasks
- 12,950 LOC TypeScript/TSX
- 395 git commits since project start (2026-05-19)
- All 25 v1.0 quick tasks completed (audit-open false positives cleared)
- 6-hunk patch-package lock on `@langchain/anthropic@1.4.0` for M3 video + reasoning roundtrip
- 8 post-milestone quick tasks (M3 chain + tooling improvements) shipped 2026-06-03

**Known technical debt:**
- TS strict catches `Cannot find module` errors in language server that vitest doesn't (pre-existing; not blocking)
- `standard.cjs:267` had a pre-existing parity gap (fixed by 260603-vht)
- codegraph daemon.pid was tracked (fixed by 260603-w0y via .gitignore)

## Constraints

- **离线优先**：所有数据本地存储，不依赖网络
- **Electron 桌面应用**：跨平台桌面环境
- **技术栈**：Electron + React + Vite | assistant-ui（对话组件）| ReactFlow（工作流组件）| Tailwind + Shadcn UI
- **Anthropic extended thinking 协议握手**：thinking 启用时 temperature/top_p/top_k 必须 unset（client-side invariant baked into 260603-se4）

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
| patch-package 永久化 LangChain 修复 | M3 video + reasoning roundtrip; 跨 npm install 自动应用 | ✓ Good (260601-nzn + 260603-tiy + 260603-u6w + 260603-vht) |
| GSD PreToolUse hook 强制 cleanup helper | 用机器强制代替人记；未来 quick task 受益 | ✓ Good (260603-wd4) |

---
*Last updated: 2026-06-03 after v1.0 milestone close*


# Agent 开发工作站

## What This Is

基于 pi-code-agent 的离线桌面全栈 Agent 开发工作站。开发者通过 Master Agent 对话界面描述需求，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills 构建自动化开发流程。支持多项目管理、工作流可视化编排、Agent 资产库管理。

## Core Value

开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

## Requirements

### Validated

- [x] **v1-MVP**: Agent 对话界面（Master Agent 与用户多轮对话） — Phase 2
- [x] **v1-MVP**: 模型供应商配置（支持多种 LLM 提供者） — Phase 2

### Active

- [ ] **v1-MVP**: Agent 资产管理（定义 Agent 角色，构建可复用资产库）
- [ ] Skills 管理
- [ ] MCP 管理（Model Context Protocol 服务器配置与健康检查）
- [ ] 工作流管理（可视化编排，节点支持并行/串行执行）
- [ ] 主题切换
- [ ] 项目管理（多代码仓库项目管理）

### Out of Scope

- 云端同步功能 — 离线优先设计
- 团队协作/权限管理 — v1 单开发者使用
- 实时协作编辑 — 桌面应用定位

## Context

**技术背景：**
- pi-code-agent 是开源 CLI 应用，作为底层 Agent 引擎被此桌面应用调用
- Master Agent 是对客界面，负责与用户沟通；普通 Agent 节点只负责工作流中的单一任务环节
- Agent 节点可配置：指定 LLM、MCP、Skills 资源

**设计理念：**
- 工作流节点分为 Agent 节点和普通节点
- Agent 节点按需配置资源（mcp、skills、指定 llm）
- 普通节点用于稳定的脚本或查询等能力
- 节点间数据传递方式待调研（状态共享 vs 消息传递）
- 工作流自动运行；需用户确认时，Master Agent 询问用户

**上下文管理策略：**
- 不做上下文压缩
- 窗口使用率达 85% 阈值时，自动总结所有历史记录
- 开启新会话，保留旧会话 ID 和总结内容注入新会话

## Constraints

- **离线优先**：所有数据本地存储，不依赖网络
- **Electron 桌面应用**：跨平台桌面环境
- **技术栈**：Electron + React + Vite | assistant-ui（对话组件）| ReactFlow（工作流组件）| Tailwind + Shadcn UI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 离线优先架构 | 开发者环境需要稳定可靠，不依赖外部服务 | — Pending |
| pi-code-agent 作为底层引擎 | 复用成熟开源能力，避免重复造轮子 | — Pending |
| 上下文总结策略 | 避免上下文压缩导致信息失真 | — Pending |
| 85%窗口阈值触发总结 | 保留安全边界，避免窗口耗尽 | Phase 2 ✅ |
| Electron + React + Vite | 成熟的桌面应用技术栈 | — Pending |
| assistant-ui 对话组件 | 官方推荐，对话场景开箱即用 | Phase 2 ✅ |
| ReactFlow 工作流组件 | 可视化编排能力强，生态成熟 | — Pending |

---
*Last updated: 2026-05-22 after Phase 2*

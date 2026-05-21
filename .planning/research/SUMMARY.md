# Research Summary: Agent 开发工作站

**Project:** Agent 开发工作站 (Agent Development Workstation)
**Synthesized:** 2026-05-21
**Confidence:** MEDIUM

---

## Executive Summary

Electron 桌面应用，目标为 AI Agent 开发者提供可视化工作流编排平台。核心技术栈：Electron v33+ + electron-vite + React 19 + TypeScript，前端组件采用 Shadcn/ui + Tailwind CSS，聊天界面使用 assistant-ui，工作流可视化使用 ReactFlow。离线优先设计通过 better-sqlite3 + electron-store 实现。

架构设计是最关键的成败因素：Main Process/Renderer Process 边界必须清晰（禁用 nodeIntegration，坚持 contextBridge），IPC 必须采用异步模式。主要风险集中在上下文窗口管理策略缺失、工作流执行状态与 UI 同步机制不完善、MCP 服务器集成疏漏。

---

## Key Findings

### Stack

| Category | Choice | Rationale |
|----------|--------|-----------|
| Desktop Runtime | Electron v33+ | 成熟跨平台，Node.js 后端集成 |
| Build Tool | electron-vite v3+ | Vite 原生，快 HMR，官方推荐 |
| Chat UI | assistant-ui | AI 对话专用，流式输出，Markdown/Code 支持 |
| Workflow | ReactFlow (@xyflow/react) v12+ | 拖拽编排，业界标准 |
| State | Zustand + XState | 轻量全局状态 + 工作流状态机 |
| Storage | better-sqlite3 + electron-store | 离线优先，结构化+键值存储 |
| UI | Tailwind v4 + Shadcn/ui | 快速开发，一致设计系统 |

### Table Stakes

- 自然语言转代码生成
- 多轮对话界面（Master Agent）
- 多文件编辑能力
- 项目上下文感知
- LLM 供应商配置
- 基础文件操作

### Differentiators

- 工作流可视化编排（ReactFlow）
- MCP 支持（Model Context Protocol）
- Agent 资产库管理
- 多项目管理
- 上下文窗口管理（85% 阈值总结）

### Watch Out For

1. **主进程/渲染进程边界模糊** — 禁用 nodeIntegration，坚持 contextBridge
2. **IPC 通信阻塞** — 使用 invoke/handle 模式，禁止同步调用
3. **上下文窗口耗尽** — 实现 85% 阈值自动总结
4. **状态管理碎片化** — 统一 Zustand 方案
5. **工作流状态同步丢失** — 实时推送机制

---

## Proposed Phases

1. **Phase 1: Foundation Workspace** — Main Process 骨架、Renderer 基础架构、数据持久层、状态管理
2. **Phase 2: AI Chat Engine** — assistant-ui 集成、多轮对话、LLM 配置、上下文管理
3. **Phase 3: Agent Integration** — pi-code-agent CLI 集成、MCP Server Manager、Agent Library
4. **Phase 4: Workflow System** — ReactFlow 集成、工作流执行引擎、实时状态
5. **Phase 5: Project Management** — 多项目管理面板、项目级数据隔离

---

## Open Questions

- assistant-ui 与 React 19 兼容性（需验证）
- electron-vite v3 生产稳定性（需验证）
- Tailwind v4 生产可用性（需验证）
- MCP 协议成熟度（需调研）
- pi-code-agent CLI 接口和输出格式（需调研）

---

## Verification Commands

```bash
npm view electron version
npm view electron-vite version
npm view @xyflow/react version
npm view assistant-ui version
npm view tailwindcss version
npm view better-sqlite3 version
npm view zustand version
```

---

*Research synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*

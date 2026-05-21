# Roadmap: pi-workbench

**5 phases** | **34 requirements mapped** | **All current requirements covered** ✅

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|-------------|-----------------|
| 1 | Foundation & Workspace | 搭好应用骨架，选择工作区，配置模型提供商 | WS-01~04, PROV-01~05, UI-01~05 | 应用启动看到界面，能选工作区，能配 API Key |
| 2 | AI Chat Engine | AI 对话核心体验 | CHAT-01~05 | 能对话、流式显示、历史持久化、可清空/新建对话 |
| 3 | Skills System | Skills 发现、安装、执行 + GSD 工作流 | SKILL-01~06, GSD-02~03 | 能看到 skills 列表，能从 GitHub 安装，能点击执行 |
| 4 | MCP Integration | MCP server 连接管理 + 工具注入 | MCP-01~06 | 能添加 MCP server，工具自动注入，agent 可调用 |
| 5 | Workflow Builder | 基于 React Flow 构建 agent 工作流编辑体验 | FLOW-01~04 | 能新增、编辑、删除工作流，并在画布中构建和保存 |

---

## Phase Details

### Phase 1: Foundation & Workspace

**Progress:** ██░░░░░░░░ 1/3 plans (1 complete)

**Goal:** 搭好 Electron 应用骨架，完成可用的工作台界面框架

**Requirements:** WS-01, WS-02, WS-03, WS-04, PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, UI-01, UI-02, UI-03, UI-04, UI-05

**Success Criteria:
1. 应用启动后显示侧边栏 + 主内容区布局
2. 可通过对话框选择工作区文件夹
3. 最近工作区列表持久化，可快速切换
4. 可添加 LLM 提供商并配置 API Key
5. 可用模型中切换当前模型
6. 主题切换（明/暗）生效
7. 窗口大小位置重启后恢复

**Phase dependencies:** None

### Phase 2: AI Chat Engine

**Goal:** 核心对话体验——用户可以跟 AI agent 对话

**Requirements:** CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05

**Success Criteria:**
1. 聊天面板可输入消息并发送
2. Agent 回复流式显示，Markdown 渲染正确
3. 对话历史可保存和恢复
4. 可清空/新建对话

**Plans:** 5 plans in 3 waves

Plans:
- [x] 02-01-PLAN.md — Message store (Zustand) + IPC streaming foundation
- [x] 02-02-PLAN.md — Chat UI components (ChatPanel, MessageBubble, InputArea, WelcomeDialog)
- [x] 02-03-PLAN.md — Markdown rendering (react-markdown + shiki) + streaming hook
- [x] 02-04-PLAN.md — Chat history persistence (electron-store per-conversation + pagination)
- [x] 02-05-PLAN.md — New conversation + clear conversation (ConversationList)

**Phase dependencies:** Phase 1 (需要 Model Provider 和工作区已配置)

### Phase 3: Skills System

**Goal:** 发现、安装、管理 skills，集成 GSD 子 agent 能力

**Requirements:** SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, SKILL-06, GSD-02, GSD-03

**Success Criteria:**
1. 侧边栏展示当前工作区的 skills 列表（含 pi-gsd 全部工作流）
2. 可从本地文件系统导入 skill
3. 可从 GitHub 仓库安装 skill（`/owner/repo`）
4. 可预览 skill 内容
5. 点击 skill 发送到当前对话并执行
6. GSD 子 agent 可通过 skill 调用自动生成

**Phase dependencies:** Phase 2 (需要 agent 对话能力)

### Phase 4: MCP Integration

**Goal:** 连接外部 MCP server，工具自动注入 agent

**Requirements:** MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06

**Success Criteria:**
1. 可添加 MCP server（名称、命令、参数）
2. 可连接/断开 MCP server
3. 已连接 server 的 tools 自动注册到 agent 工具集
4. Agent 可正常调用 MCP tool
5. 应用退出时自动断开所有连接
6. MCP 配置按工作区存储和恢复

**Phase dependencies:** Phase 2 (需要 agent 对话能力)

### Phase 5: Workflow Builder

**Goal:** 基于 React Flow 构建 agent 工作流，支持新增、编辑、删除、画布构建工作流

**Requirements:** FLOW-01, FLOW-02, FLOW-03, FLOW-04

**Success Criteria:**
1. 用户可以创建新的 agent 工作流并填写基础信息
2. 用户可以在 React Flow 画布中新增、连接、删除节点与边
3. 用户可以编辑已有工作流并持久化保存
4. 用户可以删除不再使用的工作流
5. 工作流列表与画布编辑状态在应用重启后可恢复

**Phase dependencies:** Phase 2 (需要 agent 对话能力), Phase 3 (可复用 skills / agent 能力), Phase 4 (可接入 MCP 工具节点)

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WS-01 | Phase 1 | Pending |
| WS-02 | Phase 1 | Pending |
| WS-03 | Phase 1 | Pending |
| WS-04 | Phase 1 | Pending |
| PROV-01 | Phase 1 | Pending |
| PROV-02 | Phase 1 | Pending |
| PROV-03 | Phase 1 | Pending |
| PROV-04 | Phase 1 | Pending |
| PROV-05 | Phase 1 | Pending |
| UI-01 | Phase 1 | Pending |
| UI-02 | Phase 1 | Pending |
| UI-03 | Phase 1 | Pending |
| UI-04 | Phase 1 | Pending |
| UI-05 | Phase 1 | Pending |
| CHAT-01 | Phase 2 | Pending |
| CHAT-02 | Phase 2 | Pending |
| CHAT-03 | Phase 2 | Pending |
| CHAT-04 | Phase 2 | Pending |
| CHAT-05 | Phase 2 | Pending |
| SKILL-01 | Phase 3 | Pending |
| SKILL-02 | Phase 3 | Pending |
| SKILL-03 | Phase 3 | Pending |
| SKILL-04 | Phase 3 | Pending |
| SKILL-05 | Phase 3 | Pending |
| SKILL-06 | Phase 3 | Pending |
| GSD-02 | Phase 3 | Pending |
| GSD-03 | Phase 3 | Pending |
| MCP-01 | Phase 4 | Pending |
| MCP-02 | Phase 4 | Pending |
| MCP-03 | Phase 4 | Pending |
| MCP-04 | Phase 4 | Pending |
| MCP-05 | Phase 4 | Pending |
| MCP-06 | Phase 4 | Pending |
| FLOW-01 | Phase 5 | Pending |
| FLOW-02 | Phase 5 | Pending |
| FLOW-03 | Phase 5 | Pending |
| FLOW-04 | Phase 5 | Pending |

**Coverage:**
- current requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✅

---
*Roadmap created: 2026-05-19*
*Last updated: 2026-05-21 for Phase 2 replan*

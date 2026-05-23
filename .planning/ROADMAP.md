# Roadmap: Agent 开发工作站

## Phases

- [x] **Phase 1: Foundation Workspace** - 基础架构、主题切换、项目管理基础设施
- [x] **Phase 2: AI Chat Engine** - Master Agent 对话界面、多轮对话、LLM 提供者配置
- [x] **Phase 3: Agent Integration** - Agent 资产管理、Skills 管理、MCP 服务器管理
- [ ] **Phase 4: Workflow System** - ReactFlow 可视化工作流编辑器、执行引擎
- [ ] **Phase 5: Project Management** - 多项目管理面板、项目级数据隔离

---

## Phase Details

### Phase 1: Foundation Workspace

**Goal:** 开发者可启动应用，看到主界面框架，支持主题切换和项目管理基础

**Depends on:** None (first phase)

**Requirements:** THEM-01, THEM-02, THEM-03, PROJ-01, PROJ-02, PROJ-03

**Success Criteria** (what must be TRUE):
1. 用户可启动 Electron 应用并看到主界面
2. 用户可切换浅色主题，界面正确反映
3. 用户可切换深色主题，界面正确反映
4. 用户可切换跟随系统设置，界面自动适配
5. 用户可在多项目管理面板中查看项目列表
6. 用户可在项目面板中切换不同项目

**Plans:** TBD

**UI hint:** yes

---

### Phase 2: AI Chat Engine

**Goal:** 用户可与 Master Agent 进行多轮对话，配置 LLM 提供者，对话历史持久化

**Depends on:** Phase 1

**Requirements:** CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, LLM-01, LLM-02, LLM-03

**Success Criteria** (what must be TRUE):
1. 用户可在 Master Agent 对话界面发送消息并收到回复
2. 对话关闭后重新打开，历史消息仍存在
3. 对话窗口使用率达 85% 阈值时，系统自动总结上下文
4. 开启新会话时，旧会话 ID 和总结内容注入新会话
5. 用户可通过会话 ID 查询历史对话记录
6. 用户可配置多个 LLM 提供者（OpenAI、Anthropic、本地模型等）
7. 用户的 API Key 以加密形式安全存储
8. 用户可在不同 LLM 提供者之间切换

**Plans:** TBD

**UI hint:** yes

---

### Phase 3: Agent Integration

**Goal:** 开发者可定义 Agent 角色，配置其 LLM/MCP/Skills 资源。利用 deepagents.js SDK 的内置 Skills 和 MCP 能力，通过 Electron 主进程创建和管理 deepagent 实例。前端 UI 管理 Agent 定义、Skills 脚本、MCP 服务器配置，与 deepagents 运行时的 Skills/MCP 系统对接。

**Depends on:** Phase 2

**Requirements:** AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, SKIL-01, SKIL-02, SKIL-03, MCP-01, MCP-02, MCP-03, MCP-04

**Success Criteria** (what must be TRUE):
1. 用户可在 Agent 资产库面板创建、编辑、删除 Agent 角色定义
2. 用户可为 Agent 指定 LLM 提供者
3. 用户可为 Agent 绑定 MCP 资源
4. 用户可为 Agent 绑定 Skills
5. 用户可创建、编辑、删除 Skills 脚本
6. 用户可查看 Skills 版本历史
7. 用户可查看 Skills 执行日志
8. 用户可配置 MCP 服务器（地址、端口）
9. 用户可对 MCP 服务器执行健康检查
10. 用户可连接和断开 MCP 服务器

**Plans:** TBD

---

### Phase 4: Workflow System

**Goal:** 用户可通过 ReactFlow 可视化编排工作流，执行并监控节点状态。利用 langgraph.js 的图运行时作为工作流执行引擎，每个 Agent 节点对应一个 deepagent 实例，支持子Agent 委托和上下文隔离。

**Depends on:** Phase 3

**Requirements:** WFLO-01, WFLO-02, WFLO-03, WFLO-04, WFLO-05, WFLO-06, WFLO-07

**Success Criteria** (what must be TRUE):
1. 用户可在 ReactFlow 可视化编辑器中创建和编辑工作流
2. 用户可配置 Agent 节点（指定 LLM、MCP、Skills）
3. 用户可添加普通节点（脚本/查询能力）
4. 用户可控制节点的并行/串行执行
5. 工作流执行状态实时推送到界面
6. 节点失败时汇报给 Master Agent 决断
7. 用户可保存和加载工作流

**Plans:** TBD

**UI hint:** yes

---

### Phase 5: Project Management

**Goal:** 用户可通过多项目管理面板高效管理多个项目，实现项目级数据隔离

**Depends on:** Phase 4

**Requirements:** PROJ-01, PROJ-02, PROJ-03

**Success Criteria** (what must be TRUE):
1. 用户可在项目管理面板中查看所有项目
2. 用户可在面板中快速切换项目
3. 不同项目的数据完全隔离

**Plans:** TBD

**UI hint:** yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Workspace | 1/1 | Completed | 2026-05-21 |
| 2. AI Chat Engine | 1/1 | Completed | 2026-05-22 |
| 3. Agent Integration | 5/5 | Completed | 2026-05-23 |
| 4. Workflow System | 0/1 | Not started | - |
| 5. Project Management | 0/1 | Not started | - |

---

## Coverage

**Requirements:** 28 total v1 requirements

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1 - Foundation Workspace | THEM-01, THEM-02, THEM-03, PROJ-01, PROJ-02, PROJ-03 | 6 |
| 2 - AI Chat Engine | CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, LLM-01, LLM-02, LLM-03 | 8 |
| 3 - Agent Integration | AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, SKIL-01, SKIL-02, SKIL-03, MCP-01, MCP-02, MCP-03, MCP-04 | 12 |
| 4 - Workflow System | WFLO-01, WFLO-02, WFLO-03, WFLO-04, WFLO-05, WFLO-06, WFLO-07 | 7 |
| 5 - Project Management | PROJ-01, PROJ-02, PROJ-03 | 3 |

**Coverage:** 28/28 requirements mapped
**Unmapped:** 0








---

*Last updated: 2026-05-23*







































---

*Last updated: 2026-05-23*

### Phase 6: 3.1

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 6 to break down)

### Phase 7: 3.1

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 7 to break down)

### Phase 8: 3.1

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 8 to break down)

### Phase 9: 3.1

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 9 to break down)

---

*Last updated: 2026-05-23*

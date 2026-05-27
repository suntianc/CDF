# Requirements: Agent 开发工作站

**Defined:** 2026-05-21
**Core Value:** 开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Agent 对话 (Chat) ✅ Phase 2

- [x] **CHAT-01**: Master Agent 多轮对话界面（assistant-ui）
- [x] **CHAT-02**: 对话历史本地持久化
- [x] **CHAT-03**: 上下文窗口 85% 阈值自动总结机制
- [x] **CHAT-04**: 总结后开启新会话，旧会话 ID 和总结内容注入新会话作为上下文
- [x] **CHAT-05**: Agent 可根据会话 ID 查询历史对话记录

### 模型供应商配置 (LLM Providers) ✅ Phase 2

- [x] **LLM-01**: 支持配置多个 LLM 提供者（OpenAI、Anthropic、本地模型等）
- [x] **LLM-02**: API Key 安全管理（加密存储）
- [x] **LLM-03**: 提供者切换机制

### Agent 资产管理 (Agent Library)

- [ ] **AGNT-01**: 创建/编辑/删除 Agent 角色定义
- [ ] **AGNT-02**: Agent 资产库面板
- [x] **AGNT-03**: Agent 配置：指定 LLM、提供者
- [x] **AGNT-04**: Agent 配置：绑定 MCP 资源
- [x] **AGNT-05**: Agent 配置：绑定 Skills

### Skills 管理 (Skills)

- [ ] **SKIL-01**: 创建/编辑/删除 Skills 脚本
- [ ] **SKIL-02**: Skills 版本管理
- [ ] **SKIL-03**: Skills 执行日志

### MCP 管理 (MCP Servers)

- [ ] **MCP-01**: MCP 服务器配置（地址、端口）
- [ ] **MCP-02**: MCP 服务器参数配置（待 research）
- [ ] **MCP-03**: MCP 服务器健康检查
- [ ] **MCP-04**: MCP 服务器连接/断开管理

### 工作流管理 (Workflow)

- [ ] **WFLO-01**: ReactFlow 可视化工作流编辑器
- [ ] **WFLO-02**: Agent 节点配置（指定 LLM、MCP、Skills）
- [ ] **WFLO-03**: 普通节点（脚本/查询能力）
- [ ] **WFLO-04**: 节点并行/串行执行控制
- [ ] **WFLO-05**: 工作流执行状态实时推送
- [ ] **WFLO-06**: 失败节点汇报 Master Agent 决断
- [ ] **WFLO-07**: 工作流持久化（保存/加载）

### 主题切换 (Theme)

- [ ] **THEM-01**: 浅色主题
- [ ] **THEM-02**: 深色主题
- [ ] **THEM-03**: 跟随系统设置

### 项目管理 (Project)

- [ ] **PROJ-01**: 多项目管理面板
- [ ] **PROJ-02**: 项目切换
- [ ] **PROJ-03**: 项目级数据隔离

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Skills 管理

- **SKIL-04**: Skills 市场/共享功能

### MCP 管理

- **MCP-05**: MCP 资源状态可视化
- **MCP-06**: MCP 响应缓存

### 工作流管理

- **WFLO-08**: 工作流版本管理
- **WFLO-09**: 工作流执行回滚

### 项目管理

- **PROJ-04**: 项目导入/导出
- **PROJ-05**: 团队协作/权限管理

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 云端同步 | 离线优先设计 |
| 团队协作/权限管理 | v1 单开发者使用 |
| 实时协作编辑 | 桌面应用定位 |
| 上下文压缩 | 压缩导致信息失真，采用总结策略替代 |
| 强制自动执行 | 需要用户确认的场景必须暂停 |
| LLM 参数配置 | v1 仅配置提供者，不配置参数 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| THEM-01 | Phase 1 | Pending |
| THEM-02 | Phase 1 | Pending |
| THEM-03 | Phase 1 | Pending |
| PROJ-01 | Phase 1 | Pending |
| PROJ-02 | Phase 1 | Pending |
| PROJ-03 | Phase 1 | Pending |
| CHAT-01 | Phase 2 | Pending |
| CHAT-02 | Phase 2 | Pending |
| CHAT-03 | Phase 2 | Pending |
| CHAT-04 | Phase 2 | Pending |
| CHAT-05 | Phase 2 | Pending |
| LLM-01 | Phase 2 | Pending |
| LLM-02 | Phase 2 | Pending |
| LLM-03 | Phase 2 | Pending |
| AGNT-01 | Phase 3 | Pending |
| AGNT-02 | Phase 3 | Pending |
| AGNT-03 | Phase 3 | Complete |
| AGNT-04 | Phase 3 | Complete |
| AGNT-05 | Phase 3 | Complete |
| SKIL-01 | Phase 3 | Pending |
| SKIL-02 | Phase 3 | Pending |
| SKIL-03 | Phase 3 | Pending |
| MCP-01 | Phase 3 | Pending |
| MCP-02 | Phase 3 | Pending |
| MCP-03 | Phase 3 | Pending |
| MCP-04 | Phase 3 | Pending |
| WFLO-01 | Phase 4 | Pending |
| WFLO-02 | Phase 4 | Pending |
| WFLO-03 | Phase 4 | Pending |
| WFLO-04 | Phase 4 | Pending |
| WFLO-05 | Phase 4 | Pending |
| WFLO-06 | Phase 4 | Pending |
| WFLO-07 | Phase 4 | Pending |
| REVIEW-03.2-RUNTIME | Phase 03.2 | Complete |
| REVIEW-03.2-CONTEXT | Phase 03.2 | Complete |
| REVIEW-03.2-SUBAGENT | Phase 03.2 | Complete |
| REVIEW-03.2-HUMAN | Phase 03.2 | Complete |
| REVIEW-03.2-OPTIMIZE | Phase 03.2 | Complete |
| REVIEW-03.2-REPORT | Phase 03.2 | Complete |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-05-21*
*Last updated: 2026-05-21 after roadmap creation*

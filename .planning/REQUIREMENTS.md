# Requirements: pi-workbench

> 基于 pi-coding-agent + GSD 的桌面 agent 工作台

**Defined:** 2026-05-19
**Core Value:** 用户可以通过 GUI 方便地管理和调用 AI agent 及 GSD 编码工作流

## v1 Requirements

### Workspace

- [x] **WS-01**: 用户可以通过系统对话框选择本地文件夹作为工作区
- [x] **WS-02**: 应用记录最近打开的工作区列表，支持快速切换
- [x] **WS-03**: 切换工作区时自动清理旧 agent session 并初始化新 session
- [x] **WS-04**: 应用启动时可自动恢复上次使用的工作区

### AI Chat

- [x] **CHAT-01**: 用户可以在聊天面板中输入消息与 AI agent 对话
- [x] **CHAT-02**: agent 回复流式实时显示（streaming）
- [x] **CHAT-03**: 消息支持 Markdown 渲染（代码块、列表、表格等）
- [x] **CHAT-04**: 对话历史可持久化到本地，重启后恢复
- [x] **CHAT-05**: 用户可清空或新建对话

### Model Provider

- [x] **PROV-01**: 用户可以添加 AI 模型提供商（至少支持 Anthropic、OpenAI）
- [x] **PROV-02**: 用户可以为每个提供商配置 API Key
- [x] **PROV-03**: 用户可以在可用模型中选择当前对话使用的模型
- [x] **PROV-04**: 模型配置持久化到本地存储
- [x] **PROV-05**: 连接失败时给出友好错误提示

### Skills 管理

- [ ] **SKILL-01**: 应用自动发现工作区 `.pi/` 目录下的 skills 并列表展示
- [ ] **SKILL-02**: 用户可以从本地文件系统导入 skill（`.md` 文件）
- [ ] **SKILL-03**: 用户可以从 GitHub 仓库下载安装 skills（`/owner/repo` 格式）
- [ ] **SKILL-04**: 用户可以在 UI 中预览 skill 的描述和内容
- [ ] **SKILL-05**: 用户点击执行 skill，内容发送到当前 agent 对话
- [ ] **SKILL-06**: 应用自动集成 pi-gsd 的全部工作流（prompts + workflows）

### MCP 管理

- [ ] **MCP-01**: 用户可以添加 MCP server 配置（名称、启动命令、参数）
- [ ] **MCP-02**: 用户可以连接/断开 MCP server
- [ ] **MCP-03**: 已连接的 MCP server 工具自动注册到 agent 的可用工具集
- [ ] **MCP-04**: agent 调用 MCP 工具的结果正常返回并显示
- [ ] **MCP-05**: 应用退出时自动断开所有 MCP 连接
- [ ] **MCP-06**: MCP 配置按工作区存储和恢复

### GSD 集成

- [x] **GSD-01**: 应用中可调用 pi-gsd 的全部 commands（`/gsd-plan-phase`、`/gsd-execute-phase` 等）
- [ ] **GSD-02**: GSD 子 agent（executor、planner、debugger 等）可通过 skill 执行自动生成
- [ ] **GSD-03**: `.planning/` 目录内容可在界面中查看

### UI 基础

- [x] **UI-01**: 应用有侧边栏 + 主内容区的标准布局
- [ ] **UI-02**: 侧边栏包含 Skills、MCP、Settings 等导航项
- [ ] **UI-03**: 主内容区以聊天面板为核心
- [ ] **UI-04**: 支持明暗主题切换（跟随系统或手动选择）
- [x] **UI-05**: 窗口大小/位置可保存和恢复

## v2 Requirements

### 工作流可视化

- **VIZ-01**: 在 UI 中看到 GSD phase/plan/task 的进度
- **VIZ-02**: 多 workspace 仪表盘

### Agent 扩展

- **AGNT-01**: 可视化创建和配置自定义 agent
- **AGNT-02**: Agent 预设模板

### 协作

- **COLLAB-01**: Agent 市场/商店
- **COLLAB-02**: 团队共享配置

## Out of Scope

| Feature | Reason |
|---------|--------|
| 拖拽式工作流编辑器 | V2 功能，V1 以人工调用 skills 为主 |
| 作为 MCP server 暴露 | V1 只做客户端调用他人 server |
| 移动端 | Desktop only |
| 多用户/团队协作 | V1 为个人工具 |
| Agent 市场/商店 | 需要后端服务 |
| AI IDE 级别的代码编辑 | 定位是工作台，不是 IDE |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WS-01~04 | Phase 1 | Pending |
| PROV-01~05 | Phase 1 | Pending |
| UI-01~05 | Phase 1 | Pending |
| CHAT-01~05 | Phase 2 | Pending |
| GSD-01 | Phase 2 | Complete |
| SKILL-01~06 | Phase 3 | Pending |
| GSD-02~03 | Phase 3 | Pending |
| MCP-01~06 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0 ✅

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after roadmap creation*
# Features Research: Desktop Agent Workbench

> 同类工具特性分析

## 同类产品参考

| 工具 | 类型 | 特点 |
|------|------|------|
| **Claude Desktop** | 桌面 AI 对话 | MCP 支持，对话管理，简单配置 |
| **Cursor** | AI IDE | 深度代码编辑集成，多模型支持 |
| **Pi (coding-agent)** | CLI agent | 高度可扩展，skills 系统，MCP 插件，多 provider |
| **OpenCode** | CLI agent | 简洁，和 pi 类似的 agent 能力 |
| **ChatGPT Desktop** | 桌面 AI 对话 | 语音输入，多模态，文件上传 |
| **Continue (VS Code)** | IDE 插件 | 多模型，自定义 agent，MCP 集成 |

## V1 应该包含的特性

### 核心功能（Table Stakes）

- [x] **AI 对话界面** — 标准 chat UI，消息流式显示
- [x] **多 Model Provider 支持** — 可配置 API Key、切换模型
- [x] **本地 Workspace 管理** — 选择项目文件夹作为工作区
- [x] **对话历史持久化** — 保存/恢复会话
- [x] **Skills 安装和管理** — 本地导入 + GitHub 下载
- [x] **MCP Server 管理** — 添加/连接/断开 MCP 服务

### 差异化能力（Differentiators）

- [ ] **Skills 驱动子 agent** — 点击 skill 自动生成 GSD 子 agent（executor、planner、debugger 等）
- [ ] **GSD 工作流可视化** — 在 GUI 中看到 phase/plan/task 的进度
- [ ] **MCP tools 注入 agent** — 连接的 MCP server 工具自动成为 agent 可用工具
- [ ] **多 Workspace 切换** — 在不同项目之间快速切换

### V2+ 备用

- 可视化流程编排（拖拽式 agent pipeline）
- Agent 市场/商店
- 自定义 Agent 创建 UI
- 团队协作
- 作为 MCP server 暴露

## 特性优先级矩阵

| 特性 | 价值 | 复杂度 | V1 优先级 |
|------|------|--------|-----------|
| AI 对话 | ⭐⭐⭐⭐⭐ | 中 | P0 |
| Workspace 选择 | ⭐⭐⭐⭐⭐ | 低 | P0 |
| Model Provider 配置 | ⭐⭐⭐⭐⭐ | 低 | P0 |
| Skills 安装 | ⭐⭐⭐⭐ | 中 | P0 |
| Skills 执行 | ⭐⭐⭐⭐⭐ | 中 | P0 |
| MCP 管理 | ⭐⭐⭐⭐ | 中 | P0 |
| 对话历史 | ⭐⭐⭐⭐ | 中 | P0 |
| GSD 进度可视化 | ⭐⭐⭐ | 高 | P1 |
| 多 Workspace | ⭐⭐⭐ | 低 | P1 |
| Async 后台 agent | ⭐⭐⭐ | 高 | V2 |

## V1 不做的特性

| 特性 | 原因 |
|------|------|
| 拖拽式工作流编辑器 | V2 功能，现在太重 |
| Agent 市场 | 需要后端服务 |
| 团队协作 | 需要账号系统和服务端 |
| 语音输入 | 非核心场景 |
| 作为 MCP server 暴露 | V1 只做客户端 |
| AI IDE 级别的代码编辑 | 聚焦在工作台，不是 IDE |
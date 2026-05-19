# Phase 1: Foundation & Workspace - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

搭建 Electron + React + TypeScript 桌面应用骨架，包括工作区选择与管理、LLM 模型提供商配置、以及基础 UI 外壳（侧边栏 + 主内容区布局）。本阶段交付一个可启动的桌面应用，用户能选工作区、配 API Key、看到基本界面框架。

**覆盖需求：** WS-01~04, PROV-01~05, UI-01~05

</domain>

<decisions>
## Implementation Decisions

### UI Component Library
- **D-01:** 使用 **shadcn/ui + Radix** 作为 UI 组件库，基于 Tailwind CSS
- **D-02:** 无额外重量级 UI 框架（不引入 Ant Design / MUI）

### Data Persistence
- **D-03:** 使用 **electron-store**（v11, sindresorhus）做数据持久化
- **D-04:** 存储内容：工作区历史列表、模型提供商配置、窗口状态/位置、主题偏好
- **D-05:** API Key 使用 electron-store 的 encryptionKey 加密存储

### App Startup Flow
- **D-06:** 首次启动 → 以**启动目录为默认工作区**，直接进入主界面，无需欢迎向导
- **D-07:** 后续启动 → **自动恢复上次使用的工作区**
- **D-08:** 用户可通过侧边栏**工作区标题 hover 显示的「+」按钮**添加新工作区（调用系统文件夹选择对话框）
- **D-09:** 切换工作区时自动初始化新的 pi SDK agent session，旧 session 不销毁（任务不中断）

### Layout & Navigation
- **D-10:** 参考 **Codex Desktop 的侧边栏布局**，左侧固定宽度侧边栏（~240-280px）
- **D-11:** 侧边栏从上到下结构：
  1. **新对话按钮** — 创建独立对话（Phase 2 生效）
  2. **导航项** — Skills（置灰，Phase 3）、MCP（置灰，Phase 4）、Settings（可点击）
  3. **工作区列表** — 显示所有工作区，每个工作区可展开查看其 threads
  4. **独立对话列表** — 不归属工作区的对话（Phase 2 生效）
- **D-12:** 主内容区无对话时显示**居中欢迎对话框**，标题「我们该做什么？」（可自定义）
- **D-13:** 侧边栏导航项中 Skills 和 MCP 在 Phase 1 暂时**置灰显示**「即将推出」

### Model Provider Configuration
- **D-14:** 采用**预设模板 + API Key 表单**方式配置提供商
- **D-15:** 预设模板覆盖：Anthropic、OpenAI、Google
- **D-16:** 配置入口为**设置页面**（全页，非对话框），点击侧边栏 Settings 进入
- **D-17:** 每个提供商配置：API Key 输入框 + 可用模型列表自动获取 + 默认模型选择
- **D-18:** 额外支持「自定义 OpenAI 兼容」入口（手动输入 Base URL）
- **D-19:** 连接失败时在设置页面内显示友好错误提示

### Theme
- **D-20:** **三档切换**：亮色 / 暗色 / 跟随系统
- **D-21:** 默认跟随系统（macOS 自动切换）
- **D-22:** 切换入口仅在**设置页面**
- **D-23:** 偏好通过 electron-store 持久化

### Window State
- **D-24:** 窗口大小/位置在关闭时保存，启动时恢复
- **D-25:** 使用 electron-store 持久化窗口状态（x, y, width, height, maximized）

### the agent's Discretion
- 加载动画/骨架屏的具体设计
- 欢迎对话框的具体样式和文案
- 空状态、错误状态的具体 UI 处理
- 工作区列表的排序和展示细节
- 主题切换的具体 CSS 变量命名方案
- 文件选择对话框的初始目录策略

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level context
- `.planning/PROJECT.md` — 项目愿景、核心技术决策（Electron, shadcn/ui, pi SDK）
- `.planning/REQUIREMENTS.md` — 完整需求详情：WS-01~04, PROV-01~05, UI-01~05
- `.planning/ROADMAP.md` — Phase 1 目标、成功标准、边界定义
- `.planning/STATE.md` — 当前项目进度和已做决策

### No external specs yet
当前项目无外部 ADR 或规格文档。所有需求已在 REQUIREMENTS.md 和本 CONTEXT.md 中完整捕获。后续阶段添加 ADR 时此处会更新。

</canonical_refs>

<code_context>
## Existing Code Insights

### Greenfield Project
当前代码库为空（无 src/、无 package.json、无已有组件）。本阶段需从零搭建项目脚手架。

### Key Dependencies (Determined)
- **Electron** — 桌面框架（已决策）
- **React + TypeScript** — 前端栈（已决策）
- **shadcn/ui + Radix** — UI 组件库（已决策）
- **Tailwind CSS** — 样式方案（shadcn/ui 依赖）
- **electron-store** — 数据持久化（已决策）
- **pi SDK** (`@earendil-works/pi-coding-agent`) — 核心 AI agent 引擎（主进程集成，已决策）

### Integration Points
- **主进程** — pi SDK 集成、electron-store 管理、IPC 通信、窗口管理
- **渲染进程** — React UI、shadcn/ui 组件、主题切换
- **IPC 桥梁** — 主进程 ↔ 渲染进程（设置读写、工作区操作、窗口状态）

### Scaffolding
项目脚手架推荐使用 **electron-vite**（基于 Vite 的 Electron 构建工具），集成 React + TypeScript + Tailwind 支持。无需 electron-forge 或 electron-builder 的复杂配置。

</code_context>

<specifics>
## Specific Ideas

- 欢迎对话框标题可自定义，当前使用「我们该做什么？」作为默认文案
- 代码参考 Codex Desktop 的侧边栏交互（hover 显示 + 按钮等）
- 用户偏好「启动目录为默认工作区」，不需要欢迎向导

</specifics>

<deferred>
## Deferred Ideas

None — 讨论保持在 Phase 1 范围内。

</deferred>

---

*Phase: 01-foundation-workspace*
*Context gathered: 2026-05-19*
# Phase 1: Foundation Workspace - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

## Phase Boundary

Electron 桌面应用脚手架：应用启动框架、主界面布局（侧边栏 + 主聊天区 + 悬浮任务展板）、主题切换系统、项目管理基础设施。

<decisions>
## Implementation Decisions

### 主界面布局
- **D-01:** 基于 `codex-onboarding.html` 和 `dashboard.html` 高保真设计稿实现
- **D-02:** 三区域结构：可折叠/可调节宽度左侧边栏 + 主聊天区 + 悬浮任务展板（右下角）
- **D-03:** 侧边栏支持拖拽调节宽度（200px ~ 500px）
- **D-04:** 侧边栏可完全折叠，折叠时显示固定拉手按钮

### 主题系统
- **D-05:** CSS 变量实现主题（`--bg-app`, `--bg-sidebar`, `--accent` 等）
- **D-06:** 深色/浅色/跟随系统三模式
- **D-07:** 跟随系统使用 `prefers-color-scheme` Media Query 自动监听系统主题变化

### 项目管理结构
- **D-08:** 每个项目对应一个本地文件夹路径（代码仓库目录）
- **D-09:** 用户通过"创建项目"选择本地代码仓库目录
- **D-10:** 项目树结构：项目 → 会话（一个项目下可挂载多个会话）

### 技术栈
- **D-11:** 使用 electron-vite 作为构建工具
- **D-12:** 使用 electron-store 存储配置（主题偏好等简单数据）
- **D-13:** 使用 better-sqlite3 存储结构化数据（项目配置、会话历史等）

</decisions>

<canonical_refs>
## Canonical References

### 高保真设计稿
- `codex-onboarding.html` — 主界面布局参考（侧边栏结构、主题切换、对话输入框样式）
- `dashboard.html` — 工作台布局参考（项目树、任务展板、聊天界面）

### 技术栈（来自研究）
- `research/STACK.md` — Electron + electron-vite + React 技术栈
- `research/ARCHITECTURE.md` — Main/Renderer 进程架构、IPC 通信模式

</canonical_refs>

<codebase_context>
## Existing Code Insights

### Reusable Assets
- CSS 变量主题系统：直接在 `dashboard.html` 中验证可用，迁移到 React + Tailwind

### Established Patterns
- 侧边栏折叠逻辑：抽屉式设计，CSS transition 实现平滑动画
- 项目树结构：可折叠 section + 子项层级

### Integration Points
- Phase 2 AI Chat Engine 将在此框架基础上集成 assistant-ui 对话组件
- Phase 3 Agent Integration 将在侧边栏添加 Agent 资产管理面板

</codebase_context>

<specifics>
## Specific Ideas

- 主题切换按钮放在侧边栏底部，与"设置"按钮并列
- 项目徽章"当前项目"使用紫色半透明背景 (`--accent-dim`)
- 任务展板可折叠，收起时只显示标题栏
- 消息区域：用户消息有气泡背景，AI 消息无气泡直接渲染

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 1-Foundation Workspace*
*Context gathered: 2026-05-21*

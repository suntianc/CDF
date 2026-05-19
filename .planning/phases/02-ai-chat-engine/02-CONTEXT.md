# Phase 2: AI Chat Engine - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

构建核心对话体验——用户可以跟 AI agent 对话，支持流式显示、Markdown 渲染、对话历史持久化、GSD 命令调用。不涵盖 Skills 管理、MCP 集成、GSD 子 agent 生成（这些属于 Phase 3/4）。

**覆盖需求：** CHAT-01~05, GSD-01

</domain>

<decisions>
## Implementation Decisions

### 聊天界面布局
- **D-01:** 上下结构，输入框固定底部，消息列表在上方
- **D-02:** 标准对话气泡（头像+气泡），用户消息在右，AI 消息在左
- **D-03:** 侧边栏对话列表仅显示标题，点击后加载完整对话
- **D-04:** 侧边栏显示最近 10 条对话 +「查看更多」
- **D-05:** 单对话模式，一次只能有一个活跃对话
- **D-06:** 切换工作区时清空当前对话，显示欢迎对话框
- **D-07:** 启动时显示欢迎对话框，用户手动从侧边栏选择对话恢复

### 对话管理
- **D-08:** AI 根据第一轮消息自动生成标题，用户可手动修改
- **D-09:** 对话标题固定为第一次 AI 生成的标题，不随后续消息刷新
- **D-10:** 「新建对话」按钮：自动保存当前对话（如果有内容）→ 清空 → 显示欢迎对话框

### 流式显示
- **D-11:** 立即显示光标/「思考中...」动画，第一个 token 到达后平滑过渡到文字
- **D-12:** 流式渲染：逐 chunk 追加（无防抖）
- **D-13:** 中断方式：发送按钮变为停止按钮（红色）+ Escape 快捷键
- **D-14:** 停止时：显示「已停止」标记，输出截断，新消息立即发送

### 输入区域
- **D-15:** Enter 发送，Shift+Enter 换行
- **D-16:** 输入框自动增高，1→6-8 行，超过后出现滚动条
- **D-17:** 占位符固定显示「输入消息，或 /gsd-* 执行命令」
- **D-18:** AI 回复中，输入框为空时显示「停止」按钮；有内容时显示「发送」按钮（进入队列）

### 消息队列
- **D-19:** 消息队列显示在输入框上方，卡片式（浅灰背景 + 圆角 + 边框）
- **D-20:** 队列中每条消息显示：消息预览（最多 50 字符）+ ↩︎（引导/立即发送）+ ×（删除）
- **D-21:** 引导行为：标记「已引导」+ 立即发送（打断当前 AI 输出）
- **D-22:** 队列中消息按正序排列（旧在上），无限制长度
- **D-23:** 队列超出可视区域时，自动滚动到底部
- **D-24:** 队列默认展开，可折叠；折叠时显示 ⏫ 图标
- **D-25:** 队列展开/折叠使用平滑动画（200ms 高度渐变）
- **D-26:** 队列中按钮始终可用，无禁用状态
- **D-27:** 队列中无需状态标签
- **D-28:** 引导按钮样式：↩︎ 符号，白色背景 + 灰色边框
- **D-29:** 删除按钮样式：× 符号，红色文字
- **D-30:** 立即发送/引导按钮悬停效果：背景变浅灰

### 消息状态
- **D-31:** 用户消息在对话流中显示：消息内容 + 状态标签（发送中/已发送/已引导/已停止）
- **D-32:** 「已引导」标记显示在对话流中用户消息旁边
- **D-33:** 消息发送后，输入框显示「已发送」绿色提示，2 秒后消失

### Markdown 渲染
- **D-34:** 使用 shiki 做代码高亮，配合 shadcn Card 组件包裹代码块
- **D-35:** 每个代码块右上角显示「复制」按钮，点击复制代码到剪贴板

### GSD 命令集成
- **D-36:** 输入 `/gsd-` 时自动拦截，弹出富命令补全菜单（命令名+描述+参数提示）
- **D-37:** 命令补全 UI：实时过滤 + 键盘导航（↑↓选择，Enter 确认，Escape 取消）
- **D-38:** GSD 命令结果以卡片形式展示：状态（成功/失败）+ 输出摘要 + 展开按钮 + 复制按钮
- **D-39:** GSD 命令失败时，卡片显示错误信息 + 重试按钮
- **D-40:** 所有 GSD 失败都显示重试按钮

### 错误处理
- **D-41:** AI 回复出错时，显示错误卡片（红色 Alert 样式）+ 重试按钮

### 图片上传
- **D-42:** 根据模型类型动态显示上传功能：多模态模型显示，纯 LLM 隐藏
- **D-43:** 自定义模型需手动标记 `multimodal: true/false`
- **D-44:** 图片以缩略图形式嵌入在消息气泡中，点击可放大查看

### thinking 显示
- **D-45:** 当模型启用 thinking 模式时，在折叠卡片中显示思考过程，思考完毕自动折叠

### 工具调用
- **D-46:** AI 执行工具时，显示工具调用卡片：工具名 + 参数 + 状态 + 结果

### 历史持久化
- **D-47:** 使用 pi SDK SessionManager 管理对话持久化（`SessionManager.create(cwd)`）
- **D-48:** 存储位置：`~/.pi/agent/sessions/<cwd-hash>/`，按工作区隔离
- **D-49:** 对话列表通过 `SessionManager.list(cwd)` 获取
- **D-50:** 流式事件通过 `session.subscribe()` 接收

### the agent's Discretion
- 欢迎对话框的具体样式和文案（当前使用「我们该做什么？」）
- 加载动画/骨架屏的具体设计
- 错误状态的具体 UI 处理
- 工作区列表的排序和展示细节
- 消息气泡的头像来源（用户头像 vs 默认图标）
- 消息时间戳的显示方式
- 代码块的语言检测逻辑
- 队列卡片的具体尺寸和间距
- 输入框的具体高度和边距
- 消息状态标签的具体样式和颜色

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level context
- `.planning/PROJECT.md` — 项目愿景、核心技术决策
- `.planning/REQUIREMENTS.md` — 完整需求详情：CHAT-01~05, GSD-01
- `.planning/ROADMAP.md` — Phase 2 目标、成功标准、边界定义
- `.planning/STATE.md` — 当前项目进度和已做决策

### pi SDK Session Management
- `/Users/suntc/.nvm/versions/node/v22.21.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/sessions.md` — Session 持久化、列表、命名、树结构
- `/Users/suntc/.nvm/versions/node/v22.21.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` — `createAgentSession()`, `SessionManager`, `AgentSession` API

### 外部参考
- [Archon slash command autocomplete](https://github.com/coleam00/Archon/issues/1204) — 命令补全 UI 模式参考

### 无外部 ADR 或规格文档
当前项目无外部 ADR 或规格文档。所有需求已在 REQUIREMENTS.md 和 CONTEXT.md 中完整捕获。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Sidebar component** (`pi-workbench/src/renderer/src/components/Sidebar.tsx`): 已有侧边栏结构，需扩展对话列表
- **WelcomeDialog component** (`pi-workbench/src/renderer/src/components/WelcomeDialog.tsx`): 已有欢迎对话框，需扩展
- **shadcn/ui components**: button, card, dialog, input, badge, separator, sheet, tabs, tooltip
- **electron-store**: 已有数据持久化机制
- **IPC handlers** (`pi-workbench/src/main/ipc.ts`): 已有 store/workspace/theme/providers 的 IPC 接口

### Established Patterns
- 主进程直接集成 pi SDK，IPC 仅传输事件到渲染层
- 渲染进程使用 React + TypeScript + Tailwind CSS
- 使用 electron-store 做数据持久化（需迁移到 pi SDK SessionManager）

### Integration Points
- **主进程**: 需集成 pi SDK `createAgentSession()` + `SessionManager`
- **渲染进程**: 需新增聊天面板组件、消息队列组件、命令补全组件
- **IPC 桥梁**: 需新增 session 相关接口（send message, stream events, session list）

### 需新增的组件
- `ChatPanel.tsx`: 聊天主面板
- `MessageBubble.tsx`: 消息气泡
- `MessageQueue.tsx`: 消息队列
- `CommandPalette.tsx`: GSD 命令补全菜单
- `GSDResultCard.tsx`: GSD 命令结果卡片
- `ToolCallCard.tsx`: 工具调用卡片
- `ThinkingBlock.tsx`: thinking 过程卡片
- `ErrorCard.tsx`: 错误卡片
</code_context>

<specifics>
## Specific Ideas

- 欢迎对话框标题可自定义，当前使用「我们该做什么？」作为默认文案
- 代码参考 Archon 的 slash command 补全模式
- 用户偏好「启动目录为默认工作区」，不需要欢迎向导
- 消息队列的「引导」按钮用 ↩︎ 符号，简洁直观
- GSD 命令结果卡片需支持展开/折叠和复制

</specifics>

<deferred>
## Deferred Ideas

None — 讨论保持在 Phase 2 范围内。

</deferred>

---

*Phase: 02-ai-chat-engine*
*Context gathered: 2026-05-20*
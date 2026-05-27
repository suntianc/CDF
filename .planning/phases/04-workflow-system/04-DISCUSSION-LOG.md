# Phase 4: Workflow System - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 4-Workflow System
**Areas discussed:** 编辑器布局与交互, 节点类型与配置, 执行引擎与数据流, 状态推送与持久化

---

## 编辑器布局与交互

### Q1: 工作流编辑器在 App 中如何呈现？

| Option | Description | Selected |
|--------|-------------|----------|
| 独立全屏视图（推荐） | Sidebar 新增「工作流」按钮，点击切换到全屏 ReactFlow 编辑器视图（类似 agents 视图） | ✓ |
| 编辑器 + 状态面板 | 编辑器占据主区域，右侧或底部保留一个可折叠的执行状态面板 | |
| 左右分屏 | 左侧聊天区，右侧工作流编辑区，类似 IDE 的分屏布局 | |

**User's choice:** 独立全屏视图
**Notes:** 无额外说明

### Q2: 用户如何在画布上创建节点？

| Option | Description | Selected |
|--------|-------------|----------|
| 拖拽面板（推荐） | 左侧面板列出可用节点类型（Agent 节点/普通节点），拖拽到画布创建。ReactFlow 原生支持。 | ✓ |
| 右键菜单 | 画布空白处右键弹出菜单，选择节点类型创建 | |
| 工具栏按钮 | 工具栏按钮，点击后在画布中心创建节点 | |

**User's choice:** 拖拽面板
**Notes:** 无额外说明

### Q3: 编辑器的内部布局如何安排？

| Option | Description | Selected |
|--------|-------------|----------|
| 全画布 + 抽屉配置（推荐） | 画布占满整个视图区域，左侧面板可折叠。节点配置通过点击节点弹出侧边抽屉（Drawer）编辑 | ✓ |
| 固定左面板 + 右画布 | 画布左侧固定面板（节点列表 + 配置），右侧为画布区域 | |
| 全画布 + 弹窗配置 | 画布占满，节点配置通过双击节点弹出模态对话框（Dialog） | |

**User's choice:** 全画布 + 抽屉配置
**Notes:** 无额外说明

### Q4: 用户如何管理工作流？

| Option | Description | Selected |
|--------|-------------|----------|
| 列表 → 编辑器（推荐） | Sidebar 新增工作流入口，内部先显示工作流列表（卡片），点击某个工作流进入编辑器 | ✓ |
| 直接进编辑器 | 直接进入空白编辑器，通过工具栏的下拉菜单切换/新建工作流 | |

**User's choice:** 列表 → 编辑器
**Notes:** 无额外说明

---

## 节点类型与配置

### Q1: Agent 节点如何引用已有的 Agent 资产？

| Option | Description | Selected |
|--------|-------------|----------|
| 引用资产库（推荐） | 节点配置时从 Agent 资产库下拉选择，自动继承该 Agent 的 LLM/MCP/Skills 配置。节点上显示 Agent 名称和图标。 | ✓ |
| 引用 + 覆盖 | 节点内可覆盖 Agent 的部分配置（如换一个 LLM），但基础配置仍来自资产库 | |

**User's choice:** 引用资产库
**Notes:** 无额外说明

### Q2: 工作流中节点类型的设计哲学？

| Option | Description | Selected |
|--------|-------------|----------|
| 纯 Agent 编排 | 所有节点都是 Agent 节点，不存在「普通节点」概念。工作流的核心是 Agent 之间的编排逻辑。 | |
| Agent 为主 + 辅助节点 | 主要用 Agent 节点，但保留少量特殊节点类型（如开始/结束/条件判断） | |

**User's choice:** 用户选择「Other」并描述：「不应该有这种什么脚本节点，普通节点，应该都是 agent 节点，重点在如何编排，重在条件分支、如何循环、如何停止、主 agent 如何介入等等」，后续补充「辅助节点应该只有开始和结束，甚至条件判断都应该是一个 agent 或者 master agent 介入来承担」

**Notes:** 这是一个核心架构决策——所有可执行节点都是 Agent 节点，工作流的本质是 Agent 编排而非脚本编排。

### Q3: 条件分支如何工作？

| Option | Description | Selected |
|--------|-------------|----------|
| Agent 输出决定分支（推荐） | 分支由 Agent 输出决定（如返回 {next: "A"} 或 {next: "B"}），Agent 自主判断走哪条路径 | |
| Master Agent 决定分支 | Master Agent 在执行到分支点时介入，由 Master Agent 决定走哪条路径 | |
| 混合模式 | 两种都支持：简单分支由 Agent 自主，关键分支由 Master Agent 介入 | ✓ |

**User's choice:** 混合模式，编排时可自主选择
**Notes:** 用户强调编排阶段应可自主选择使用哪种分支模式

### Q4: 工作流如何支持循环？

| Option | Description | Selected |
|--------|-------------|----------|
| 内置循环节点（推荐） | 支持循环结构（do-while/for），循环条件由 Agent 输出或 Master Agent 判断 | ✓ |
| Agent 自循环 | 通过 Agent 自我调用实现循环（Agent 输出触发重新执行自身），无显式循环结构 | |
| v1 不做循环 | v1 不支持循环，只支持线性 + 分支 | |

**User's choice:** 内置循环节点
**Notes:** 无额外说明

### Q5: 节点失败时如何处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 节点级失败策略 + Master 决断（推荐） | 每个节点可配置「失败时」行为：重试/跳过/停止并汇报 Master Agent。Master Agent 可决定继续/终止/修改参数重试 | ✓ |
| 全局失败即停止 | 任何节点失败都自动停止整个工作流，汇报 Master Agent | |
| 失败自动跳过 | 节点失败自动跳过，继续执行后续节点 | |

**User's choice:** 节点级失败策略 + Master 决断
**Notes:** 无额外说明

---

## 执行引擎与数据流

### Q1: 工作流执行引擎如何实现？

| Option | Description | Selected |
|--------|-------------|----------|
| LangGraph.js 驱动（推荐） | ReactFlow 图 → 转换为 LangGraph StateGraph → 由 LangGraph 运行时执行。利用 LangGraph 的状态管理、检查点、流式执行能力。 | ✓ |
| 自建执行引擎 | 自建执行引擎，不依赖 LangGraph。自己管理节点调度、状态传递、错误处理。 | |

**User's choice:** LangGraph.js 驱动
**Notes:** 无额外说明

### Q2: 节点之间的数据如何传递？

| Option | Description | Selected |
|--------|-------------|----------|
| 共享 State 模式（推荐） | LangGraph 的 State 对象在节点间传递，每个节点读取 state 并写入自己的输出。类似全局共享状态。 | ✓ |
| 消息传递模式 | 每个节点的输出通过边传递给下一个节点的输入，类似函数式管道 | |
| 混合模式 | 两种都支持：简单数据用共享 state，大数据/文件用消息传递 | |

**User's choice:** 共享 State 模式
**Notes:** 无额外说明

### Q3: 如何控制并行/串行执行？

| Option | Description | Selected |
|--------|-------------|----------|
| LangGraph fan-out/fan-in（推荐） | LangGraph 的 fan-out/fan-in 模式：多个节点并行执行，汇合后继续。用户在编辑器中通过连接线定义并行关系。 | ✓ |
| 并行容器节点 | 显式的「并行节点组」容器，放入其中的节点自动并行执行 | |
| v1 仅串行 | v1 只支持串行执行，并行留到 v2 | |

**User's choice:** LangGraph fan-out/fan-in
**Notes:** 无额外说明

### Q4: 工作流如何被触发执行？

| Option | Description | Selected |
|--------|-------------|----------|
| 编辑器内独立运行（推荐） | 用户在工作流编辑器中点击「运行」按钮启动，执行过程在编辑器内实时展示。与 Chat 视图独立。 | |
| Chat 中触发执行 | 用户在 Chat 中对 Master Agent 说「运行 XX 工作流」，Master Agent 触发执行，结果在 Chat 中展示 | |
| 双入口 | 两种都支持：编辑器可直接运行，Chat 中也可通过 Master Agent 触发 | ✓ |

**User's choice:** 双入口
**Notes:** 无额外说明

---

## 状态推送与持久化

### Q1: 工作流执行状态如何实时推送到 UI？

| Option | Description | Selected |
|--------|-------------|----------|
| IPC 事件流（推荐） | 复用现有的 IPC 事件流模式（类似 llm:chunk-{requestId}），LangGraph 执行事件通过 IPC channel 推送到渲染进程 | ✓ |
| 轮询模式 | 通过 Zustand Store 轮询主进程获取状态更新 | |
| WebSocket | WebSocket 连接，主进程推送实时状态 | |

**User's choice:** IPC 事件流
**Notes:** 无额外说明

### Q2: 工作流如何持久化保存？

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite 存储（推荐） | 新建 workflows 表存储：id, name, graph_data (JSON), created_at, updated_at。graph_data 包含 ReactFlow 的 nodes/edges/viewport。 | ✓ |
| JSON 文件存储 | 工作流保存为 JSON 文件，存储在项目目录下 | |
| 混合存储 | SQLite 存元数据 + JSON 文件存图数据 | |

**User's choice:** SQLite 存储
**Notes:** 无额外说明

### Q3: 工作流是否需要导入/导出功能？

| Option | Description | Selected |
|--------|-------------|----------|
| 支持导入导出（推荐） | 支持导出为 JSON 文件 + 从 JSON 文件导入。方便分享和备份。 | ✓ |
| v1 不做导入导出 | v1 不做导入导出，纯本地管理 | |

**User's choice:** 支持导入导出
**Notes:** 无额外说明

### Q4: 是否需要工作流执行历史？

| Option | Description | Selected |
|--------|-------------|----------|
| 完整执行历史（推荐） | 每次执行记录：开始时间、结束时间、每个节点的输入输出、成功/失败状态。可通过历史记录回看。 | ✓ |
| 仅最近一次 | 只记录最近一次执行状态，不保留历史 | |
| v1 不做 | v1 不做执行历史 | |

**User's choice:** 完整执行历史
**Notes:** 无额外说明

---

## Claude's Discretion

无 — 所有决策均由用户明确选择。

## Deferred Ideas

- 工作流版本管理（v2 需求，REQUIREMENTS.md 中 WFLO-08）
- 工作流执行回滚（v2 需求，REQUIREMENTS.md 中 WFLO-09）
- 工作流模板/市场功能 — 未来阶段
- 节点执行超时配置 UI — v1 可硬编码默认值
- 工作流执行并发限制 — 未来阶段

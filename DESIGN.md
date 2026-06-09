---
name: CDF
description: 本地 Agent 指挥舱，让开发者在自己的机器上调度、审批和观察自动化开发流程。
colors:
  command-black: "#101114"
  panel-black: "#17191d"
  app-graphite: "#1f2228"
  surface-graphite: "#282c34"
  raised-graphite: "#303541"
  trace-line: "#d7e1ff14"
  border-strong: "#d7e1ff24"
  text-primary: "#f0f3f7"
  text-secondary: "#c3cad680"
  text-muted: "#c3cad64d"
  execution-violet: "#7c3aed"
  execution-violet-hover: "#8b5cf6"
  execution-violet-dim: "#7c3aed1f"
  success: "#22c55e"
  danger: "#ef4444"
  warning: "#f59e0b"
  info: "#3b82f6"
typography:
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "JetBrains Mono, SF Mono, Fira Code, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  panel: "28px 32px"
components:
  command-surface:
    backgroundColor: "{colors.panel-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "14px 16px 10px"
  button-primary:
    backgroundColor: "{colors.execution-violet}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  agent-panel:
    backgroundColor: "{colors.surface-graphite}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  input-field:
    backgroundColor: "{colors.command-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
---

# Design System: CDF

## 1. Overview

**Creative North Star: “指挥舱，不是仪表盘”**

CDF 的界面是一个本地 Agent 指挥舱。它不是用来展示漂亮数据的 dashboard，而是用来调度行动的桌面系统：开发者下达命令，Master Agent 规划路径，工具和子代理进入执行轨，用户在关键节点审批、暂停或恢复。

高级感来自系统秩序、执行可见性和局部张力。默认界面应安静、暗、精密；只有当命令被提交、Agent 正在运行、工具等待审批、工作流节点变化或错误需要处理时，信号色才出现。没有事件，就没有高亮。

当前代码里的深色基调可以保留，但视觉方向要从“普通深色 AI 工具 + 紫色品牌”推进到“冷黑工程系统 + 稀有执行信号”。紫色不再是泛品牌装饰，它是 **Execution Violet**，用于执行、焦点、选中、运行和编排状态。

**Key Characteristics:**

- 指挥舱布局：导航、命令台、执行轨、Agent 栈、编排画布，各自承担明确任务。
- 冷黑中性色主导，色彩只作为事件信号。
- 细线、层级、对齐和密度制造高级感，而不是阴影、发光和渐变制造气氛。
- 单一 sans + mono 仪表文字，保持桌面工具的长期可读性。
- 动效表达状态变化，不表演情绪。

## 2. Colors

这是一套冷黑工程调色板。中性色承担 90% 的界面表达，Execution Violet 和语义色只在行动发生时出现。

### Primary

- **Execution Violet** (`#7c3aed`): 命令提交、Agent 编排、当前选中、焦点 ring、运行状态和关键主操作。它不是装饰色。
- **Execution Violet Hover** (`#8b5cf6`): 主操作 hover、当前执行项的轻微增强、欢迎页少量品牌强调。
- **Execution Violet Dim** (`#7c3aed1f`): 用户消息、低强度选中背景、命令台焦点区域和 Agent 运行提示。

### Neutral

- **Command Black** (`#101114`): 最深层命令背景，用于输入区、代码区域和需要 recessed 感的局部。
- **Panel Black** (`#17191d`): 侧栏、命令台、任务面板底层。
- **App Graphite** (`#1f2228`): 应用主背景和聊天区域。
- **Surface Graphite** (`#282c34`): 卡片、弹层、设置块和 Agent 面板。
- **Raised Graphite** (`#303541`): hover、浮层、当前活动面板和临时提升区域。
- **Trace Line** (`#d7e1ff14`): 默认分割线、执行轨线、节点边界。
- **Strong Border** (`#d7e1ff24`): hover、focus-adjacent、弹层和需要更明确边界的容器。
- **Primary Text** (`#f0f3f7`): 标题、正文和关键状态。
- **Secondary Text** (`#c3cad680`): 次级说明、导航文本、按钮辅助文本。
- **Muted Text** (`#c3cad64d`): 时间戳、占位和低优先级提示。不要用于正文或关键状态。

### Semantic

- **Success Green** (`#22c55e`): 完成、在线、通过。
- **Danger Red** (`#ef4444`): 错误、失败、破坏性操作。
- **Warning Amber** (`#f59e0b`): 等待审批、条件分支、需要用户介入。
- **Info Blue** (`#3b82f6`): 非阻塞信息、系统提示、资源说明。

### Named Rules

**The Event Color Rule.** 所有彩色必须绑定事件：选中、运行、等待、失败、完成、聚焦或可执行。没有事件含义的彩色就是噪音。

**The 90/10 Rule.** 单屏 90% 应由冷黑中性色、线和排版承担；10% 以内给 Execution Violet 与语义色。

## 3. Typography

**Display Font:** Inter, with system fallbacks  
**Body Font:** Inter, with system fallbacks  
**Label/Mono Font:** JetBrains Mono, SF Mono, Fira Code, monospace

**Character:** CDF 使用单一 sans 字体保持系统工具感。Mono 不是装饰字体，而是仪表文字：模型名、token、时间、命令参数、JSON、工作流 ID 和执行日志使用 mono，让机器信息和人类说明一眼区分。

### Hierarchy

- **Title** (600, 16px, 1.25, -0.01em): 顶栏标题、弹窗标题、主区域名称。标题短，不写营销句。
- **Section Title** (600, 18px, 1.3): 设置页、资产页和任务面板的区域标题。
- **Body** (400, 14px, 1.7): 聊天消息、说明文本、工具结果正文。长文本保持 65 到 75ch。
- **Control** (500, 13px, 1.4): 按钮、导航、菜单、输入控件。
- **Label** (500 到 600, 11px 到 12px, 1.4): 字段名、状态名和分组名。大写只用于技术分组，不作为装饰性 eyebrow。
- **Instrumentation** (400, 12px 到 13px, 1.5): 代码、token 数、模型、时间戳、路径、JSON 和工作流技术细节。

### Named Rules

**The Instrumentation Rule.** Mono 只用于机器信息和结构化状态，不用于“看起来技术”的装饰。

**The Short Label Rule.** 控件文案要短、动词明确。用户在指挥舱里调度动作，不阅读营销文案。

## 4. Elevation

CDF 的层级来自材料、线和状态，不来自厚重阴影。默认表面是平的，使用冷黑层级区分深度。浮层、toast、菜单和正在交互的面板可以短暂提升，但阴影必须服务于“这个东西浮在当前工作流之上”的含义。

### Shadow Vocabulary

- **Popover Shadow** (`0 4px 20px rgba(0,0,0,0.4)`): 模型选择、菜单、临时列表。
- **Panel Lift** (`0 8px 24px rgba(0,0,0,0.18)`): 活动面板或悬停卡片的轻微提升。
- **Toast Shadow** (`0 10px 25px -5px rgba(0,0,0,0.20), 0 8px 10px -6px rgba(0,0,0,0.15)`): 浮动通知。
- **Signal Ring** (`0 0 0 3px var(--accent-dim)`): 焦点、命令台激活、需要用户确认的操作入口。

### Named Rules

**The Surface Before Shadow Rule.** 先用背景层级和线表达结构，只有浮层、焦点或状态变化才允许阴影。

## 5. Components

组件语言是指挥舱组件语言，不是通用卡片库。标准控件要保持标准，CDF 的独特性来自命令台、执行轨、Agent 栈和编排画布。

### Command Surface

- **Role:** 用户下达指令的主入口，不是普通 textarea。
- **Shape:** `14px` 到 `20px` 圆角，使用 `Panel Black` 或 `Command Black`，边框为 `Trace Line`。
- **Focus:** 边框切到 Execution Violet，使用轻微 Signal Ring。焦点只提示“命令台已激活”，不要大面积发光。
- **Controls:** 模型选择、上下文、附件和发送按钮是命令控制件，视觉上应嵌入同一个表面。

### Execution Rail

- **Role:** 展示工具调用、审批、子任务、折叠过程和运行结果。
- **Style:** 线性、时间性、可扫描。使用细线、状态点、短标签和 mono 元数据。
- **State:** running 使用 Execution Violet 或 Warning Amber；completed 使用 Success；failed 使用 Danger。状态必须配文字。
- **Motion:** 展开和折叠使用短促过渡，不用 bounce。

### Agent Stack

- **Role:** 承载当前 Agent 活动、待审批动作、子代理进度和失败恢复。
- **Style:** 面板化而不是卡片堆。用标题、状态槽和分隔线组织信息。
- **Density:** 高密度可以接受，但每个状态块必须有明确目标、动作和归属。

### Workflow Canvas

- **Role:** CDF 的主要视觉表达区域，展示行动图而不是装饰图。
- **Nodes:** 节点像系统元件，不像营销卡片。边、状态、输入输出和执行结果比图标更重要。
- **Edges:** 线条表达条件、顺序和循环。不要用彩色边作为装饰。
- **Selection:** 当前节点使用 Execution Violet，非当前节点保持中性。

### Buttons

- **Shape:** 默认 `10px`，紧凑、标准、可预测。
- **Primary:** Execution Violet 背景和白色文本，只用于真正主动作。
- **Secondary / Ghost:** 透明背景、细边框或 hover tonal fill，用于普通操作。
- **Destructive:** Danger Red，永远配明确文本。

### Inputs / Fields

- **Style:** 深色 recessed 背景、1px 边框、`10px` 圆角。
- **Focus:** Execution Violet 边框和轻 ring。
- **Placeholder:** `Muted Text` 只用于短占位，不用于说明正文。

### Navigation

- **Sidebar:** Panel Black 背景、细边框、13px/500 文本。active 是状态，不是装饰。
- **Topbar:** 低高度、低装饰，保留窗口区域和当前上下文。
- **Panels:** 右侧或抽屉面板使用 Agent Stack 语言，避免普通 dashboard 卡片堆叠。

### Chat Messages

- **Assistant:** 默认无气泡，像系统回传结果，保持阅读流。
- **User:** 使用低强度 Execution Violet containment，表达命令来源。
- **Code:** mono、低对比背景、小圆角、可复制，像仪表内容而不是装饰块。

## 6. Do's and Don'ts

### Do:

- **Do** 把 CDF 当成本地 Agent 指挥舱设计，不当作 AI 聊天网页设计。
- **Do** 用冷黑中性色、细线、状态槽和排版建立秩序。
- **Do** 只在选中、运行、等待、失败、完成、聚焦或可执行时使用彩色。
- **Do** 让 Agent、工具调用、审批和工作流节点都可定位、可解释、可追溯。
- **Do** 把 Command Surface、Execution Rail、Agent Stack、Workflow Canvas 作为 signature components 维护。
- **Do** 让 mono 字体承担仪表信息，而不是装饰气质。

### Don't:

- **Don't** 把产品做成普通 AI Chat App、紫色 SaaS Dashboard、VS Code 皮肤、黑绿 Hacker Terminal 或云端营销页。
- **Don't** 使用渐变文字作为通用规则。欢迎页可以少量使用品牌渐变，工作区不使用。
- **Don't** 使用 hero-metric 模板、重复图标卡片网格、过度玻璃拟态、霓虹边框或无意义发光装饰。
- **Don't** 把 Execution Violet 当作普通品牌装饰铺满界面。
- **Don't** 让工作流节点看起来像通用卡片。它们是行动元件。
- **Don't** 用 `Muted Text` 承载正文或关键状态。
- **Don't** 让动画表演情绪。动效只表达状态变化。
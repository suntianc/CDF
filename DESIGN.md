---
name: CDF
description: 离线优先的 Agent 开发工作站，让开发者在本机用自然语言编排、审批和观察自动化开发流程。
colors:
  app-bg: "#212121"
  sidebar-bg: "#191919"
  surface-bg: "#2d2d2d"
  hover-bg: "#ffffff0f"
  active-bg: "#ffffff1a"
  border: "#ffffff1a"
  border-strong: "#ffffff29"
  text-primary: "#ececec"
  text-secondary: "#ffffff8c"
  text-muted: "#ffffff4d"
  orchestration-violet: "#7c3aed"
  orchestration-violet-hover: "#8b5cf6"
  orchestration-violet-dim: "#7c3aed1f"
  success: "#22c55e"
  danger: "#ef4444"
  warning: "#f59e0b"
  info: "#3b82f6"
  light-app-bg: "#f9f9f7"
  light-sidebar-bg: "#f0f0f0"
  light-surface-bg: "#eaeaea"
typography:
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
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
  button-primary:
    backgroundColor: "{colors.orchestration-violet}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.orchestration-violet-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  surface-card:
    backgroundColor: "{colors.surface-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  input-field:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
---

# Design System: CDF

## 1. Overview

**Creative North Star: “本地控制塔”**

CDF 的界面像一个本地控制塔：左侧是导航和资产入口，中间是对话和执行流，右侧或抽屉承载审批、任务和细节。视觉系统服务于“大胆、前沿、实验”的产品气质，但它首先是开发者工具。实验感来自 Agent 编排、工作流图、状态反馈和高密度信息层，而不是泛滥装饰。

当前系统以深色表面为默认工作环境。`#212121` 是主应用背景，`#191919` 是侧栏和输入容器，`#2d2d2d` 是浮层和卡片表面。`#7c3aed` 是 **Orchestration Violet**，只用于主操作、选中、焦点、编排状态和关键反馈。它的稀缺性让界面保持控制感。

系统明确拒绝通用 SaaS 营销模板：不要渐变文字、hero-metric 模板、重复图标卡片网格、过度玻璃拟态、无意义发光装饰，也不要每个区域都加小号大写 eyebrow。设计目标是密集、分层、可信。

**Key Characteristics:**

- 深色工作台默认，浅色主题作为可用但次要的模式。
- 单一主强调色，承担编排、焦点、选中和主操作。
- 细边框和 tonal layering 区分区域，阴影只在浮层和悬停反馈中出现。
- 13px 到 16px 的紧凑字体层级，适配开发者长时间使用。
- 动效短促，用于状态变化、展开、浮层和反馈，不做页面编舞。

## 2. Colors

这是一套深色控制台调色板：低亮度中性表面承载信息，Orchestration Violet 作为唯一品牌和编排强调色，语义色只用于状态。

### Primary

- **Orchestration Violet** (`#7c3aed`): 主操作、发送、焦点边框、选中态、当前模型或工作流状态。不要把它用于普通装饰。
- **Orchestration Violet Hover** (`#8b5cf6`): 主按钮 hover、选中标签文字、强调态的可交互反馈。
- **Orchestration Violet Dim** (`#7c3aed1f`): 轻量选中背景、用户消息气泡、徽标和低强度焦点区域。

### Neutral

- **App Graphite** (`#212121`): 应用主体背景，承载聊天和主编辑区域。
- **Sidebar Black** (`#191919`): 侧栏、输入框和更深一层容器。
- **Surface Charcoal** (`#2d2d2d`): 卡片、菜单、弹层和设置容器。
- **Hairline Border** (`#ffffff1a`): 默认分割线和卡片边框。
- **Strong Border** (`#ffffff29`): hover、弹层和需要更强边界的容器。
- **Primary Text** (`#ececec`): 正文、标题和关键标签。
- **Secondary Text** (`#ffffff8c`): 描述、次级按钮和导航文本。
- **Muted Text** (`#ffffff4d`): 时间戳、占位、辅助说明。正文不要使用这一档。

### Semantic

- **Success Green** (`#22c55e`): 成功、在线、完成。
- **Danger Red** (`#ef4444`): 错误、破坏性操作、失败。
- **Warning Amber** (`#f59e0b`): 等待审批、条件边、需要用户注意的中断状态。
- **Info Blue** (`#3b82f6`): 信息提示和非阻塞通知。

### Named Rules

**The Orchestration Violet Rule.** Orchestration Violet 在单屏中应少量出现，优先给主操作、当前选中和 Agent 编排状态。若一个区域中紫色超过 10% 表面积，通常说明它被当成装饰用了。

**The Status Needs Text Rule.** 成功、警告、错误和等待状态不能只靠颜色表达，必须配合文字、图标或位置。

## 3. Typography

**Display Font:** Inter, with system fallbacks  
**Body Font:** Inter, with system fallbacks  
**Label/Mono Font:** JetBrains Mono, SF Mono, Fira Code, monospace

**Character:** CDF 使用单一 sans 字体承载大部分界面，保持开发者工具的熟悉度。Mono 字体用于模型名、代码、时间、JSON 参数和技术标识，帮助用户快速识别机器输出和结构化内容。

### Hierarchy

- **Title** (600, 16px, 1.25): 顶栏标题、弹窗标题、主区域名称。不要用夸张 display heading。
- **Section Title** (600, 18px, 1.3): 设置页和资产页的区域标题。
- **Body** (400, 14px, 1.7): 聊天消息、说明文本、工具结果正文。长文本建议保持 65 到 75ch。
- **Control** (500, 13px, 1.4): 按钮、导航项、菜单、表单输入。
- **Label** (500 到 600, 11px 到 12px, 1.4): 字段名、状态名、分组名。大写标签只能少量用于技术分组，不作为每个区块的装饰。
- **Mono** (400, 12px 到 13px, 1.5): 代码、模型 tag、时间戳、JSON 和工作流技术细节。

### Named Rules

**The Product Scale Rule.** CDF 不使用流式大标题。产品界面固定字号更可靠，视觉层级通过 weight、色彩、间距和容器关系建立。

## 4. Elevation

CDF 主要依靠 tonal layering 和细边框表达层级。静态容器通常是平的：主背景、侧栏、表面卡片通过色值差和 `1px` 边框分隔。阴影只出现在 dropdown、toast、modal 和 hover 提升中，用来表达浮层或临时反馈。

### Shadow Vocabulary

- **Dropdown Shadow** (`0 4px 20px rgba(0,0,0,0.4)`): 模型选择器、菜单和临时列表。
- **Hover Lift Shadow** (`0 4px 16px rgba(0,0,0,0.15)`): 可点击 feature card 的轻微 hover 提升。
- **Toast Shadow** (`0 10px 25px -5px rgba(0, 0, 0, 0.20), 0 8px 10px -6px rgba(0, 0, 0, 0.15)`): 浮动通知。
- **Focus Glow** (`0 0 0 3px var(--accent-dim)`): 输入聚焦和需要明确定位的交互控件。

### Named Rules

**The Flat-By-Default Rule.** 表面静止时不靠阴影制造层级。阴影只表示浮层、hover、focus 或临时反馈。

## 5. Components

组件语言是密集、分层、可信。控件应保持标准、紧凑和可预测，把独特性留给 Agent 执行反馈、工作流图和审批体验。

### Buttons

- **Shape:** 中等圆角，默认 `10px`，shadcn button 使用 `rounded-md`。
- **Primary:** `#7c3aed` 背景和白色文本，CSS 类 `.btn-primary` 使用 `8px 14px`，shadcn default 使用 `h-10 px-4 py-2`。
- **Hover / Focus:** hover 变为 `#8b5cf6`；focus 使用 Orchestration Violet ring。禁用态降低 opacity，不改变结构。
- **Secondary / Ghost:** 透明背景、细边框或 hover tonal fill，用于非主操作。
- **Destructive:** 红色用于删除和失败修复，不与主紫色混用。

### Chips

- **Style:** 模型 tag 使用 mono 字体、20px 圆角、低对比背景和细边框。
- **State:** 选中或当前模型可以使用 `--accent-dim` 背景和 `--accent-hover` 文字。未选中状态不要使用饱和色。

### Cards / Containers

- **Corner Style:** `14px` 到 `20px` 用于大容器，`10px` 用于中等卡片和按钮，`6px` 用于小控件。
- **Background:** `#2d2d2d` 用于卡片，`#191919` 用于侧栏和输入容器，`#212121` 用于主画布。
- **Shadow Strategy:** 静态容器平铺，hover 或浮层才出现阴影。
- **Border:** 默认 `1px solid rgba(255,255,255,0.10)`，hover 或弹层可提升到 `rgba(255,255,255,0.16)`。
- **Internal Padding:** 设置卡片常用 `18px 20px`，主设置内容区域为 `28px 32px`。

### Inputs / Fields

- **Style:** 深色背景、1px 边框、`10px` 圆角，文本使用 `--text-primary`。
- **Focus:** 边框切到 Orchestration Violet，并使用 `--accent-dim` glow。
- **Placeholder:** 使用 `--text-muted` 只适合短占位，不用于正文说明。
- **Error / Disabled:** 错误使用 danger 色加文字说明；禁用态降低透明度并移除 pointer events。

### Navigation

- **Sidebar:** `#191919` 背景、1px 右边框、13px/500 导航文本，active 使用 `--bg-active`，hover 使用 `--bg-hover`。
- **Topbar:** 保持低高度、低装饰，使用细分割线和紧凑按钮。侧栏折叠时为 macOS 窗口控制区留出空间。
- **Workflow Editor:** React Flow 画布是产品的表达核心。节点可以更鲜明，但必须保持边、状态和执行结果清楚。

### Dialogs / Popovers

- **Dialog:** 深色 sidebar 背景、`1px` 边框、`24px` 内边距、`rounded-lg`，overlay 使用黑色透明遮罩。
- **Dropdown:** `#2d2d2d` 表面、强边框、`0 4px 20px rgba(0,0,0,0.4)` 阴影。
- **Motion:** 150 到 250ms 的 fade、slide 或 zoom。遵守 reduced motion。

### Chat Messages

- **Assistant:** 默认无气泡，直接排版在背景上，保持阅读流。
- **User:** 使用 `--accent-dim` 背景和细边框，表达“用户输入”而非装饰性品牌块。
- **Code:** mono 字体、低对比深色背景、小圆角，保持可复制和可扫描。

## 6. Do's and Don'ts

### Do:

- **Do** 使用 `#212121`、`#191919`、`#2d2d2d` 建立三层深色工作台。
- **Do** 把 `#7c3aed` 留给主操作、选中、焦点和 Agent 编排状态。
- **Do** 让状态同时有颜色、图标或文字，尤其是审批、错误、等待和执行中。
- **Do** 保持产品字号紧凑：按钮和导航 13px，正文 14px，标题 16px 到 18px。
- **Do** 用细边框、背景层级和短动效解释结构变化。

### Don't:

- **Don't** 使用渐变文字、hero-metric 模板、重复图标卡片网格、过度玻璃拟态或无意义发光装饰。
- **Don't** 在每个 section 上方放小号大写 eyebrow 或 01/02/03 式编号脚手架。
- **Don't** 把紫色当作通用装饰色铺满界面。
- **Don't** 用 `--text-muted` 承载正文或关键状态说明，它只适合时间戳、占位和低优先级提示。
- **Don't** 为了“AI 感”重造标准按钮、输入框、弹窗和导航交互。
- **Don't** 让动画阻挡任务流。产品界面不需要入场编舞。

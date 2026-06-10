---
name: CDF
description: 本地多领域 Agent 工作站，让用户在自己的机器上组织任务、上下文、Agent、能力和产物。
themes:
  - light
  - dark
colors:
  # Light 主题（默认，Figma 风格奶白画布 + 粉彩 color blocks + 单点 accent-magenta）
  light:
    canvas: "#fbf8f4"
    inverse-canvas: "#1a1a1a"
    surface-raised: "#ffffff"
    surface-soft: "#f1ece2"
    surface-sunken: "#ece5d4"
    ink-primary: "#1a1a1a"
    ink-secondary: "#1a1a1acc"
    ink-muted: "#1a1a1a80"
    ink-inverse: "#fbf8f4"
    ink-inverse-soft: "#fbf8f426"
    block-lime: "#e0f0c2"
    block-lilac: "#e3d8f5"
    block-cream: "#f5e6c5"
    block-mint: "#c2e8d6"
    block-pink: "#f5c4d1"
    block-coral: "#f5b0a0"
    block-navy: "#1a1a3a"
    accent-magenta: "#e2007a"
    accent-magenta-hover: "#c4006a"
    accent-magenta-dim: "#e2007a1f"
    success: "#0a7a3a"
    danger: "#c0002a"
    warning: "#a86b00"
    info: "#1f5fb0"
    overlay-scrim: "#00000099"
    trace-line: "#1a1a1a14"
    border-strong: "#1a1a1a26"
  # Dark 主题（冷黑画布 + 同一套 ink 角色 + Intelligence Violet 单点强调）
  dark:
    canvas: "#111216"
    inverse-canvas: "#f0f2f5"
    surface-raised: "#252932"
    surface-soft: "#1f2228"
    surface-sunken: "#171a1f"
    ink-primary: "#f0f2f5"
    ink-secondary: "#c8cfda99"
    ink-muted: "#c8cfda5c"
    ink-inverse: "#111216"
    ink-inverse-soft: "#11121626"
    block-lime: "#3a4a2c"
    block-lilac: "#3d3658"
    block-cream: "#4a3f24"
    block-mint: "#2c4438"
    block-pink: "#4a2f37"
    block-coral: "#4a3128"
    block-navy: "#0e0f1a"
    accent-magenta: "#7c3aed"
    accent-magenta-hover: "#8b5cf6"
    accent-magenta-dim: "#7c3aed1f"
    success: "#22c55e"
    danger: "#ef4444"
    warning: "#f59e0b"
    info: "#3b82f6"
    overlay-scrim: "#000000cc"
    trace-line: "#d8e0f014"
    border-strong: "#d8e0f026"
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
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  panel: "28px 32px"
components:
  task-surface:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.lg}"
    padding: "14px 16px 10px"
  color-block-section:
    backgroundColor: "{colors.block-cream}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.lg}"
    padding: "28px 32px"
  button-primary:
    backgroundColor: "{colors.accent-magenta}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  text-input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  tab-selected:
    backgroundColor: "{colors.accent-magenta}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
  overlay-icon-inverse:
    backgroundColor: "{colors.ink-inverse-soft}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
---

# Design System: CDF

## 1. Overview

**Creative North Star: “Agent 工作站，不是 AI 聊天页”**

CDF 的界面是一个本地多领域 Agent 工作站。它不是普通聊天产品，也不是代码专用 IDE。用户在这里创建任务、绑定上下文、选择 Agent 与能力、观察过程、审批关键动作，并把结果沉淀为可继续使用的产物。

高级感来自工作空间秩序、上下文清晰度、Agent 协作透明度和产物位置感。默认界面应安静、清醒、精密；只有当任务被聚焦、Agent 正在工作、能力被调用、用户需要确认或产物生成时，信号色才出现。

CDF 借 **Figma DESIGN.md** 纪律：双主题、ink 角色、状态色、组件命名都遵循同一套规则。Light 主题以奶白画布 + 粉彩 color block 表达 section depth；Dark 主题以冷黑画布 + 同一套 ink 角色和 state 语言。

**Key Characteristics:**

- 工作站布局：Task Surface、Activity Trail、Agent Bench、Capability Shelf、Artifact Space、Workflow Canvas 各自承担明确任务。
- 双主题（Light + Dark），状态语言、组件语法和 token 纪律在两套主题下一致。
- 中性色主导，色彩只作为焦点、协作、状态或风险信号。
- 信息层级靠字重和排版承载，不靠透明度或灰度滑变。
- 细线、层级、密度和留白制造高级感，而不是终端感、霓虹感或装饰性发光。
- 单一 sans + 少量 mono 仪表文字，保持桌面生产力工具的长期可读性。
- 动效表达状态变化，不表演情绪。

## 2. Colors

CDF 采用双主题：

- **Light 主题**：默认。奶白画布 + 粉彩 color block 表达 section depth。**accent-magenta** 是 single-shot 强调色，一页只允许一个主 CTA。
- **Dark 主题**：冷黑画布 + 同一套 ink 角色和 state 语言。**Intelligence Violet** 作为 single-shot 强调色。

两套主题共享 ink 角色、状态色、组件语法和 spacing；用户切换主题时不丢失语境。

### 2.1 Light Theme

#### Canvas & Surface

- **canvas** (`#fbf8f4`): 主画布。奶白纸张感，长时间阅读不刺眼。
- **inverse-canvas** (`#1a1a1a`): 用于 footer / 收尾 / 反白面板。
- **surface-raised** (`#ffffff`): 卡片、弹层、Task Surface 和表单容器。
- **surface-soft** (`#f1ece2`): 浮层、轻底色。
- **surface-sunken** (`#ece5d4`): recessed 输入区、代码块。

#### Ink

- **ink-primary** (`#1a1a1a`): 标题、正文、关键状态。
- **ink-secondary** (`#1a1a1acc`): 次级说明、导航、按钮辅助。
- **ink-muted** (`#1a1a1a80`): 时间戳、占位和低优先级提示。**不要用于正文或关键状态。**
- **ink-inverse** (`#fbf8f4`): 反白 ink，用于深色面板和深色 CTA。
- **ink-inverse-soft** (`#fbf8f426`): 反白半透明 ink，用于 inverse 按钮和图标。

#### Block Palette（封闭集）

- **block-lime**, **block-lilac**, **block-cream**, **block-mint**, **block-pink**, **block-coral**, **block-navy**: 7 个 color block 角色。
- **Do not add new colors to the block palette.** 这是封闭集合。section depth 只能通过 7 种 block 表达。
- **One color block per viewport maximum** — 白色画布必须把它们分开。
- **No drop shadows on color blocks.** section depth 由色块本身承担。

#### Accent

- **accent-magenta** (`#e2007a`): 主动作、当前焦点、关键状态信号。**single-shot**，一页只允许一个主 CTA。
- **accent-magenta-hover** (`#c4006a`): 主操作 hover。
- **accent-magenta-dim** (`#e2007a1f`): 用户目标、低强度选中、Task Surface 焦点。

#### Semantic

- **success** (`#0a7a3a`): 完成、可用、通过。
- **danger** (`#c0002a`): 错误、失败、破坏性操作。
- **warning** (`#a86b00`): 等待确认、条件分支。
- **info** (`#1f5fb0`): 非阻塞信息、系统提示。
- **semantic-success / semantic-danger / semantic-warning / semantic-info** 只用于 glyph 填充，不用于 surface。

#### Lines & Overlays

- **trace-line** (`#1a1a1a14`): 默认分割线、color block 边界、节点边界。
- **border-strong** (`#1a1a1a26`): hover、focus-adjacent、弹层。
- **overlay-scrim** (`#00000099`): 模态遮罩。token 只存底色，opacity 在 render 时应用。

### 2.2 Dark Theme

#### Canvas & Surface

- **canvas** (`#111216`): 冷黑工作站画布。
- **inverse-canvas** (`#f0f2f5`): 反白面板，用于 footer / 收尾。
- **surface-raised** (`#252932`): 卡片、弹层、Task Surface、Agent Bench。
- **surface-soft** (`#1f2228`): 浮层、轻底色。
- **surface-sunken** (`#171a1f`): recessed 输入区、代码块。

#### Ink

- **ink-primary** (`#f0f2f5`): 标题、正文、关键状态。
- **ink-secondary** (`#c8cfda99`): 次级说明、导航、按钮辅助。
- **ink-muted** (`#c8cfda5c`): 时间戳、占位和低优先级提示。
- **ink-inverse** (`#111216`): 反白 ink。
- **ink-inverse-soft** (`#11121626`): 反白半透明 ink。

#### Block Palette（封闭集）

- **block-lime** (`#3a4a2c`), **block-lilac** (`#3d3658`), **block-cream** (`#4a3f24`), **block-mint** (`#2c4438`), **block-pink** (`#4a2f37`), **block-coral** (`#4a3128`), **block-navy** (`#0e0f1a`): 同样 7 个 color block，深度更暗。

#### Accent

- **accent-magenta** (`#7c3aed` → Intelligence Violet): 主动作、当前焦点、关键状态信号。**single-shot**。
- **accent-magenta-hover**, **accent-magenta-dim**: 配套。

#### Semantic & Lines

- 与 Light 主题同一组语义角色和描边规则，hex 值随主题不同。
- **trace-line** (`#d8e0f014`), **border-strong** (`#d8e0f026`), **overlay-scrim** (`#000000cc`)。

### 2.3 Named Rules（两主题共享）

**The Ink Hierarchy Rule.** 信息层级来自字重和排版，不靠透明度。body 文字 320–340 已经在 weight 上表达 secondary，不要再降透明度。

**The Single-Shot Accent Rule.** 同一 viewport 中 `accent-magenta` / Intelligence Violet 主动作只能出现一次。出现第二次时必须把其中一个降为 secondary。

**The Block Pacing Rule.** 同一 viewport 最多一个 color block；block 之间必须保留白色 / canvas 间隔。

**The State Color Rule.** 所有彩色必须绑定含义：当前焦点、智能协作、可执行、等待确认、失败、完成、风险或产物状态。

**The 90/10 Rule.** 单屏 90% 应由中性色、线、排版和空间承担；10% 以内给 accent 与语义色。

## 3. Typography

**Display Font:** Inter, with system fallbacks  
**Body Font:** Inter, with system fallbacks  
**Label/Mono Font:** JetBrains Mono, SF Mono, Fira Code, monospace

**Character:** CDF 使用单一 sans 字体保持系统工具感。Mono 不是装饰字体，而是仪表文字：模型名、token、时间、命令参数、路径、JSON、工作流 ID 和工具详情使用 mono，让机器信息和人类说明一眼区分。

### Hierarchy

- **Title** (600, 16px, 1.25, -0.01em): 顶栏标题、弹窗标题、主区域名称。标题短，不写营销句。
- **Section Title** (600, 18px, 1.3): 设置页、资产页、产物区和活动轨的区域标题。
- **Body** (400, 14px, 1.7): 工作流说明、Agent 回传、产物正文和长文本。长文本保持 65 到 75ch。
- **Control** (500, 13px, 1.4): 按钮、导航、菜单、输入控件。
- **Label** (500 到 600, 11px 到 12px, 1.4): 字段名、状态名和分组名。大写只用于技术分组，不作为装饰性 eyebrow。
- **Instrumentation** (400, 12px 到 13px, 1.5): 代码、token 数、模型、时间戳、路径、JSON 和工具技术细节。

### Named Rules

**The Instrumentation Rule.** Mono 只用于机器信息和结构化状态，不用于“看起来技术”的装饰。

**The Plain Task Rule.** 控件和状态文案要短、具体、面向任务。用户在工作站里组织工作，不阅读营销文案。

**The Theme Parity Rule.** Light 与 Dark 共享同一份 typography hierarchy，字号、字重、lineHeight 在两套主题下一致。

## 4. Elevation

CDF 的层级来自材料、线和状态，不来自厚重阴影。默认表面是平的，使用主题 surface 层级区分深度。浮层、toast、菜单和正在交互的面板可以短暂提升，但阴影必须服务于“这个东西浮在当前工作之上”的含义。

### Shadow Vocabulary

- **Popover Shadow** (`0 4px 20px rgba(0,0,0,0.4)`): 模型选择、菜单、临时列表。
- **Panel Lift** (`0 8px 24px rgba(0,0,0,0.18)`): 活动面板或产物预览的轻微提升。
- **Toast Shadow** (`0 10px 25px -5px rgba(0,0,0,0.20), 0 8px 10px -6px rgba(0,0,0,0.15)`): 浮动通知。
- **Signal Ring** (`0 0 0 3px var(--accent-dim)`): 焦点、Task Surface 激活、需要用户确认的操作入口。

### Named Rules

**The Surface Before Shadow Rule.** 先用背景层级和线表达结构，只有浮层、焦点或状态变化才允许阴影。

**The No Shadow On Blocks Rule.** Color block section 不允许使用 drop shadow；section depth 由色块本身承担。

## 5. Components

组件语言是工作站组件语言，不是通用卡片库。标准控件要保持标准，CDF 的独特性来自 Task Surface、Activity Trail、Agent Bench、Capability Shelf、Artifact Space 和 Workflow Canvas。

### State Vocabulary（两主题共享）

- `default`
- `hover`
- `focus`（focus-visible 必须显示 ring；ring 用 accent）
- `pressed`（主按钮 pressed 不降色，靠 micro-scale 0.98）
- `selected`（与 `button-primary` surface 一致；选中 = 主动 CTA）
- `disabled`

### Task Surface

- **Role:** 用户描述目标、绑定上下文、选择 Agent/能力并启动工作的主入口，不是普通 textarea。
- **Shape:** `14px` 到 `20px` 圆角，使用主题 `surface-raised` 或 `surface-sunken`，边框为 `trace-line`。
- **Focus:** 边框切到 accent，使用轻微 Signal Ring。焦点只提示“当前任务表面已激活”，不要大面积发光。
- **Controls:** 模型选择、上下文、附件、能力和发送按钮是任务控制件，视觉上应嵌入同一个表面。

### Color Block Section

- **Role:** 表达 section depth 的核心器件，沿用 Figma 纪律。
- **Style:** 选用 7 种 block color 之一作为 section 背景。同一 viewport 只允许一个 block。**不允许 drop shadow。**
- **Padding:** 至少 `28px 32px`。
- **Use cases:** 欢迎页 hero 的状态面板、产物区 hero、Capability Shelf 的 ready 区域。

### Activity Trail

- **Role:** 展示 Agent 活动、工具调用、材料读取、用户确认、阶段性结果和失败恢复。
- **Style:** 线性、时间性、可扫描。使用细线、状态点、短标签和 mono 元数据。
- **State:** running 使用 accent 或 Warning Amber；completed 使用 Success；failed 使用 Danger。状态必须配文字。
- **Motion:** 展开和折叠使用短促过渡，不用 bounce。

### Agent Bench

- **Role:** 承载当前主 Agent、可调用子 Agent、角色、能力范围、权限和失败恢复。
- **Style:** 席位化而不是部署栈。用标题、状态槽、能力摘要和分隔线组织信息。
- **Density:** 高密度可以接受，但每个 Agent 状态块必须有明确目标、动作和归属。

### Capability Shelf

- **Role:** 承载 MCP、Skills、Workflows、文件系统、浏览器、知识库、模板和本地应用连接。
- **Style:** 像工作站的能力架，而不是工具广告墙。优先展示可用性、边界、健康状态和适用任务。
- **Color:** 能力类型不靠彩色装饰区分；状态才用色。

### Artifact Space

- **Role:** 放置 Agent 生成或修改的产物：文档、计划、代码、表格、摘要、图片、文件变更、工作流输出。
- **Style:** 产物应可识别、可打开、可复制、可保存或继续编辑。不要只埋在聊天流里。
- **State:** draft、generated、modified、needs review、saved、failed 应有清晰状态。

### Workflow Canvas

- **Role:** 可视化编排跨领域任务流程，不只是代码工作流。
- **Nodes:** 节点像工作步骤和 Agent 能力元件，不像营销卡片。输入、输出、条件和产物比图标更重要。
- **Edges:** 线条表达顺序、条件、循环和依赖。不要用彩色边作为装饰。
- **Selection:** 当前节点使用 accent，非当前节点保持中性。

### Buttons

- **Shape:** 默认 `10px`，紧凑、标准、可预测。
- **Primary:** accent-magenta / Intelligence Violet 背景和反白 ink，只用于真正主动作。**single-shot 限制。**
- **Secondary:** 透明背景、细边框或 hover tonal fill，用于普通操作。
- **Destructive:** Danger Red，永远配明确文本。
- **Pressed:** 同 fill + micro-scale，不降色。

### Inputs / Fields

- **Style:** 深色 recessed 背景、1px 边框、`10px` 圆角。
- **Focus:** accent 边框和轻 ring。**focused surface 与 default surface 相同，焦点靠 ring 表达。**
- **Placeholder:** `Muted` 只用于短占位，不用于说明正文。

### Navigation

- **Sidebar:** 主题 `surface` 背景、细边框、13px/500 文本。active 是位置和状态，不是装饰。
- **Topbar:** 低高度、低装饰，保留窗口区域和当前工作空间。
- **Panels:** 右侧或抽屉面板使用 Agent Bench / Activity Trail 语言，避免普通 dashboard 卡片堆叠。

### Work Stream

- **User:** 用户输入是目标或指令来源，使用低强度 accent containment。
- **Agent:** Agent 回传像工作站输出，默认无气泡，保持阅读流。
- **Tool / Evidence:** 工具证据使用 Activity Trail 或 Artifact Space 结构。
- **Code / Data:** mono、低对比背景、小圆角、可复制，像仪表内容而不是装饰块。

## 6. Do's and Don'ts

### Do:

- **Do** 把 CDF 当成本地多领域 Agent 工作站设计，不当作 AI 聊天页或代码 IDE。
- **Do** 用中性色、细线、状态槽、产物区和 Task Surface 建立秩序。
- **Do** 让 Light 与 Dark 共享同一套 ink 角色、状态语言和组件语法。
- **Do** 让 mono 字体承担仪表信息，而不是装饰气质。
- **Do** 在 section 深度上优先用 color block，而不是阴影或渐变。
- **Do** 单一主动作严格 single-shot，不在同 viewport 出现两次 accent CTA。

### Don't:

- **Don't** 把产品做成普通 AI Chat App、代码专用 IDE、VS Code 皮肤、黑绿 Hacker Terminal、开发者监控台或云端营销页。
- **Don't** 使用渐变文字作为通用规则。欢迎页可以少量使用品牌强调，工作区不使用。
- **Don't** 使用 hero-metric 模板、重复图标卡片网格、过度玻璃拟态、霓虹边框或无意义发光装饰。
- **Don't** 让 accent-magenta / Intelligence Violet 变成普通品牌装饰。
- **Don't** 让 color block 出现 drop shadow。
- **Don't** 让同一 viewport 同时出现两个 color block。
- **Don't** 用透明度或灰度滑变代替字重表达信息层级。
- **Don't** 把所有任务都包装成命令执行日志。研究、写作、分析、运营和设计任务也需要自然的工作站表达。
- **Don't** 用 `Muted` 承载正文或关键状态。
- **Don't** 让动画表演情绪。动效只表达状态变化。

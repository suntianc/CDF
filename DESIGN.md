# CDF UI System

本文件是 CDF 唯一的界面设计规范。它直接从当前 Electron 渲染进程的结构、状态和交互能力提炼，不以 README、旧截图或通用 Dashboard 模板为依据。

## 0. 代码基线

本规范覆盖当前代码中真实存在的界面能力：

- 应用壳层和视图切换：`src/renderer/src/App.tsx`
- 主侧栏、Project 与 Conversation 树：`components/Sidebar/`、`components/ProjectTree/`
- Conversation Welcome、Timeline、Composer、Tool、Approval、Subagent：`components/ChatArea/`
- 文件树和编辑预览：`components/FilePanel/`
- Agent 活动、委派、并行任务、审批：`components/TaskPanel/`
- Agents、Skills、MCP、Tools、Provider 与系统设置：`components/AgentLibrary/`、`components/PluginsPanel/`、`components/Settings/`
- Workflow 列表、画布、Node Palette、配置 Drawer 和执行面板：`components/WorkflowEditor/`
- General / Research Scene，以及 Paper Library、Writing、Experiments：`components/SceneWorkspace/`
- 当前主题、圆角、层级、动效和 Workflow 色块：`styles/globals.css`

规范不得虚构代码中不存在的一级产品模块。新能力出现后，先确认其状态模型和导航归属，再扩充本文件。

---

## 1. 设计方向：Local Field Desk

CDF 的界面是一张**本地项目工作桌**，不是聊天主页，也不是企业后台。

桌面由三个有明确职责的区域构成：

1. **Project Ledger / 项目簿**：左侧持续记录当前 Project、Conversation 和可进入的工作区。
2. **Scene Desk / 场景桌面**：中间承载 Conversation、Research、Workflow 和资源管理等实际工作。
3. **Auxiliary Bay / 辅助舱**：右侧按需打开 Files 或 Activity，不与主工作争夺导航层级。

视觉语气来自纸质档案、石墨工具、实验记录和终端输出：Light 主题像暖灰纸面上的墨水，Dark 主题像碳黑仪器面板。唯一全局强调色是**朱砂红**，用于当前焦点和主要动作；Workflow Node 的淡色块是用户数据，不是全局装饰色。

### 1.1 设计意图

- **人**：在桌面上长时间处理本地 Project、文件、Agent 执行和研究材料的用户。
- **核心动作**：恢复 Project 上下文，下达指令，观察执行，处理审批，检查文件或结果。
- **感受**：像可靠的工作台——有重量、有秩序、信息密集但不嘈杂。
- **主焦点**：每个视图只允许一个主要工作对象；辅助信息退到边缘，不与其争夺对比度。

### 1.2 独特标志

**Ledger Edge / 档案边标**是 CDF 的识别元素：

- 当前 Project 或当前 Scene 在左侧使用 3px 朱砂边标。
- Timeline 中等待审批、失败和 Artifact 使用同一边标语言，但颜色改为对应语义色。
- Workflow Node 选中态使用边标而不是发光描边。
- 边标始终贴合容器左侧，不导致文字位移，不使用渐变。

它表达“这条记录当前有效或需要处理”，不是装饰。

### 1.3 拒绝的模式

- 不新增全局图标 Rail；当前产品的 Project Ledger 已经承担主要导航。
- 不把 Welcome Surface 设计为 Hero + 三张功能卡。
- 不默认使用三列资源卡片；Agents、Skills、MCP 和 Workflows 优先使用列表或主从布局。
- 不使用紫蓝 AI 渐变、霓虹发光、玻璃拟态、噪点背景或大面积模糊光晕。
- 不让 Files 与 Activity 以两个独立浮层互相避让。
- 不使用 `transition: all`、hover 放大到 1.05、持续 pulse 或无意义 spinner。
- 不把所有辅助动作隐藏到 hover 后才出现。
- 不以“设置”包住 Agents、Skills、MCP 和 Workflows；这些是工作区，设置只承载连接和偏好。

---

## 2. 应用框架

### 2.1 标准布局

```text
┌────────────────────────────── 40px title / drag strip ────────────────────────────────┐
│ Project Ledger │ Scene Desk topbar                                 │ Auxiliary Bay    │
│ 240–360px      ├───────────────────────────────────────────────────┤ 300–440px        │
│                │                                                   │ Files | Activity │
│ app entries    │ Scene / Conversation / Resource / Workflow        │                  │
│ project tree   │                                                   │                  │
│ conversations  │                                                   │                  │
│                │                                                   │                  │
│ settings       │ Composer dock / canvas controls                   │                  │
└────────────────┴───────────────────────────────────────────────────┴──────────────────┘
```

应用根节点不滚动。Project Ledger、Scene Desk 和 Auxiliary Bay 各自管理滚动。

### 2.2 Project Ledger

保留当前侧栏作为单一左侧导航，不新增第二条全局导航。

**宽度**：

- 默认 280px，与 `App.tsx` 当前状态一致。
- 最小 240px；最大 360px。
- 用户拖拽宽度后持久化。
- 折叠后宽度为 0；召回按钮位于 Scene Desk topbar 左侧，不悬浮在 traffic lights 附近。

**模式**：

Project Ledger 有两个互斥模式，禁止混排：

1. **Work 模式**
   - 顶部：New Conversation、Agents、Skills & MCP、Workflows。
   - 中部：Project 与其 Conversation。
   - 下部：Scratch Conversation。
   - 底部：Settings。
2. **Settings 模式**
   - 顶部只显示“返回工作桌”。
   - 中部只显示 LLM Provider、AI Subscription、Tools、Research、System 等设置分类。
   - 不重复显示 Agents、Skills & MCP、Workflows，也不显示 Project Tree。

进入 Settings 是一次明确的导航层级切换，而不是在 Work 导航中插入第二组菜单。返回工作桌时恢复离开前的 Project、Conversation 和滚动位置。

**项目树规则**：

- Project 行高 32px；Conversation 行高 30px。
- Project 名称 13px/600；Conversation 名称 12px/450。
- 展开箭头与选择操作分离。
- Project 的 More 按钮始终占位，默认使用 tertiary ink；hover/focus 提高对比，禁止 `opacity: 0`。
- 当前 Project 使用 Ledger Edge + `surface-selected`。
- 当前 Conversation 使用更浅的 selected surface，不重复 Ledger Edge。
- 运行中的 Conversation 显示 6px 状态点和可访问文本；等待审批显示琥珀标记。
- 删除进入 More 菜单，不在每一行 hover 时突然出现。

### 2.3 Scene Desk

Scene Desk 是唯一主工作区。其顶部固定 40px topbar：

- 左侧：侧栏召回、当前 Project、Scene 或页面名称。
- 中部：仅在 Research Scene 等同一对象的子视图中显示 Tabs。
- 右侧：状态、次要动作、一个主要动作、Files 开关和 Activity 触发器。
- 无业务控件的空白区域是窗口 drag region。

Topbar 不能为空。Agent、Skills、MCP、Settings 和 Workflow 列表都必须显示页面名称，不再保留只有拖拽功能的空条。

### 2.4 Files Panel 与 Activity Popover

Files 和 Agent Activity 的使用频率与持续时间不同，不能合并为同一种侧面板。

#### Files Panel

- FileTree、Filter 和 EditorPane 使用右侧固定面板。
- 默认宽 360px，最小 300px，最大 440px；可拖拽并持久化。
- Files 是持续参考内容，可以与 Conversation 或 Research Scene 并排存在。
- 关闭后焦点返回 Files 触发按钮。

#### Activity Popover

- Agent Activity 使用由 topbar 触发器锚定的浮动 Popover，不占用固定横向布局。
- 默认宽 360px，最大高 70vh；内容内部滚动。
- 使用 Radix Popover 的 Portal、碰撞检测、Escape 和焦点返回，不以窗口坐标或 `calc()` 手工避让 Files Panel。
- 内容包括当前 Run、Tool、Approval、Delegated Work 和 Parallel Batch。
- 有未决审批时，触发器显示琥珀计数；Popover 自动打开，但不抢走 Composer 中正在输入的焦点。
- Popover 适合快速查看和决策；选择 Subagent/Worker 详情后，详情继续进入 Conversation Viewport，而不是把浮层扩成永久侧栏。
- 点击外部或 Escape 关闭；关闭 Activity 不改变 Files Panel 的打开状态。

**原因**：Activity 是短时、上下文相关的运行检查；固定侧栏会长期压缩 Composer、Timeline 和 Workflow Canvas，并错误暗示它与 Files 一样需要持续并排。只有当未来出现需要长期监控多个 Run 的明确工作流时，才重新评估可固定模式。

### 2.5 窗口策略

当前主窗口最小尺寸为 800 × 600；规范必须在此尺寸可用。

| 可用宽度 | Project Ledger | Files Panel | Activity Popover | Scene Desk |
|---|---|---|---|---|
| ≥ 1440px | 固定显示 | 可固定 | 锚定浮层 | 最小 720px |
| 1120–1439px | 固定显示 | 可固定或覆盖 | 锚定浮层 | 最小 560px |
| 800–1119px | 可折叠 Drawer | 覆盖层 | 碰撞后向内翻转 | 全宽优先 |

空间不足时按以下顺序收缩：

1. Files Panel 从固定变覆盖。
2. Project Ledger 折叠。
3. Topbar 次要动作进入 More。
4. Composer 使用 Scene Desk 全宽并保留 16px 边距。

禁止先压缩 Composer、Workflow Canvas 或编辑器到不可用宽度。

### 2.6 滚动

- Project Ledger：工作区入口和底栏固定，Project/Scratch 列表滚动。
- Conversation：Timeline 是唯一纵向滚动区，Composer Dock 固定。
- Files：FileTree 与 EditorPane 分区滚动，分隔明显。
- Activity Popover：头部固定，轨迹内容在 70vh 内滚动。
- Resource 页面：页面级滚动，不在每个资源块内再滚动。
- Workflow Canvas 不随页面滚动；Palette、Inspector 和 Execution Panel 独立滚动。
- 禁止两个无边界的同方向嵌套滚动区。

---

## 3. 密度与间距

### 3.1 4px 网格

所有布局使用下列值：

| Token | 值 | 用途 |
|---|---:|---|
| `--space-1` | 4px | 状态点、紧凑图标间距 |
| `--space-2` | 8px | 控件内图文、列表项间距 |
| `--space-3` | 12px | 控件水平 padding、小组 |
| `--space-4` | 16px | 面板 padding、字段间距 |
| `--space-5` | 20px | 工具栏或表单组 |
| `--space-6` | 24px | 页面区段 |
| `--space-8` | 32px | 大区段、空状态 |
| `--space-10` | 40px | 页面顶层留白上限 |

1–2px 仅用于边框、Ledger Edge 和光学校正。禁止新增 5、7、9、13、18、22、30px 等游离值。

### 3.2 工作台密度

CDF 使用中高密度，不以大空白营造营销感：

- Topbar：40px。
- 标准列表行：32px；双行资源：48px。
- 标准控件：32px；主要动作和 Composer 控件：36px。
- 图标按钮视觉尺寸 28–32px，命中区至少 40 × 40px。
- Ledger padding：左右 8px。
- 面板 padding：16px。
- 资源页面 padding：20px；≥1440px 时 24px。
- 表单最大宽度：720px；Provider/MCP 复杂配置最大 880px。
- Timeline 最大可读宽度：820px，但 Tool 输出、表格和代码可扩展到 1040px。

空间节奏：控件内部 4–8px；语义组 8–12px；字段/列表 12–16px；区段 24px；页面概念 32–40px。

---

## 4. 排版

### 4.1 字体

只使用项目已安装字体：

- UI：`Plus Jakarta Sans Variable`。
- 技术内容：`JetBrains Mono`，后备 `SF Mono`、`Fira Code`、`monospace`。

文件路径、模型 ID、MCP command、URL、Tool 名、日志、token 数和快捷键使用 Mono。正文、导航和表单标签使用 UI 字体。

根节点启用：

```css
-webkit-font-smoothing: antialiased;
font-variant-numeric: proportional-nums;
```

动态计数、时长、进度和表格数值单独启用 `tabular-nums`。

### 4.2 字阶

| 角色 | 字号/行高 | 字重 | 使用位置 |
|---|---|---:|---|
| Page title | 18/24px | 650 | 资源页、Settings、空状态标题 |
| Section title | 15/20px | 600 | 面板区段、Dialog 标题 |
| Body | 14/21px | 450 | Conversation、描述、表单说明 |
| UI label | 13/18px | 550 | 导航、按钮、Tab、字段标签 |
| Meta | 12/16px | 450 | 时间、计数、状态说明 |
| Micro | 11/14px | 550 | Badge、紧凑技术标签；不承载主要内容 |
| Mono | 12/18px | 450 | 路径、命令、日志 |

Welcome Surface 不使用超过 28px 的标题。页面标题轻微负字距 `-0.01em`；Micro 技术标签可用 `0.03em`。不使用大段 uppercase；`stdio`、HTTP、MCP 等协议标识可以 uppercase。

### 4.3 文字层级

- `ink-primary`：当前值、标题、正文。
- `ink-secondary`：未选导航、说明。
- `ink-tertiary`：时间、辅助元数据。
- `ink-disabled`：不可用控件，同时必须有禁用语义。

标题 `text-wrap: balance`，说明 `text-wrap: pretty`。名称单行尾部截断；路径中间截断；完整值通过 Tooltip 和复制动作提供。

---

## 5. 色彩系统

### 5.1 色彩方向

**Light：Archive Paper**——暖灰纸面、深棕黑墨水、朱砂边标。

**Dark：Carbon Desk**——碳黑表面、暖白文字、略亮朱砂。Dark 不是 Light 的紫色版本；两个主题必须共享色相身份。

### 5.2 全局语义色

实现继续使用现有 `--bg-*`、`--text-*`、`--border-*`、`--accent-*` 命名，替换值而不并行新增第二套系统。

```css
/* Light / Archive Paper */
--bg-app:            oklch(0.972 0.010 78);
--bg-sidebar:        oklch(0.944 0.016 78);
--bg-surface:        oklch(0.989 0.007 78);
--bg-sunken:         oklch(0.925 0.014 78);
--bg-hover:          oklch(0.260 0.020 55 / 0.050);
--bg-active:         oklch(0.590 0.155 31 / 0.100);
--border:            oklch(0.310 0.025 55 / 0.095);
--border-strong:     oklch(0.310 0.025 55 / 0.175);
--text-primary:      oklch(0.235 0.020 55);
--text-secondary:    oklch(0.390 0.022 55);
--text-muted:        oklch(0.535 0.020 55);
--text-disabled:     oklch(0.650 0.014 55);
--accent:            oklch(0.565 0.185 31);
--accent-hover:      oklch(0.505 0.190 31);
--accent-dim:        oklch(0.565 0.185 31 / 0.115);
--accent-glow:       transparent;

/* Dark / Carbon Desk */
--bg-app:            oklch(0.150 0.010 55);
--bg-sidebar:        oklch(0.176 0.012 55);
--bg-surface:        oklch(0.205 0.013 55);
--bg-sunken:         oklch(0.128 0.009 55);
--bg-hover:          oklch(0.930 0.012 78 / 0.055);
--bg-active:         oklch(0.690 0.145 31 / 0.145);
--border:            oklch(0.930 0.012 78 / 0.070);
--border-strong:     oklch(0.930 0.012 78 / 0.145);
--text-primary:      oklch(0.930 0.012 78);
--text-secondary:    oklch(0.780 0.014 78);
--text-muted:        oklch(0.620 0.014 78);
--text-disabled:     oklch(0.465 0.012 78);
--accent:            oklch(0.690 0.165 31);
--accent-hover:      oklch(0.745 0.145 31);
--accent-dim:        oklch(0.690 0.165 31 / 0.145);
--accent-glow:       transparent;
```

Accent 只用于主要动作、Focus ring、当前选中边标和链接。页面背景禁止径向光晕。

### 5.3 语义状态

| 状态 | Light | Dark | 用途 |
|---|---|---|---|
| Success | `oklch(0.50 0.13 145)` | `oklch(0.72 0.14 145)` | 完成、连接健康 |
| Warning | `oklch(0.57 0.14 76)` | `oklch(0.78 0.14 76)` | 等待审批、额度、暂停 |
| Danger | `oklch(0.50 0.19 24)` | `oklch(0.68 0.18 24)` | 失败、删除、断开 |
| Info | `oklch(0.49 0.12 250)` | `oklch(0.72 0.12 250)` | 中性执行信息 |

每种状态提供 solid、dim（10–14% alpha）、border（20% alpha）。状态必须同时显示图标或文字，不能只靠颜色。

### 5.4 Workflow Node 色块

现有 lime、lilac、cream、mint、pink、coral 是 Workflow 用户可选的 Node 分类色：

- 只允许出现在 Node header、4px 顶边或小型色标，不填满整个 Node。
- Light 使用低饱和 18–24% 混色；Dark 使用 20–28%。
- Node 状态颜色优先于分类色：运行、成功、失败时分类色退为 30% 可见度。
- `block-navy` 仅用于特殊技术节点，不作为主题表面。
- 这些颜色不得用于按钮、导航和普通资源卡。

### 5.5 表面、边框和阴影

深度策略是**纸张叠层**：主要依靠表面明度和细边框，阴影只给浮层。

- 普通资源行、设置区段、Timeline item：无阴影。
- Popover/Menu：1px border + `0 8px 24px rgb(30 20 10 / .10)`。
- Dialog/Drawer：Light 使用 `0 18px 56px rgb(30 20 10 / .14)`；Dark 使用更深 scrim 和弱阴影。
- Input 比周围表面更深，表达“可写入”。
- Sidebar 与 Scene Desk 仅用一条 subtle border 分隔。
- 禁止 generic card shadow、内发光和 spotlight border。

### 5.6 圆角

| Token | 值 | 用途 |
|---|---:|---|
| `--radius-xs` | 3px | 技术 token、Ledger Edge 相邻标记 |
| `--radius-sm` | 6px | Button、Input、列表选中态 |
| `--radius-md` | 9px | Composer、Popover、Menu、Node |
| `--radius-lg` | 12px | Dialog、Drawer、空状态 |
| `--radius-xl` | 16px | 仅大型 Welcome/Onboarding 容器 |

不使用 pill 作为默认形状；状态 Badge 可使用 4px 圆角。嵌套元素遵守同心圆角。

---

## 6. 组件状态

### 6.1 强制状态矩阵

每个交互控件必须覆盖：

| 状态 | 表现 |
|---|---|
| Default | 稳定可识别，无装饰动画 |
| Hover | 背景或边框轻微变化，不改变尺寸和排版 |
| Active | 100ms 内背景加深；仅主要按钮可 `scale(.98)` |
| Focus-visible | 2px accent ring + 2px offset，不能被裁剪 |
| Selected | active surface + primary ink；必要时 Ledger Edge |
| Disabled | disabled ink + disabled surface，并解释原因 |
| Loading | 保持原尺寸，禁用重复操作，显示动作文本 |
| Error | 控件附近说明原因并提供恢复动作 |

数据区域必须覆盖 Loading、Empty、Error；执行相关区域还必须覆盖 Queued、Running、Waiting、Succeeded、Failed、Cancelled。

### 6.2 Button

| Variant | 高度 | 视觉 |
|---|---:|---|
| Primary | 32px；Composer 36px | 朱砂实心，每个区域最多一个 |
| Secondary | 32px | Raised surface + border |
| Ghost | 32px | 透明，hover 出现浅表面 |
| Destructive | 32px | 普通场景为 Ghost danger；确认场景才实心 |
| Icon | 32px 视觉/40px 命中 | 必须有 aria-label 和 Tooltip |
| Link | 自适应 | Accent 文字，hover 下划线 |

文字 13px/550；左右 padding 12px；图文间距 8px。禁止 `hover:scale-105` 和 `transition-all`。

### 6.3 Input、Select、Search

- 标准高 32px，圆角 6px。
- Label 在上方，13px/550；帮助文字 12px/16。
- Placeholder 不承载字段说明或格式要求。
- Search 左侧图标 14px；有内容时提供 32px 清除按钮。
- Select、Combobox、Menu 使用 Radix 或现有可访问原语，不手写透明全屏 overlay。
- 错误边框与错误文字同时出现。
- MCP command、URL 和参数使用 Mono。

### 6.4 Resource row

Agents、Skills、MCP 和 Workflows 使用 48px 或 56px 资源行；仅模板或需要视觉预览的对象使用 Card。

标准列：

1. 28px identity icon。
2. 名称与一行说明。
3. Scope/Type。
4. 状态。
5. 最近更新时间、模型或 endpoint 等一项关键元数据。
6. 一个主要行级动作。
7. More。

行为：

- 点击行选择并在右侧 Drawer/Inspector 编辑。
- Toggle 不与整行点击冲突；Toggle 区域必须 stop propagation 并有明确 label。
- Run、Edit、Delete 不同时裸露在卡片底部。
- 删除、断开和重置进入 More 菜单的危险分组。
- Search 无结果与完全空数据使用不同 Empty State。

### 6.5 Badge 与状态点

- Badge 高 20px，3–4px 圆角，11px/550。
- `stdio`、HTTP 等协议可使用 Mono uppercase。
- 在线/离线不能持续 pulse；Running 可在状态点内部使用低频亮度变化，reduced motion 下静止。
- Badge 文案具体：连接正常、未连接、检查中、运行中、等待审批、失败。

### 6.6 Tooltip、Menu、Popover

- Tooltip 500ms hover 延迟，Focus 立即显示；不承载必需信息。
- Menu 最小 180px，项高 32px；危险操作用 Divider 分组。
- Popover 从触发点方向出现，150ms，opacity + 3px translate。
- Escape 关闭最上层并恢复焦点。
- 所有浮层做窗口碰撞检测，不遮住触发器或越界。

### 6.7 Dialog、Drawer、Toast

- 简短确认用 Dialog；Agent/MCP/Provider 的长表单用右侧 Drawer。
- Dialog 默认 440–560px；复杂配置 Drawer 380–440px。
- 危险确认重复对象名称和影响，初始焦点落在 Cancel。
- Toast 只表达无需立即处理的已完成结果；审批和运行失败必须保留在 Activity。
- Toast 右下角最多 3 条，成功 3s，信息 5s，错误保持。
- 全局只使用 Sonner 或统一 Toast 实现；Workflow、Agent 和 Plugin 不再各自维护 z-9999 容器。

### 6.8 Empty、Loading、Error

**Empty**：标题 + 原因 + 一个主动作。不得只放一段居中文字和 dashed border。

**Loading**：

- 列表使用与真实行一致的 Skeleton。
- 小于 300ms 不闪 Skeleton。
- Agent/Workflow 长执行显示当前阶段，不显示假百分比。

**Error**：

- 不清空已加载内容。
- 显示发生位置、影响和恢复动作。
- 技术详情折叠并可复制。
- 禁止 `window.alert()`；删除使用统一确认 Dialog。

---

## 7. Conversation

### 7.1 Welcome Surface

Welcome Surface 不再垂直居中整页，也不显示背景 glow 和三张等权 Feature Card。

布局：

```text
Project / Scratch context
一句状态化标题 + 简短说明
Composer
最近 Conversations 或当前 Project 建议动作（最多 4 行）
```

状态优先级：

1. 没有 Project：创建或选择本地目录。
2. 没有可用模型：打开模型设置。
3. 有等待审批：打开 Activity。
4. 有当前 Project：Composer 是焦点，下面显示最近 Conversation。
5. Scratch：明确显示不会绑定自定义 Project。

Composer 宽 680–820px，保持左对齐，不让整页像营销 Landing Page。

### 7.2 Timeline

Conversation 是连续工作记录，不使用社交聊天气泡。

- 用户指令：左侧 Ledger Edge 为 accent，顶部显示“你”和时间。
- Agent 输出：无边标，正文占主视觉。
- Think trace：默认折叠为紧凑 disclosure，显示耗时；Streaming 时展开当前段。
- Tool Group：折叠摘要显示数量、状态和总耗时。
- Approval：warning Ledger Edge + warning soft surface，保持在原时间位置。
- Error：danger Ledger Edge，提供 Retry/Details。
- Artifact/modified files：显示文件图标、路径和打开 Files 动作。

Timeline 主列 820px；代码、表格和 Tool 详情可扩展到 1040px。用户手动向上滚动后停止自动跟随，并显示“回到最新”。

### 7.3 Composer

Welcome Composer 与 Session Composer 共用一套结构：

- 输入高度 92–220px，超过后内部滚动。
- 上部：Slash token、Path Mention、Attachment 和正文。
- 下部左侧：Add、Approval Mode、Context。
- 下部右侧：Model Selection、Send/Stop。
- Enter 发送，Shift+Enter 换行；IME composition 期间不发送。
- Streaming 时 Send 原位变为 Stop，不改变宽度。
- 不可发送时 Tooltip 说明缺少 Project、模型、文本或仍在 Streaming。
- Plan disclosure 位于 Composer 上沿，与输入表面共享宽度，不悬浮遮挡 Timeline。

### 7.4 Approval

Pending Approval 在 Timeline 显示摘要，在 Activity Popover 中完成决策。

必须显示：

- Agent 要执行的动作。
- 目标文件、命令或外部资源。
- 可见风险。
- Approve once、Approve for run、Reject。

危险 Shell/File 操作默认焦点在 Reject 或安全返回；批准按钮不使用绿色，使用中性 Primary，避免把批准暗示为“正确答案”。审批完成后卡片变为只读结果，不从 Timeline 消失。

### 7.5 Activity

Activity Popover 复用现有 TaskPanel projection：

1. Run summary。
2. Tool summary。
3. Conversation approval。
4. Workflow approval。
5. Delegated work progress。
6. Parallel batch。

委派任务保持当前纵向轨迹，但轨迹只用于父子执行关系。Newest-first 必须在标题处明确；进入 Subagent/Worker detail 后提供稳定 Back，不替换整个应用导航。

Progress 有确定总量时显示 `done / total`；无总量时显示当前阶段。Synthesis 不同时使用 pulse 和 spinner，只保留静态状态图标与文案，必要时旋转单个 14px Loader。

---

## 8. Files

- Files 是 Auxiliary Bay Tab，不是独立全屏页面。
- FileTree 行高 28px；目录和文件使用 14px 图标。
- 选中文件使用 active surface；修改、未保存和错误通过独立状态标识。
- Filter 固定在顶部；Tree 滚动；EditorPane 在选中文件后出现。
- 宽度不足 340px 时 Tree 与 Preview 使用前后层级，不上下硬挤。
- 路径使用 Mono，中间截断，可复制。
- 文件创建、重命名和删除使用 inline input 或 Menu + Dialog；不能依赖 hover-only 图标。
- 二进制或不可预览文件提供在系统中打开和显示所在目录。

---

## 9. Research Scene

Research Scene 继续使用当前真实子视图：Conversation、Paper Library、Writing、Experiments。

### 9.1 Scene Tabs

- 位于 Scene Desk topbar 中部，不再另加一条 40px 子顶栏。
- Tab 高 28px，13px/550；当前项使用 active surface 和 Ledger Edge 的 2px 下边变体，二者择一。
- 800–999px 时图标保留、文字按优先级收纳到 More。

### 9.2 Paper Library

Paper Library 是研究资料目录，不使用 Dashboard 卡片：

- 顶部一行：标题/结果数、Search、Refresh。
- 第二行：View mode 和筛选器。
- Filter chips 超出时横向滚动，不换成多行标签墙。
- Flat 使用文献列表；Grouped 使用 tag section + 列表。
- 文献项优先显示 title、authors、journal/year、DOI 和 tags；abstract 默认两行并可展开。
- Journal metrics 是次级元数据，不用彩色 KPI Badge。
- Refresh Loading 保留当前数据，按钮内显示状态。

Writing 与 Experiments 未实现时显示明确的 Coming later 状态，但不能伪造可点击功能。

---

## 10. Resource Pages

### 10.1 Agents

- 默认使用列表 + 右侧编辑 Drawer。
- 行显示 Agent、模型、Skill preload 数和 MCP exclusion 数。
- 搜索和 Create Agent 保持在页面 topbar；结果数在列表头。
- description 不固定 `h-8`；列表中单行截断，Drawer 中完整显示。
- Agent 编辑表单按 Identity、Model、Skills、MCP exclusions 分段。

### 10.2 Skills & MCP

Plugins 页面统一命名为 **Skills & MCP**，内部使用 Tabs。

Skills：

- 列表显示名称、来源、可见性和最近更新。
- 内容预览进入 Drawer，不用卡片展开全部说明。

MCP：

- 列表显示名称、transport、endpoint/command、连接状态、最近 health check。
- Connect/Disconnect 是明确的行级动作。
- Health check 在原位置显示 checking → success/error，不只发 Toast。
- Command、args 和 URL 使用 Mono。
- MCP 配置使用 Drawer；stdio 与 HTTP 字段按 transport 切换。

### 10.3 Workflows 列表

- 使用列表而不是三列 Card。
- 列：名称、状态、节点数、最近更新、最近运行、Run、More。
- 点击名称进入编辑；Run 是独立按钮；Enable Toggle 不让整行可点击。
- Empty State 提供 Create Workflow。
- 删除通过统一 Dialog，不使用本地 modal overlay。

### 10.4 Settings

Settings 保留现有分类：LLM Provider、AI Subscription、Tools、Research、System；Agents、Skills/MCP 和 Workflows 不在 Settings 中重复出现。

- 左侧 Project Ledger 切换为 Settings index，并显示“返回工作桌”。
- 设置内容最大 760px；Provider 详情最大 880px。
- 使用 label + description + control 的行，不为每一项创建 Card。
- 自动保存显示 Saving / Saved / Failed；手动保存固定在表单底部。
- Theme、Language 和 Auto-save 属于 System。

---

## 11. Workflow Editor

Workflow Editor 是唯一允许自动折叠 Project Ledger 的视图，以最大化画布。

### 11.1 布局

```text
48px Workflow toolbar
┌─────────────┬───────────────────────┬──────────────────┐
│ Node palette│ React Flow canvas     │ one side panel   │
│ 208px       │ flexible, min 520px   │ 360–400px        │
└─────────────┴───────────────────────┴──────────────────┘
```

右侧一次只显示一种：Node/Edge Config、Execution、History。禁止三者并排连续压缩 Canvas。

### 11.2 Toolbar

- Back、workflow name、Save state、Undo/Redo、History、Run/Stop。
- 高 48px；macOS drag region 与普通 topbar 共享规则。
- 保存中、已保存、保存失败是可见状态。
- Run 前验证失败在画布和 Validation summary 同时显示，不只发 Toast。
- `⌘/Ctrl + S` Save，`⌘/Ctrl + Z` Undo，`⌘/Ctrl + Shift + Z` Redo。

### 11.3 Node

- Start/End：150 × 50px。
- 可执行 Node：210 × 100px 基线，可因必要摘要增高但不缩小命中区。
- Node header 展示 type 和 label；body 展示 Agent/goal/failure strategy 等一项关键配置。
- 选中：accent Ledger Edge + strong border。
- Pending：neutral status marker。
- Running：info marker，禁止整个 Node pulse。
- Success：success marker + check。
- Failed：danger marker + error icon。
- Disabled：降低文字对比并显示 Disabled label。
- 分类色只出现在 4px 顶边或 header tint。

### 11.4 Canvas 与面板

- Palette 同时支持 Drag 和 Click-to-add；键盘用户使用 Add Node Menu。
- Canvas 使用 subtle dot grid；Light/Dark 对比一致。
- MiniMap 默认在节点超过 8 个后显示，少量节点不占空间。
- Node/Edge Inspector 宽 380px，与当前代码一致。
- Execution Panel 显示节点执行轨迹、Approval、Stop 和输出。
- History Drawer 选择一次运行后复用 Execution Panel 详情，不再打开第三层面板。

---

## 12. 动效

- 高频导航和列表选择：0–100ms，无位移。
- Hover/Press：120ms。
- Menu/Popover：150ms，opacity + 3px translate。
- Drawer/Auxiliary Bay：200ms，transform + opacity。
- Dialog：180ms，opacity + `scale(.98 → 1)`。
- Toast：180ms enter / 140ms exit。
- Sidebar 用户拖拽期间无 transition；折叠/展开 200ms。

只动画 `transform`、`opacity` 和必要的颜色属性。禁止动画 width、height、margin、padding、top、left；面板尺寸拖拽直接更新。`prefers-reduced-motion` 下移除位移、缩放、pulse 和 stagger。

---

## 13. 可访问性与键盘

- 所有点击区域使用 button、link 或可访问原语；禁止裸 `div onClick`。
- Focus ring：2px accent + 2px offset，必须可见。
- 图标按钮有 `aria-label`；Tooltip 不是唯一名称。
- 最小命中区 40 × 40px；可视控件可以更小。
- Selected、Running、Failed、Approval 不能只靠颜色。
- Dialog、Drawer、Menu 和 Popover 正确管理 focus trap、Escape 和焦点返回。
- Streaming 文本不逐 token `aria-live`；状态完成或变化时再宣告。
- 拖拽操作必须有键盘替代：Workflow Add Node、Sidebar resize 默认值恢复、文件移动等。

全局键盘：

| 快捷键 | 行为 |
|---|---|
| `⌘/Ctrl + K` | Command Palette |
| `⌘/Ctrl + N` | 当前 Project 新建 Conversation |
| `⌘/Ctrl + Shift + N` | 新建 Project |
| `⌘/Ctrl + B` | 折叠/展开 Project Ledger |
| `⌘/Ctrl + .` | 打开/关闭 Auxiliary Bay |
| `⌘/Ctrl + ,` | Settings |
| `Escape` | 只关闭最上层临时表面 |

Tab 顺序：Project Ledger → Scene topbar → Scene content → Composer/Canvas controls → Auxiliary Bay。Overlay 打开后限制在 Overlay 内，关闭后返回触发器。

---

## 14. 层级

| Token | 值 | 用途 |
|---|---:|---|
| `--z-base` | 0 | 页面内容 |
| `--z-sticky` | 20 | Topbar、Composer Dock |
| `--z-popover` | 100 | Tooltip、Menu、Popover |
| `--z-drawer` | 200 | 紧凑侧栏、Auxiliary overlay、Drawer |
| `--z-scrim` | 300 | Dialog scrim |
| `--z-modal` | 400 | Dialog |
| `--z-toast` | 500 | Toast |

禁止 `z-[9999]`。若出现新层级，先更新本表。

---

## 15. macOS 与桌面行为

- 保持 hidden title bar 和 `contextIsolation` 等现有 Electron 安全边界。
- 左上 traffic lights 预留 76 × 28px；仅 Shell 管理该偏移。
- Topbar 空白区域是 drag region，Button/Input/Tab 明确 no-drag。
- 不同 Scene 和 Workflow Toolbar 不分别硬编码 115px、144px 等左 padding。
- 面板拖拽把手视觉宽 1–2px，命中宽 8px；hover 使用 accent 35% 混色。
- 窗口关闭、缩放、最小化后恢复用户的 Ledger、Auxiliary 和 Workflow 面板尺寸，但必须 clamp 到当前窗口。

---

## 16. 国际化和长内容

- 中文与英文共享同一布局，不依赖固定字符数。
- 工作区入口、Tab、Button 在空间不足时按优先级收纳，禁止文字重叠。
- 名称单行截断；说明最多三行；Abstract 和 Tool output 可展开。
- 相对时间通过 Tooltip 提供绝对时间；日志显示本地精确时间。
- 路径、命令、模型 ID 和 URL 可复制。
- 动态数字使用 tabular figures，避免运行中布局抖动。

---

## 17. 验收标准

每个新页面或重构模块必须通过以下检查。

### 17.1 布局

- 在 800 × 600、1120 × 700、1440 × 900 可完成核心任务。
- Project Ledger、Scene Desk、Auxiliary Bay 职责清晰。
- Files、Activity、Config、Execution、History 不会同时挤压主工作区。
- Root 不滚动；每个滚动区边界清晰。
- macOS traffic lights、drag/no-drag 区域正确。

### 17.2 视觉

- Light 是 Archive Paper，Dark 是 Carbon Desk；两者共享朱砂 accent。
- 不存在 radial glow、紫蓝 AI gradient、generic card grid 或无理由大空白。
- 颜色只来自现有语义 token；Workflow block palette 不泄漏到全局控件。
- 间距使用 4px 网格；字体和圆角来自本规范。
- Squint test 下可辨认当前 Project、主工作对象、Auxiliary 与最上层浮层。

### 17.3 状态

- 控件覆盖 Default、Hover、Active、Focus-visible、Selected、Disabled、Loading、Error。
- 列表覆盖 Loading、Empty、Error、Search empty。
- Agent/Workflow 覆盖 Queued、Running、Waiting Approval、Succeeded、Failed、Cancelled。
- 审批、错误和运行状态在关闭 Toast 后仍可找到。

### 17.4 交互

- 核心操作可用键盘完成，Tab 顺序稳定。
- 长文本、中文、英文、路径和模型 ID 不破坏布局。
- Hover 不改变布局，不隐藏唯一入口。
- Overlay 正确处理 Escape、外部点击和焦点返回。
- reduced motion 下无位移、pulse 或持续动态装饰。

### 17.5 实现

- 复用 `components/ui/`、Radix、Lucide、Tailwind v4 和现有 Zustand/IPC。
- 不引入第二套组件库、图标库、CSS-in-JS 或 token 系统。
- 不修改业务数据、持久化、IPC 或 Agent runtime 来迁就视觉设计。
- 不用绝对定位、魔法 z-index 或 `calc()` 让核心面板互相避让。
- 同一模式出现第二次时提取 component 或 variant。
- UI 文案同步 `en-US.json` 和 `zh-CN.json`。

---

## 18. 实施顺序

1. 统一 Light/Dark token 为 Archive Paper / Carbon Desk，删除 welcome glow 和主题间不一致 accent。
2. 统一 40px Shell topbar，修复 traffic lights 和 drag region。
3. 保持单一 Project Ledger，并明确分离 Work 模式与 Settings 模式。
4. 保留 FilePanel 作为右侧面板；将 TaskPanel 实现为锚定 topbar 的 Activity Popover。
5. 重做 Conversation Welcome 和 Timeline 层级。
6. 将 Agents、Skills、MCP、Workflow 卡片网格迁移为资源列表 + Drawer。
7. 统一 Dialog、Drawer、Toast、Button、Input 和状态组件。
8. 最后处理 Workflow Editor、Research Scene、窄窗口、键盘和动效。

每次只实施用户指定模块；不得借设计迁移重写业务架构或扩大到无关页面。

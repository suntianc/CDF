<div align="center">
  <br />
  <img src="src/renderer/public/logo.png" alt="CDF logo" width="80" style="border-radius: 8px;" />
  <br />
  <br />

  # CDF

  ### ── 本地项目工作桌 ──

  **一款为长线创作、科研及专业场景设计的本地优先（Offline-First）AI 工作站**

  *用「工作桌」的实体秩序，取代散落在无数网页标签页里的对话碎片。*

  <p>
    <strong>简体中文</strong> • <a href="README.md">English</a>
  </p>

  <p>
    <a href="#设计哲学local-field-desk">设计哲学</a> •
    <a href="#核心特性">核心特性</a> •
    <a href="#路线图">路线图</a> •
    <a href="#产品界面">产品界面</a> •
    <a href="#技术基座">技术基座</a> •
    <a href="#快速开始">快速开始</a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/License-AGPL%203.0-b83b22?style=flat-square&logo=git&logoColor=white" alt="License" />
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-333333?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Node-%3E%3D22-6b5d54?style=flat-square" alt="Node" />
  </p>
</div>

---

## 设计哲学：Local Field Desk

CDF 没有选择进入单调的 Coding Agent 范畴，或是选择 Hermes/Openclaw 全能型 Agent 赛道，用「场景（Scene）」重新定义人与 AI 协作的物理边界。

> **朱砂墨痕，规矩方圆。**  
> CDF 以**朱砂红**（Cinnabar Red）为唯一的全局强调色，引导你的视线聚焦于核心决策；我们拒绝无意义的紫蓝渐变、玻璃态与霓虹发光，只为你在长线、高强度的专业工作中提供最克制的视觉呼吸。

---

## 核心特性

### 场景工作桌 (Scenes) —— 按专业场景切换，而非按模型切换

AI 不应把写作、编程、图像和科研粗暴地塞进同一个对话输入框。在 CDF 中，每种专业任务都有它专属的 Scene 桌面：

*   **通用工作区 (General Workspace)**  
    承接从构思、写作、代码、图像到音视频的日常多模态工作。项目文件、上下文对话与生成产物被自然地归纳在同一个本地目录中。
*   **学术科研舱 (Research Scene)**  
    为材料阅读、文献检索、实验记录与写作提供共同的上下文。内置 **Paper Library**，支持文献检索、一键收集、PDF 本地解析与学术风格润色工作流。
*   **更多专业桌面（正在扩展）**  
    创作与设计桌面即将到来，你无需切换软件，在同一个桌面中即可无缝进入针对不同专业优化的物理工作区。

---

### 统一连接：使用你已有的 AI 订阅 (Subscriptions)

你不需要为每一个桌面工作站重新购买昂贵的专有 API服务。CDF 允许你在 **AI Subscriptions** 中统一接入现有的订阅：

*   <img src="assets/readme/minimax-color.svg" width="18" /> **MiniMax Token Plan**：驱动文本推理、多模态对话以及高质量图像、视频、语音和音乐生成能力。
*   <img src="assets/readme/openai-color.svg" width="18" /> **Codex / GPT OAuth**：使用你已登录的账号，调用其推理、代码及图像生成能力。
*   <img src="assets/readme/xai-color.svg" width="18" /> **xAI Grok OAuth**：借助长上下文推理与多模态分析，处理复杂的信息提取与生成。

> **能力即路由**：账号连接是 CDF 的能力入口，而非产品边界。你无需在不同的网页、应用之间来回跳转，即可无缝穿梭于推理、作图、音视频和研究之间。

---

### 任务骨架：Workflow Skeleton 与 Gate 审批机制

当任务不再能通过单次对话解决，CDF 的工作流骨架将复杂过程拆解为可预测的 **Stages** 和验收条件：
*   **Gate 闸口审批**：关键的节点会暂停，等待人类的确认或纠偏，绝不以“全自动”的幌子敷衍了事。
*   **档案边标 (Ledger Edge)**：Timeline 中等待审批、异常和重要产物，都使用侧边朱砂线贴合高亮，让需要关注的信息一眼即明。

> 目前工作流还处于初步阶段，暂未与主 Agent 打通，当前以手动方式触发

---

## 产品界面

> [!TIP]
> CDF 的界面由三大功能区精密组合而成：左侧的 **Project Ledger（项目簿）** 负责追踪本地上下文，中间的 **Scene Desk（场景桌面）** 承载主要创作区，右侧的 **Auxiliary Bay（辅助舱）** 按需展示文件树与活动轨迹。

| 本地项目工作桌 | 多模态订阅中心 |
| :---: | :---: |
| ![CDF 项目工作台](assets/readme/workbench.webp) | ![CDF 订阅与创作](assets/readme/subscriptions.webp) |
| *项目簿、主桌面与辅助舱各司其职，核心内容始终在视线中心* | *统一管理 MiniMax、Codex 与 Grok，文本、图文、音视频能力一触即发* |

| 复杂任务工作流 | 长线学术研究舱 |
| :---: | :---: |
| ![CDF 工作流运行](assets/readme/workflow.webp) | ![CDF 科研场景](assets/readme/research.webp) |
| *Stages 阶段推进与 Gate 闸口审批，掌控复杂任务的运行节奏* | *集论文库、文献检索、PDF 解析与学术写作于一体的原生场景* |

---

## 技术基座

CDF 坚守**本地优先**与**安全沙箱**的桌面工程实践，核心技术栈如下：

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                          CDF DESKTOP SYSTEM                            │
 ├───────────────────┬────────────────────────┬───────────────────────────┤
 │ PRESENTATION      │ AGENT RUNTIME          │ LOCAL STORAGE & VISUAL    │
 ├───────────────────┼────────────────────────┼───────────────────────────┤
 │ • Electron & Vite │ • LangChain & LangGraph│ • better-sqlite3 (SQLite) │
 │ • React 19        │ • deepagents           │ • Zustand State Store     │
 │ • Tailwind CSS v4 │ • Model Context        │ • React Flow Canvas       │
 │ • Radix UI        │   Protocol (MCP)       │ • Monaco & Excalidraw     │
 └───────────────────┴────────────────────────┴───────────────────────────┘
```

> **测试与构建保障**：全量测试套件由 [Vitest](https://vitest.dev/) 与 [Testing Library](https://testing-library.com/) 驱动，确保每一次主进程 IPC 变更与渲染进程的交互都精准可信。

---

## 快速开始

### 先决条件

*   **Node.js** `>= 22.0.0`
*   **Package Manager** `pnpm` `@11.5.1`
*   **OS Support** macOS / Windows / Linux 桌面环境

### 本地构建与运行

由于本项目依赖原生数据库模块 `better-sqlite3`，在开发和测试之间切换时需要注意原生 ABI 的重新编译：

```bash
# 1. 克隆并安装依赖
pnpm install

# 2. 启动 Electron 桌面开发环境（会自动将 Sqlite rebuild 至 Electron ABI）
pnpm run dev:electron
```

### 常用控制指令

| 命令 | 描述 | ABI 状态说明 |
| :--- | :--- | :--- |
| `pnpm run dev:electron` | **启动 Electron 开发桌面** | 自动 rebuild 原生模块至 **Electron ABI** *(推荐)* |
| `pnpm test` | **执行全量单元测试 (Vitest)** | 会在测试前将原生模块 rebuild 至 **Node ABI** |
| `pnpm run build` | **构建生产环境应用包** | 自动进行类型检查与跨进程构建编译 |
| `pnpm run preview` | **预览本地构建产物** | 在发布前进行本地 Electron 包可用性验证 |

> [!WARNING]
> **原生 ABI 冲突说明**：在运行过 `pnpm test` 之后，直接执行启动命令可能会遇到 sqlite ABI 不匹配的错误。请务必使用 `pnpm run dev:electron` 来还原 Electron 运行环境，**切勿**手动删除 lockfile 或尝试重装依赖。

---

## 项目结构

遵循 Electron 的安全设计，CDF 的核心逻辑分布在以下目录：

```text
CDF/
├── src/
│   ├── main/        # Electron 主进程 (IPC, 数据库, LLM, deepagent 运行时)
│   ├── preload/     # contextBridge 安全通道预加载脚本
│   ├── renderer/    # React 渲染进程 (工作桌界面, 状态 stores, i18n)
│   └── shared/      # 跨主/渲染进程共享的 TypeScript 类型定义与常量
├── docs/            # 领域设计文档与架构决策记录 (ADR)
├── resources/       # 随应用打包的静态资产与图标
└── patches/         # patch-package 本地依赖修补程序
```

> **开发原则**：安全边界至关重要。请保持 `contextIsolation: true` 及 `nodeIntegration: false`；渲染进程所需的系统高权限能力必须经由 [preload](file:///Users/suntc/project/CDF/src/preload/) 并通过 IPC 向主进程发出请求。

---

## 贡献与许可

我们极其欢迎任何关于专业 Scene 的设计建议、技术讨论与 PR 贡献：
*   在提报任何代码变更前，请务必先仔细阅读我们的 [AGENTS.md](file:///Users/suntc/project/CDF/AGENTS.md) 指南。
*   本项目开源协议采用 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)。

---

## 路线图

- [x] **Agent通用场景**
- [x] **基础科研场景**
- [ ] **1.0版本能力打磨，完善（进行中）**
- [ ] **设计类场景（进行中）**
- [ ] **待规划...**

---

## 致谢

CDF 的诞生承蒙开源社区众多卓越项目垫起的基石。在此向以下项目的维护者和贡献者致以崇高的敬意：

*   **应用骨架**：[`Electron`](https://www.electronjs.org/) 与 [`electron-vite`](https://electron-vite.org/) 提供了稳固的桌面跨平台运行基座。
*   **交互界面**：[`React`](https://react.dev/)、[`TypeScript`](https://www.typescriptlang.org/)、[`Tailwind CSS`](https://tailwindcss.com/)、[`Radix UI`](https://www.radix-ui.com/) 与 [`Lucide Icons`](https://lucide.dev/) 勾勒出 Local Field Desk 的质感。
*   **Agent 编排**：[`LangChain`](https://js.langchain.com/)、[`LangGraph`](https://langchain-ai.github.io/langgraphjs/)、[`deepagents`](https://github.com/langchain-ai/deepagentsjs) 与 [`Model Context Protocol (MCP)`](https://modelcontextprotocol.io/) 赋予工作站以智能。
*   **本地引擎**：[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) 构筑高速本地存储，[`Zustand`](https://zustand.docs.pmnd.rs/) 维系全局状态，[`React Flow`](https://reactflow.dev/) 实现工作流可视化。
*   **内置能力支持**：
    *   [`paper-search-cli`](https://github.com/dr-dumpling/paper-search-cli) 赋能文献库学术检索与元数据抓取。
    *   [`Obscura`](https://github.com/h4ckf0r0day/obscura) 驱动 Crawler 爬虫的结构化网页提取。
    *   [`Marker`](https://github.com/VikParuchuri/marker) 为本地 PDF 解析提供了卓越的排版提取路径。
    *   [`scientific-agent-skills`](https://github.com/K-Dense-AI/scientific-agent-skills) 与 [`humanizer`](https://github.com/blader/humanizer) 启发并构成了学术润色与审稿技能的基底。

<p align="center">
  <b>CDF • Local Field Desk AI Workspace</b>
</p>

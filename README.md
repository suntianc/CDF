# CDF

CDF 是一个离线优先的桌面端 Agent 开发工作站。它基于 Electron、React 和本地工作流编排能力，让开发者通过自然语言对话驱动自动化开发流程。

项目目标是提供一个本地化的 Master Agent 工作台：开发者描述需求，Master Agent 负责理解目标、编排流程、调用已配置的 MCP 与 Skills，并在桌面应用中交付执行结果。

## 核心特性

- **自然语言驱动开发**：通过对话描述需求，由 Master Agent 统筹任务执行。
- **离线优先**：项目数据和工作流状态优先保存在本地，适合私有项目和本地开发环境。
- **桌面应用体验**：基于 Electron 构建跨平台桌面应用。
- **Agent 工作流编排**：支持将复杂任务拆解为可执行节点与自动化流程。
- **本地状态管理**：使用 SQLite、Electron Store 与 Zustand 管理应用数据和前端状态。
- **多模型/多工具集成**：支持接入 LangChain、LangGraph、MCP 适配器和本地/远程模型提供方。

## 技术栈

- **桌面框架**：Electron、electron-vite
- **前端框架**：React、TypeScript、Vite
- **样式与 UI**：Tailwind CSS、Radix UI、Lucide React、assistant-ui
- **状态管理**：Zustand
- **工作流与图编辑**：React Flow、LangGraph、deepagents
- **本地数据**：better-sqlite3、electron-store
- **测试**：Vitest、Testing Library

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- npm

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 运行测试

```bash
npm test
```

### 构建应用

```bash
npm run build
```

### 预览构建结果

```bash
npm run preview
```

## 开发脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run build` | 构建主进程、预加载脚本和渲染进程 |
| `npm run preview` | 预览构建后的 Electron 应用 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 以 watch 模式运行测试 |
| `npm run postinstall` | 安装 Electron 原生依赖并应用 patch-package 补丁 |

## 项目结构

```text
.
├── src
│   ├── main           # Electron 主进程、IPC、LLM、数据库与工作流逻辑
│   ├── preload        # contextBridge 预加载脚本
│   ├── renderer       # React 渲染进程应用
│   └── shared         # 主进程与渲染进程共享类型和工具
├── resources          # 应用资源文件
├── scripts            # 项目脚本
├── patches            # patch-package 补丁
├── electron.vite.config.ts
├── vitest.config.ts
├── package.json
└── LICENSE
```

## 开发说明

- 主进程代码位于 `src/main`，负责 Electron 生命周期、IPC、LLM 调用和本地数据访问。
- 渲染进程代码位于 `src/renderer/src`，负责桌面端界面、状态管理和用户交互。
- 预加载脚本位于 `src/preload`，通过 `contextBridge` 安全暴露主进程能力。
- 共享类型位于 `src/shared`，用于保持主进程和渲染进程之间的类型一致性。

## 许可证

本仓库根目录的 `LICENSE` 文件使用 GNU Affero General Public License v3.0。请在使用、修改或分发本项目时遵守该许可证条款。

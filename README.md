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
- **测试**：Vitest 4（main 进程用 node 环境、renderer 用 jsdom + @testing-library/react）、@testing-library/react、@testing-library/dom

## 快速开始

### 环境要求

- **Node.js 22**（项目通过 `.nvmrc` 锁定版本，建议用 `nvm use`）
- **pnpm 11**（项目通过 `packageManager` 字段锁定版本；`engines.node >= 22`）
- 原生模块构建工具链：本项目依赖 `better-sqlite3`，安装时需要 C/C++ 编译环境：
  - Debian / Ubuntu：`sudo apt install build-essential python3`
  - Fedora / RHEL：`sudo dnf install gcc-c++ python3`
  - macOS：`xcode-select --install`
  - Windows：安装 Visual Studio Build Tools，并勾选"使用 C++ 的桌面开发"

### 安装依赖

```bash
pnpm install
```

`postinstall` 会自动用 `electron-rebuild` 把 `better-sqlite3` 编译到 Electron 的 ABI。

### 启动开发环境

```bash
# 推荐：启动前自动 rebuild 原生模块到 Electron ABI
pnpm run dev:electron

# 已知原生模块状态正确时，直接启动（更快）
pnpm run dev
```

> **注意：** `better-sqlite3` 的原生模块在「测试（Node ABI）」和「开发（Electron ABI）」之间需要不同的编译产物。跑过 `pnpm test` 后，`pretest` 会把它重编译到 Node ABI，此时直接 `pnpm run dev` 会因 ABI 不匹配启动失败。请改用 `pnpm run dev:electron`，它会先 rebuild 再启动。

### 运行测试

```bash
pnpm test            # 全量测试（pretest 自动 rebuild 到 Node ABI）
pnpm run test:watch  # watch 模式
```

测试使用 **Vitest 4**，按运行区域分离环境（见 `vitest.config.ts` 的 `test.projects` 配置）：

- **main 进程测试**（`src/main/**/*.test.ts`）：node 环境，可 import `node:` 内置模块与 `better-sqlite3`。
- **renderer 测试**（`src/renderer/**/*.test.{ts,tsx}`）：jsdom 环境，用 `@vitejs/plugin-react` 提供 JSX runtime，`vitest.setup.ts` 设置 `IS_REACT_ACT_ENVIRONMENT`（React 19 兼容）并自动 cleanup DOM。

跑单个测试文件或按名字过滤：

```bash
pnpm test src/main/deepagent/agent-tools.test.ts   # 指定文件
pnpm test -t "renders file kind"                   # 按测试名过滤
```

> CI（`.github/workflows/code-checks.yml`）会在 ubuntu/macos/windows 三平台矩阵上跑同一套测试，并额外 `pnpm rebuild better-sqlite3` 确保 Node ABI 匹配。

### 构建应用

```bash
pnpm run build
```

### 预览构建结果

```bash
pnpm run preview
```

## 开发脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm run dev` | 启动 Electron + Vite 开发环境（不 rebuild，需原生模块已为 Electron ABI） |
| `pnpm run dev:electron` | 先 rebuild 原生模块到 Electron ABI，再启动开发环境（跑过测试后推荐用此命令） |
| `pnpm run build` | 构建主进程、预加载脚本和渲染进程 |
| `pnpm run preview` | 预览构建后的 Electron 应用 |
| `pnpm test` | 运行 Vitest 测试（pretest 自动 rebuild 原生模块到 Node ABI） |
| `pnpm run test:watch` | 以 watch 模式运行测试 |
| `pnpm run postinstall` | 用 `electron-rebuild` 编译原生模块到 Electron ABI，并应用 patch-package 补丁 |

> **原生模块 ABI 说明：** `better-sqlite3` 是 native addon，Node.js（测试用）和 Electron（开发/运行时用）有不同的 ABI 版本。项目通过 `pretest`（→ Node ABI）和 `dev:electron`/`postinstall`（→ Electron ABI）自动切换，无需手动 `npm rebuild`。

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
├── vitest.config.ts   # 测试配置（main→node、renderer→jsdom 分环境）
├── vitest.setup.ts    # renderer 测试 setup（React 19 act 兼容 + DOM cleanup）
├── package.json
└── LICENSE
```

## 开发说明

- 主进程代码位于 `src/main`，负责 Electron 生命周期、IPC、LLM 调用和本地数据访问。
- 渲染进程代码位于 `src/renderer/src`，负责桌面端界面、状态管理和用户交互。
- 预加载脚本位于 `src/preload`，通过 `contextBridge` 安全暴露主进程能力。
- 共享类型位于 `src/shared`，用于保持主进程和渲染进程之间的类型一致性。

### 测试约定

- 测试文件与源码同目录，后缀 `.test.ts`（main）或 `.test.tsx`（renderer）。
- **main 进程测试**：`src/main/**/*.test.ts`，跑在 node 环境，可直接 import `node:` 内置模块、`better-sqlite3`。需要 mock `electron` 模块（用 `vi.mock` stub `app.getPath` 等）。
- **renderer 测试**：`src/renderer/**/*.test.{ts,tsx}`，跑在 jsdom 环境，用 `@testing-library/react` 的 `render` / `screen` / `fireEvent`。组件依赖的 `lucide-react` 图标可在测试里 mock 为 sentinel `<svg data-testid="...">`。
- **集成测试**：`*.integration.test.ts` 用真实 SQLite（非 mock），验证 FK CASCADE、UNIQUE 约束等数据库行为。
- 写新的 main 进程测试无需手动加 `// @vitest-environment node`——`vitest.config.ts` 的 `test.projects` 已按路径自动分配环境。

## 许可证

本仓库根目录的 `LICENSE` 文件使用 GNU Affero General Public License v3.0。请在使用、修改或分发本项目时遵守该许可证条款。

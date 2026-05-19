# Stack Research: Desktop Agent Workbench

> 基于 pi-coding-agent + GSD 的桌面 agent 应用

## Recommended Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Desktop Shell** | Electron 34+ | Node.js 原生兼容 pi SDK，生态成熟 |
| **Frontend** | React 19 + TypeScript 5 | 用户选定，生态最丰富 |
| **Build** | electron-vite + electron-builder | 开发体验好，HMR 支持，打包成熟 |
| **Styling** | Tailwind CSS 4 + shadcn/ui | 美观、可定制、组件丰富 |
| **State** | Zustand | 轻量、TS 友好、无 boilerplate |
| **IPC Bridge** | Electron contextBridge + ipcRenderer/ipcMain | 安全隔离主进程和渲染进程 |
| **Agent Engine** | `@earendil-works/pi-coding-agent` (v1.x) | 核心 SDK，提供 createAgentSession、SessionManager、DefaultResourceLoader |
| **MCP Client** | `@modelcontextprotocol/client` (v1.x) | 官方 SDK，连接 MCP server，获取 tools |
| **AI Provider** | pi 内置 ModelRegistry + AuthStorage | 已有多 provider 支持（Anthropic、OpenAI、Google 等） |
| **Workflow** | pi-gsd (v2.1.4) | GSD discuss→plan→execute→verify 流程 + 18个子 agent |
| **Icon** | lucide-react | 图标美观、按需加载 |

## 关键依赖版本

```json
{
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^1.x",
    "@modelcontextprotocol/client": "^1.x",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.x",
    "tailwindcss": "^4.0.0",
    "@radix-ui/react-*": "^1.x"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.x"
  }
}
```

## 为什么选这些

### Electron vs Tauri

| 维度 | Electron | Tauri |
|------|----------|-------|
| 生态 | 极其成熟，任何问题都有答案 | 较新，部分场景需要自己摸索 |
| Node.js 兼容 | 原生，pi SDK 直接 require | 需要 sidecar 或子进程 |
| 包体 | ~150MB baseline | ~5MB baseline |
| 内存 | 较高 | 较低 |
| 结论 | ✅ 选择 | pi SDK 是 Node.js 包，Electron 主进程可直接 import。若用 Tauri 则需要额外桥接层，增加复杂度。V1 优先降低技术风险。 |

### electron-vite

- 原生 Vite 支持，HMR 速度极快
- 主进程/渲染进程/preload 分目录管理
- 内置 electron-builder 集成
- 社区活跃，2025 年已成为 Electron + Vite 的主流选择

### @modelcontextprotocol/client (v1.x)

- v1.x 是当前稳定版，用于生产环境
- 支持 StdioClientTransport 和 Streamable HTTP
- 可连接任何 MCP server，获取 tools 列表并调用
- 2026 年 Q2 的 v2 版本还在 pre-alpha，暂不使用

## 不推荐的方案

| 方案 | 原因 |
|------|------|
| Tauri v2 | Rust 侧需要额外维护 pi SDK 的 Node.js sidecar，增加 V1 复杂度 |
| Vue/Svelte | 用户选定 React，生态优势明显 |
| Next.js/Remix | 桌面应用不需要 SSR，增加无谓复杂度 |
| Python backend | 额外进程通信开销，和 pi SDK 的 Node.js 生态不匹配 |
| WebSocket IPC | Electron 内置 IPC 已经足够，WebSocket 额外复杂 |

## Confidence

- **Desktop shell**: 高置信度 — Electron 是 Node.js 桌面应用的行业标准
- **Frontend stack**: 高置信度 — React+Tailwind+shadcn 是 2025-2026 的主流组合
- **Agent engine**: 高置信度 — pi SDK 是核心，无替代方案
- **MCP client**: 高置信度 — 官方 SDK，标准实现
- **Build tooling**: 中置信度 — electron-vite 成熟，但也可用 electron-forge
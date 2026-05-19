# Research Summary: Desktop Agent Workbench

> 基于 pi-coding-agent + GSD 的桌面 agent 工作台

## Key Findings

### Stack

| 决定 | 方案 |
|------|------|
| Desktop | **Electron** — pi SDK 原生兼容，无需额外桥接 |
| Frontend | **React 19 + TypeScript + Tailwind 4 + shadcn/ui** |
| Build | **electron-vite + electron-builder** |
| Agent Engine | **@earendil-works/pi-coding-agent v1.x** |
| MCP | **@modelcontextprotocol/client v1.x** (StdioClientTransport) |
| Workflow | **pi-gsd v2.1.4** (已有 18 子 agent) |

### Table Stakes

AI 对话、Workspace 管理、Model Provider 配置、对话历史持久化、Skills 安装和管理、MCP Server 管理

### Differentiators

Skills 驱动子 agent、GSD 工作流可视化、MCP tools 自动注入 agent、多 Workspace 切换

### Watch Out For

1. **主进程阻塞** — agent 操作异步化，不阻塞 UI
2. **MCP 僵尸进程** — 断开时确保 kill 子进程
3. **Session 混乱** — workspace 切换时 dispose 旧 session
4. **Skills 安全** — 安装来源不明 skill 需谨慎
5. **IPC 过载** — streaming 数据节流推送
6. **GSD 子 agent 依赖** — 确保 `pi` 命令在 PATH 中

## 架构概览

```
Main Process (Node.js)
  ├─ AgentManager (pi SDK sessions)
  ├─ McpManager (MCP client connections)
  ├─ SkillManager (.pi skills + GitHub install)
  └─ WorkspaceManager (cwd + config)
        │
    IPC (contextBridge)
        │
Renderer Process (React + Zustand)
  ├─ ChatPanel (streaming messages)
  ├─ SkillBrowser (list + execute)
  ├─ McpManager (connect/disconnect)
  ├─ SettingsPanel (providers)
  └─ WorkspaceSelector
```

## 文件清单

| 文件 | 状态 |
|------|------|
| `.planning/PROJECT.md` | ✅ |
| `.planning/config.json` | ✅ |
| `.planning/research/STACK.md` | ✅ |
| `.planning/research/FEATURES.md` | ✅ |
| `.planning/research/ARCHITECTURE.md` | ✅ |
| `.planning/research/PITFALLS.md` | ✅ |
| `.planning/research/SUMMARY.md` | ✅ 当前文件 |

## 下一步

1. 定义 v1 Requirements（REQUIREMENTS.md）
2. 创建 Roadmap（ROADMAP.md + STATE.md）
3. 开始 Phase 1 讨论
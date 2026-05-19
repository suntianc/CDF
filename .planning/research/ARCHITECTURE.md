# Architecture Research: Desktop Agent Workbench

> 关键架构决策和组件设计

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
│                                                              │
│  ┌──────────── Renderer Process ────────────┐                │
│  │  React App (Vite + Tailwind + shadcn)    │                │
│  │                                           │                │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐  │                │
│  │  │ Chat     │ │ Skills   │ │ Settings  │  │                │
│  │  │ Panel    │ │ Browser  │ │ Panel     │  │                │
│  │  └─────────┘ └──────────┘ └───────────┘  │                │
│  │  ┌─────────┐ ┌──────────┐                │                │
│  │  │ MCP     │ │ Workspace│                │                │
│  │  │ Manager │ │ Selector │                │                │
│  │  └─────────┘ └──────────┘                │                │
│  │                                           │                │
│  │  ┌─── Zustand Stores ──────────────────┐  │                │
│  │  │ agent │ skills │ mcp │ workspace    │  │                │
│  │  └────────────────────────────────────-┘  │                │
│  └───────────────┬─── contextBridge ─────────┘                │
│                  │ IPC (invoke/on)                            │
│  ┌──────────── Main Process ──────────────┐                  │
│  │                                         │                  │
│  │  ┌── AgentManager ──────────────────┐   │                  │
│  │  │  createAgentSession()            │   │                  │
│  │  │  session.subscribe() → IPC push  │   │                  │
│  │  │  session.prompt()               │   │                  │
│  │  │  skills: load/execute           │   │                  │
│  │  └──────────────────────────────────┘   │                  │
│  │                                         │                  │
│  │  ┌── McpManager ────────────────────┐   │                  │
│  │  │  connect(StdioClientTransport)   │   │                  │
│  │  │  listTools() → registerTool()    │   │                  │
│  │  │  callTool()                      │   │                  │
│  │  │  disconnect()                    │   │                  │
│  │  └──────────────────────────────────┘   │                  │
│  │                                         │                  │
│  │  ┌── SkillManager ──────────────────┐   │                  │
│  │  │  discover(.pi/skills/)           │   │                  │
│  │  │  installFromGitHub(repo)         │   │                  │
│  │  │  installFromLocal(path)          │   │                  │
│  │  │  execute(name, args)             │   │                  │
│  │  └──────────────────────────────────┘   │                  │
│  │                                         │                  │
│  │  ┌── WorkspaceManager ──────────────┐   │                  │
│  │  │  select(path)                    │   │                  │
│  │  │  detect(dotPi, dotPlanning)      │   │                  │
│  │  │  config persistence              │   │                  │
│  │  └──────────────────────────────────┘   │                  │
│  │                                         │                  │
│  └─────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

## 核心数据流

### Agent 对话流程

```
User Input → React ChatInput → IPC invoke('agent:prompt')
  → main AgentManager.session.prompt(text)
    → pi SDK agent loop
      → stream events: message_update / tool_call / tool_result
        → IPC send('agent:event', event)
          → React Zustand store update
            → ChatPanel re-render
```

### MCP 集成流程

```
User 添加 MCP server → IPC invoke('mcp:connect', config)
  → McpManager.connectServer(config)
    → new StdioClientTransport(command, args)
    → new Client().connect(transport)
    → client.listTools() → get tool list
  → 返回 tools 列表到 UI
  → 注入到当前 agent session: pi.registerTool(mcpTool)

User 发送 prompt → agent 调用 mcp_tool
  → execute() → client.callTool(name, args) → 返回结果
```

### Skill 执行流程

```
User 点击 skill → IPC invoke('skill:execute', name, args)
  → SkillManager.readSkill(name)
    → 读取 .md 文件内容 (frontmatter + body)
  → 拼接参数: content + "\n" + args
  → agentManager.currentSession.prompt(skillContent)
  → 结果流式推送到 UI
```

## 进程模型

```
┌─────────────────────────────────┐
│  Main Process (Node.js)         │
│                                 │
│  • pi SDK agent sessions        │
│  • MCP server connections       │
│  • File I/O (workspace, skills) │
│  • Electron window management   │
│  • Config persistence           │
│                                 │
│  单个主进程处理所有 agent 逻辑   │
│  GSD 子 agent 走 child_process  │
│  生成独立 pi 进程（JSON mode）  │
└─────────────────────────────────┘
```

## 安全模型

- **IPC 隔离**: 渲染进程通过 contextBridge + preload 访问有限 API，不暴露 Node.js 完整能力
- **Workspace 沙箱**: 每个 agent session 绑定了 cwd，工具调用限制在工作区内
- **MCP 权限**: MCP server 连接需用户主动添加和确认
- **API Key 管理**: 通过 pi 的 AuthStorage 加密存储，不暴露到渲染进程

## 数据持久化

| 数据 | 存储位置 | 方式 |
|------|---------|------|
| Agent 会话 | `~/.pi/agent/sessions/` 或工作区 | pi SessionManager (.jsonl) |
| Model 配置 | `~/.pi/agent/auth.json` + settings.json | AuthStorage |
| MCP 配置 | 工作区 `.pi/mcp-servers.json` | JSON |
| Workspace 列表 | App config 目录 | electron-store / JSON |
| Skills | 工作区 `.pi/skills/` + 全局 `~/.pi/agent/skills/` | Markdown 文件 |
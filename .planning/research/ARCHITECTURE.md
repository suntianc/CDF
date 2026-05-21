# Architecture Patterns

**Domain:** Electron 桌面应用 with Agent 工作流
**Researched:** 2026-05-21
**Confidence:** MEDIUM（基于训练数据，WebSearch 验证失败）

## Recommended Architecture

Electron 应用采用多进程架构，分为 Main Process（主进程）和 Renderer Process（渲染进程）。对于 Agent 工作流系统，推荐分层设计：

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Node.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Window    │  │   IPC Hub   │  │  pi-code-agent CLI  │  │
│  │  Manager    │  │             │  │     Integration     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Data      │  │   Config    │  │    MCP Server      │  │
│  │   Store     │  │   Store     │  │    Manager         │  │
│  │  (SQLite)   │  │  (JSON)     │  │                    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ IPC
┌─────────────────────────────────────────────────────────────┐
│                Renderer Process (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Master    │  │  Workflow  │  │     Agent          │  │
│  │   Agent     │  │   Canvas    │  │     Library        │  │
│  │   Chat UI   │  │  (ReactFlow)│  │     Panel          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Shared UI Components                   │    │
│  │   (Shadcn UI + Tailwind + assistant-ui)            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Component Boundaries

### Main Process Components

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Window Manager** | 创建/管理 BrowserWindow，生命周期控制 | Renderer via IPC |
| **IPC Hub** | 路由主进程与渲染进程间消息，暴露 API | Both directions |
| **pi-code-agent CLI Integration** | 执行底层 Agent 命令，子进程管理 | IPC Hub |
| **MCP Server Manager** | 管理 MCP 服务器健康检查、配置 | IPC Hub |
| **Data Store (SQLite)** | 持久化项目、工作流、Agent 资产 | IPC Hub |
| **Config Store** | 用户配置、主题偏好 | IPC Hub |

### Renderer Process Components

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Master Agent Chat UI** | 用户对话界面（assistant-ui） | IPC Hub |
| **Workflow Canvas** | 可视化编排（ReactFlow） | IPC Hub |
| **Agent Library Panel** | Agent 资产管理 | IPC Hub |
| **Project Panel** | 多项目管理 | IPC Hub |
| **Settings Panel** | 模型配置、MCP 配置 | IPC Hub |

## Data Flow

### 核心数据流

```
User Input → Master Agent Chat UI → IPC → Main Process → pi-code-agent CLI
                                                              ↓
UI Update ← Chat Response ← IPC ← Main Process ← CLI Output
```

### 工作流执行数据流

```
Workflow Start → Read Workflow Definition → For Each Node:
  → If Agent Node: IPC → pi-code-agent (with node config: LLM, MCP, Skills)
  → If Action Node: IPC → Execute Script/Query
  → Store Results → Next Node or Wait for User Confirmation
  → User Confirm → Continue or Modify
→ Workflow Complete → Store Results → UI Update
```

### 上下文管理数据流

```
Chat Message → Check Window Usage
  → If < 85%: Append to conversation history
  → If >= 85%: Trigger summarization → Store summary → Start new session with summary injected
```

## IPC 通信模式

### 推荐的 IPC 通道

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `agent:invoke` | Renderer → Main | 调用 Agent 执行任务 |
| `agent:response` | Main → Renderer | 流式返回 Agent 响应 |
| `workflow:execute` | Renderer → Main | 启动工作流执行 |
| `workflow:status` | Main → Renderer | 工作流执行状态更新 |
| `mcp:health-check` | Renderer → Main | MCP 服务器健康检查 |
| `mcp:status` | Main → Renderer | MCP 服务器状态 |
| `store:query` | Renderer → Main | 数据查询 |
| `store:persist` | Renderer → Main | 数据持久化 |

### IPC 实现示例模式

```typescript
// Main Process: IPC Handler
ipcMain.handle('agent:invoke', async (event, { prompt, config }) => {
  const child = spawn('pi-code-agent', ['execute', '--prompt', prompt]);
  return new Promise((resolve) => {
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    child.on('close', () => resolve(output));
  });
});

// Renderer Process: IPC Invoke
const result = await window.electron.invoke('agent:invoke', { prompt, config });
```

## Build Order Implications

基于依赖关系的构建顺序建议：

### Phase 1: 基础设施层
```
1. Main Process 基础架构（Window Manager, IPC Hub）
2. Renderer 基础架构（React + Vite + Tailwind）
3. 数据持久层（SQLite + Config Store）
```
**原因：** 其他所有层都依赖 IPC 通信和数据持久化

### Phase 2: 核心 UI 组件
```
1. Master Agent Chat UI（assistant-ui 集成）
2. 基础布局框架（侧边栏、导航）
3. 主题系统（明/暗切换）
```
**原因：** 用户最早需要与 Master Agent 对话，是核心交互界面

### Phase 3: Agent 集成
```
1. pi-code-agent CLI 集成
2. MCP Server Manager
3. Agent Library Panel
4. LLM 配置面板
```
**原因：** 需要与外部 Agent 引擎通信

### Phase 4: 工作流系统
```
1. ReactFlow 集成
2. Workflow Canvas
3. 工作流执行引擎
4. 节点并行/串行执行控制
```
**原因：** 依赖 Agent 集成完成

### Phase 5: 项目管理
```
1. 多项目管理面板
2. 项目切换逻辑
3. 项目级数据隔离
```
**原因：** 依赖工作流系统完成

## Scalability Considerations

| Concern | 100 Users | 10K Users | 1M Users |
|---------|-----------|-----------|----------|
| **数据存储** | SQLite 单文件 | SQLite 分片 | PostgreSQL/分布式 |
| **工作流执行** | 单线程顺序 | 线程池并行 | 进程池 + 队列 |
| **上下文窗口** | 本地总结 | 分层总结策略 | 向量数据库索引 |
| **UI 响应** | 无优化 | 虚拟列表 | 懒加载 + 分页 |

## Anti-Patterns to Avoid

### 1. 不要在 Renderer 中直接调用 Node.js 模块
**What:** 在 React 组件中直接 require('fs') 或其他 Node 模块
**Why:** 安全风险 + 违反 Electron 架构原则
**Instead:** 总是通过 IPC 调用 main process

### 2. 不要阻塞主进程
**What:** 在 main process 中执行长时间同步操作
**Why:** 导致 UI 冻结
**Instead:** 使用 child_process 或 worker_threads

### 3. 不要把所有状态放 Redux
**What:** 对于 Electron 桌面应用，所有状态都放全局 store
**Why:** 增加不必要的复杂度
**Instead:** 局部组件状态 + IPC 同步关键数据

## Sources

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) - 官方文档（需要验证）
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc) - 官方文档（需要验证）
- **Confidence Note:** WebSearch 验证失败，本文基于训练数据编写，建议通过官方文档验证关键细节

---

*Research completed but limited by WebSearch API errors. Recommend validating with official Electron documentation.*

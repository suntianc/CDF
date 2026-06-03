# Architecture Patterns — `/` Command System (v1.1)

**Project:** CDF — Agent 开发工作站
**Subsystem:** v1.1 — Claude Code 风格 `/` 命令 popup
**Researched:** 2026-06-04
**Confidence:** HIGH（基于直接源码阅读；所有 IPC channel 与 file path 均为现存而非新设计）

---

## 1. System Overview — 命令系统如何嵌入现有架构

CDF 已经是一个成熟的 Electron 三进程架构（main / preload / renderer），新功能必须落在已有约束里：main 是单一可信源、preload 是 contextBridge 暴露面、renderer 是 React 19 + Zustand 状态。`/` 命令系统不是一个新子系统，而是**对 ChatArea 输入层 + sessionStore 状态层 + IPC 元数据查询层的轻量增量**。

```
┌──────────────────────────────────────────────────────────────────────┐
│  RENDERER (React 19 + Zustand + assistant-ui 自有 textarea)          │
│                                                                      │
│  ┌──────────────────────────┐    ┌─────────────────────────────┐     │
│  │ ChatArea.tsx (1097 lines)│    │ useSlashCommandStore (NEW)  │     │
│  │  ├─ <textarea> + popup   │◄──►│  ├─ commands: SlashCommand[]│     │
│  │  ├─ handleKeyDown        │    │  ├─ filter / cursorIndex    │     │
│  │  └─ dispatchCommand()    │    │  └─ session-cache invalidation│    │
│  │         │                │    └──────────────┬──────────────┘     │
│  │         │ invoke         │                   │ subscribe         │
│  │         ▼                │                   ▼                    │
│  │ useSessionStore.sendMsg  │    useCommandRegistry (NEW hook)        │
│  │  ├─ llm:chat (existing)  │     ├─ IPC: commands:list              │
│  │  └─ workflow:run (existing)     └─ merge static + dynamic         │
│  └──────────────────────────┘                                        │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ contextBridge (preload)
┌──────────────────────────────────┼───────────────────────────────────┐
│  PRELOAD (src/preload/index.ts) — add 3 methods:                      │
│   - commands.list(projectId)                                         │
│   - commands.readProjectCommands(projectId)                          │
│   - llm.chat  (existing) | workflow.runWorkflow (existing)           │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │ ipcMain.handle
┌──────────────────────────────────┼───────────────────────────────────┐
│  MAIN (Node.js + LangGraph + sqlite)                                 │
│                                                                      │
│  ┌─────────────────────┐  ┌────────────────────┐  ┌──────────────┐  │
│  │ ipc-handlers.ts     │  │ deepagent/         │  │ workflow/    │  │
│  │  + registerCommands │  │  - mcp-connector   │  │  workflow-   │  │
│  │    IpcHandlers()    │  │  - skill-manager   │  │  runtime.ts  │  │
│  │                     │  │  - runtime.ts      │  │  (existing)  │  │
│  │ commands:list       │  │                    │  │              │  │
│  │  合并 4 源：         │  │  client.getTools() │  │  runWorkflow │  │
│  │   • 静态系统命令 3   │  │  listPhysical...   │  │  (existing)  │  │
│  │   • MCP tools (cache)│  │                    │  │              │  │
│  │   • Skills (fs)     │  │                    │  │              │  │
│  │   • Workflows (db)  │  │                    │  │              │  │
│  │   • .cdf/commands/* │  │                    │  │              │  │
│  └─────────────────────┘  └────────────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 核心决策

| 决策 | 取舍 | 落到哪里 |
|---|---|---|
| 注册表放 renderer（Zustand）| main 持有 source of truth；renderer 缓存可减少 IPC | `useSlashCommandStore` + `useCommandRegistry` hook |
| 插件命令元数据**只在 IPC `commands:list` 拉一次**，session 切换 / 资产变更时失效 | MCP 连接是贵操作，不能每次按键都连 | `mcp-connector.ts:95` `client.getTools()` 复用现有 `mcpCache` |
| **所有插件命令都走 `llm:chat`**，不直接 fire-and-forget | 让 v3 streamEvents + M3 reasoning 自然覆盖 | 复用 `runLLMChat` 入口（`llm.ts:306`）|
| 系统命令 `/goal /context /plan` 是 renderer 内的纯本地分支 | 不需要 main 解析，节省 IPC | ChatArea `dispatchCommand()` switch |
| 项目级 `.cdf/commands/*.md` 走文件系统，**复用 skill-manager 的扫描模式** | 与 skills 一致的发现语义 | `skill-manager.ts:89` `listPhysicalSkills` 是同形 reference |

---

## 2. 现有架构锚点（必须复用的不变量）

### 2.1 IPC Channel 命名约定

| 现有前缀 | 用途 | 例子 |
|---|---|---|
| `db:*` | SQLite CRUD（直接 prepare + JSON）| `db:getWorkflows`, `db:getSkills` |
| `llm:*` | Master Agent 推理入口 | `llm:chat`, `llm:stopChat`, `llm:chunk-${requestId}` |
| `workflow:*` | 独立 LangGraph runtime | `workflow:run`, `workflow:event-${executionId}` |
| `store:*` | electron-store KV | `store:get`, `store:set` |
| `deepagents:*` | Agent harness 管理 | `deepagents:createAgent` |

**`/` 命令系统新增 2 个 channel：**

| 新增 channel | 方向 | 用途 |
|---|---|---|
| `commands:list` | renderer → main | 拉取合并后的命令清单（系统 3 + 插件 4 源）|
| `commands:readProjectCommands` | renderer → main | 仅读 `<projectPath>/.cdf/commands/*.md` 列表（轻量，按需重读）|

**注意：** `workflow:run` 和 `llm:chat` 都已存在，命令分发层**不需要新 channel**——通过现有 channel 即可。

### 2.2 流式推理事件契约（不变）

`llm.ts:124-138` 定义了 `LLMStreamEvent` union 13 种类型。命令系统必须**复用**这套类型而不是发明新事件，因为 ChatArea + MarkdownRenderer 已经按这套事件渲染 reasoning 和 tool_call。

```
{message_chunk}              ← M3 reasoning ('<think>' + text + '</think>\n\n') + 文本
{tool_start / tool_end}      ← 工具调用可视化（已支持 task 工具）
{delegated_task_start/...}   ← 子 Agent 委托（plugin 命令走这条最自然）
{run_started / run_updated}  ← Agent 运行生命周期
```

**结论：** plugin 命令通过 `llm:chat` 进入后，模型调用 `task` 工具（已存在，`runtime.ts:540-587` 自动发现的子 Agent）就能产生 `delegated_task_*` 事件。**不需要新增 LLMStreamEvent 类型**。

### 2.3 Master Agent runtime 已支持的工具入口

`runtime.ts:488-529` 注册了内置工具 + workflow tools。**命令系统不需要新写 deepagent 工具**——直接把 `/${mcp_tool_name}` 重写为 user message（"call the ${name} tool with ${params}"）让 Master Agent 通过既有的 tool-call 机制调度即可，因为：

- `loadMcpTools`（`mcp-connector.ts:129`）已把 MCP tools 注入到 `tools: [...mcpRuntime.tools, ...]`
- Skills 由 `resolveAgentSkillsConfig`（`skill-manager.ts:142`）配置进 `skills: skillsSources`，deepagents 的 SkillsMiddleware 会处理
- Workflows 由 `createWorkflowTools`（`workflow/tools.ts:19`）暴露 `run_workflow` 工具

---

## 3. 组件边界（新增 vs 修改）

### 3.1 新增文件

```
src/renderer/src/stores/slashCommandStore.ts        # 命令注册表 + UI 状态（Zustand）
src/renderer/src/hooks/useCommandRegistry.ts        # 合并系统 + IPC 拉取的 hook
src/renderer/src/components/ChatArea/SlashCommandPopup.tsx  # 弹层 UI
src/renderer/src/lib/commands/dispatcher.ts         # /command → 调度的纯函数（renderer-only）
src/main/commands/command-registry.ts               # main 端元数据合并器
src/main/commands/project-commands.ts               # 读 <projectPath>/.cdf/commands/*.md
```

### 3.2 修改文件

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `src/preload/index.ts` | 加 `commands.list` / `commands.readProjectCommands` 2 个 method | contextBridge 暴露 |
| `src/main/ipc-handlers.ts` | 注册 `commands:list` 和 `commands:readProjectCommands` 2 个 handler | 主进程入口 |
| `src/shared/types.ts` | 加 `SlashCommand` / `SlashCommandSource` / `CommandDispatchPlan` 类型 | 跨进程契约 |
| `src/renderer/src/components/ChatArea/ChatArea.tsx` | `<textarea>` 上方叠加 `<SlashCommandPopup>`；`handleKeyDown` 加 `↑↓ Enter Esc`；`handleSend` 前过 `dispatcher` | popup 锚定 + 键盘导航 + 命令分发 |
| `src/renderer/src/stores/sessionStore.ts` | `sendMessage` 接受可选 `dispatchPlan` 字段（system command 用）；plugin command 走原有 path | 透传 system 注入 |
| `src/main/deepagent/skill-manager.ts` | **不改**——`.cdf/commands/*` 是新模块，但读写模式可参考 `listPhysicalSkills` | reference only |

### 3.3 数据契约（新增 type）

```typescript
// src/shared/types.ts（追加）

export type SlashCommandSource = 'system' | 'mcp' | 'skill' | 'workflow' | 'project';

export interface SlashCommand {
  /** 命令名（不含 /）—— `goal` / `arxiv_search` / `simplify` */
  name: string;
  /** 一句话说明，用于 popup 描述列 */
  description: string;
  /** 分类标签——MCP tool / Skill / Workflow / System / Project */
  source: SlashCommandSource;
  /** 命令的"目的地"——MCP tool 名 / Skill 路径 / Workflow id / 系统动作枚举 */
  target: string;
  /** 参数提示（来自 MCP tool schema / SKILL.md frontmatter / Workflow 节点 inputs） */
  argsHint?: string;
  /** 用于冲突展示：source 重复时显示如 `[mcp:arxiv]` `[skill:simplify]` */
  sourceLabel?: string;
}

export type CommandDispatchAction =
  | { kind: 'local-silent'; systemPrompt: string }       // /goal
  | { kind: 'local-reply'; text: string }                // /context
  | { kind: 'plan-mode'; task: string }                  // /plan
  | { kind: 'llm-chat'; userMessage: string; mentionTool?: string };  // /arxiv_search foo bar

export interface CommandDispatchPlan {
  command: SlashCommand;
  args: string;
  action: CommandDispatchAction;
}
```

---

## 4. 数据流（4 源命令的统一管线）

### 4.1 注册表构建（renderer 启动 + 资产变化时）

```
ChatArea 挂载
    │
    ▼
useCommandRegistry(projectId)
    │
    ├─► IPC `commands:list(projectId)` ────────────────►  main/commands/command-registry.ts
    │                                                          │
    │                                                          ├─► 静态 3 系统命令 (硬编码)
    │                                                          │
    │                                                          ├─► MCP 源：遍历 agent 绑定的 mcp_servers
    │                                                          │      └─► mcpCache.get(agentId).tools
    │                                                          │             (复用 mcp-connector.ts:129 已 cache)
    │                                                          │
    │                                                          ├─► Skills 源：listPhysicalSkills(projectPath)
    │                                                          │      (复用 skill-manager.ts:89 文件系统扫描)
    │                                                          │
    │                                                          ├─► Workflows 源：SELECT id,name,description
    │                                                          │      FROM workflows WHERE status='active'
    │                                                          │      (新建轻量 SQL，不复用 db:getWorkflows 因为后者返回 graph_data 太重)
    │                                                          │
    │                                                          └─► Project 源：read .cdf/commands/*.md
    │                                                                 (新模块，与 skill 同形)
    │   ◄───────────────────────────────────────────────── SlashCommand[]
    │
    ▼
useSlashCommandStore.commands = result
  + sessionId / projectId / agentId 作为 cache key
  + fs.watch(.cdf/commands) → invalidate（可选 v1.2，v1.1 拉一次即可）
```

**性能要点：** MCP 工具列表来自 `mcpCache`（`mcp-connector.ts:11-12` 的 `Map<agentId, McpCacheEntry>`），`commands:list` 不重新连接 MCP server——`checkMcpServerHealth` 也不会在 popup 打开时触发。

### 4.2 用户触发 `/` 命令（核心 UX 路径）

```
用户键入 `/` 在 <textarea>
    │
    ▼
ChatArea 检测 inputVal.startsWith('/') && !inputVal.includes(' ') || 仅 / 后是字母
    │
    ├─ 渲染 <SlashCommandPopup> 锚定到 textarea 上方
    │     位置：absolute bottom-full mb-2（与现有 model-selector 模式一致）
    │     列表：useSlashCommandStore.commands.filter(cmd => cmd.name.startsWith(filter))
    │
    ▼
用户继续键入字母 → filter 实时更新
用户按 ↑/↓ → cursorIndex 变化
用户按 Tab/Enter → dispatch
    │
    ▼
dispatcher.resolve(inputVal, commands) → CommandDispatchPlan
    │
    ├─ kind: 'local-silent'    ─► 直接 set state, 无 IPC（/goal 注入新 system 约束）
    ├─ kind: 'local-reply'     ─► 直接渲染静态气泡（/context 列出当前 session 元数据）
    ├─ kind: 'plan-mode'       ─► sendMessage with override { planOnly: true }（v1.1 简化：just 给一段提示让 Master Agent 走 task tool 不执行 write_file）
    └─ kind: 'llm-chat'        ─► sendMessage(content='/arxiv_search foo bar')
                                     │
                                     ▼
                                 复用 llm:chat (existing)
                                     │
                                     ▼
                                 runLLMChat() in llm.ts:306
                                     │
                                     ▼
                                 runtime.agent.streamEvents v3 ──► M3 reasoning 流出
                                     │
                                     ▼
                                 tool_start (arxiv_search) ──► MCP 实际调用
                                     │
                                     ▼
                                 消息回到 renderer 渲染
```

**关键不变量：** **plugin 命令的输出和普通 chat 一模一样**——M3 reasoning 包在 `<think>...</think>\n\n`，tool call 显示在 ToolMessageCard。这是 v1.1 不破坏 streaming 透明性的根本。

### 4.3 plugin 命令的 M3 reasoning 透明性

> 约束：plugin command messages should also go through reasoning

`llm.ts:382-406` `consumeReasoning()` 已经把 reasoning 转 `message_chunk` 事件，`<MarkdownRenderer>`（`renderer/src/components/ChatArea/MarkdownRenderer.tsx`）解析 `<think>` 标签做折叠显示。

`/${mcp_tool_name}` 这种命令走 `kind: 'llm-chat'` 路径时：

1. `dispatcher` 把 `/${mcp_tool_name} ${args}` 改写为人类可读 prompt：
   ```
   "请调用 ${tool} 工具，参数：${args}"
   ```
2. 透传到 `llm:chat` → Master Agent
3. 模型在 M3 reasoning 阶段产出 `<think>The user invoked /arxiv_search. I should call the arxiv_search tool with these params...</think>`
4. 随后 `tool_start` 事件触发
5. ChatArea 现有 MarkdownRenderer 完整渲染

**这就是"transparent to v3 streamEvents + M3 thinking"的实现方式**——**什么特殊 channel 都不需要**。`/${mcp_tool_name}` 本质上是 user 文本的简写，模型自然处理。

> 唯一例外：`/plan` 需要让 Master Agent "只规划不执行"。v1.1 简化实现：dispatcher 生成一段特殊的 system 注入（"User requests plan-only mode. Respond with a structured plan, do NOT call write_file/edit_file/bash"），通过 `sendMessage` 的 `dispatchPlan` 字段进入。`sessionStore.sendMessage` 把 system 注入临时拼到 messages 列表前面。**不动 deepagent runtime**。

---

## 5. 关键 IPC Surface（最小集）

### 5.1 必须新增

```typescript
// preload/src/index.ts (追加)
commands: {
  list: (projectId: string, agentId?: string) =>
    ipcRenderer.invoke('commands:list', projectId, agentId),
  readProjectCommands: (projectId: string) =>
    ipcRenderer.invoke('commands:readProjectCommands', projectId),
}
```

```typescript
// main/ipc-handlers.ts (注册函数, ~80 行新增)
ipcMain.handle('commands:list', (_, projectId, agentId) => {
  return buildCommandRegistry(projectId, agentId);
});

ipcMain.handle('commands:readProjectCommands', (_, projectId) => {
  return listProjectCommands(projectId);
});
```

### 5.2 必须复用（不新增）

| 复用的 channel | 在 v1.1 中的角色 | 文件 |
|---|---|---|
| `llm:chat` | plugin command 入口（kind: 'llm-chat'）| `main/llm.ts:283` |
| `workflow:run` | system command `/run-workflow` 可选快捷路径（v1.1 默认走 llm-chat）| `main/workflow/workflow-runtime.ts:474` |
| `db:getMcpServers` | command-registry 取活跃 MCP server id 列表 | `main/ipc-handlers.ts:531` |
| `db:getSkills` | 备援：若 v1.1 选择不直读 fs 而走 IPC | `main/ipc-handlers.ts:474` |
| `db:getWorkflows` | 备援 | `main/ipc-handlers.ts:656` |

### 5.3 强约束

- **不新增** `commands:execute` 之类的 channel。**所有 plugin 命令都走 `llm:chat`**——这是 transparent reasoning 的硬要求。
- **不修改** `runtime.ts`（deepagent runtime）和 `workflow-runtime.ts`（workflow runtime）。命令系统是输入层增强，不碰 LangGraph harness。

---

## 6. 命令元数据采集细节

### 6.1 MCP 源

```typescript
// main/commands/command-registry.ts
import { loadMcpTools } from '../deepagent/mcp-connector';

async function collectMcpCommands(agentId: string): Promise<SlashCommand[]> {
  const mcpServers = db.prepare(`
    SELECT m.* FROM mcp_servers m
    INNER JOIN agent_mcp_servers ams ON ams.mcp_server_id = m.id
    WHERE ams.agent_id = ?
  `).all(agentId) as MCPServer[];
  const { tools } = await loadMcpTools(agentId, mcpServers);
  return tools.map(tool => ({
    name: tool.name,                                  // 'arxiv_search'
    description: tool.description,                    // 来自 MCP server manifest
    source: 'mcp',
    target: tool.name,
    argsHint: extractArgsHintFromSchema(tool.schema), // zod → "{query: string, max: number?}"
  }));
}
```

**关键：** 复用 `mcpCache`（`mcp-connector.ts:12`），不重新连接。

### 6.2 Skills 源

```typescript
import { listPhysicalSkills } from '../deepagent/skill-manager';

function collectSkillCommands(projectId: string): SlashCommand[] {
  const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string };
  return listPhysicalSkills(project.path).map(skill => ({
    name: skill.name,                                 // 'simplify'
    description: skill.description,                  // 来自 SKILL.md frontmatter (skill-manager.ts:29-45)
    source: 'skill',
    target: `${skill.scope}:${skill.name}`,
    argsHint: '<text>',                               // skills 总是接一段文本输入
  }));
}
```

`skill-manager.ts:29-45` 的 `parseFrontmatter` 已能解析 `name` / `description`。

### 6.3 Workflows 源

**必须新建轻量 SQL**，不调用 `db:getWorkflows`（后者带 `graph_data` JSON，几 KB 一个，对 popup 列表是浪费）。

```typescript
function collectWorkflowCommands(projectId: string): SlashCommand[] {
  return db.prepare(`
    SELECT id, name, description FROM workflows
    WHERE project_id = ? AND status = 'active'
    ORDER BY updated_at DESC
  `).all(projectId) as Array<{id: string; name: string; description: string | null}>;
  // → SlashCommand[]
}
```

### 6.4 Project 源（`.cdf/commands/*.md`）

新建 `main/commands/project-commands.ts`，**模式与 `skill-manager.ts:89` `listPhysicalSkills` 几乎同形**：

```typescript
// main/commands/project-commands.ts
import fs from 'fs';
import path from 'path';

const COMMANDS_DIR = '.cdf/commands';

export function listProjectCommands(projectId: string): SlashCommand[] {
  const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId);
  if (!project) return [];
  const dir = path.join(project.path, COMMANDS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(filename => {
      const name = path.basename(filename, '.md');
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
      const frontmatter = parseFrontmatter(content);   // 从 skill-manager.ts 借用
      return {
        name,
        description: frontmatter.description || '',
        source: 'project',
        target: name,
        argsHint: frontmatter['args-hint'] || '$ARGUMENTS',
      };
    });
}
```

**v1.1 简化：** project command body 内容不需要解析执行，只需要元数据（name/description/args-hint）。运行时把 `${args}` 替换 body 里的 `$ARGUMENTS` 占位符，作为 user message 注入到 `llm:chat`。

### 6.5 系统命令 3 个（硬编码）

```typescript
const SYSTEM_COMMANDS: SlashCommand[] = [
  { name: 'goal',  source: 'system', target: 'goal',
    description: '设置本会话的目标条件', argsHint: '[condition]' },
  { name: 'context', source: 'system', target: 'context',
    description: '查看当前 session 的上下文占用', argsHint: '[all]' },
  { name: 'plan', source: 'system', target: 'plan',
    description: '切换 Master Agent 到规划模式', argsHint: '[description]' },
];
```

---

## 7. Build Order（基于依赖图）

| 阶段 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| **P1-类型层** | `src/shared/types.ts` 加 `SlashCommand` / `CommandDispatchAction` | 无 | `tsc` 通过 |
| **P2-main 端元数据** | 新建 `main/commands/command-registry.ts` + `project-commands.ts` | `mcp-connector.ts` / `skill-manager.ts` 现有函数 | 单元测试 4 源各返回 |
| **P3-IPC 注册** | `ipc-handlers.ts` 加 2 个 handler；`preload/index.ts` 暴露 2 个 method | P2 | renderer 端 `await window.electronAPI.commands.list(projectId)` 拿到 5+ 条 |
| **P4-renderer 状态** | `useSlashCommandStore` + `useCommandRegistry` hook | P3 | 切换 session 重新拉取 |
| **P5-弹层 UI** | `<SlashCommandPopup>` 组件 + 锚定到 ChatArea | P4 | `/` 触发，过滤正常 |
| **P6-键盘导航** | `handleKeyDown` 增加 ↑/↓/Enter/Esc 分支 | P5 | 全键盘流程 |
| **P7-调度器** | `lib/commands/dispatcher.ts` resolve `/${cmd} ${args}` | P4 | 4 种 action 单元测试 |
| **P8-system 3 命令** | dispatcher 路由 `/goal` `/context` `/plan` | P7 | 三个命令本地生效 |
| **P9-plugin 4 源** | dispatcher 路由 `/${mcp_tool}` `/${skill}` `/${workflow}` `/${project}` → 走 `llm:chat` | P7, P3 | 流式 reasoning 正常 |
| **P10-project commands** | 读 `.cdf/commands/*.md` → dispatcher 替换 `$ARGUMENTS` 注入 | P9 | 至少 seed 一个示例 |

**依赖关键路径：** P1 → P2 → P3 → P4 → P5 → P6 → P7 → {P8 || P9} → P10。

**P9 风险：** plugin 命令必须完整跑过 M3 reasoning 流。需要 e2e 验证：键入 `/arxiv_search foo` → Master Agent 真的产出含 `arxiv_search` tool_call 的 assistant 消息。

---

## 8. Anti-Patterns（这个子系统特别要避免的）

### 8.1 ❌ 新建 `commands:execute` IPC channel
**Why bad:** 绕开 `llm:chat` 会让 plugin 命令的输出**不走 v3 streamEvents**，用户看不到模型为什么决定调用这个工具、看不到 reasoning 折叠。破坏"transparent to reasoning"硬约束。
**Instead:** dispatcher 永远把 plugin 命令的 `args` 拼成 user message，走 `llm:chat`（existing IPC）。

### 8.2 ❌ 在 renderer 端连 MCP server
**Why bad:** 现有所有 MCP 连接都在 main 端（`mcp-connector.ts:13-16` 的 `mcpCache` + `serverClients`），renderer 没有任何 `MultiServerMCPClient` 实例。在 renderer 重新连接会绕过连接复用、绕过健康检查、引入 IPC 往返。
**Instead:** main 端 `loadMcpTools(agentId, mcpServers)` 返回的 `tools` 直接序列化为 `SlashCommand[]` 推到 renderer。

### 8.3 ❌ popup 中直接用 `useSessionStore.sendMessage`
**Why bad:** `sendMessage` 当前签名是 `(projectId, content, overrides)`。直接传 `/${tool} foo` 字符串会让 chat history 里出现 `/${tool} foo` 这种字面量。Claude Code 的做法是**命令触发后用户消息呈现为自然语言**（"调用 arxiv_search 查询 foo"）而不是 `/${tool} foo`。
**Instead:** dispatcher 的 `kind: 'llm-chat'` 生成 `userMessage` 字段（"请用 arxiv_search 工具查询：foo"），传给 sendMessage。

### 8.4 ❌ 项目级 commands 复用 skill-manager 的 scope 逻辑
**Why bad:** skill 的 `scope: 'global' | 'project'` 决定是否需要白名单绑定（`skill-manager.ts:142-174`），而 project command **没有 global scope**——它天然 project-only。
**Instead:** 新建 `main/commands/project-commands.ts`，不复用 `resolveAgentSkillsConfig`。

### 8.5 ❌ `<SlashCommandPopup>` 用 portal 到 body
**Why bad:** 现有 `model-selector` (`ChatArea.tsx:1018`) 是 textarea form 内联 absolute 定位，简单可靠。引入 portal 会破坏 z-index 协调、点击外部关闭、focus 行为。
**Instead:** 同 `model-selector` 模式——`absolute bottom-full mb-2` 锚定到 form 容器。

### 8.6 ❌ plugin 命令解析 args 时智能拆分（识别引号、JSON）
**Why bad:** 违反 PROJECT.md "插件命令严格 passthrough：参数空格分隔直接给底层 tool/skill/workflow，不做 wrapper 智能"。
**Instead:** `args` = `inputVal.substring(1 + cmd.length).trim()`，原始字符串直接交给底层。

---

## 9. Scalability Considerations

| 关注点 | 50 命令 | 200 命令 | 1000 命令 |
|---|---|---|---|
| popup 列表渲染 | 简单 `.map()` | 简单 | 需 react-virtual 虚拟列表（v1.1 不做） |
| `commands:list` payload | < 10KB | < 50KB | 需分页 / 按 source 拆分 IPC |
| MCP 工具数 | 10s | 100s | 需 schema 摘要压缩 |
| Skills 文件系统读 | O(1) | O(1) | v1.2+ 加 fs.watch 失效 |
| 命名冲突 | 罕见 | `[mcp:foo] [skill:foo]` 标签足够 | 需 source priority 策略 |

v1.1 假设 < 50 命令（3 system + 4 source × ~10）—— 简单 `.map()` 足够。

---

## 10. 集成点（外部边界）

| 边界 | 通信 | 注意 |
|---|---|---|
| `<SlashCommandPopup>` ↔ `<textarea>` | 同 React 组件树（parent state）| popup 显隐由 `inputVal.startsWith('/')` 派生 |
| `useSlashCommandStore` ↔ `useSessionStore` | 共享 sessionId/projectId 字段 | 命令注册表缓存键绑定 sessionId，session 切换时自动重拉 |
| renderer ↔ main | `commands:list` (新增) | 单次拉取 + 资产变更 invalidate |
| dispatcher ↔ `llm:chat` | renderer 内部（不发新 IPC）| `CommandDispatchAction.kind === 'llm-chat'` 时 `userMessage` 字段直接进 `sendMessage` |
| dispatcher ↔ `workflow:run` | v1.1 不直接走；/plan 走 llm-chat | 避免破坏 reasoning 透明性 |

---

## 11. Sources

- **直接源码**（HIGH 置信度）：
  - `src/main/ipc-handlers.ts` (780 lines) — IPC channel 全集
  - `src/main/llm.ts:306-425` — `runLLMChat` + `streamEvents` v3 + `consumeReasoning`
  - `src/main/deepagent/runtime.ts:453-613` — `createDeepAgentRuntime` 工具装配
  - `src/main/deepagent/mcp-connector.ts:129-156` — `loadMcpTools` + `mcpCache`
  - `src/main/deepagent/skill-manager.ts:89-174` — `listPhysicalSkills` + `resolveAgentSkillsConfig`
  - `src/main/workflow/tools.ts:19-79` — `createWorkflowTools`（Master Agent 可调）
  - `src/main/workflow/workflow-runtime.ts:473-499` — `registerWorkflowIpcHandlers`
  - `src/renderer/src/components/ChatArea/ChatArea.tsx:1002-1090` — `<textarea>` composer 现状
  - `src/renderer/src/stores/sessionStore.ts:338+` — `sendMessage` 入口
  - `src/preload/index.ts:1-105` — contextBridge 全部 method
  - `src/shared/types.ts:124-431` — `LLMStreamEvent` / `WorkflowStreamEvent` / `ElectronAPI` 契约
  - `.planning/PROJECT.md` — v1.1 milestone goals & constraints
- **Claude Code 风格参考** (MEDIUM，已在 PROJECT.md 标注已 webfetch 调研)

---

## 12. Confidence Assessment

| 区域 | 置信度 | 原因 |
|---|---|---|
| 注册表位置 (renderer) | HIGH | 现有 7 个 Zustand store 全部 renderer-side |
| IPC surface 复用集 | HIGH | 所有引用的 channel 都从 `ipc-handlers.ts` 真实 grep 得出 |
| M3 reasoning 透明性 | HIGH | 复用 `llm:chat` + `consumeReasoning` 路径明确 |
| `commands:list` 合并逻辑 | HIGH | 4 个 source 的现有函数都已 grep 找到 |
| Project commands 文件路径 | MEDIUM | 选了 `.cdf/commands/`（与 `.cdf/skills/` 平行），未在 v1.0 出现，但与 skill-manager 同形；需 v1.1 phase 1 决定 |
| `/plan` 模式实现 | MEDIUM | v1.1 简化方案是"注入 system prompt 提示模型不要写文件"；`createDeepAgentRuntime` 的 `interruptOn` 不需要改，但需要 v1.1 phase 1 验证 model 是否真的遵守 |
| popup UI 锚定 | HIGH | `model-selector` 是现成可参考模式 |
| System 命令 3 个具体语义 | MEDIUM | `/goal /context /plan` 的精确行为 PROJECT.md 只说"切只规划不执行"等概述，phase 1 需要确认 |

---

## 13. Open Questions for v1.1 Phase 1

1. **Project commands 路径**：`.cdf/commands/*.md` vs `.claude/commands/*.md`？PROJECT.md 写的是 `.claude/commands/*.md`，但与 skill 的 `.cdf/skills/` 不一致。**建议**沿用 `.cdf/commands/` 保持项目元数据集中。
2. **`/plan` 是否真要独立 mode**：v1.1 简化为 system prompt 注入可行；但用户期望"切模式"（影响后续所有 turn）还是"一次性"（只这次规划）？PROJECT.md 没明确。
3. **MCP 命令 args hint 的 schema 抽取**：MCP tool 的 inputSchema 是 zod JSON schema 字符串还是 OpenAI function schema？需要 v1.1 phase 1 看 mcp-adapters 返回的 `tool.schema` 形状。
4. **命令注册表缓存失效**：session 切换 / MCP 启停 / skill 增删 / workflow save 之后，何时重拉？v1.1 简化：session 切换重拉，其他事件不感知（接受 stale）。v1.2+ 加事件驱动。
5. **命名冲突 UI**：同名 skill `simplify` 和同名 workflow `simplify` 怎么展示？PROJECT.md 写"plugin source 标签显示"，建议 `[mcp:foo] [skill:foo] [workflow:foo] [project:foo]` 横向 tab 区分。
6. **`/goal` 状态存储**：goal 是 session-level 还是 turn-level？session 持久化到 `sessions` 表的 `summary` 字段还是单独 `session_goals` 表？v1.1 建议先放内存（`useSessionStore.sessionGoals: Map<sessionId, string>`）。

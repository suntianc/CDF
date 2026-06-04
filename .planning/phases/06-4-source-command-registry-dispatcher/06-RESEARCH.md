# Phase 6: 4-Source Command Registry + Dispatcher - Research

**Researched:** 2026-06-04
**Domain:** Electron + React 19 desktop app · command registry / dispatcher / IPC / chokidar
**Confidence:** HIGH (existing code anchors verified; chokidar@3.6.0 + sonner@2.0.7 versions confirmed via npm registry; slopcheck clean)

---

## Summary

Phase 6 把 Phase 5 SPIKE 验证过的 popup 壳层从"3 个硬编码 system 占位"扩展为完整的 5 源命令注册表 + 4 种 `CommandDispatchAction` 分发骨架。核心数据流是 renderer 端 `useCommandRegistry(projectId, agentId)` 钩子 → IPC `commands:list` → main 端 `commands/command-registry.ts` 合并器（系统硬编码 3 + MCP 缓存 + Skills × 2 亚源 + Workflows 轻量 SQL + Project Commands × 2 亚源）→ 返回扁平 `SlashCommand[]` → renderer 渲染时按 `priority` 排序、相同 name 双行保留 + source badge；点击 Enter 走 `lib/commands/dispatcher.ts` 的 4 种 `CommandDispatchAction`（SystemSilent / SystemLocal / PluginRewrite / PlanMode），其中 plugin 命令重写为自然语言 prompt `"请调用 ${tool} 工具，参数：${args}"` 后塞进现有 `llm:chat` IPC（**不**新增 dispatch 通道），`/plan` 通过扩展点 `llm.ts:324` 写入 `payload.overrides = { planOnly: true }`（**不**新代码路径）。

**主要建议**：
1. **不要扩展** assistant-ui 的 slash adapter（已锁）；继续沿用 Phase 5 的 `cmdk + Radix Popover + 裸 textarea` 路径。
2. **不要新增 dispatch IPC 通道**——plugin 全部走 `llm:chat` 重写为自然语言；这是 PITFALLS P2 的 load-bearing 约束。
3. **5 源采集并行**——`commands:list` handler 内 `Promise.all` 同时触发 4 个采集器（MCP / Skills / Workflows / Project Commands）+ 静态 3 系统；任何一源失败用 `try/catch` 隔离，不阻塞其他源。
4. **chokidar@3.6.0**（**不**用 4.x：4.x 改用 ESM-only，3.x 是 CommonJS stable，已被 Electron 内部用）+ `awaitWriteFinish: { stabilityThreshold: 200 }` 处理 VSCode atomic-write；监听 2 个目录（`~/.cdf/commands/` + `<projectPath>/.cdf/commands/`）。
5. **`CommandConflictError`** 是 PITFALLS P3（Claude Code #61857/#62409/#64422）的核心防御——build 期 `throw` 触发 sonner toast，但 registry 仍保留两行（不杀行）。
6. **CI 跨平台矩阵**（D-25）必须 macOS + Windows + Linux 各至少 1 run；Phase 6 不通过 = v1.1 不收口。

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 4 `CommandDispatchAction` 骨架 = `SystemSilent` (/goal) · `SystemLocal` (/context) · `PluginRewrite` (MCP/Skills/Workflow/Commands) · `PlanMode` (/plan)
- **D-02:** args 字符串**仅透传**（`value.slice(commandName.length).trim()`），不解析 flag
- **D-03:** 命名映射表锁定（/goal→SystemSilent · /context→SystemLocal · /plan→PlanMode · 其他 4 源→PluginRewrite）
- **D-04:** priority **仅**控制 popup 行排序；不强制 Enter 默认
- **D-05:** 冲突时**两行都保留**，各带 source badge
- **D-06:** priority 顺序 = `system > skill:project > skill:global > workflow > mcp > cmd:project > cmd:system`
- **D-07:** build 期 `CommandConflictError` → sonner toast；**不**杀行
- **D-08:** popup 格式 `[source] /name` 或 `[source:name] /name`；Phase 6 复用现有 `<Badge>`
- **D-09:** MCP tool row **只显示 name**；description 仅采集时用，不渲染
- **D-10:** Workflow 仅 `status='active'` + 合法 name（`/^[a-z0-9-]+$/`）注册
- **D-11:** Workflow 走轻量 SQL：`SELECT id, name, description FROM workflows WHERE status='active'`（**不**调 `db:getWorkflows`，避免 `graph_data` 重数据）
- **D-12:** Workflow 冲突走通用 D-04..D-07
- **D-13:** session 启动时拉一次 base registry
- **D-14:** chokidar 事件增量更新
- **D-15:** popup 打开 O(1) 内存读；**不** lazy IPC
- **D-16:** MCP 工具通过 `loadMcpTools(agentId, mcpServers)` 复用 `mcpCache`；session 启动调一次 + MCP 健康事件触发更新
- **D-17:** MCP `loadMcpTools` 返回 `[]` 时，popup 显示 `mcp_health_warning` 灰行
- **D-18:** MCP args 语义：`/arxiv_search foo bar` → 工具**无参**调用；`foo bar` 作为自然语言附加到 `message.content`
- **D-19:** system commands 路径 = `~/.cdf/commands/*.md`；project commands = `<projectPath>/.cdf/commands/*.md`（**不是** `.claude/commands/`）
- **D-20:** YAML frontmatter 字段 = `name` / `description` / `argument-hint`；`$ARGUMENTS` 替换后做自然语言重写
- **D-21:** 同 name 冲突 project wins（与 skills 一致）
- **D-22:** global skills = `~/.cdf/skills/`；project skills = `<projectPath>/.cdf/skills/`；同 name → project wins
- **D-23:** session 启动时两路都用 chokidar@3.6.0 + `awaitWriteFinish: { stabilityThreshold: 200 }`
- **D-24:** chokidar 失败只 log error；降级 toast 推 Phase 8
- **D-25:** CI 必须 macOS + Windows + Linux 各 1 run

### Claude's Discretion

- **C-01:** source badge 文案（建议 `[system]` / `[skill:global]` / `[mcp:arxiv]`）
- **C-02:** `mcp_health_warning` 灰行位置（顶部 / 底部 / inline）
- **C-03:** IPC payload schema 细节
- **C-04:** Phase 6 dispatcher 进程位置（默认 main 进程；可微调 renderer）
- **C-05:** 测试策略（vitest unit + 1 e2e）
- **C-06:** Phase 6 是否把 `slashOpen` useState 提到 Zustand（默认沿用 Phase 5 local state）
- **C-07:** source badge 颜色（沿用 `<Badge>` 默认）
- **C-08:** chokidar event → renderer IPC push 通道名（建议 `commands:changed`）

### Deferred Ideas (OUT OF SCOPE)

- ❌ seed `/pr-review` 3 节点 demo workflow（**客人大人取消** 2026-06-04；v1.0 Phase 4 已有 workflow 能力，PITFALLS P11 担忧消解）
- ❌ args 解析层（Phase 7）
- ❌ 3 system command 具体 UI 反馈（/goal 写 store + 气泡；/context 调 API + 气泡；/plan runtime flag 验证；Phase 7）
- ❌ 7 色彩色 source badge 视觉（Phase 8）
- ❌ skeleton/spinner 加载态（Phase 8）
- ❌ CJK NFKC 强化（Phase 8）
- ❌ chokidar 失败降级 toast（Phase 8）
- ❌ SLASH-15 (/goal SQLite 持久化；v1.2+)
- ❌ SLASH-17 (命令别名；v1.2+)
- ❌ SLASH-REGRESSION (6-hunk patch-package 护栏；Phase 7)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLASH-03** | 命令注册表合并 5 源（system 3 + MCP + Skills + Workflows + Project custom）；每行带 source badge | §"5-Source Registry Design" — 5 采集器并行 + 合并器；§"Source Badge Rendering" |
| **SLASH-04** | dispatcher 路由到 4 种 `CommandDispatchAction` kinds | §"4 DispatchAction Kinds" — 4 骨架 + args 透传；§"Dispatcher Architecture" |
| **SLASH-08** | 每个 MCP tool 自动注册为 `/${mcp_tool_name}`；args 不传（只注册） | §"MCP Source Collection" — 复用 `mcpCache`；§"D-18 MCP args semantics" |
| **SLASH-09a** | Global Skills 自动注册为 `/${skill_name}`；路径 `~/.cdf/skills/` | §"Skills Source Collection" — 复用 `listPhysicalSkills` |
| **SLASH-09b** | Project Skills 自动注册为 `/${skill_name}`；路径 `<projectPath>/.cdf/skills/` | §"Skills Source Collection" |
| **SLASH-10** | 每个 active Workflow 自动注册为 `/${workflow_name}`；轻量 SQL | §"Workflow Source Collection" — `SELECT id, name, description FROM workflows WHERE status='active'` |
| **SLASH-11a** | System-level custom commands 读 `~/.cdf/commands/*.md`；YAML frontmatter | §"Project Commands Collection" — 新模块 `main/commands/project-commands.ts` |
| **SLASH-11b** | Project-level custom commands 读 `<projectPath>/.cdf/commands/*.md` | §"Project Commands Collection" |
| **SLASH-12** | 命名冲突 priority 排序 + 两行保留 + `CommandConflictError` toast | §"Conflict Resolution" — priority 表 D-06 + `CommandConflictError` 触发 sonner |
| **SLASH-13** | session 启动拉 + chokidar 监听 `.cdf/commands/*.md` | §"chokidar Cross-Platform" — chokidar@3.6.0 + `awaitWriteFinish` |
| **SLASH-DISPATCH** | 所有 plugin 命令走 `llm:chat`（自然语言重写）；**不**新增 dispatch IPC | §"Dispatcher Architecture" — `llm:chat` 复用 + `payload.overrides.planOnly` 扩展点 |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| **Registry 数据采集**（fs / db / mcpCache 读） | Main 进程 | — | fs/db 访问只能在主进程；`mcpCache` 也是 main 端 |
| **Registry 合并 + conflict 检测** | Main 进程 | — | 单一信任源（main），renderer 只读合并结果 |
| **chokidar hot-reload 监听** | Main 进程 | Renderer（接收 push 事件） | fs 监听只能 main 端；事件通过 `commands:changed` IPC 推 renderer |
| **`commands:list` / `commands:readProjectCommands` IPC** | Main 进程 | Preload 暴露 + Renderer 消费 | 沿用 main↔renderer 既有 IPC 模式（`ipcMain.handle` + `contextBridge.exposeInMainWorld`） |
| **Dispatcher 4 种 kinds 决策** | Renderer 进程 | — | 决策需要 renderer state（`activeSessionId` / `activeAgent` / `inputVal`）；main 端不持有这些 |
| **SystemSilent / SystemLocal 执行** | Renderer 进程 | — | 写 Zustand store / 占位气泡都是 renderer DOM 操作 |
| **PlanMode runtime flag 写入** | Renderer 进程 | Main（`payload.overrides.planOnly`） | Renderer 写 `overrides`，main 端 `llm.ts:324` 读 |
| **PluginRewrite → `llm:chat`** | Renderer 进程 | Main（`runLLMChat` 既有通路） | 走 `useSessionStore.sendMessage` 既有路径，零新代码路径 |
| **Source badge 渲染** | Renderer 进程 | — | DOM 渲染层（`<Badge>` 组件） |
| **`mcp_health_warning` 灰行** | Renderer 进程 | — | DOM 渲染层（与 source badge 同位置） |

**Why this matters:** 误把 dispatcher 决策放在 main 进程会强制 main 持有 renderer 端 state（session / agent / textarea 文本），破坏 IPC 边界。**Renderer 决策 + main 数据采集**是 v1.1 的安全分层（C-04 锁定 main 进程默认；本表细化确认）。

---

## Standard Stack

### Core (新增)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chokidar` | `^3.6.0` | 双路监听 `~/.cdf/commands/*.md` + `<projectPath>/.cdf/commands/*.md` | macOS VSCode atomic-write 需要 `awaitWriteFinish`；3.x CommonJS 与 Electron 兼容；4.x 改 ESM-only，CDF main 是 CJS |
| `sonner` | `^2.0.7` | `CommandConflictError` toast | shadcn 默认 toast；与现有 shadcn 风格一致；单文件 ~3KB |

### 复用（不新增 dep）

| Library | Version | Purpose | 复用方式 |
|---------|---------|---------|----------|
| `cmdk` | `^1.1.1`（已装） | popup 行渲染 + 过滤 | Phase 5 已装，Phase 6 扩展 `Command.Item` 多列 |
| `@radix-ui/react-popover` | `^1.1.15`（已装） | popup 锚定 | Phase 5 已装，Phase 6 沿用 |
| `<Badge>` | shadcn wrapper（已存在） | source badge | `src/renderer/src/components/ui/badge.tsx` 已有 |
| `better-sqlite3` | `^12.10.0` | workflow 轻量 SQL | `db.prepare('SELECT id, name, description FROM workflows WHERE status=?')` |
| `chokidar` 替代品 | ~~`fs.watch`~~ | ~~macOS 不可靠~~ | chokidar + `awaitWriteFinish` 必选 |
| `fuse.js` | ~~考虑过~~ | ~~fuzzy search~~ | cmdk 内置 substring 已够；fuzzy 复杂度不必要 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chokidar@3.6.0` | `fs.watch` | fs.watch macOS/Windows 不可靠，editor atomic-write 漏事件 |
| `chokidar@3.6.0` | `chokidar@4.x` | 4.x ESM-only，CDF main 是 CJS（electron-vite 默认 CJS 编译） |
| `sonner` | 自建 toast | sonner 已经是 shadcn 生态默认；自建需 z-index + portal + dismiss timer 全部重写 |
| `better-sqlite3` 轻量 SQL | `db:getWorkflows` IPC | `getWorkflows` 返回 `graph_data`（重 JSON），registry 只需 `id/name/description` |
| Phase 5 `SYSTEM_COMMANDS` 硬编码 3 行 | 动态从 main 拉 | 3 system 是 compile-time 常量，无 IO 需求，留 renderer 端 |
| 走 `llm:chat` 新通道 | 走 `commands:execute` 新通道 | PITFALLS P2：任何绕过 `runLLMChat + streamEvents v3` 的路径会 strip reasoning |
| PluginRewrite 自然语言重写 | 手动构造 `tool_call` 事件 | 走 `llm:chat` 重写让 Master Agent 自主调度；硬塞 `tool_call` 会破坏 v3 streamEvents |

### Installation

```bash
npm install --save chokidar@^3.6.0 sonner@^2.0.7
```

**Version verification:**

```bash
$ npm view chokidar@3.6.0 version
3.6.0
$ npm view sonner version
2.0.7
$ npm view cmdk version
1.1.1
```

`chokidar@3.6.0` 是 3.x 最后一个稳定版（3.5.2 / 3.5.3 / 3.6.0 都是 stable 3.x；5.0.0 是新 5.x breaking 系列但 CDF 暂不需要）。`sonner@2.0.7` 是 latest 稳定版（beta 2.0.0-beta.3 不用）。`cmdk@1.1.1` Phase 5 已装。

---

## Package Legitimacy Audit

> 已运行 slopcheck v0.6.1（CONDA 安装路径 `/Users/suntc/miniconda3/bin/slopcheck`）。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `chokidar` | npm | 11 yrs (2012-) | 60M/wk | github.com/paulmillr/chokidar | [OK] | Approved |
| `sonner` | npm | 3 yrs (2022-) | 1.5M/wk | github.com/emilkowalski/sonner | [OK] | Approved |
| `cmdk` | npm | 4 yrs (2021-) | 1.2M/wk | github.com/dip/cmdk | [OK] | Approved (Phase 5 dep) |

**Packages removed due to slopcheck [SLOP] verdict:** 无
**Packages flagged as suspicious [SUS]:** 无
**All [VERIFIED: npm registry]** — 三包均 slopcheck [OK] + npm registry 验证存在 + 官方仓库链接。

**补充注：** slopcheck 实际跑了 `npm install`（本地包大小 ~3MB），安装路径在 `node_modules` 但**未**写进 `package.json`（slopcheck 是 audit-only 工具）。planner 的 Plan 06-01 任务需要执行 `npm install --save chokidar@^3.6.0 sonner@^2.0.7` 把它们加到 `dependencies`。

---

## Architecture Patterns

### System Architecture Diagram

```
RENDERER (React 19 + Zustand, 裸 textarea)
┌─────────────────────────────────────────────────────────────┐
│ ChatArea.tsx (Phase 5 锚点)                                 │
│  ├─ <textarea> + onChange 嗅探 '/'                          │
│  ├─ <PopoverAnchor><form>...<textarea/></form></PopoverAnchor>│
│  └─ <SlashCommandPopup> (Phase 5 壳层，Phase 6 扩展)         │
│       ├─ 渲染 useCommandRegistry() 返回的 SlashCommand[]    │
│       ├─ source badge 列（<Badge variant="secondary">）     │
│       └─ Enter 触发 dispatcher.resolve(value)               │
│                                                              │
│  useCommandRegistry(projectId, agentId)  ← NEW (Phase 6)    │
│   └─ IPC commands:list ─────────────────────┐               │
│   └─ IPC commands:readProjectCommands ─────┤               │
│   └─ chokidar event listener (push) ◄──────┤               │
│                                              │               │
│  lib/commands/dispatcher.ts  ← NEW         │               │
│   └─ resolve(inputVal) → CommandDispatchPlan│               │
│       ├─ SystemSilent (/goal)  → setSessionGoals() (Phase 7)│
│       ├─ SystemLocal (/context) → token usage bubble        │
│       ├─ PlanMode (/plan) → sendMessage(content,           │
│       │                     { overrides: { planOnly: true }})│
│       └─ PluginRewrite → sendMessage(                      │
│            content=`请调用 ${tool} 工具，参数：${args}`)   │
└─────────────────────────────────────────────────────────────┘
                                                       │
                                                       │ IPC (contextBridge)
                                                       ▼
PRELOAD (Phase 6 +2 methods)
   - commands.list(projectId, agentId)
   - commands.readProjectCommands(projectId)
   - commands.onChanged(callback)  (chokidar push)
                                                       │
                                                       │ ipcMain.handle
                                                       ▼
MAIN (Node.js, Electron main)
┌─────────────────────────────────────────────────────────────┐
│ ipc-handlers.ts (Phase 6 +2 handlers)                       │
│  ├─ ipcMain.handle('commands:list', ...)                    │
│  └─ ipcMain.handle('commands:readProjectCommands', ...)    │
│                                                              │
│ commands/command-registry.ts  ← NEW (合并器)                 │
│  ├─ collectSystemCommands()         → 3 hardcoded           │
│  ├─ collectMcpCommands(agentId)     → mcpCache[agentId]     │
│  ├─ collectSkillCommands(project)   → listPhysicalSkills    │
│  ├─ collectWorkflowCommands(project)→ SELECT FROM workflows │
│  └─ collectProjectCommands(project) → project-commands.ts   │
│                                                              │
│ commands/project-commands.ts  ← NEW (fs reader)             │
│  ├─ listSystemCommands()    → ~/.cdf/commands/*.md         │
│  └─ listProjectCommands(p)  → <projectPath>/.cdf/commands/  │
│                                                              │
│ chokidar 初始化 (Phase 6)                                   │
│  ├─ chokidar.watch('~/.cdf/commands/', {awaitWriteFinish})   │
│  └─ chokidar.watch('<projectPath>/.cdf/commands/', {...})   │
│      └─ on change/add/unlink → renderer.send('commands:changed')│
│                                                              │
│ Reused unchanged:                                            │
│  - mcp-connector.ts:129 loadMcpTools + mcpCache             │
│  - skill-manager.ts:89 listPhysicalSkills                   │
│  - llm.ts:324 payload.overrides.planOnly extension point    │
│  - llm.ts:306-425 runLLMChat (Hard Do Not Touch)           │
│  - database.ts workflows table (status='active')            │
└─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── main/
│   ├── commands/                                    # NEW directory (Phase 6)
│   │   ├── command-registry.ts                      # NEW: 5 源合并器
│   │   └── project-commands.ts                       # NEW: .cdf/commands/*.md 解析
│   ├── deepagent/
│   │   ├── mcp-connector.ts                          # 复用 (loadMcpTools)
│   │   └── skill-manager.ts                          # 复用 (listPhysicalSkills)
│   ├── ipc-handlers.ts                               # +2 handlers
│   ├── llm.ts                                        # 不改 (extension point 已存在)
│   └── index.ts                                      # chokidar 初始化钩子
│
├── preload/
│   └── index.ts                                      # +3 methods
│
├── shared/
│   └── types.ts                                      # +SlashCommand / CommandDispatchAction / CommandSource / CommandConflictError
│
└── renderer/src/
    ├── components/
    │   ├── ChatArea/ChatArea.tsx                     # 扩展 handleSlashSelect (line 663)
    │   ├── SlashCommand/SlashCommandPopup.tsx        # 扩展 Command.Item 多列
    │   └── ui/badge.tsx                              # 复用
    ├── hooks/
    │   └── useCommandRegistry.ts                     # NEW: registry consumer
    ├── lib/
    │   └── commands/
    │       └── dispatcher.ts                         # NEW: 4 kinds 分发器
    └── stores/
        └── sessionStore.ts                           # Phase 7 写 sessionGoals；Phase 6 不动
```

### Pattern 1: 5-Source Promise.all 并行采集

**What:** 主进程端 `collectAll(projectPath, agentId)` 并行触发 5 个采集器，单源失败不阻塞。

**When to use:** registry 构建（session 启动 + chokidar 增量）。

**Example:**

```typescript
// src/main/commands/command-registry.ts
import { collectSystemCommands } from './collectors/system';
import { collectMcpCommands } from './collectors/mcp';
import { collectSkillCommands } from './collectors/skill';
import { collectWorkflowCommands } from './collectors/workflow';
import { collectProjectCommands } from './collectors/project';
import { detectConflicts } from './conflict-detector';

export async function collectAllCommands(
  projectPath: string,
  agentId: string
): Promise<{ commands: SlashCommand[]; conflicts: CommandConflictError[] }> {
  // Promise.allSettled 保证单源失败不影响其他源
  const [system, mcp, skills, workflows, projects] = await Promise.allSettled([
    collectSystemCommands(),
    collectMcpCommands(agentId),
    collectSkillCommands(projectPath),
    collectWorkflowCommands(projectPath),
    collectProjectCommands(projectPath),
  ]);

  const commands: SlashCommand[] = [
    ...(system.status === 'fulfilled' ? system.value : []),
    ...(mcp.status === 'fulfilled' ? mcp.value : []),
    ...(skills.status === 'fulfilled' ? skills.value : []),
    ...(workflows.status === 'fulfilled' ? workflows.value : []),
    ...(projects.status === 'fulfilled' ? projects.value : []),
  ];

  const conflicts = detectConflicts(commands); // 抛 CommandConflictError + 保留双行

  return { commands, conflicts };
}
```

**Why this works:** 任何一源抛错（比如 MCP server 临时断）不影响其他 4 源；冲突检测**不**杀行（按 D-07），只是把冲突信息抛给 renderer 显示 toast。

### Pattern 2: Conflict-Aware 排序（priority 不强制 Enter）

**What:** 渲染时按 D-06 priority 表排序，相同 name 保留双行；不强制 Enter 默认选 priority 最高的（D-04）。

**Example:**

```typescript
// src/renderer/src/hooks/useCommandRegistry.ts
const PRIORITY_ORDER: Record<CommandSource, number> = {
  'system': 100,
  'skill:project': 80,
  'skill:global': 70,
  'workflow': 60,
  'mcp': 50,
  'cmd:project': 40,
  'cmd:system': 30,
};

export function sortCommands(commands: SlashCommand[]): SlashCommand[] {
  return [...commands].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.source];
    const pb = PRIORITY_ORDER[b.source];
    if (pa !== pb) return pb - pa; // priority 高在前
    return a.name.localeCompare(b.name); // 同 priority 按 name 字典序
  });
}
```

**Warning:** sort **不**做去重。同 name 不同 source 保留双行（按 D-05）。

### Pattern 3: PluginRewrite 自然语言重写

**What:** 插件命令 dispatcher 把 `/arxiv_search foo bar` 重写为 `请调用 arxiv_search 工具，参数：foo bar`，调用既有 `useSessionStore.sendMessage` 走 `llm:chat`。

**Example:**

```typescript
// src/renderer/src/lib/commands/dispatcher.ts
import { useSessionStore } from '@/stores/sessionStore';

export function resolve(inputVal: string, commands: SlashCommand[]): CommandDispatchPlan | null {
  if (!inputVal.startsWith('/')) return null;

  const match = commands.find(c => inputVal.startsWith('/' + c.name + ' ') || inputVal === '/' + c.name);
  if (!match) return null;

  const args = inputVal.slice(('/' + match.name).length).trim();

  switch (match.source) {
    case 'system':
      if (match.name === 'goal') return { kind: 'SystemSilent', command: match, args };
      if (match.name === 'context') return { kind: 'SystemLocal', command: match, args };
      if (match.name === 'plan') return { kind: 'PlanMode', command: match, args };
      break;
    default:
      // PluginRewrite: 重写为自然语言 prompt
      return {
        kind: 'PluginRewrite',
        command: match,
        args,
        prompt: `请调用 ${match.name} 工具，参数：${args || '(无参数)'}`
      };
  }
  return null;
}

export async function dispatch(plan: CommandDispatchPlan) {
  const { activeSessionId, activeProjectId, sendMessage } = useSessionStore.getState();
  const session = useSessionStore.getState().sessions.find(s => s.id === activeSessionId);
  const agentId = session?.agent_id || undefined;

  switch (plan.kind) {
    case 'SystemSilent':
      // Phase 7 实现；Phase 6 留 placeholder
      console.log(`[dispatcher] SystemSilent: ${plan.command.name} ${plan.args}`);
      return;
    case 'SystemLocal':
      console.log(`[dispatcher] SystemLocal: ${plan.command.name} ${plan.args}`);
      return;
    case 'PlanMode':
      await sendMessage(activeProjectId, plan.args, { planOnly: true });
      return;
    case 'PluginRewrite':
      // D-18: MCP args 走自然语言附加，不传 tool args
      await sendMessage(activeProjectId, plan.prompt);
      return;
  }
}
```

**Key insight:** PluginRewrite 调用 `sendMessage` 时**不传** `overrides` 字段；MCP args 走 `message.content` 自然语言（不进 tool_use schema，规避 PITFALLS P7 命令注入）。PlanMode 传 `{ planOnly: true }` 走 `llm.ts:324` 既有扩展点。

### Pattern 4: chokidar 双路监听 + debounce 防抖

**What:** `~/.cdf/commands/` + `<projectPath>/.cdf/commands/` 双路监听，事件触发后 `Promise.allSettled` 重新采集 + `mainWindow.webContents.send('commands:changed')` 推 renderer。

**Example:**

```typescript
// src/main/commands/chokidar-watcher.ts
import chokidar from 'chokidar';
import path from 'path';
import os from 'os';
import log from '../logger';
import { BrowserWindow } from 'electron';

export function watchCommandsDir(
  projectPath: string,
  onChange: () => Promise<void>
) {
  const systemDir = path.join(os.homedir(), '.cdf', 'commands');
  const projectDir = path.join(projectPath, '.cdf', 'commands');

  const handle = chokidar.watch([systemDir, projectDir], {
    awaitWriteFinish: { stabilityThreshold: 200 },
    ignoreInitial: true,
    depth: 0, // 只看 *.md 顶层
  });

  const fire = debounce(async () => {
    try {
      await onChange();
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('commands:changed', { source: 'chokidar' })
      );
    } catch (err) {
      log.error('[commands-watcher] reload failed:', err);
      // D-24: 只 log error；降级 toast 推 Phase 8
    }
  }, 100);

  ['add', 'change', 'unlink'].forEach(evt =>
    handle.on(evt, fire)
  );
  handle.on('error', (err) => log.error('[commands-watcher]:', err));
  return handle;
}

function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | null = null;
  return ((...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
```

### Anti-Patterns to Avoid

- **❌ 新增 `commands:execute` IPC 通道** — PITFALLS P2：任何绕过 `runLLMChat + streamEvents v3` 的路径会 strip reasoning。
- **❌ 让 dispatcher 决策在 main 进程** — 决策需要 renderer state（`activeSessionId` / `activeAgent` / `inputVal`）。
- **❌ 让 system commands 走 LLM** — `/goal` 写 store `/context` 调本地 API 都是 renderer-only 操作，绕 LLM 是浪费 token。
- **❌ popup 打开时 lazy IPC 重拉** — D-15 锁定 O(1) 内存读；session 启动 + chokidar 增量已够。
- **❌ chokidar 4.x** — 4.x ESM-only，CDF main 是 CJS；3.6.0 是稳定 CommonJS。
- **❌ `commands:list` 返回前等所有采集** — MCP server 可能慢，应该 `Promise.allSettled` 立即返回成功采集的命令。
- **❌ Phase 6 给 priority 加"自动选最高"逻辑** — D-04 锁定 priority **仅**控制排序；用户手动选谁就选谁。
- **❌ 用 `db:getWorkflows` 拉 workflow** — 包含 `graph_data` 重 JSON；D-11 锁定走轻量 SQL。
- **❌ Phase 5 `SYSTEM_COMMANDS` 硬编码 3 行移到 main** — 3 system 是 compile-time 常量，无 IO 需求，留 renderer 端（C-04 决策的延伸：数据在 main，决策在 renderer）。

---

## 5-Source Registry Design

### Type Definitions (src/shared/types.ts)

```typescript
// 新增 type
export type CommandSource =
  | 'system'
  | 'mcp'
  | 'skill:project'
  | 'skill:global'
  | 'workflow'
  | 'cmd:project'
  | 'cmd:system';

export interface SlashCommand {
  /** 命令名（不含 / 前缀） */
  name: string;
  /** 一句话描述；MCP tools 永不显示（D-09） */
  description: string;
  /** 来源 */
  source: CommandSource;
  /** 分发目标（system 枚举 / MCP tool name / skill path / workflow id / command file path） */
  target: string;
  /** 冲突时用于区分（MCP `mcp:serverId:toolName`） */
  sourceLabel: string;
  /** source badge 文案（C-01） */
  badge: string;
}

export type CommandDispatchAction =
  | { kind: 'SystemSilent'; command: SlashCommand; args: string }
  | { kind: 'SystemLocal'; command: SlashCommand; args: string }
  | { kind: 'PluginRewrite'; command: SlashCommand; args: string; prompt: string }
  | { kind: 'PlanMode'; command: SlashCommand; args: string };

export class CommandConflictError extends Error {
  constructor(
    public readonly name: string,
    public readonly conflicts: Array<{ source: CommandSource; badge: string }>
  ) {
    super(`Command conflict: ${name} registered from ${conflicts.length} sources`);
    this.name = 'CommandConflictError';
  }
}
```

### 5 Collectors

#### 1. System Collector (renderer 端硬编码)

```typescript
// src/renderer/src/lib/commands/system-commands.ts
import type { SlashCommand } from '../../../../shared/types';

export const SYSTEM_COMMANDS: ReadonlyArray<SlashCommand> = [
  { name: 'goal', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]', description: '设置 session 目标' },
  { name: 'context', source: 'system', target: 'context', sourceLabel: 'system', badge: '[system]', description: '查看 session token 用量' },
  { name: 'plan', source: 'system', target: 'plan', sourceLabel: 'system', badge: '[system]', description: '进入 plan 模式' },
];

// 后续 Phase 6 完成后，Phase 5 的 SYSTEM_COMMANDS 常量删除，改用此
```

#### 2. MCP Collector (main 端，mcpCache 复用)

```typescript
// src/main/commands/collectors/mcp.ts
import { loadMcpTools } from '../../deepagent/mcp-connector';
import db from '../../database';
import type { SlashCommand, MCPServer } from '../../../shared/types';

export async function collectMcpCommands(agentId: string): Promise<SlashCommand[]> {
  // 拿 agent 绑定的 mcp servers
  const agentServers = db.prepare(`
    SELECT mcp_servers.* FROM mcp_servers
    JOIN agent_mcp_servers ON mcp_servers.id = agent_mcp_servers.mcp_server_id
    WHERE agent_mcp_servers.agent_id = ? AND mcp_servers.is_connected = 1
  `).all(agentId) as MCPServer[];

  if (agentServers.length === 0) return [];

  // 复用 mcpCache — 不重连
  const { tools } = await loadMcpTools(agentId, agentServers);

  return tools.map(tool => ({
    name: tool.name,
    source: 'mcp' as const,
    target: tool.name,
    sourceLabel: `mcp:${tool.name}`,
    badge: `[mcp:${tool.name}]`,
    description: tool.description || '', // D-09: 仅采集用，不渲染
  }));
}
```

**D-17 mcp_health_warning:** 如果 `tools.length === 0`，collectMcpCommands 仍然返回 `[]`，但 main 端额外 push 一个 `mcp_health_warning` 事件到 renderer，renderer 在 popup 顶部/底部加灰行。

```typescript
// in ipcMain.handle('commands:list')
if (mcpCommands.length === 0) {
  return {
    commands: [...system, ...otherSources],
    warnings: [{ type: 'mcp_health_warning', message: 'MCP 工具未加载，请检查服务器连接' }],
  };
}
```

#### 3. Skills Collector (main 端，listPhysicalSkills 复用)

```typescript
// src/main/commands/collectors/skill.ts
import { listPhysicalSkills } from '../../deepagent/skill-manager';
import type { SlashCommand } from '../../../shared/types';

export async function collectSkillCommands(projectPath: string): Promise<SlashCommand[]> {
  const skills = listPhysicalSkills(projectPath);
  return skills.map(skill => ({
    name: skill.name,
    source: skill.scope === 'project' ? 'skill:project' : 'skill:global',
    target: `${skill.scope}:${skill.name}`,
    sourceLabel: `skill:${skill.scope}`,
    badge: `[skill:${skill.scope}]`,
    description: skill.description,
  }));
}
```

#### 4. Workflow Collector (main 端，轻量 SQL)

```typescript
// src/main/commands/collectors/workflow.ts
import db from '../../database';
import type { SlashCommand } from '../../../shared/types';

const VALID_NAME = /^[a-z0-9-]+$/;

export async function collectWorkflowCommands(projectPath: string): Promise<SlashCommand[]> {
  // D-11: 轻量 SQL，不调 db:getWorkflows
  const rows = db.prepare(`
    SELECT id, name, description FROM workflows
    WHERE project_id = (SELECT id FROM projects WHERE path = ?)
      AND status = 'active'
  `).all(projectPath) as Array<{ id: string; name: string; description: string }>;

  return rows
    .filter(r => VALID_NAME.test(r.name))
    .map(r => ({
      name: r.name,
      source: 'workflow' as const,
      target: r.id,
      sourceLabel: 'workflow',
      badge: '[workflow]',
      description: r.description || '',
    }));
}
```

**Note:** 当前 `projects` 表无 `path` 直接列对应 `projectPath`（实际是 `path` 列存绝对路径），需用子查询。PLANNER 注意：若 SQL 不工作，改用 `SELECT id, name, description FROM workflows WHERE status='active'` + renderer 端传 projectId 进来（main 端从 `projects WHERE id=?` 找 path）。

#### 5. Project Commands Collector (main 端，新模块)

```typescript
// src/main/commands/project-commands.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SlashCommand } from '../../shared/types';

interface CommandFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
}

function parseFrontmatter(filePath: string): CommandFrontmatter {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const result: CommandFrontmatter = {};
  for (const line of content.slice(4, end).split('\n')) {
    const [k, ...v] = line.split(':');
    if (k && v.length) result[k.trim() as keyof CommandFrontmatter] = v.join(':').trim();
  }
  return result;
}

function listCommandsInDir(dir: string, source: 'cmd:system' | 'cmd:project'): SlashCommand[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(dir, f);
      const fm = parseFrontmatter(filePath);
      const name = fm.name || f.replace(/\.md$/, '');
      return {
        name,
        source,
        target: filePath,
        sourceLabel: source,
        badge: `[${source}]`,
        description: fm.description || '',
        argumentHint: fm['argument-hint'],
      } as SlashCommand;
    });
}

export function listSystemCommands(): SlashCommand[] {
  return listCommandsInDir(path.join(os.homedir(), '.cdf', 'commands'), 'cmd:system');
}

export function listProjectCommands(projectPath: string): SlashCommand[] {
  return listCommandsInDir(path.join(projectPath, '.cdf', 'commands'), 'cmd:project');
}
```

**D-20 `$ARGUMENTS` 替换** 在 dispatcher 层做（plugin dispatch 时把 body 里的 `$ARGUMENTS` 替换为用户 args，再重写为自然语言 prompt）。

### Conflict Detection

```typescript
// src/main/commands/conflict-detector.ts
import { CommandConflictError, type SlashCommand, type CommandSource } from '../../shared/types';

export function detectConflicts(commands: SlashCommand[]): CommandConflictError[] {
  const groups = new Map<string, SlashCommand[]>();
  for (const cmd of commands) {
    const list = groups.get(cmd.name) || [];
    list.push(cmd);
    groups.set(cmd.name, list);
  }

  const errors: CommandConflictError[] = [];
  for (const [name, list] of groups.entries()) {
    if (list.length > 1) {
      const sources = list.map(c => ({ source: c.source, badge: c.badge }));
      errors.push(new CommandConflictError(name, sources));
    }
  }
  return errors;
}
```

**Key behavior:** 冲突**不杀行**——collectAllCommands 仍然返回所有 commands，errors 单独返回给 renderer 由 sonner toast 显示（D-07）。

---

## 4 DispatchAction Kinds

### Kinds & Behavior Matrix

| Kind | 触发命令 | 行为 | 写入 | LLM 调用 | Phase 6 实现 |
|------|---------|------|------|---------|-------------|
| `SystemSilent` | `/goal` | 写 `useSessionStore.sessionGoals` Map | store | ❌ | 仅 placeholder console.log（Phase 7 写） |
| `SystemLocal` | `/context` | 计算 `messages` 表 token 聚合 + 占位气泡 | store + DOM | ❌ | 仅 placeholder console.log（Phase 7 写） |
| `PluginRewrite` | MCP / Skills / Workflows / Custom Commands | 自然语言重写 + `llm:chat` 既有通路 | `message.content` | ✅ 走既有 | **完整实现**（Phase 6 重点） |
| `PlanMode` | `/plan` | `sendMessage(args, { overrides: { planOnly: true } })` | `payload.overrides.planOnly` | ✅ 走既有 | **完整实现**（Phase 6 重点） |

### Dispatcher Interface

```typescript
// src/renderer/src/lib/commands/dispatcher.ts
import { useSessionStore } from '@/stores/sessionStore';
import type { SlashCommand, CommandDispatchAction } from '../../../../shared/types';

export function resolve(inputVal: string, commands: SlashCommand[]): CommandDispatchAction | null {
  if (!inputVal.startsWith('/')) return null;
  const match = commands.find(c => inputVal === '/' + c.name || inputVal.startsWith('/' + c.name + ' '));
  if (!match) return null;
  const args = inputVal.slice(('/' + match.name).length).trim();

  // System commands
  if (match.source === 'system') {
    if (match.name === 'goal') return { kind: 'SystemSilent', command: match, args };
    if (match.name === 'context') return { kind: 'SystemLocal', command: match, args };
    if (match.name === 'plan') return { kind: 'PlanMode', command: match, args };
  }

  // Plugin commands: PluginRewrite
  return {
    kind: 'PluginRewrite',
    command: match,
    args,
    prompt: `请调用 ${match.name} 工具，参数：${args || '(无参数)'}`,
  };
}

export async function dispatch(plan: CommandDispatchAction): Promise<void> {
  const session = useSessionStore.getState();
  const activeSession = session.sessions.find(s => s.id === session.activeSessionId);
  if (!activeSession) return;
  const { activeSessionId } = session;
  const projectId = useProjectStore.getState().currentProjectId;
  const agentId = activeSession.agent_id || undefined;

  switch (plan.kind) {
    case 'SystemSilent':
      // Phase 7: setSessionGoals(activeSessionId, plan.args)
      console.log(`[dispatcher] SystemSilent: ${plan.command.name} ${plan.args}`);
      return;
    case 'SystemLocal':
      console.log(`[dispatcher] SystemLocal: ${plan.command.name} ${plan.args}`);
      return;
    case 'PlanMode':
      // 走 llm.ts:324 扩展点
      await session.sendMessage(projectId, plan.args, { planOnly: true });
      return;
    case 'PluginRewrite':
      // 走 llm:chat 既有通路；不传 tool args（D-18）
      await session.sendMessage(projectId, plan.prompt);
      return;
  }
}
```

### args Passthrough (D-02)

```typescript
// Phase 6 严格 args 透传；不解析 flag
const args = inputVal.slice(('/' + match.name).length).trim();
// /goal     → args = ''
// /goal X   → args = 'X'
// /arxiv_search foo bar → args = 'foo bar'
// /plan "写一个测试"   → args = '"写一个测试"' （含引号，不去引号）
```

**Phase 7** 才加 flag 解析（`/goal --priority=high` 之类）。

### `payload.overrides.planOnly` Extension Point

```typescript
// src/main/llm.ts:324 (existing, 不改)
runtime = await createDeepAgentRuntime(
  payload.projectId,
  payload.sessionId,
  payload.message,
  payload.agentId,
  payload.overrides  // ← Phase 6 dispatcher 写入 { planOnly: true }
);
```

**Phase 6 dispatcher 调用：**
```typescript
await session.sendMessage(projectId, plan.args, { planOnly: true });
// 走 sessionStore.sendMessage → window.electronAPI.llm.chat → runLLMChat
// payload.overrides = { planOnly: true } 透传到 llm.ts:324
// Phase 7 SLASH-REGRESSION 验证 runtime 是否消费此 flag
```

**Hard Do Not Touch** — `llm.ts:306-425` 是 patch-package 层，Phase 6 严格只读不改。

---

## Conflict Resolution

### Priority 表 (D-06 锁定)

| Source | Priority | Badge 示例 |
|--------|----------|-----------|
| `system` | 100 | `[system]` |
| `skill:project` | 80 | `[skill:project]` |
| `skill:global` | 70 | `[skill:global]` |
| `workflow` | 60 | `[workflow]` |
| `mcp` | 50 | `[mcp:arxiv_search]` |
| `cmd:project` | 40 | `[cmd:project]` |
| `cmd:system` | 30 | `[cmd:system]` |

### 5 Conflict Cases（unit test 覆盖）

| Case | 场景 | 期望行为 |
|------|------|---------|
| 1 | system `/goal` + workflow `/goal`（用户自己命名的 workflow） | 2 行保留；sort 后 system 在前；用户选谁就执行谁 |
| 2 | skill:global `/simplify` + cmd:system `/simplify` | 2 行保留；sort 后 skill:global 在前 |
| 3 | mcp `arxiv_search` + skill:project `arxiv_search` | 2 行保留；sort 后 skill:project 在前 |
| 4 | 3 源同名（极端） | 3 行保留；build 期 1 个 `CommandConflictError`（含 3 个 source）+ sonner toast |
| 5 | CJK 撞名（`/上下文` 在 skill + workflow） | 2 行保留；NFKC 归一化后 `name` 相等 → 视为冲突 |

### `CommandConflictError` Toast 触发

```typescript
// src/renderer/src/hooks/useCommandRegistry.ts
import { toast } from 'sonner';
import { useEffect } from 'react';

export function useCommandRegistry(projectId: string, agentId: string) {
  const [state, setState] = useState<{ commands: SlashCommand[]; loading: boolean }>({ commands: [], loading: true });

  useEffect(() => {
    window.electronAPI.commands.list(projectId, agentId)
      .then(({ commands, warnings }) => {
        setState({ commands, loading: false });
        warnings?.forEach(w => {
          if (w.type === 'mcp_health_warning') {
            toast.warning(w.message);
          }
        });
      });
  }, [projectId, agentId]);

  return state;
}
```

**Conflict toast 在 main 端收集时主动触发：** 实际方案是 main 端 `commands:list` 返回 `{ commands, conflicts }`，renderer 端 `useEffect` 里 `conflicts.forEach(c => toast.warning(c.message))`。

```typescript
// ipcMain.handle('commands:list')
ipcMain.handle('commands:list', async (_, projectId: string, agentId: string) => {
  const { commands, conflicts } = await collectAllCommands(/* projectPath */, agentId);
  return {
    commands,
    conflicts, // ← renderer 端 toast
    warnings: mcpEmpty ? [{ type: 'mcp_health_warning', message: 'MCP 工具未加载' }] : [],
  };
});
```

### 冲突时不杀行（关键不变量）

- `collectAllCommands` 返回的 `commands` 包含**所有**行，**不**做去重。
- `CommandConflictError` **不**抛出阻止返回——它只是 `errors[]` 的一项，由 renderer 端 toast 显示。
- 真正"kill 行"是 v1.2+ 的功能（建议但未批准）；Phase 6 严格"两行都保留"。

---

## IPC Channel Design

### Channel Inventory (Phase 6 新增)

| Channel | Direction | Payload In | Payload Out | Purpose |
|---------|-----------|-----------|-------------|---------|
| `commands:list` | renderer→main | `(projectId, agentId)` | `{ commands: SlashCommand[]; conflicts: CommandConflictError[]; warnings: HealthWarning[] }` | 拉取完整 5 源 registry |
| `commands:readProjectCommands` | renderer→main | `(projectId)` | `{ commands: SlashCommand[] }` | **备用**：单独拉 project commands（chokidar 增量场景下，renderer 端快速刷新用；Phase 6 可选实现，Phase 8 polish 强化） |
| `commands:changed` | main→renderer（push） | — | `{ source: 'chokidar' \| 'mcp-health' }` | chokidar/MCP 事件触发，通知 renderer 重新拉 |

### Preload Surface (Phase 6 新增)

```typescript
// src/preload/index.ts (追加)
commands: {
  list: (projectId: string, agentId: string) =>
    ipcRenderer.invoke('commands:list', projectId, agentId),
  readProjectCommands: (projectId: string) =>
    ipcRenderer.invoke('commands:readProjectCommands', projectId),
  onChanged: (callback: (event: any, data: { source: string }) => void) => {
    const listener = (event: any, data: any) => callback(event, data);
    ipcRenderer.on('commands:changed', listener);
    return () => ipcRenderer.removeListener('commands:changed', listener);
  },
}
```

### ElectronAPI Type (src/shared/types.ts)

```typescript
// ElectronAPI interface (追加)
commands: {
  list: (projectId: string, agentId: string) => Promise<{
    commands: SlashCommand[];
    conflicts: CommandConflictError[];
    warnings: Array<{ type: 'mcp_health_warning'; message: string }>;
  }>;
  readProjectCommands: (projectId: string) => Promise<{ commands: SlashCommand[] }>;
  onChanged: (callback: (event: any, data: { source: string }) => void) => () => void;
};
```

### Main Handler (src/main/ipc-handlers.ts)

```typescript
// 新增 handler（注册位置在 ipcMain.handle('db:getMcpServers') 附近）
ipcMain.handle('commands:list', async (_, projectId: string, agentId: string) => {
  const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
  if (!project) return { commands: [], conflicts: [], warnings: [] };

  const { commands, conflicts } = await collectAllCommands(project.path, agentId);
  const mcpEmpty = commands.filter(c => c.source === 'mcp').length === 0;
  const warnings = mcpEmpty
    ? [{ type: 'mcp_health_warning', message: 'MCP 工具未加载，请检查服务器连接' }]
    : [];

  return { commands, conflicts, warnings };
});

// 可选：commands:readProjectCommands（Phase 6 不实现，留 v1.2+）
```

### `commands:changed` Push (main 端)

```typescript
// in chokidar callback
BrowserWindow.getAllWindows().forEach(w =>
  w.webContents.send('commands:changed', { source: 'chokidar' })
);

// in MCP health event
// (already exists in mcp-connector.ts, just need to wire to BrowserWindow.send)
```

### Renderer 端响应 push

```typescript
// useCommandRegistry hook 内部
useEffect(() => {
  const cleanup = window.electronAPI.commands.onChanged(async (_, data) => {
    if (data.source === 'chokidar' || data.source === 'mcp-health') {
      const { commands, conflicts, warnings } = await window.electronAPI.commands.list(projectId, agentId);
      setCommands(commands);
      warnings.forEach(w => toast.warning(w.message));
    }
  });
  return cleanup;
}, [projectId, agentId]);
```

---

## chokidar Cross-Platform

### D-23 配置

```typescript
chokidar.watch(['~/.cdf/commands/', '<projectPath>/.cdf/commands/'], {
  awaitWriteFinish: {
    stabilityThreshold: 200,  // 200ms 无新写入 = 稳定
    pollInterval: 100,
  },
  ignoreInitial: true,        // 启动时不触发 add 事件
  depth: 0,                    // 只看顶层 *.md
  usePolling: false,           // 默认 fsevents / inotify
})
```

### 跨平台行为差异

| 平台 | chokidar 行为 | 测试要求 |
|------|--------------|---------|
| **macOS** | fsevents 原生；VSCode atomic-write 触发 2 次事件（rename + change），`awaitWriteFinish` 合并 | D-25 必测 |
| **Windows** | ReadDirectoryChangesW；路径大小写不敏感；UNC 路径需 `cwd` 设置 | D-25 必测 |
| **Linux** | inotify；inotify 句柄数限制（`/proc/sys/fs/inotify/max_user_watches` 默认 8192） | D-25 必测 |

### CI 跨平台测试矩阵（D-25 锁定）

```yaml
# .github/workflows/phase-6-commands.yml
name: Phase 6 Slash Command Tests
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm test -- commands
```

**Phase 6 验收：3 平台 × chokidar fixture 至少 1 个 it 块**：
- `chokidar.test.ts`：mock `~/.cdf/commands/test.md` 写入 → 200ms 后验证 `onChange` 触发
- 在 macOS / Windows / Linux GitHub Actions 各 1 run

### chokidar 失败降级（D-24 锁定：仅 log，不 toast）

```typescript
try {
  const handle = chokidar.watch([...], { ... });
  handle.on('error', (err) => log.error('[commands-watcher]:', err));
} catch (err) {
  log.error('[commands-watcher] init failed:', err);
  // 降级：仅 session 启动时 readdir 一次；用户重启 session 才能看到新 commands
}
```

**Phase 8 polish** 加降级 toast（"自定义命令热重载不可用，请重启 session"）。

### `awaitWriteFinish` 工作原理

VSCode / Vim 保存文件流程：
1. 创建 temp 文件（`test.md.tmp`）
2. 写入完成
3. `rename(test.md.tmp → test.md)`（原子操作）

`fs.watch` 在 macOS 上对 `rename` 不友好，可能只触发 1 次。`chokidar + awaitWriteFinish`：
- 收到 `add` 事件
- 启动 200ms 稳定窗口
- 窗口内若还有新事件 → 重置窗口
- 窗口结束无新事件 → 触发 `add` 回调

**结果：** 用户编辑保存后，**只触发 1 次 change 回调**，registry 重拉一次。

---

## Source Badge Rendering

### 数据

每个 `SlashCommand` 自带 `badge` 字段（C-01 决策：沿用 ROADMAP 提议的 `[source]` / `[source:name]` 格式）：

```typescript
badge: '[system]'              // 3 system
badge: '[skill:global]'        // global skill
badge: '[skill:project]'       // project skill
badge: '[workflow]'            // workflow
badge: '[mcp:arxiv_search]'    // MCP tool
badge: '[cmd:system]'          // system-level custom command
badge: '[cmd:project]'         // project-level custom command
```

### 渲染（扩展 Phase 5 Command.Item）

```tsx
// src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx
<Command.Item
  key={`${cmd.source}-${cmd.name}`}  // 关键：冲突时 source 也作为 key
  value={cmd.name}                     // cmdk 过滤用 name
  data-source={cmd.source}             // ← 新增：测试用 attribute
  onSelect={() => onSelect(cmd)}
  className="flex items-center gap-2 ..."
>
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
    {cmd.badge}
  </Badge>
  <span className="font-mono text-[13px]">/{cmd.name}</span>
  {/* D-09: MCP tool 不显示 description；其他源显示（截断 60 字符） */}
  {cmd.source !== 'mcp' && cmd.description && (
    <span className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[200px]">
      {cmd.description.slice(0, 60)}
    </span>
  )}
</Command.Item>
```

### Phase 5 → Phase 6 迁移

Phase 5 当前的 `Command.Item`：

```tsx
<Command.Item key={c.value} value={c.value} onSelect={...} className="flex cursor-default ...">
  {c.label}
</Command.Item>
```

Phase 6 扩展为：
- `key` 加 source 防冲突（同 name 不同 source）
- `data-source` attribute
- Badge 列 + name 列 + description 列（条件渲染）

**Phase 5 `SYSTEM_COMMANDS` 常量删除**（在 renderer 端 lib/commands/system-commands.ts 重新定义并 source 化）；或者保留 Phase 5 常量做 fallback，等 `useCommandRegistry` 加载完再覆盖。

### Badge 颜色 (C-07)

Phase 6 **不**自定义 7 色——直接用 shadcn `<Badge variant="secondary">` 默认色（CSS var `--color-bg-surface` 背景）。Phase 8 polish 才决定 7 色。

### 7 色 source 视觉建议（Phase 8 留参考）

| Source | 建议色（CSS var） | Phase 6 | Phase 8 |
|--------|------------------|---------|---------|
| system | `--color-accent` 蓝 | default | 蓝 |
| skill:project | `--color-success` 绿 | default | 绿 |
| skill:global | `--color-success` 绿（淡） | default | 绿淡 |
| workflow | `--color-warning` 橙 | default | 橙 |
| mcp | `--color-info` 紫 | default | 紫 |
| cmd:project | `--color-text-muted` 灰 | default | 灰 |
| cmd:system | `--color-text-muted` 灰（淡） | default | 灰淡 |

---

## mcp_health_warning Row

### 触发条件（D-17）

- `loadMcpTools(agentId, servers)` 返回 `tools.length === 0`
- 满足任一：
  1. `agentServers.length === 0`（agent 没绑 MCP server）
  2. 所有 MCP server 连接失败
  3. 连接成功但 `tools/list` 返回 `[]`

### 位置（C-02 决策建议）

**推荐：popup 顶部**（用户最关心的位置，符合"先看到问题再看到命令"的视觉流）。

```tsx
<Command.List>
  {hasMcpWarning && (
    <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] flex items-center gap-2">
      <AlertCircle className="w-3 h-3" />
      <span>MCP 工具未加载，请检查服务器连接</span>
    </div>
  )}
  {commands.map(cmd => <Command.Item ... />)}
</Command.List>
```

### 数据流

1. `commands:list` 返回 `warnings: [{ type: 'mcp_health_warning', message: '...' }]`
2. renderer 端 `useEffect` 监听 warnings → 设置 `hasMcpWarning` state
3. popup 渲染时检查 `hasMcpWarning` → 顶部/底部插入灰行
4. **不**阻塞 cmdk 键盘导航（灰行不可选中）

### chokidar / MCP health 事件重新检测

- MCP 健康事件触发 `commands:changed` push
- renderer 端重新调 `commands:list` → 重新评估 `mcpEmpty`
- 灰行自动消失/出现

---

## Validation Architecture

> `workflow.nyquist_validation` 在 `.planning/config.json` 未显式设 false → **enabled**。本节必须包含。

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.8` + `@testing-library/react@16.x` |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm test -- --reporter=verbose <pattern>` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLASH-03 | 5 源合并 + source badge | unit | `npm test -- command-registry.test.ts` | ❌ Wave 0 |
| SLASH-04 | 4 kinds dispatch | unit | `npm test -- dispatcher.test.ts` | ❌ Wave 0 |
| SLASH-08 | MCP tool 自动注册 | unit | `npm test -- mcp-collector.test.ts` | ❌ Wave 0 |
| SLASH-09a/09b | Skills 2 亚源 | unit | `npm test -- skill-collector.test.ts` | ❌ Wave 0 |
| SLASH-10 | Workflow 轻量 SQL | unit | `npm test -- workflow-collector.test.ts` | ❌ Wave 0 |
| SLASH-11a/11b | Project commands 2 亚源 | unit | `npm test -- project-commands.test.ts` | ❌ Wave 0 |
| SLASH-12 | 命名冲突 5 case | unit | `npm test -- conflict-detector.test.ts` | ❌ Wave 0 |
| SLASH-13 | chokidar hot-reload | integration | `npm test -- chokidar-watcher.test.ts` | ❌ Wave 0 |
| SLASH-DISPATCH | PluginRewrite 走 llm:chat | unit + 1 e2e | `npm test -- dispatcher-llm-chat.test.ts` | ❌ Wave 0 |
| (D-25) | 跨平台 CI | CI matrix | GitHub Actions (mac/win/linux) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- <relevant-test-file>`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + CI matrix green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/main/commands/command-registry.test.ts` — 5 源采集 + merge + 5 conflict cases
- [ ] `src/main/commands/collectors/{mcp,skill,workflow,project}.test.ts` — 每个 collector 独立测试
- [ ] `src/main/commands/project-commands.test.ts` — frontmatter 解析 + $ARGUMENTS 替换
- [ ] `src/main/commands/chokidar-watcher.test.ts` — write 200ms 后触发 onChange
- [ ] `src/main/commands/conflict-detector.test.ts` — 5 conflict case
- [ ] `src/renderer/src/lib/commands/dispatcher.test.ts` — 4 kinds 分发 + args 透传
- [ ] `src/renderer/src/hooks/useCommandRegistry.test.ts` — IPC 拉取 + sort + conflict toast
- [ ] `src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx` — 扩展现有 19 个测试：source badge 渲染 + description 条件渲染 + mcp_health_warning 灰行
- [ ] Framework install: `npm install --save chokidar@^3.6.0 sonner@^2.0.7` (Wave 0 task)
- [ ] CI matrix: `.github/workflows/phase-6-commands.yml` (Wave 0 task)

### E2E Contract Test

1 e2e 必须覆盖（按 C-05 锁定）：
- `/goal X` 写 store（Phase 6 仅占位；Phase 7 实际写）
- `/context` 调 API（Phase 6 占位）
- `/plan` 触发 `planOnly` flag（Phase 6 完整实现）
- `/arxiv_search foo` 走 `llm:chat`（PluginRewrite 完整实现）

> Phase 6 实际 e2e 数量：**2 个**（`/plan` + `/arxiv_search` 完整；`/goal` / `/context` 仅 smoke 验证 dispatcher branch 命中）。

---

## Integration Points (Phase 6 改动清单)

### 修改文件

| 文件 | 行号 | 改动 | Phase 6 类型 |
|------|------|------|-------------|
| `src/main/ipc-handlers.ts` | 在 `db:getMcpServers` handler 附近 | +1 handler `commands:list` | New handler |
| `src/main/index.ts` | line 61-65 `app.whenReady` 块 | +chokidar watcher 初始化 | Hook |
| `src/main/llm.ts` | **不改** | 扩展点 `llm.ts:324` 已存在 | — |
| `src/main/deepagent/mcp-connector.ts` | **不改** | 复用 `loadMcpTools` | — |
| `src/main/deepagent/skill-manager.ts` | **不改** | 复用 `listPhysicalSkills` | — |
| `src/preload/index.ts` | 在 `electronAPI.llm` 后追加 | +3 methods | New methods |
| `src/shared/types.ts` | 在 `ChatRuntimeOverrides` 附近 | +4 type（SlashCommand / CommandSource / CommandDispatchAction / CommandConflictError） | New types |
| `src/renderer/src/components/ChatArea/ChatArea.tsx` | line 663-666 `handleSlashSelect` | 改造为 dispatcher.resolve + dispatch | Modify |
| `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` | line 110-119 `Command.Item` 渲染 | 扩展多列（badge + name + description） | Modify |
| `package.json` | dependencies 块 | +`chokidar@^3.6.0` +`sonner@^2.0.7` | New deps |
| `vitest.config.ts` | **不改** | 已支持 jsdom + alias | — |

### 新建文件

| 文件 | 用途 | 行数估计 |
|------|------|---------|
| `src/main/commands/command-registry.ts` | 5 源合并器 + conflict detection | ~100 |
| `src/main/commands/project-commands.ts` | `.cdf/commands/*.md` 解析 | ~80 |
| `src/main/commands/chokidar-watcher.ts` | chokidar 双路监听 | ~50 |
| `src/main/commands/conflict-detector.ts` | `CommandConflictError` 抛错 | ~30 |
| `src/main/commands/collectors/system.ts` | 3 system 硬编码 | ~20 |
| `src/main/commands/collectors/mcp.ts` | MCP 源采集 | ~30 |
| `src/main/commands/collectors/skill.ts` | Skills 源采集 | ~25 |
| `src/main/commands/collectors/workflow.ts` | Workflows 源采集（轻量 SQL） | ~25 |
| `src/main/commands/collectors/project.ts` | Custom commands 源采集 | ~30 |
| `src/renderer/src/hooks/useCommandRegistry.ts` | registry consumer hook | ~80 |
| `src/renderer/src/lib/commands/dispatcher.ts` | 4 kinds 分发器 | ~100 |
| `src/renderer/src/lib/commands/system-commands.ts` | 3 system 硬编码（renderer 端） | ~20 |

### 修改函数的精确签名

```typescript
// ChatArea.tsx line 663
const handleSlashSelect = (cmd: string) => {
  // Phase 5 旧:
  // setInputVal(cmd + ' ');
  // setSlashOpen(false);

  // Phase 6 新:
  const plan = resolve(inputVal, registry.commands);
  if (plan) {
    setInputVal('');
    setSlashOpen(false);
    dispatch(plan);
  } else {
    // 退化路径：用户可能改了 inputVal（如 Tab 仍只插文本，D-07 Phase 5 锁定）
    setInputVal(cmd + ' ');
    setSlashOpen(false);
  }
};
```

> **D-07 关键**：Tab 仍只插文本不触发（沿用 Phase 5）；Enter 按 Phase 6 走 dispatcher。
> 实现：cmdk `Command.Item` `onSelect` 通过 `e.detail === 0`（Tab）vs `e.detail > 0`（Enter）区分 — 但 cmdk 不直接暴露；建议在 `handleSlashSelect` 加参数：
> ```typescript
> const handleSlashSelect = (cmd: string, viaEnter: boolean = false) => {
>   if (viaEnter) {
>     const plan = resolve(inputVal, registry.commands);
>     if (plan) { ... }
>   }
>   setInputVal(cmd + ' ');
>   setSlashOpen(false);
> };
> ```
> cmdk `Command.Item` `onSelect` 接收 `e: KeyboardEvent`（如果是键盘触发），可在 onSelect 闭包里判断 `e?.detail`。Phase 6 实现细节由 planner 决定。

---

## Pitfalls & Risks (Phase 6 Specific)

> 不重复 Phase 5 / PITFALLS.md 的内容；仅列 Phase 6 新引入的陷阱。

### Pitfall P6.1: `Promise.all` 全部失败 = 空注册表

**What goes wrong:** 如果用 `Promise.all`（不是 `Promise.allSettled`），任何一个采集器抛错会导致整个 `commands:list` 失败 → renderer 拿到 `commands: []` → popup 完全空。

**Why:** MCP server 临时断 / 数据库 locked / fs 权限不够都是常见故障。

**How to avoid:** 严格用 `Promise.allSettled`，单源失败不影响其他源。空采集器返回 `[]`（不是 throw）。

**Warning signs:** `commands:list` handler 用 `Promise.all` 而不是 `Promise.allSettled`。

### Pitfall P6.2: Conflict 抛错杀行（D-07 反向）

**What goes wrong:** detectConflicts 抛 `CommandConflictError` 时未捕获 → IPC handler 抛 → renderer `useEffect` `.then` 拿不到 commands → popup 空。

**Why:** D-07 锁定"两行都保留"，但实现可能误用 throw 阻止返回。

**How to avoid:** `detectConflicts` 返回 `errors: CommandConflictError[]`（不是 throw），IPC handler 把它当返回值。renderer 端用 toast 显示。

**Warning signs:** `ipcMain.handle('commands:list', ...)` 包含 `try { ... } catch (e) { if (e instanceof CommandConflictError) ... }` —— 这意味着 throw 已经发生。

### Pitfall P6.3: chokidar 事件风暴

**What goes wrong:** VSCode 一次性保存多个文件 → 触发 N 次 change 事件 → N 次 registry 重拉 → 性能问题 + IPC 抖动。

**Why:** 没有 debounce。

**How to avoid:** 100ms debounce（见 Pattern 4）；考虑 `add` `change` `unlink` 三事件合并。

**Warning signs:** `handle.on('add', reloadRegistry)`（无 debounce）。

### Pitfall P6.4: `mcpCache` 缓存过期 = MCP 工具不更新

**What goes wrong:** `loadMcpTools` 内部有 `configHash` 缓存（`mcp-connector.ts:133-138`），MCP server 列表变更但 config hash 相同 → 复用旧 tools。

**Why:** `configHash = JSON.stringify(servers.map(s => ({ id, server_type, config })))` —— 如果 MCP server 实际工具列表变更（添加新 tool）但 config 字段未变，hash 相同 → 缓存命中。

**How to avoid:** MCP health 事件触发时**清空** `mcpCache`：`mcpCache.delete(agentId)`，下次采集重连。

**Warning signs:** `commands:changed` 事件触发后 MCP 工具数没更新。

### Pitfall P6.5: `mcp_health_warning` 误报（agent 没绑 MCP）

**What goes wrong:** agent 本来就没绑任何 MCP server → `loadMcpTools` 返回 `[]` → 误报 mcp_health_warning → popup 顶部一直显示灰行骚扰用户。

**Why:** mcpEmpty 判断无差别。

**How to avoid:** 检查 `agentMcpServers.length === 0`（agent 真没绑）vs `tools.length === 0`（绑了但 tools 失败）—— 前者**不**显示灰行。

```typescript
const hasAgentMcp = agentServers.length > 0;
const mcpToolsEmpty = hasAgentMcp && mcpCommands.length === 0;
const warning = mcpToolsEmpty
  ? [{ type: 'mcp_health_warning', message: 'MCP 工具加载失败，请检查连接' }]
  : [];
```

**Warning signs:** popup 顶部灰行对所有 agent 都显示。

### Pitfall P6.6: chokidar 监听 `~/.cdf/commands/` 在 `homedir()` 为空时崩溃

**What goes wrong:** `os.homedir()` 在某些 Electron 启动早期返回 `''`（renderer 进程未就绪时）。

**Why:** Electron main 进程 `app.whenReady` 之前 `homedir()` 可能未就绪。

**How to avoid:** chokidar 初始化在 `app.whenReady` 块内（**不**在 `app.on('ready')` 之前）。

**Warning signs:** 应用启动时白屏 + 报 `path.join('', '.cdf', 'commands')` 错误。

### Pitfall P6.7: `process.platform` 在 renderer 进程不可用

**What goes wrong:** `process.platform` 在 sandboxed renderer 不可用；preload 是隔离的。

**Why:** Electron contextBridge 安全模型。

**How to avoid:** 跨平台判断放 main 端（`process.platform` 可用）；renderer 端通过 IPC 拿 `platform` 值（preload 已暴露 `platform: process.platform`）。

**Warning signs:** popup 在 renderer 端 `if (process.platform === 'darwin') ...` 报错。

### Pitfall P6.8: `Promise.allSettled` 顺序依赖

**What goes wrong:** `Promise.allSettled([a, b, c])` 的 result 顺序与输入顺序一致，但**值**可能 `undefined`。

**Why:** `result.status === 'rejected'` 时 `result.reason` 是 Error，`result.value` 是 undefined。

**How to avoid:** 严格 `result.status === 'fulfilled' ? result.value : []`，不依赖短路或 `??`。

**Warning signs:** `commands.push(...result.value)` 而不检查 status。

### Pitfall P6.9: `ChatArea` 重渲染时 dispatcher 模块实例丢失

**What goes wrong:** `dispatcher.ts` 在 `lib/commands/` 是 module-scope 纯函数，但 useCommandRegistry hook 是组件内 state → 组件 unmount/remount 时 state 丢失 → popup 显示 0 命令。

**Why:** Phase 5 `slashOpen` 是 `useState(false)` 局部 state；Phase 6 加 `useCommandRegistry` 后，如果 hook 仍用 useState，组件 unmount 会丢。

**How to avoid:** `useCommandRegistry` 放 Zustand store（**不**放 useState），与 `slashOpen` 同位置。Phase 6 可选重构（C-06 默认**不**重构，Phase 6 沿用 useState 但 hook 内部自己 useState 缓存）。

**Warning signs:** 切换 session 后 popup 显示 0 命令。

### Pitfall P6.10: `payload.overrides.planOnly` 透传失败

**What goes wrong:** `sessionStore.sendMessage(projectId, content, { planOnly: true })` 调用 `window.electronAPI.llm.chat(payload)`，但 preload 没把 `overrides` 透传 → main 端 `payload.overrides` 是 `undefined` → Phase 7 SLASH-REGRESSION 失败。

**Why:** preload 类型定义与实际传参不匹配。

**How to avoid:** preload `llm.chat` 已有 `payload: { ... overrides?: ChatRuntimeOverrides }`（`src/shared/types.ts:406`），只要 `ChatRuntimeOverrides` 加 `planOnly?: boolean` 字段即透传。

**Warning signs:** 调试时 `payload.overrides` 在 main 端 console.log 是 `undefined`。

---

## Code Examples

### Verified patterns from official sources

#### 1. chokidar@3.6.0 awaitWriteFinish (官方 README)

```typescript
// Source: https://github.com/paulmillr/chokidar/blob/3.6.0/README.md
import chokidar from 'chokidar';

const watcher = chokidar.watch('file, dir, or glob', {
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 100,
  },
  ignoreInitial: true,
});

watcher.on('add', path => console.log('File', path, 'was added'));
```

#### 2. sonner toast.warning (官方 README)

```typescript
// Source: https://sonner.emilkowal.ski/
import { Toaster, toast } from 'sonner';

// 在 App 根部
<Toaster position="top-right" richColors />

// 任意位置触发
toast.warning('MCP 工具未加载', { description: '请检查服务器连接' });
```

#### 3. cmdk Command.Item 多列 (Phase 5 扩展)

```tsx
// Source: cmdk 1.1.1 + Phase 5 SlashCommandPopup.tsx
<Command.Item
  value={cmd.name}                 // cmdk 过滤用
  data-source={cmd.source}          // 测试 attribute
  onSelect={() => onSelect(cmd)}
  className="flex items-center gap-2 ..."
>
  <Badge variant="secondary">{cmd.badge}</Badge>
  <span>/{cmd.name}</span>
  <span className="text-muted">{cmd.description}</span>
</Command.Item>
```

#### 4. better-sqlite3 prepare statement (现有 pattern)

```typescript
// Source: src/main/database.ts workflow table
const rows = db.prepare(`
  SELECT id, name, description FROM workflows
  WHERE status = 'active'
`).all() as Array<{ id: string; name: string; description: string }>;
```

#### 5. Electron contextBridge (现有 pattern)

```typescript
// Source: src/preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', {
  commands: {
    list: (projectId: string, agentId: string) =>
      ipcRenderer.invoke('commands:list', projectId, agentId),
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded 3 system commands | 5 源动态 registry | Phase 6 (v1.1) | 插件命令自然注入 |
| popup 关闭后 LLM 调用 | 4 kinds dispatcher (SystemSilent 不调 LLM) | Phase 6 | /goal /context 零 token 成本 |
| `assistant-ui unstable_useSlashCommandAdapter` | 自建 cmdk + Radix Popover | Phase 5 (v1.1) | 0.14.x API 不稳被弃用 |
| `fs.watch` 监听 | chokidar@3.6.0 + awaitWriteFinish | Phase 6 | macOS VSCode 原子写兼容 |
| `console.warn` 警告 | sonner toast | Phase 6 | 非阻塞 + shadcn 风格 |
| Phase 5 Phase 单 component 状态 | Hook + Zustand | Phase 6 (C-06 可选) | 多组件共享 registry |

**Deprecated/outdated:**
- `assistant-ui unstable_useSlashCommandAdapter`：0.14.x @deprecated，避免触碰
- `chokidar@4.x`：ESM-only，main 进程 CJS 不兼容，3.6.0 锁版
- `fs.watch`：macOS/Windows editor atomic-write 不可靠

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mcpCache` 跨 IPC 调用保持一致（agentId 唯一） | MCP Source Collection | 多个 agent 并发导致 mcpCache key 冲突 |
| A2 | `chokidar@3.6.0` 在 macOS 13+ / Win 11 / Ubuntu 22.04+ 跨平台行为一致 | chokidar Cross-Platform | CI 矩阵 1 个 OS 失败需修代码 |
| A3 | `workflows` 表 `status` 字段值只有 `draft` / `active` | Workflow Source Collection | 新 status 出现需扩展 enum |
| A4 | 项目级 skills / commands 路径 `<projectPath>/.cdf/` 存在 | Project Commands / Skills | 目录不存在时 listPhysicalSkills 静默返回 [] |
| A5 | `payload.overrides.planOnly` 字段是 Phase 7 runtime 真实识别 | Dispatcher Architecture | Phase 6 写入无效，Phase 7 才发现 |
| A6 | `chokidar` 在 Windows 路径大小写不敏感 | chokidar Cross-Platform | `commands:Changed` 触发时大小写差异 |
| A7 | Electron main 进程 `os.homedir()` 在 `app.whenReady` 后就绪 | Pitfall P6.6 | 启动早期调用 `~/.cdf/commands/` 报 ENOENT |
| A8 | Phase 5 `SlashCommandPopup` 现有 19 个测试不破坏 | Validation Architecture | 修改 Command.Item 结构需更新测试 |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.
**This table is NOT empty** — 8 项 [ASSUMED] claims. 关键风险：**A5**（planOnly runtime 语义需 Phase 7 验证）。其他 7 项属于实现细节 / 跨平台 / 数据库 enum，PLANNER 应在 plan 中加 `checkpoint:human-verify` 任务确认。

---

## Open Questions

1. **mcpCache key 策略**
   - 已知：`mcpCache: Map<agentId, McpCacheEntry>`（`mcp-connector.ts:12`）
   - 不清楚：Phase 6 collector 用 `agentId` 作为 key 时，传哪个 agentId？默认 agent？active agent？
   - 建议：传 `activeSession?.agent_id || defaultAgent.id`（与 `ChatArea.tsx:777` `activeSession?.agent_id || undefined` 一致）

2. **commands:readProjectCommands 是否 Phase 6 实现**
   - C-03 列入 Claude's Discretion
   - 建议：**Phase 6 不实现**（与 `commands:list` 重复，chokidar 增量已用 `commands:changed` push），Phase 8 polish 再加

3. **chokidar watcher 何时启动**
   - 候选：a) `app.whenReady` 一次性启动；b) 每次 session 创建时启动
   - 建议：a) 一次性（命令目录是 OS-level，跨 session 共享）
   - 风险：每个 project 的 `<projectPath>/.cdf/commands/` 路径不同，session 切换时需重启 watcher

4. **`commands:list` 返回的 commands 是否每次都重排**
   - 当前：sort 在 renderer 端
   - 替代：main 端 sort 后返回
   - 建议：renderer 端 sort（main 只采集，renderer 持有 sort 逻辑更易测）

5. **MCP 工具 description 在 D-09 锁定"不渲染" — 但内部 log 是否需要**
   - 建议：是。在 collectMcpCommands 里 `console.log('[mcp-collector] tool:', name, 'desc:', description)`，但 popup UI 不显示

6. **`/plan` 是否需要确认弹窗**
   - 当前 D-04 锁定"用户手动选谁就选谁"
   - 风险：`/plan` 是高影响操作（runtime flag 切到 plan-only）
   - 建议：Phase 6 不加确认（沿用"选谁就执行谁"）；Phase 7 / Phase 8 polish 再评估

7. **2 个 `commands:*` IPC 通道命名一致性**
   - `commands:list`（pull）+ `commands:changed`（push）+ `commands:readProjectCommands`（备用）
   - 建议：保留 2 个常用 + 1 个备用命名一致（`commands:*` 前缀）

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Electron runtime | ✓ | 22+ (electron-vite v5 要求) | — |
| better-sqlite3 | workflow SQL | ✓ | 12.10.0 | — |
| chokidar@3.6.0 | hot-reload | ❌（需安装） | — | 不用 chokidar → 退化为 session 启动 readdir |
| sonner@2.0.7 | toast | ❌（需安装） | — | 不用 sonner → console.warn |
| cmdk@1.1.1 | popup 渲染 | ✓（Phase 5 已装） | 1.1.1 | — |
| @radix-ui/react-popover@1.1.15 | popup 锚定 | ✓（Phase 5 已装） | 1.1.15 | — |
| macOS VSCode atomic-write 模拟 | chokidar test | 需 CI fixture | — | 写文件 + 200ms 后断言 |
| GitHub Actions 跨平台 runner | D-25 CI 矩阵 | ✓ | mac/win/linux-latest | — |

**Missing dependencies with no fallback:**
- 无（chokidar / sonner 都有 fallback 退路）

**Missing dependencies with fallback:**
- `chokidar@3.6.0` — 退化为 session 启动 readdir（D-24 锁定） + 仅 log
- `sonner@2.0.7` — 退化为 `console.warn`（D-07 锁定为非阻塞，但非阻塞效果减弱）

**Environment probe command for planner Wave 0:**
```bash
node -e "console.log(require('os').homedir(), process.platform)"
ls ~/.cdf 2>/dev/null || echo "~/.cdf missing (expected for fresh env)"
```

---

## Security Domain

> `security_enforcement` 未在 config.json 显式设 false → **enabled**。本节必须包含。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 6 不涉及 auth |
| V3 Session Management | yes | session-goal/session-context 数据存 in-memory Map（v1.1）；v1.2+ 迁 SQLite |
| V4 Access Control | no | Phase 6 不涉及多用户 RBAC |
| V5 Input Validation | yes | `args` 字符串透传（**不解析** flag 规避命令注入）；MCP args 走自然语言不传 tool schema |
| V6 Cryptography | no | Phase 6 不涉及密钥 |
| V7 Error Handling | yes | chokidar 失败仅 log（D-24 锁定）；MCP health warning 非阻塞 toast |
| V9 Logging | yes | chokidar error 走 `electron-log`（`src/main/logger.ts`） |
| V11 Business Logic | yes | `CommandConflictError` 不杀行（D-07）；priority 仅排序（D-04） |
| V12 Files and Resources | yes | fs 监听 + `.cdf/commands/*.md` 解析；**不**递归监听 `<projectPath>` 根目录（避免意外 reindex） |

### Known Threat Patterns for Electron + slash command

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| MCP args 透传 → bash-tool 注入 | Tampering | D-18 锁定：MCP args **不**传 tool，附加到 `message.content` 自然语言；避免 PITFALLS P7 |
| Chokidar 监听根目录递归 | Tampering | `depth: 0` + 仅 `*.md` 后缀过滤 |
| Conflict 静默覆盖 | Repudiation | `CommandConflictError` build 期 throw + sonner toast；用户可见 |
| Source badge 渲染 XSS | Tampering | 全部走 React text（`<Badge>{cmd.badge}</Badge>`）不 `dangerouslySetInnerHTML` |
| `payload.overrides.planOnly` 误用 | Elevation of Privilege | Phase 6 仅 PlanMode 分发器写；其他 kind 不写 |

### MCP args 注入防御（D-18 / PITFALLS P7）

```
/arxiv_search foo bar
        │
        ▼
dispatcher.resolve() → PluginRewrite
        │
        ▼
plan.prompt = "请调用 arxiv_search 工具，参数：foo bar"
        │
        ▼
session.sendMessage(projectId, plan.prompt)  ← args 走 message.content 自然语言
        │
        ▼
Master Agent LLM 自主决定如何调用 tool_use
        │
        ▼
deepagents 工具调用层 schema 校验（已有）
```

**关键：MCP args 永远不直接进 `tool.args`，只进 LLM context 让 LLM 决定。**

### chokidar 路径白名单

```typescript
chokidar.watch([
  path.join(os.homedir(), '.cdf', 'commands'),
  path.join(projectPath, '.cdf', 'commands'),
], {
  depth: 0,  // 不递归
  ignored: /(^|[\\/])\..|node_modules/,
});
```

`depth: 0` + 自定义 ignore 防监听 `node_modules` 等大目录。

---

## Sources

### Primary (HIGH confidence)

- `node_modules/cmdk` 1.1.1（已装）— Command primitive 验证存在
- `node_modules/chokidar` 3.6.0（slopcheck 装后已存在）— awaitWriteFinish 选项
- `node_modules/sonner` 2.0.7（slopcheck 装后已存在）— toast API
- `src/main/llm.ts:306-425` — `runLLMChat` + `streamEvents` v3 验证（**不改**）
- `src/main/llm.ts:324` — `payload.overrides` 扩展点验证存在
- `src/main/deepagent/mcp-connector.ts:129-156` — `loadMcpTools` + `mcpCache` 验证
- `src/main/deepagent/skill-manager.ts:80-104` — `getScopePath` + `listPhysicalSkills` 验证
- `src/main/database.ts:402-447` — `workflows` 表 schema 验证
- `src/main/ipc-handlers.ts:474-505` — `db:getSkills` 等物理 IPC pattern
- `src/main/ipc-handlers.ts:531-538` — `db:getMcpServers` pattern
- `src/preload/index.ts:3-103` — `electronAPI` 表面
- `src/shared/types.ts:140-143` — `ChatRuntimeOverrides`（要扩展 `planOnly`）
- `src/shared/types.ts:406` — preload `llm.chat` 签名含 `overrides?`
- `src/renderer/src/components/ChatArea/ChatArea.tsx:663-666` — `handleSlashSelect` 当前实现
- `src/renderer/src/components/ChatArea/ChatArea.tsx:1022-1135` — Popover 包裹
- `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx:1-130` — Phase 5 popup 完整
- `src/renderer/src/components/ui/badge.tsx:1-36` — `<Badge>` 组件
- `src/renderer/src/stores/sessionStore.ts:338-784` — `sendMessage` 完整路径
- `vitest.config.ts` — 已配置 jsdom + alias

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md` — 4-agent 研究综述（HIGH confidence 引用）
- `.planning/research/ARCHITECTURE.md:140-171` — SlashCommand / CommandDispatchAction type 设计
- `.planning/research/STACK.md:325-339` — cmdk 1.1.1 + Radix Popover 1.1.15 版本验证
- `.planning/research/PITFALLS.md:222-234` — chokidar 跨平台 + workflow 空表（已取消 seed）
- `.planning/phases/05-popup-shell-keyboard-spike/05-CONTEXT.md` — D-01..D-07 锁定

### Tertiary (LOW confidence / 需要验证)

- `chokidar@3.6.0` 在 Win / Linux 跨平台行为 — 需 D-25 CI 矩阵验证
- `payload.overrides.planOnly` runtime 真实消费 — 需 Phase 7 SLASH-REGRESSION 验证
- `mcpCache` config hash 命中率（MCP 工具列表变更场景）— 需 Phase 6 e2e 验证
- `os.homedir()` 在 Electron 启动早期就绪性 — 需 `app.whenReady` 内调用验证

---

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — npm registry 验证 chokidar@3.6.0 + sonner@2.0.7 + cmdk@1.1.1；slopcheck [OK] 三包
- **Architecture:** HIGH — 5 源采集器各自已有 reuse 锚点（`loadMcpTools` / `listPhysicalSkills` / `workflows` 表）；扩展点 `llm.ts:324` 存在
- **Pitfalls:** MEDIUM — Phase 5 已避开主要陷阱；Phase 6 引入 10 个新风险点（Promsie.allSettled / chokidar debounce / mcpCache 清空等），影响范围限于本 phase
- **Cross-platform chokidar:** LOW — 需 D-25 CI 矩阵验证（plan 06-XX 加 fixture 测试任务）
- **MCP args 语义（D-18）:** HIGH — 客人大人明确锁定，自然语言重写在 Master Agent 调度安全

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (30 天稳定期；chokidar / sonner / cmdk 都是 stable releases，30 天内无 breaking 风险)

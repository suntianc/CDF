---
name: workflow-not-active-guard
description: Removed status guard in runWorkflow() — status now only gates Agent visibility, manual run allows both draft and active workflows.
status: resolved
trigger: "Error invoking remote method 'workflow:run': Error: Workflow 4220eb34-067d-4518-b36d-96c90137b389 is not active and cannot be executed"
---

# Resolution

**修复方案**：采用诊断中的方案 D —— 移除 `runWorkflow()` 的 status 守卫。

- `src/main/workflow/workflow-runtime.ts:244-248` —— 删除 `if (workflowRow.status !== 'active') throw ...` 守卫
- 注释同步更新：`status` 仅控制 Agent 可见性（`tools.ts:25` 仍过滤 `status = 'active'`），手动运行允许 draft 与 active 两态

**未触达**：WorkflowList / WorkflowEditor 的 Run 按钮本就无 status 校验（保留现状即可）。

**验证**：`grep "is not active and cannot be executed"` 在 src 下 0 命中；下游无 status 假设。


# 症状（Symptoms）

- IPC 调用 `workflow:run` 抛出 `Error: Workflow {id} is not active and cannot be executed`
- Electron 包装为 `Error invoking remote method 'workflow:run'`
- 触发面：用户点击"运行工作流"按钮（列表页或编辑器内），无差别命中

# 根因（Root Cause）

## 状态机不闭合 + 客户端缺校验

| 层 | 行为 |
|---|---|
| `workflows.status` 列（`database.ts:408`） | `TEXT NOT NULL DEFAULT 'draft'` |
| 类型（`shared/types.ts:280`） | `'draft' \| 'active'` —— **仅两态** |
| 新建工作流（`App.tsx:87`、`ipc-handlers.ts:683/688`、`WorkflowEditor.tsx:500`） | 默认写入 `'draft'` |
| 唯一的状态翻转入口（`WorkflowList.tsx:48-60`） | 列表页开关显式 toggle `active ↔ draft` |
| 服务端守卫（`workflow-runtime.ts:247-249`） | `if (workflowRow.status !== 'active') throw ...` |
| 列表页 Run 按钮（`WorkflowList.tsx:62-80`） | **不检查 status**，直接 `runWorkflow()` |
| 编辑器 Run 按钮（`WorkflowEditor.tsx:513-534`） | 先保存（保持 `status || 'draft'`），**不检查 status**，直接 `runWorkflow()` |
| Agent 工具（`tools.ts:25`） | `WHERE status = 'active'`，chat 触发路径天然规避 |

## 关键代码

```ts
// src/main/workflow/workflow-runtime.ts:236-249
export async function runWorkflow(params: RunWorkflowParams) {
  const { workflowId } = params;
  const workflowRow = getWorkflow(workflowId);
  // 防御性校验：对 Agent 隐藏的 draft 工作流，禁止执行。
  if (workflowRow.status !== 'active') {
    throw new Error(`Workflow ${workflowId} is not active and cannot be executed`);
  }
  ...
}
```

```ts
// src/renderer/src/components/WorkflowEditor/WorkflowList.tsx:62-80
const handleRunWorkflow = async (workflow: Workflow, e: React.MouseEvent) => {
  e.stopPropagation();
  const startNode = workflow.graph_data?.nodes?.find((n) => n.type === 'start');
  const taskGoal = (startNode?.data?.taskGoal as string || '').trim();
  if (!taskGoal) { showToast('请先填写任务目标', 'error'); return; }  // 只校验 taskGoal
  try {
    await runWorkflow(workflow.id, currentProjectId, 'editor', { taskGoal });  // ❌ 无 status 校验
  } catch (err: any) { showToast(err.message, 'error'); }
};
```

## 触发场景

1. **新建即运行**：用户新建工作流（写入 `status='draft'`）→ 在列表页或编辑器内直接点 Run → 守卫拒绝。
2. **禁用后运行**：用户在列表页 toggle 关闭（写入 `'draft'`）→ 再次点 Run → 守卫拒绝。
3. **Editor 路径盲区**：即使在编辑器内保存，保存的是 `workflow.status || 'draft'`（`WorkflowEditor.tsx:500`），编辑器不会主动帮用户翻到 `active`，Run 必失败。
4. **chat 路径安全**：Agent 工具只列举 `active` 工作流，正常 chat 触发走不到这条；除非有缓存了旧 workflowId 的旧会话。

# 因果链

```
新建工作流 (status=draft) → 用户点 Run (无前端校验)
    → ipcRenderer.invoke('workflow:run', id, ...)
    → ipcMain.handle('workflow:run') → runWorkflow()
    → getWorkflow(id).status === 'draft' !== 'active'
    → throw "Workflow {id} is not active and cannot be executed"
    → Electron 包装为 "Error invoking remote method 'workflow:run': Error: ..."
    → renderer toast 显示 raw error.message
```

# 修复方向（按优先级，用户未要求修改代码，仅供后续参考）

| # | 方案 | 位置 | 评估 |
|---|---|---|---|
| A | Run 按钮前置 `if (workflow.status !== 'active')` 拦截 + 引导 toggle | `WorkflowList.tsx:62`、`WorkflowEditor.tsx:513` | **推荐** —— UX 友好，立刻给用户可执行指引 |
| B | 守卫抛错信息补足上下文（"请在列表页启用该工作流后再运行"） | `workflow-runtime.ts:248` | 错误可读性提升；不解决误触 |
| C | 保存时若 start 节点 taskGoal 已填且无错误，自动 promote 到 `active` | `WorkflowEditor.tsx:494-501` | 有副作用（绕开"未启用"的语义），需另议 |
| D | 移除守卫，强制运行；把"启用/禁用"改为仅控制 Agent 可见性 | `workflow-runtime.ts:247` | 语义改动大；与 `tools.ts:25` 的"对 Agent 隐藏"初衷冲突 |

# 证据

- `src/main/database.ts:402-412` — `workflows` 表 DDL，`status TEXT NOT NULL DEFAULT 'draft'`
- `src/shared/types.ts:280` — `status: 'draft' | 'active'`
- `src/renderer/src/App.tsx:87` — 新建工作流硬编码 `status: 'draft'`
- `src/renderer/src/components/WorkflowEditor/WorkflowList.tsx:48-60` — 唯一 toggle 入口
- `src/renderer/src/components/WorkflowEditor/WorkflowList.tsx:62-80` — Run 按钮无 status 校验
- `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:500, 513-534` — 编辑器保存保持 `status || 'draft'`，Run 不校验
- `src/main/workflow/workflow-runtime.ts:236-249, 474` — 守卫与 IPC handler
- `src/main/ipc-handlers.ts:683, 688` — `db:saveWorkflow` 默认 `'draft'`
- `src/main/workflow/tools.ts:25` — Agent 工具 SQL 过滤 `status = 'active'`

# 验证

无修复，故不验证。后续若采纳方案 A，建议同时在 WorkflowEditor 增加 E2E：draft 状态下点 Run 看到引导 toast 而非后端抛错。

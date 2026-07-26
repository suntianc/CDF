/**
 * db.ts — Workflow Run 数据库操作层
 *
 * 所有 workflow_runs / workflow_stage_gates 的 CRUD 集中在此。
 * 事务边界由调用方控制（ipc.ts / llm.ts/ runtime.ts）。
 * 骨架快照、Stage Report 均以 JSON 字符串持久化。
 */

import crypto from 'crypto';
import db from '../database';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunTask,
  WorkflowStage,
  WorkflowStageGate,
  WorkflowStageReport,
  WorkflowTaskStatus,
} from '../../shared/types';
import { normalizeWorkflowStages, selectWorkflowStageRoute } from '../../shared/workflow-routing';

// ---- Row 类型（DB 行 → 应用类型转换） ----

interface RunRow {
  id: string;
  workflow_id: string;
  project_id: string;
  session_id: string;
  master_agent_id: string;
  status: string;
  current_stage_id: string | null;
  current_stage_index: number;
  total_stages: number;
  stages: string;
  skeleton_snapshot: string | null;
  error: string | null;
  started_at: number;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

function toWorkflowRun(row: RunRow): WorkflowRun {
  const stages = normalizeWorkflowStages(JSON.parse(row.stages) as WorkflowStage[]);
  const currentStageId = row.current_stage_id ?? '';
  const currentStageIndex = stages.findIndex((stage) => stage.id === currentStageId);
  return {
    ...row,
    status: row.status as WorkflowRunStatus,
    current_stage_id: currentStageId,
    current_stage_index: currentStageIndex,
  };
}

interface GateRow {
  id: string;
  run_id: string;
  stage_id: string;
  stage_name: string;
  report: string;
  status: string;
  feedback: string | null;
  created_at: number;
  decided_at: number | null;
}

function toWorkflowStageGate(row: GateRow): WorkflowStageGate {
  return {
    ...row,
    report: JSON.parse(row.report) as WorkflowStageReport,
    status: row.status as WorkflowStageGate['status'],
  };
}


// ---- Workflow Runs ----

export function createWorkflowRun(
  workflowId: string,
  projectId: string,
  sessionId: string,
  masterAgentId: string,
  stages: WorkflowStage[],
  skeletonSnapshot: string,
): WorkflowRun {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO workflow_runs
      (id, workflow_id, project_id, session_id, master_agent_id, status, current_stage_id, current_stage_index,
       total_stages, stages, skeleton_snapshot, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, 0, ?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, projectId, sessionId, masterAgentId, stages[0].id, stages.length, JSON.stringify(stages), skeletonSnapshot, now, now, now);

  return {
    id,
    workflow_id: workflowId,
    project_id: projectId,
    session_id: sessionId,
    master_agent_id: masterAgentId,
    status: 'running',
    current_stage_id: stages[0].id,
    current_stage_index: 0,
    total_stages: stages.length,
    stages: JSON.stringify(stages),
    skeleton_snapshot: skeletonSnapshot,
    error: null,
    started_at: now,
    ended_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function getWorkflowRun(runId: string): WorkflowRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as RunRow | undefined;
  return row ? toWorkflowRun(row) : undefined;
}

export function listWorkflowRuns(workflowId: string): WorkflowRun[] {
  const rows = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC').all(workflowId) as RunRow[];
  return rows.map(toWorkflowRun);
}

export function getRunBySessionId(sessionId: string): WorkflowRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE session_id = ?').get(sessionId) as RunRow | undefined;
  return row ? toWorkflowRun(row) : undefined;
}

export function updateRunStatus(runId: string, status: WorkflowRunStatus, error?: string): void {
  const now = Date.now();
  db.prepare(`
    UPDATE workflow_runs SET status = ?, error = ?, updated_at = ?,
      ended_at = CASE WHEN ? IN ('completed','aborted','failed') THEN ? ELSE ended_at END
    WHERE id = ?
  `).run(status, error || null, now, status, now, runId);
  db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = (SELECT session_id FROM workflow_runs WHERE id = ?)')
    .run(status, runId);
}

export function advanceStageCursor(runId: string, routeId?: string): WorkflowRun | undefined {
  const run = getWorkflowRun(runId);
  if (!run) return undefined;
  const stages = normalizeWorkflowStages(JSON.parse(run.stages) as WorkflowStage[]);
  const currentStage = stages.find((stage) => stage.id === run.current_stage_id);
  if (!currentStage) return undefined;
  const route = selectWorkflowStageRoute(currentStage, routeId);
  const nextStageId = route?.targetStageId ?? currentStage.id;
  const nextIndex = stages.findIndex((stage) => stage.id === nextStageId);
  if (route && nextIndex < 0) throw new Error(`Route target Stage not found: ${route.targetStageId}`);
  const now = Date.now();
  const newStatus: WorkflowRunStatus = currentStage.terminal ? 'completed' : 'running';
  const isComplete = newStatus === 'completed' ? 1 : 0;
  db.prepare(`
    UPDATE workflow_runs SET current_stage_id = ?, current_stage_index = ?, status = ?, updated_at = ?,
      ended_at = CASE WHEN ? THEN ? ELSE NULL END
    WHERE id = ?
  `).run(nextStageId, nextIndex, newStatus, now, isComplete, now, runId);
  db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?')
    .run(newStatus, run.session_id);
  return { ...run, current_stage_id: nextStageId, current_stage_index: nextIndex, status: newStatus, updated_at: now };
}

export function abortWorkflowRun(runId: string): void {
  updateRunStatus(runId, 'aborted');
  // Reject any still-pending gates so a late resolve-stage-gate can't revive the
  // aborted run back to 'running' and advance its cursor.
  db.prepare(
    `UPDATE workflow_stage_gates
       SET status = 'rejected', feedback = COALESCE(feedback, '运行已中止'), decided_at = ?
     WHERE run_id = ? AND status = 'pending'`
  ).run(Date.now(), runId);
}

export function getCurrentStage(run: WorkflowRun): WorkflowStage | null {
  let stages: WorkflowStage[];
  try {
    stages = normalizeWorkflowStages(JSON.parse(run.stages as string));
  } catch {
    return null;
  }
  return stages.find((stage) => stage.id === run.current_stage_id) ?? null;
}

// ---- Stage Gates ----

export function createStageGate(
  runId: string,
  stageId: string,
  stageName: string,
  report: WorkflowStageReport,
): WorkflowStageGate {
  const id = crypto.randomUUID();
  const now = Date.now();
  const persistedReport: WorkflowStageReport = {
    ...report,
    tasks: listRunTasks(runId, stageId),
  };
  db.prepare(`
    INSERT INTO workflow_stage_gates (id, run_id, stage_id, stage_name, report, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, runId, stageId, stageName, JSON.stringify(persistedReport), now);
  return { id, run_id: runId, stage_id: stageId, stage_name: stageName, report: persistedReport, status: 'pending', feedback: null, created_at: now, decided_at: null };
}

export function resolveStageGate(
  gateId: string,
  decision: 'approved' | 'rejected' | 'auto_approved',
  feedback?: string | null,
): WorkflowStageGate | undefined {
  const row = db.prepare('SELECT * FROM workflow_stage_gates WHERE id = ?').get(gateId) as GateRow | undefined;
  if (!row) return undefined;
  const now = Date.now();
  const report = JSON.parse(row.report) as WorkflowStageReport;
  if (decision === 'approved' || decision === 'auto_approved') {
    if (report.routeProposal) report.routeSelection = report.routeProposal;
  } else {
    delete report.routeSelection;
  }
  delete report.routeProposal;
  const update = db.prepare(`
    UPDATE workflow_stage_gates SET status = ?, feedback = ?, report = ?, decided_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(decision, feedback ?? null, JSON.stringify(report), now, gateId);
  if (update.changes !== 1) return undefined;
  return { ...toWorkflowStageGate(row), report, status: decision, feedback: feedback ?? null, decided_at: now };
}

export function listStageGates(runId: string, status?: string): WorkflowStageGate[] {
  let sql = 'SELECT * FROM workflow_stage_gates WHERE run_id = ?';
  const params: unknown[] = [runId];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params) as GateRow[];
  return rows.map(toWorkflowStageGate);
}

export function getPendingStageGates(runId: string): WorkflowStageGate[] {
  return listStageGates(runId, 'pending');
}

export function getStageGate(gateId: string): WorkflowStageGate | undefined {
  const row = db.prepare('SELECT * FROM workflow_stage_gates WHERE id = ?').get(gateId) as GateRow | undefined;
  return row ? toWorkflowStageGate(row) : undefined;
}

// =====================================================================
// Workflow Run Tasks — 任务图持久化
// =====================================================================

interface TaskRow {
  id: string;
  run_id: string;
  stage_id: string;
  title: string;
  description: string;
  status: string;
  dependencies: string;
  delegation_batch_id: string | null;
  delegation_worker_id: string | null;
  delegated_run_id: string | null;
  delegation_agent_slug: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function toWorkflowRunTask(row: TaskRow): WorkflowRunTask {
  const { delegation_worker_id: _legacyWorkerId, ...current } = row;
  return {
    ...current,
    status: row.status as WorkflowTaskStatus,
    dependencies: JSON.parse(row.dependencies) as string[],
  };
}

/** 创建 task — 返回新 task */
export function createTask(
  runId: string,
  stageId: string,
  title: string,
  description: string,
  dependencies?: string[],
): WorkflowRunTask {
  const id = crypto.randomUUID();
  const now = Date.now();
  const deps = JSON.stringify(dependencies ?? []);
  db.prepare(`
    INSERT INTO workflow_run_tasks (id, run_id, stage_id, title, description, status, dependencies, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?)
  `).run(id, runId, stageId, title, description, deps, now, now);
  return {
    id, run_id: runId, stage_id: stageId, title, description,
    status: 'planned', dependencies: dependencies ?? [],
    delegation_batch_id: null, delegated_run_id: null, delegation_agent_slug: null,
    created_at: now, updated_at: now, completed_at: null,
  };
}

/** 获取单条 task */
export function getTask(taskId: string): WorkflowRunTask | undefined {
  const row = db.prepare('SELECT * FROM workflow_run_tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  return row ? toWorkflowRunTask(row) : undefined;
}

/** 按 run_id 查询 tasks，可选按 stage_id 过滤；按 created_at 升序 */
export function listRunTasks(runId: string, stageId?: string): WorkflowRunTask[] {
  if (stageId) {
    return (db.prepare(
      'SELECT * FROM workflow_run_tasks WHERE run_id = ? AND stage_id = ? ORDER BY created_at ASC'
    ).all(runId, stageId) as TaskRow[]).map(toWorkflowRunTask);
  }
  return (db.prepare(
    'SELECT * FROM workflow_run_tasks WHERE run_id = ? ORDER BY created_at ASC'
  ).all(runId) as TaskRow[]).map(toWorkflowRunTask);
}

/** 查询某 Stage 未开始的 task（可用于投影） */
export function getPendingTasks(runId: string, stageId: string): WorkflowRunTask[] {
  return (db.prepare(
    'SELECT * FROM workflow_run_tasks WHERE run_id = ? AND stage_id = ? AND status = ? ORDER BY created_at ASC'
  ).all(runId, stageId, 'planned') as TaskRow[]).map(toWorkflowRunTask);
}

/** 更新 task 状态，自动设置时间戳 */
export function updateTaskStatus(taskId: string, status: WorkflowTaskStatus): WorkflowRunTask | undefined {
  const now = Date.now();
  const completedAt = status === 'completed' || status === 'failed' ? now : null;
  db.prepare(`
    UPDATE workflow_run_tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
  `).run(status, now, completedAt, taskId);
  return getTask(taskId);
}

/**
 * 设置 task 的依赖（替换式），自动检测循环依赖。
 * 返回对象：success 或 detectCycle 检测到的环路径。
 */
export function setTaskDependencies(
  taskId: string,
  newDeps: string[],
): { success: true } | { detectCycle: string[] } {
  const task = getTask(taskId);
  if (!task) return { detectCycle: [taskId] };

  // 清空依赖始终合法。
  if (newDeps.length === 0) {
    db.prepare('UPDATE workflow_run_tasks SET dependencies = ?, updated_at = ? WHERE id = ?')
      .run('[]', Date.now(), taskId);
    return { success: true };
  }

  // 验证所有依赖存在且属于同一个 Run、同一个 Stage。
  const dependencies = newDeps.map((depId) => getTask(depId));
  if (dependencies.some((dependency) => (
    !dependency
    || dependency.run_id !== task.run_id
    || dependency.stage_id !== task.stage_id
  ))) {
    return { detectCycle: [`dependency ${JSON.stringify(newDeps)} not in same run and stage`] };
  }

  // 检测自依赖
  if (newDeps.includes(taskId)) {
    return { detectCycle: [taskId, taskId] };
  }

  // BFS 检测环：从每个 newDep 出发，看是否能走回 taskId
  const cyclePath = findCyclicDependency(task.run_id, taskId, newDeps);
  if (cyclePath) return { detectCycle: cyclePath };

  const now = Date.now();
  db.prepare('UPDATE workflow_run_tasks SET dependencies = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(newDeps), now, taskId);
  return { success: true };
}

/**
 * BFS 检测新依赖是否会在 run 的任务图中引入环。
 * 从每个 newDep 出发，沿 dependencies 遍历，看能否走回 taskId。
 * @returns 若检测到环，返回环路径（[taskId, ...steps, taskId]），否则 null
 */
export function findCyclicDependency(
  runId: string,
  taskId: string,
  newDepIds: string[],
): string[] | null {
  // 加载 run 全部 task 的依赖关系
  const allTasks = db.prepare(
    'SELECT id, dependencies FROM workflow_run_tasks WHERE run_id = ?'
  ).all(runId) as Array<{ id: string; dependencies: string }>;
  const depMap = new Map<string, string[]>(
    allTasks.map((t) => [t.id, JSON.parse(t.dependencies) as string[]]),
  );
  // 对于新依赖，若 taskId 尚未持久化，先假想它在 depMap 中
  if (!depMap.has(taskId)) depMap.set(taskId, newDepIds);

  for (const startDep of newDepIds) {
    // BFS
    const visited = new Set<string>();
    const parent = new Map<string, string | null>();
    const queue = [startDep];
    parent.set(startDep, null);
    visited.add(startDep);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) {
        // 重建路径：从 startDep 到 taskId 的环检测
        const path: string[] = [];
        let node: string | null = taskId;
        while (node !== null) {
          path.push(node);
          node = parent.get(node) ?? null;
        }
        // path = [taskId, ..., startDep, null] → reverse → [startDep, ..., taskId]
        return path.reverse();
      }
      const currentDeps = depMap.get(current);
      if (currentDeps) {
        for (const dep of currentDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            parent.set(dep, current);
            queue.push(dep);
          }
        }
      }
    }
  }
  return null;
}

/** 记录 task 的 delegation 关联 */
export function setTaskDelegation(
  taskId: string,
  batchId: string,
  delegatedRunId: string,
  agentSlug: string,
): void {
  const now = Date.now();
  db.prepare(`
    UPDATE workflow_run_tasks
    SET delegation_batch_id = ?, delegated_run_id = ?,
        delegation_agent_slug = ?, updated_at = ?
    WHERE id = ?
  `).run(batchId, delegatedRunId, agentSlug, now, taskId);
}

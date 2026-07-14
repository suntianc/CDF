/**
 * runtime.ts — Workflow Run 运行编排核心
 *
 * 管理 Workflow Run 的生命周期：
 * - startRun：启动新 Run，创建 Conversation session+workflow_runs 记录，冻结完整 stages 骨架快照
 * - handleAdvanceStageInterrupt：处理 deepagents actionRequests.advance_stage 中断
 *   （门禁逻辑——非 apprv 不推进 cursor，cursor 在工具 callback 中推进）
 * - resolveGateFromExternal：外部（IPC）触发门禁解析，桥接到同一个 pending resolution
 *
 * 不依赖内存为权威——所有状态可重启恢复查询。
 * Gate pending 等待使用模块级 map 桥接 LLM 循环与外部 IPC 调用。
 */

import crypto from 'crypto';
import db from '../database';
import { BrowserWindow } from 'electron';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStage,
  WorkflowStageGate,
  WorkflowStageReport,
  StageGateResolution,
  LLMStreamEvent,
} from '../../shared/types';
import {
  createWorkflowRun,
  getWorkflowRun,
  getRunBySessionId,
  listWorkflowRuns,
  advanceStageCursor,
  abortWorkflowRun,
  getCurrentStage,
  createStageGate,
  resolveStageGate,
  getPendingStageGates,
  getStageGate,
  updateRunStatus,
} from './db';
import { pushProjectionEvent } from './notify';
import { normalizeWorkflowStages, selectWorkflowStageRoute, validateWorkflowStages } from '../../shared/workflow-routing';
import { ensureMasterAgent } from '../project-agent-service';

let resumeAgentCallback: ((sessionId: string, projectId: string, decisions: Array<{ type: 'approve' | 'reject'; message?: string }>) => void) | null = null;

export function registerResumeAgentCallback(cb: typeof resumeAgentCallback) {
  resumeAgentCallback = cb;
}

export function resumeWorkflowRunFromInput(sessionId: string): WorkflowRun | undefined {
  const run = getRunBySessionId(sessionId);
  if (!run || run.status !== 'waiting_input') return run;
  updateRunStatus(run.id, 'running');
  const resumed = getWorkflowRun(run.id);
  if (resumed) {
    pushProjectionEvent({ type: 'run', runId: resumed.id, status: 'running', currentStageId: resumed.current_stage_id, currentStageIndex: resumed.current_stage_index, error: null });
  }
  return resumed;
}
// =============================================================================
// 开始运行
// =============================================================================

export interface StartRunResult {
  run: WorkflowRun;
  sessionId: string;
  firstStage: WorkflowStage;
}

/**
 * 启动一个 Workflow Run：
 * 1. 从 workflows 表读取 stages
 * 2. 解析 Project 受保护的 Master Agent 并创建标记了 workflow_run_id 的 Conversation session
 * 3. 创建 workflow_runs 记录（含完整 stages 的骨架快照）
 * 4. 返回 session/run 及首阶段信息
 */
export function startRun(workflowId: string, projectId: string): StartRunResult {
  const wfRow = db.prepare('SELECT id, project_id, name, stages FROM workflows WHERE id = ?').get(workflowId) as
    { id: string; project_id: string; name: string; stages: string } | undefined;
  if (!wfRow) throw new Error(`Workflow not found: ${workflowId}`);
  if (wfRow.project_id !== projectId) throw new Error('Workflow does not belong to this project');

  const stages = normalizeWorkflowStages(JSON.parse(wfRow.stages) as WorkflowStage[]);
  if (!stages.length) throw new Error('Workflow has no stages defined');
  const routeErrors = validateWorkflowStages(stages);
  if (routeErrors.length > 0) throw new Error(`Invalid Workflow Stage routes: ${routeErrors.join('; ')}`);

  const master = ensureMasterAgent(db, projectId);
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, project_id, name, agent_id, prompt_snapshot, workflow_run_id, workflow_run_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, projectId, `工作流: ${wfRow.name}`, master.id, master.system_prompt ?? '', null, 'running', now, now);

  // 骨架快照包含完整 stages（后续编辑 workflow 不影响已冻结的 run）
  const skeletonSnapshot = JSON.stringify({
    workflowId,
    workflowName: wfRow.name,
    stages: JSON.parse(JSON.stringify(stages)),
    startedAt: now,
  });

  const run = createWorkflowRun(workflowId, projectId, sessionId, stages, skeletonSnapshot);

  db.prepare('UPDATE sessions SET workflow_run_id = ?, workflow_run_status = ? WHERE id = ?')
    .run(run.id, run.status, sessionId);
  pushProjectionEvent({
    type: 'snapshot',
    run,
    gates: [],
    tasks: [],
  });

  return { run, sessionId, firstStage: stages[0] };
}

// =============================================================================
// Gate 等待 map：桥接 LLM 异步等待与外部 IPC 调用
// =============================================================================

const pendingGateResolutions = new Map<string, (resolution: StageGateResolution) => void>();

export function waitForGateApproval(gateId: string, signal?: AbortSignal): Promise<StageGateResolution> {
  return new Promise<StageGateResolution>((resolve, reject) => {
    const onAbort = () => {
      pendingGateResolutions.delete(gateId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    pendingGateResolutions.set(gateId, (resolution) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(resolution);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveGatePromise(gateId: string, resolution: StageGateResolution): void {
  const resolve = pendingGateResolutions.get(gateId);
  if (resolve) {
    pendingGateResolutions.delete(gateId);
    resolve(resolution);
  }
}

// =============================================================================
// 处理 advance_stage 中断（LLM 循环调用，async）
// =============================================================================

/**
 * 处理 advance_stage 中断的完整 async 逻辑。
 * 由 llm.ts 在检测到 deepagents actionRequests 中断后调用。
 *
 * - gateEnabled=false：自动批准，以 approve decision resume（工具 callback 推进 cursor）
 * - gateEnabled=true：等待外部审批，返回 approve/reject decision（cursor 由工具 callback 推进）
 * - AbortSignal 中止：清理 waiter，收敛 workflow_runs/sessions/gate 为 aborted/rejected
 * - 重复 reject 可重试 / terminate 结束 run
 *
 * @param runId - 运行 ID
 * @param report - 阶段验收报告
 * @param sender - 可选的事件发送器（用于发送 approval_required）
 * @param channel - 事件通道名
 * @param signal - 可选的 AbortSignal（用于取消等待审批）
 */
export type AdvanceStageInterruptResult =
  | { resume: { decisions: Array<{ type: 'approve' | 'reject'; message?: string }> }; terminate?: false }
  | { terminate: true; resume?: never };

export async function handleAdvanceStageInterrupt(
  runId: string,
  report: WorkflowStageReport,
  sender?: { send: (channel: string, payload: unknown) => void },
  channel?: string,
  signal?: AbortSignal,
  selection?: { routeId?: string; rationale?: string },
): Promise<AdvanceStageInterruptResult> {
  const run = getWorkflowRun(runId);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);

  const stages = normalizeWorkflowStages(JSON.parse(run.stages as string) as WorkflowStage[]);
  const stage = getCurrentStage(run);
  if (!stage) throw new Error(`Current Stage ${run.current_stage_id} not found in run ${runId}`);
  const stageIndex = stages.findIndex((candidate) => candidate.id === stage.id);
  const selectedRoute = selectWorkflowStageRoute(stage, selection?.routeId);
  if ((stage.routes?.length ?? 0) > 1 && !selection?.rationale?.trim()) {
    throw new Error(`Stage ${stage.name} requires a route rationale`);
  }
  const persistedReport: WorkflowStageReport = selectedRoute
    ? {
        ...report,
        routeProposal: {
          routeId: selectedRoute.id,
          targetStageId: selectedRoute.targetStageId,
          rationale: selection?.rationale?.trim() ?? '',
        },
      }
    : report;
  const gate = createStageGate(runId, stage.id, stage.name, persistedReport);
  pushProjectionEvent({ type: 'stage_gate', gate });
  if (stage.gateEnabled) {
    pushProjectionEvent({ type: 'run', runId, status: 'waiting_gate', currentStageId: stage.id, currentStageIndex: stageIndex, error: null });
  }

  if (!stage.gateEnabled) {
    // gateEnabled=false：自动批准，resume 以 approve decision
    // 工具 callback 将在 resume 后执行并推进 cursor
    const approvedGate = resolveStageGate(gate.id, 'auto_approved');
    if (approvedGate) pushProjectionEvent({ type: 'stage_gate', gate: approvedGate });
    return { resume: { decisions: [{ type: 'approve' as const }] } };
  }

  // gateEnabled=true：等待外部审批
  updateRunStatus(runId, 'waiting_gate');
  db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('waiting_gate', run.session_id);

  // 发送 approval_required 事件供 Conversation 时间线使用
  if (sender && channel) {
    sender.send(channel, {
      type: 'approval_required',
      approval: {
        id: gate.id,
        runId: run.id,
        actions: [{
          name: 'advance_stage',
          args: { report: persistedReport, routeId: selectedRoute?.id, rationale: selection?.rationale?.trim() },
          description: `阶段 "${stage.name}" 完成，等待审批`,
          allowedDecisions: ['approve', 'reject'],
        }],
      },
    } satisfies LLMStreamEvent);
  }

  let resolution: StageGateResolution;
  try {
    resolution = await waitForGateApproval(gate.id, signal);
  } catch (err: unknown) {
    // AbortSignal 中止：清理 waiter，收敛状态
    if (err instanceof Error && (err.name === 'AbortError' || signal?.aborted)) {
      abortWorkflowRun(runId);
      resolveStageGate(gate.id, 'rejected', '已中止');
      pushProjectionEvent({ type: 'run', runId, status: 'aborted', currentStageId: stage.id, currentStageIndex: stageIndex, error: '已中止' });
      return { terminate: true };
    }
    throw err;
  }

  if (resolution.decision === 'terminate') {
    abortWorkflowRun(runId);
    resolveStageGate(gate.id, 'rejected', resolution.feedback || '已终止');
    pushProjectionEvent({ type: 'run', runId, status: 'aborted', currentStageId: stage.id, currentStageIndex: stageIndex, error: '已终止' });
    return { terminate: true };
  }

  if (resolution.decision === 'reject') {
    // 打回：reject decision，cursor 不变，agent 可重新提交
    const rejectedGate = resolveStageGate(gate.id, 'rejected', resolution.feedback || null);
    updateRunStatus(runId, 'running');
    db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('running', run.session_id);
    if (rejectedGate) pushProjectionEvent({ type: 'stage_gate', gate: rejectedGate });
    pushProjectionEvent({ type: 'run', runId, status: 'running', currentStageId: stage.id, currentStageIndex: stageIndex, error: null });
    return {
      resume: {
        decisions: [{
          type: 'reject' as const,
          message: resolution.feedback || '未通过审批，请按反馈完善当前阶段后重新提交。',
        }],
      },
    };
  }

  // approve：resume 以 approve decision，工具 callback 执行并推进 cursor
  const approvedGate = resolveStageGate(gate.id, 'approved', resolution.feedback || null);
  updateRunStatus(runId, 'running');
  db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('running', run.session_id);
  if (approvedGate) pushProjectionEvent({ type: 'stage_gate', gate: approvedGate });
  pushProjectionEvent({ type: 'run', runId, status: 'running', currentStageId: stage.id, currentStageIndex: stageIndex, error: null });
  return { resume: { decisions: [{ type: 'approve' as const }] } };
}

// =============================================================================
// 外部触发门禁解析（IPC handler 调用）
// =============================================================================

/**
 * 外部（IPC workflow-run:resolve-stage-gate）触发门禁解析。
 * 同时解析 DB 记录与 pending 的 LLM wait。
 * 专用 API 必须桥接到同一个 pending resolution，不产生两个独立审批事实源。
 */
export function resolveGateFromExternal(gateId: string, resolution: StageGateResolution): void {
  const gate = getStageGate(gateId);
  if (!gate) throw new Error(`Stage gate not found: ${gateId}`);
  if (gate.status !== 'pending') throw new Error(`Stage gate ${gateId} already resolved`);

  const claimedGate = resolveStageGate(
    gate.id,
    resolution.decision === 'approve' ? 'approved' : 'rejected',
    resolution.feedback || (resolution.decision === 'terminate' ? '已终止' : null),
  );
  if (!claimedGate) throw new Error(`Stage gate ${gateId} already resolved`);
  pushProjectionEvent({ type: 'stage_gate', gate: claimedGate });

  if (pendingGateResolutions.has(gateId)) {
    // Gate decision is durably claimed before resuming the in-memory waiter.
    resolveGatePromise(gateId, resolution);
  } else {
    // 内存 waiter 不在，说明是重启/重载后的 resume
    const run = getWorkflowRun(gate.run_id);
    if (!run) throw new Error(`Workflow run not found: ${gate.run_id}`);

    if (resolution.decision === 'terminate') {
      abortWorkflowRun(run.id);
      db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('aborted', run.session_id);
      pushProjectionEvent({ type: 'run', runId: run.id, status: 'aborted', currentStageId: run.current_stage_id, currentStageIndex: run.current_stage_index, error: '已终止' });
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('conversation:messages-changed', { sessionId: run.session_id });
      }
    } else if (resolution.decision === 'reject') {
      updateRunStatus(run.id, 'running');
      db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('running', run.session_id);
      pushProjectionEvent({ type: 'run', runId: run.id, status: 'running', currentStageId: run.current_stage_id, currentStageIndex: run.current_stage_index, error: null });
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('conversation:messages-changed', { sessionId: run.session_id });
      }
      if (resumeAgentCallback) {
        resumeAgentCallback(run.session_id, run.project_id, [{
          type: 'reject',
          message: resolution.feedback || '未通过审批，请按反馈完善当前阶段后重新提交。',
        }]);
      }
    } else {
      updateRunStatus(run.id, 'running');
      db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('running', run.session_id);
      pushProjectionEvent({ type: 'run', runId: run.id, status: 'running', currentStageId: run.current_stage_id, currentStageIndex: run.current_stage_index, error: null });
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('conversation:messages-changed', { sessionId: run.session_id });
      }
      if (resumeAgentCallback) {
        resumeAgentCallback(run.session_id, run.project_id, [{ type: 'approve' }]);
      }
    }
}
}

// =============================================================================
// 查询 / 中止
// =============================================================================

export { getWorkflowRun, getRunBySessionId, listWorkflowRuns, getPendingStageGates, getStageGate, abortWorkflowRun };

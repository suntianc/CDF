/**
 * ipc.ts — Workflow Run IPC 处理器
 *
 * 注册 workflow-run:* IPC handler，由 ipc-handlers.ts 调用 registerWorkflowRunIpcHandlers()。
 */

import { typedHandle } from '../typed-ipc';
import db from '../database';
import type { StageGateResolution } from '../../shared/types';
import { listRunTasks, listStageGates } from './db';
import {
  startRun,
  getWorkflowRun,
  listWorkflowRuns,
  abortWorkflowRun,
  resolveGateFromExternal,
  getRunBySessionId,
} from './runtime';

export function registerWorkflowRunIpcHandlers(): void {
  typedHandle('workflow-run:start', (_event, workflowId, projectId) => {
    const result = startRun(workflowId, projectId);
    return { runId: result.run.id, sessionId: result.sessionId, firstStage: result.firstStage };
  });

  typedHandle('workflow-run:get-runs', (_event, workflowId) => {
    return listWorkflowRuns(workflowId);
  });

  typedHandle('workflow-run:get-run', (_event, runId) => {
    return getWorkflowRun(runId);
  });

  typedHandle('workflow-run:get-stage-gates', (_event, runId) => {
    return listStageGates(runId);
  });

  typedHandle('workflow-run:resolve-stage-gate', (_event, gateId, resolution) => {
    resolveGateFromExternal(gateId, resolution);
  });

  typedHandle('workflow-run:abort', (_event, runId) => {
    abortWorkflowRun(runId);
    const run = getWorkflowRun(runId);
    if (run?.session_id) {
      db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('aborted', run.session_id);
    }
  });

  typedHandle('workflow-run:get-run-by-session', (_event, sessionId) => {
    return getRunBySessionId(sessionId) ?? null;
  });
  typedHandle('workflow-run:get-tasks', (_event, runId, stageId) => {
    return listRunTasks(runId, stageId);
  });
}

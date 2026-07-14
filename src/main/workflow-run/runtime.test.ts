/**
 * runtime.test.ts — Workflow Run 运行编排核心测试
 *
 * 使用真实 SQLite（临时目录）验证：
 * - startRun：读取 stages/master_agent_id，创建 session + run，冻结完整 stages 骨架快照
 * - isAdvanceStageInterrupt：检测 deepagents 标准 actionRequests 格式
 * - gateEnabled=false 自动批准，返回 approve decision（非 cursor 推进）
 * - gateEnabled=true 等待审批，返回 approve/reject decision（cursor 由工具 callback 推进）
 * - 重复 reject / terminate
 * - 工具 callback（createAdvanceStageTool）权威推进 cursor
 * - 重启恢复查询（pending gates / run status）
 * - Session workflow_run_id/status 标记
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP_DIR = vi.hoisted(() => {
  const osSync = require('node:os') as typeof import('node:os');
  const fsSync = require('node:fs') as typeof import('node:fs');
  const dir = `${osSync.tmpdir()}/cdf-wf-run-int-${process.pid}-${Date.now()}`;
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
});

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR },
  ipcMain: { handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

import db from '../database';
import {
  startRun,
  getWorkflowRun,
  listWorkflowRuns,
  getPendingStageGates,
  handleAdvanceStageInterrupt,
  getRunBySessionId,
  resolveGateFromExternal,
  resumeWorkflowRunFromInput,
} from './runtime';
import { createAdvanceStageTool, createStageRouteBlockerTool, createTaskGraphTools, isAdvanceStageInterrupt } from './tools';
import { createTask, getPendingTasks, getStageGate, getTask, listRunTasks, setTaskDependencies, updateTaskStatus, listStageGates, createStageGate, resolveStageGate } from './db';
import type { WorkflowStageReport, WorkflowRun } from '../../shared/types';

const PROJECT_ID = 'test-project-1';

const TABLES_IN_DELETE_ORDER = [
  'workflow_run_tasks',
  'workflow_stage_gates',
  'workflow_runs',
  'workflows',
  'sessions',
  'agent_skills',
  'agent_mcp_exclusions',
  'agents',
  'messages',
  'llm_providers',
  'projects',
];

let lastMasterAgentId: string;
let lastWorkflowId: string;

interface SessionRow {
  id: string;
  project_id: string;
  name: string;
  agent_id: string | null;
  workflow_run_id: string | null;
  workflow_run_status: string | null;
  created_at: number;
  updated_at: number;
}

interface StageGateRow {
  id: string;
  run_id: string;
  stage_id: string;
  status: string;
  feedback: string | null;
  decided_at: number | null;
}

function seedData(): void {
  for (const t of TABLES_IN_DELETE_ORDER) {
    db.exec(`DELETE FROM ${t}`);
  }

  const now = Date.now();
  db.prepare('INSERT INTO projects (id, name, path, scene, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(PROJECT_ID, 'Test', TMP_DIR, 'general', now, now);

  const providerId = crypto.randomUUID();
  db.prepare('INSERT INTO llm_providers (id, name, provider_type, api_url, default_model, context_limit, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(providerId, 'Test OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4o', 8192, now, now);

  const masterAgentId = crypto.randomUUID();
  db.prepare('INSERT INTO agents (id, project_id, name, provider_id, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(masterAgentId, PROJECT_ID, 'Master Agent', providerId, now, now);
  lastMasterAgentId = masterAgentId;

  // 创建一个两阶段 workflow
  const stages = [
    { id: 'stage-1', name: '需求分析', taskDescription: '分析需求文档', acceptanceCriteria: '需求清晰', gateEnabled: true },
    { id: 'stage-2', name: '方案设计', taskDescription: '设计技术方案', acceptanceCriteria: '方案完整', gateEnabled: false },
  ];
  const stagesJson = JSON.stringify(stages);
  const wfId = crypto.randomUUID();
  db.prepare('INSERT INTO workflows (id, project_id, name, stages, master_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(wfId, PROJECT_ID, '测试工作流', stagesJson, masterAgentId, 'active', now, now);
  lastWorkflowId = wfId;
}

beforeEach(() => {
  seedData();
});

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// =============================================================================
// 1. startRun — 基本流程
// =============================================================================

describe('startRun', () => {
  it('creates a workflow run with session and returns first stage', () => {
    const { run, sessionId, firstStage } = startRun(lastWorkflowId, PROJECT_ID);

    expect(run.workflow_id).toBe(lastWorkflowId);
    expect(run.project_id).toBe(PROJECT_ID);
    expect(run.status).toBe('running');
    expect(run.current_stage_id).toBe('stage-1');
    expect(run.current_stage_index).toBe(0);
    expect(run.total_stages).toBe(2);
    expect(run.master_agent_id).toBe(lastMasterAgentId);
    expect(firstStage.id).toBe('stage-1');
    expect(firstStage.name).toBe('需求分析');

    // 验证 session 创建
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    expect(session).toBeTruthy();
    expect(session!.workflow_run_id).toBe(run.id);
    expect(session!.workflow_run_status).toBe('running');
    expect(session!.project_id).toBe(PROJECT_ID);
  });

  it('freezes full stages skeleton snapshot', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const snapshot = JSON.parse(run.skeleton_snapshot!);
    expect(snapshot.workflowId).toBe(lastWorkflowId);
    expect(snapshot.workflowName).toBe('测试工作流');
    expect(snapshot.stages).toHaveLength(2);
    // 完整 stages 字段
    expect(snapshot.stages[0].id).toBe('stage-1');
    expect(snapshot.stages[0].name).toBe('需求分析');
    expect(snapshot.stages[0].taskDescription).toBe('分析需求文档');
    expect(snapshot.stages[0].acceptanceCriteria).toBe('需求清晰');
    expect(snapshot.stages[0].gateEnabled).toBe(true);
    expect(snapshot.stages[0]).toMatchObject({
      terminal: false,
      routes: [{ id: 'route:stage-1:stage-2', targetStageId: 'stage-2', condition: '' }],
    });
    expect(snapshot.stages[1].id).toBe('stage-2');
    expect(snapshot.stages[1].name).toBe('方案设计');
    expect(snapshot.stages[1].taskDescription).toBe('设计技术方案');
    expect(snapshot.stages[1].acceptanceCriteria).toBe('方案完整');
    expect(snapshot.stages[1].gateEnabled).toBe(false);
    expect(snapshot.stages[1]).toMatchObject({ terminal: true, routes: [] });
    expect(snapshot.agentId).toBe(lastMasterAgentId);
  });

  it('skeleton snapshot is frozen (independent from workflow edit)', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const snapshot = JSON.parse(run.skeleton_snapshot!);
    // 修改 DB 中的 workflow，验证 snapshot 不受影响
    const modifiedStages = JSON.stringify([{ id: 'stage-modified', name: 'Modified' }]);
    db.prepare('UPDATE workflows SET stages = ?, master_agent_id = ? WHERE id = ?').run(modifiedStages, 'other', lastWorkflowId);
    // Re-read run from DB — snapshot should still be original
    const reloaded = getWorkflowRun(run.id)!;
    const reloadedSnapshot = JSON.parse(reloaded.skeleton_snapshot!);
    expect(reloadedSnapshot.workflowName).toBe('测试工作流');
    expect(reloadedSnapshot.stages).toHaveLength(2);
    expect(reloadedSnapshot.stages[0].name).toBe('需求分析');
  });

  it('throws for non-existent workflow', () => {
    expect(() => startRun('no-such-wf', PROJECT_ID)).toThrow('Workflow not found');
  });

  it('throws for workflow without stages', () => {
    const wfId = crypto.randomUUID();
    db.prepare('INSERT INTO workflows (id, project_id, name, stages, master_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(wfId, PROJECT_ID, 'Empty', '[]', lastMasterAgentId, 'active', Date.now(), Date.now());
  });

  it('throws for workflow without master_agent_id', () => {
    const noAgentStages = JSON.stringify([{ id: 's1', name: 'S1', taskDescription: '', acceptanceCriteria: '', gateEnabled: false }]);
    const wfId = crypto.randomUUID();
    db.prepare('INSERT INTO workflows (id, project_id, name, stages, master_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(wfId, PROJECT_ID, 'No Agent', noAgentStages, '', 'active', Date.now(), Date.now());
  });
});

// =============================================================================
// 1b. isAdvanceStageInterrupt — deepagents 标准 actionRequests 格式
// =============================================================================

describe('isAdvanceStageInterrupt', () => {
  it('detects advance_stage from deepagents actionRequests format', () => {
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: 'done',
    };
    const interruptValue = {
      actionRequests: [{ name: 'advance_stage', args: { report } }],
      reviewConfigs: [{ allowedDecisions: ['approve', 'reject'], description: 'test' }],
    };
    const result = isAdvanceStageInterrupt(interruptValue);
    expect(result).not.toBeNull();
    expect(result && 'report' in result ? result.report.summary : null).toBe('done');
    expect(result && 'report' in result ? result.report.acceptanceSelfCheck : []).toHaveLength(1);
  });

  it('returns null for non-advance_stage action', () => {
    const interruptValue = {
      actionRequests: [{ name: 'bash', args: { command: 'ls' } }],
    };
    expect(isAdvanceStageInterrupt(interruptValue)).toBeNull();
  });

  it('rejects multiple actionRequests with advance_stage as non-first action', () => {
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: 'done',
    };
    const interruptValue = {
      actionRequests: [
        { name: 'bash', args: { command: 'ls' } },
        { name: 'advance_stage', args: { report } },
      ],
      reviewConfigs: [{ allowedDecisions: ['approve', 'reject'], description: 'test' }],
    };
    // 任意位置出现 advance_stage 且同时有其他 action 时都必须拒绝，不能落入通用审批。
    expect(isAdvanceStageInterrupt(interruptValue)).toEqual({
      error: 'multiple_actions: advance_stage must be the only action in the interrupt',
    });
  });

  it('rejects multiple actionRequests with advance_stage as first action', () => {
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: 'done',
    };
    const interruptValue = {
      actionRequests: [
        { name: 'advance_stage', args: { report } },
        { name: 'read_file', args: { file_path: '/etc/hosts' } },
      ],
    };
    const result = isAdvanceStageInterrupt(interruptValue);
    // advance_stage 与其他 action 混用时返回 error，不允许绕过门禁
    expect(result).not.toBeNull();
    if (result && 'error' in result) {
      expect((result as { error: string }).error).toContain('multiple');
    }
  });

  it('accepts single advance_stage action alone', () => {
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: 'done',
    };
    const interruptValue = {
      actionRequests: [{ name: 'advance_stage', args: { report } }],
    };
    const result = isAdvanceStageInterrupt(interruptValue);
    expect(result).not.toBeNull();
    if (result && 'report' in result) {
      expect(result.report.summary).toBe('done');
    }
  });

  it('returns null for non-actionRequests format', () => {
    expect(isAdvanceStageInterrupt(null)).toBeNull();
    expect(isAdvanceStageInterrupt(undefined)).toBeNull();
    expect(isAdvanceStageInterrupt({ type: '__workflow_advance_stage__' })).toBeNull();
    expect(isAdvanceStageInterrupt(42)).toBeNull();
  });
});

// =============================================================================
// 2-4. handleAdvanceStageInterrupt — 门禁逻辑（不推进 cursor）
// =============================================================================

describe('handleAdvanceStageInterrupt', () => {
  it('auto-approves when gateEnabled=false and returns approve decision', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    // 推进到 stage 1 (gateEnabled=false) by directly updating the persisted Stage identity.
    db.prepare('UPDATE workflow_runs SET current_stage_id = ?, current_stage_index = 1 WHERE id = ?').run('stage-2', run.id);

    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '方案完整', passed: true, notes: '已通过' }],
      artifacts: [{ path: 'docs/design.md', description: '设计文档' }],
      summary: '方案设计完成',
    };

    const result = await handleAdvanceStageInterrupt(run.id, report);
    // Returns approve decision (cursor advanced by tool callback, not here)
    expect(result.resume).toEqual({ decisions: [{ type: 'approve' }] });

    // DB: gate recorded as auto_approved
    const allGates = db.prepare('SELECT * FROM workflow_stage_gates WHERE run_id = ?').all(run.id) as StageGateRow[];
    expect(allGates).toHaveLength(1);
    expect(allGates[0].status).toBe('auto_approved');

    // Cursor NOT advanced by interrupt handler
    const unchanged = getWorkflowRun(run.id)!;
    expect(unchanged.current_stage_index).toBe(1);
  });

  it('records and traverses an approval-off route, then auto-completes the explicit terminal', async () => {
    const stages = [
      {
        id: 'a', name: 'A', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: false,
        routes: [{ id: 'to-b', targetStageId: 'b', condition: '' }],
      },
      { id: 'b', name: 'B', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    db.prepare('UPDATE workflows SET stages = ? WHERE id = ?').run(JSON.stringify(stages), lastWorkflowId);
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const report = { acceptanceSelfCheck: [], artifacts: [], summary: 'done' };

    await handleAdvanceStageInterrupt(run.id, report, undefined, undefined, undefined, { routeId: 'to-b' });
    expect(getPendingStageGates(run.id)).toEqual([]);
    expect(listStageGates(run.id)[0]).toMatchObject({
      status: 'auto_approved',
      report: { routeSelection: { routeId: 'to-b', targetStageId: 'b' } },
    });
    const tool = createAdvanceStageTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });
    await tool.invoke({ report, routeId: 'to-b' });
    expect(getWorkflowRun(run.id)).toMatchObject({ current_stage_index: 1, status: 'running' });

    await handleAdvanceStageInterrupt(run.id, report);
    await tool.invoke({ report });
    expect(getWorkflowRun(run.id)?.status).toBe('completed');
  });

  it('creates pending gate when gateEnabled=true and waits for resolution', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: '已确认' }],
      artifacts: [{ path: 'docs/requirements.md', description: '需求文档' }],
      summary: '需求分析完成',
    };

    // 并发启动 handleAdvanceStageInterrupt（会等待 gate 解析）
    const promise = handleAdvanceStageInterrupt(run.id, report);

    // 等待微任务让 pending gate 持久化
    await new Promise(r => setTimeout(r, 0));

    // 验证 gate 已持久化 pending
    const gates = getPendingStageGates(run.id);
    expect(gates).toHaveLength(1);
    expect(gates[0].stage_id).toBe('stage-1');
    expect(gates[0].status).toBe('pending');

    const runStatus = getWorkflowRun(run.id)!;
    expect(runStatus.status).toBe('waiting_gate');

    // 模拟外部批准
    resolveGateFromExternal(gates[0].id, { decision: 'approve' });

    const result = await promise;
    // Returns approve decision (cursor advanced by tool callback, not here)
    expect(result.resume).toEqual({ decisions: [{ type: 'approve' }] });

    // Cursor NOT advanced by interrupt handler
    const unchanged = getWorkflowRun(run.id)!;
    expect(unchanged.current_stage_index).toBe(0);
  });

  it('persists the selected authored route and rationale in the Stage Gate report', async () => {
    const routedStages = [
      {
        id: 'a', name: 'A', taskDescription: 'choose', acceptanceCriteria: '', gateEnabled: true, terminal: false,
        routes: [
          { id: 'route-b', targetStageId: 'b', condition: 'Use B' },
          { id: 'route-c', targetStageId: 'c', condition: 'Use C' },
        ],
      },
      { id: 'b', name: 'B', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
      { id: 'c', name: 'C', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    db.prepare('UPDATE workflows SET stages = ? WHERE id = ?').run(JSON.stringify(routedStages), lastWorkflowId);
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const promise = handleAdvanceStageInterrupt(
      run.id,
      { acceptanceSelfCheck: [], artifacts: [], summary: 'choose C' },
      undefined,
      undefined,
      undefined,
      { routeId: 'route-c', rationale: 'C matches the report' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [gate] = getPendingStageGates(run.id);

    expect(gate.report.routeProposal).toEqual({
      routeId: 'route-c',
      targetStageId: 'c',
      rationale: 'C matches the report',
    });
    resolveGateFromExternal(gate.id, { decision: 'approve' });
    await promise;
    expect(getStageGate(gate.id)?.report.routeSelection).toEqual({
      routeId: 'route-c',
      targetStageId: 'c',
      rationale: 'C matches the report',
    });
  });

  it('rejects a route not owned by the current Stage', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    await expect(handleAdvanceStageInterrupt(
      run.id,
      { acceptanceSelfCheck: [], artifacts: [], summary: 'bad route' },
      undefined,
      undefined,
      undefined,
      { routeId: 'foreign-route', rationale: 'invalid' },
    )).rejects.toThrow('Unknown route');
    expect(getPendingStageGates(run.id)).toEqual([]);
  });

  it('reject saves feedback and stays on same stage', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: false, notes: '需求不完整' }],
      artifacts: [],
      summary: '需求分析不完整',
    };

    const promise = handleAdvanceStageInterrupt(run.id, report);
    await new Promise(r => setTimeout(r, 0));

    const gates = getPendingStageGates(run.id);
    resolveGateFromExternal(gates[0].id, { decision: 'reject', feedback: '请补充需求细节' });

    const result = await promise;
    expect(result.resume).toEqual({
      decisions: [{ type: 'reject', message: '请补充需求细节' }],
    });

    // cursor 未推进
    const unchanged = getWorkflowRun(run.id)!;
    expect(unchanged.current_stage_index).toBe(0);
    expect(unchanged.status).toBe('running');
  });

  it('claims a pending Stage Gate once when duplicate decisions arrive together', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const pending = handleAdvanceStageInterrupt(run.id, {
      acceptanceSelfCheck: [], artifacts: [], summary: 'ready',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const gate = getPendingStageGates(run.id)[0];

    resolveGateFromExternal(gate.id, { decision: 'approve' });
    expect(() => resolveGateFromExternal(gate.id, { decision: 'approve' })).toThrow('already resolved');
    await expect(pending).resolves.toEqual({ resume: { decisions: [{ type: 'approve' }] } });
    expect(getStageGate(gate.id)?.status).toBe('approved');
  });

  it('supports rejection, rework, and a later accepted route without selecting the rejected proposal', async () => {
    const routedStages = [
      {
        id: 'a', name: 'A', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false,
        routes: [
          { id: 'route-b', targetStageId: 'b', condition: 'B' },
          { id: 'route-c', targetStageId: 'c', condition: 'C' },
        ],
      },
      { id: 'b', name: 'B', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
      { id: 'c', name: 'C', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    db.prepare('UPDATE workflows SET stages = ? WHERE id = ?').run(JSON.stringify(routedStages), lastWorkflowId);
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const report = { acceptanceSelfCheck: [], artifacts: [], summary: 'report' };
    const rejected = handleAdvanceStageInterrupt(run.id, report, undefined, undefined, undefined, {
      routeId: 'route-b', rationale: 'first choice',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstGate = getPendingStageGates(run.id)[0];
    resolveGateFromExternal(firstGate.id, { decision: 'reject', feedback: 'rework' });
    await rejected;
    expect(getStageGate(firstGate.id)?.report.routeSelection).toBeUndefined();
    expect(getWorkflowRun(run.id)?.current_stage_index).toBe(0);

    const accepted = handleAdvanceStageInterrupt(run.id, report, undefined, undefined, undefined, {
      routeId: 'route-c', rationale: 'reworked choice',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondGate = getPendingStageGates(run.id)[0];
    resolveGateFromExternal(secondGate.id, { decision: 'approve' });
    await accepted;
    expect(getStageGate(secondGate.id)?.report.routeSelection?.routeId).toBe('route-c');

    const tool = createAdvanceStageTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });
    await tool.invoke({ report, routeId: 'route-c', rationale: 'reworked choice' });
    expect(getWorkflowRun(run.id)?.current_stage_index).toBe(2);
  });

  it('repeated reject allows retry', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    const report1: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: false, notes: '需求不完整' }],
      artifacts: [],
      summary: '第一次提交',
    };

    // 第一次：reject
    const p1 = handleAdvanceStageInterrupt(run.id, report1);
    await new Promise(r => setTimeout(r, 0));
    const g1 = getPendingStageGates(run.id);
    resolveGateFromExternal(g1[0].id, { decision: 'reject', feedback: '请补充' });
    const r1 = await p1;
    expect(r1.resume).toEqual({
      decisions: [{ type: 'reject', message: '请补充' }],
    });
    expect(getWorkflowRun(run.id)!.current_stage_index).toBe(0);

    // 第二次：approve
    const report2: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: '已补充完整' }],
      artifacts: [{ path: 'docs/requirements.md', description: '需求 v2' }],
      summary: '第二次提交',
    };

    const p2 = handleAdvanceStageInterrupt(run.id, report2);
    await new Promise(r => setTimeout(r, 0));
    const g2 = getPendingStageGates(run.id);
    resolveGateFromExternal(g2[0].id, { decision: 'approve' });
    const r2 = await p2;
    expect(r2.resume).toEqual({ decisions: [{ type: 'approve' }] });
    expect(getWorkflowRun(run.id)!.current_stage_index).toBe(0);
  });

  it('terminate aborts the run', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: '提交',
    };

    const promise = handleAdvanceStageInterrupt(run.id, report);
    await new Promise(r => setTimeout(r, 0));

    const gates = getPendingStageGates(run.id);
    resolveGateFromExternal(gates[0].id, { decision: 'terminate', feedback: '取消' });

    const result = await promise;
    expect(result).toEqual({ terminate: true });

    const aborted = getWorkflowRun(run.id)!;
    expect(aborted.status).toBe('aborted');
  });

  it('abort signal during gate wait terminates run and cleans up gate', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: '提交',
    };

    const controller = new AbortController();
    const promise = handleAdvanceStageInterrupt(run.id, report, undefined, undefined, controller.signal);

    // Gate 在 await waitForGateApproval 之前已经同步创建
    const gates = getPendingStageGates(run.id);
    expect(gates).toHaveLength(1);
    expect(gates[0].status).toBe('pending');
    expect(getWorkflowRun(run.id)!.status).toBe('waiting_gate');

    // 通过 AbortSignal 中止等待
    controller.abort();

    const result = await promise;
    expect(result).toEqual({ terminate: true });

    // Run 状态已 aborted
    const aborted = getWorkflowRun(run.id)!;
    expect(aborted.status).toBe('aborted');

    // Session 状态同步 aborted
    const session = db.prepare('SELECT workflow_run_status FROM sessions WHERE id = ?').get(run.session_id) as { workflow_run_status: string };
    expect(session.workflow_run_status).toBe('aborted');

    // Gate 已解析为 rejected
    const gate = getStageGate(gates[0].id);
    expect(gate?.status).toBe('rejected');
  });
});

// =============================================================================
// 3b. createAdvanceStageTool callback — 权威推进 cursor
// =============================================================================

describe('createAdvanceStageTool callback advances cursor', () => {
  it('uses the stable current Stage identity when the compatibility index disagrees', async () => {
    const routedStages = [
      {
        id: 'entry', name: 'Entry', taskDescription: 'choose', acceptanceCriteria: '', gateEnabled: false, terminal: false,
        routes: [
          { id: 'route-left', targetStageId: 'left', condition: 'Use left' },
          { id: 'route-right', targetStageId: 'right', condition: 'Use right' },
        ],
      },
      { id: 'left', name: 'Left', taskDescription: 'not current', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
      { id: 'right', name: 'Right', taskDescription: 'selected', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    db.prepare('UPDATE workflows SET stages = ? WHERE id = ?').run(JSON.stringify(routedStages), lastWorkflowId);
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    db.prepare('UPDATE workflow_runs SET current_stage_index = 1, current_stage_id = ? WHERE id = ?')
      .run('entry', run.id);
    const tool = createAdvanceStageTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });

    const result = await tool.invoke({
      routeId: 'route-right',
      report: { acceptanceSelfCheck: [], artifacts: [], summary: 'selected' },
    });

    expect(result).toMatchObject({ status: 'stage_advanced', nextStageIndex: 2, nextStageName: 'Right' });
    expect(getWorkflowRun(run.id)).toMatchObject({ current_stage_id: 'right', current_stage_index: 2 });
  });

  it.each([
    ['route-to-b', 1, 'B'],
    ['route-to-c', 2, 'C'],
  ])('advances through authored conditional route %s', async (routeId, expectedIndex, expectedName) => {
    const routedStages = [
      {
        id: 'a', name: 'A', taskDescription: 'choose', acceptanceCriteria: '', gateEnabled: false, terminal: false,
        routes: [
          { id: 'route-to-b', targetStageId: 'b', condition: 'Use B' },
          { id: 'route-to-c', targetStageId: 'c', condition: 'Use C' },
        ],
      },
      { id: 'b', name: 'B', taskDescription: 'branch B', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
      { id: 'c', name: 'C', taskDescription: 'branch C', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    db.prepare('UPDATE workflows SET stages = ? WHERE id = ?').run(JSON.stringify(routedStages), lastWorkflowId);
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const tool = createAdvanceStageTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });

    const result = await tool.invoke({
      routeId,
      rationale: `Choose ${expectedName}`,
      report: { acceptanceSelfCheck: [], artifacts: [], summary: 'selected' },
    });

    expect(result).toMatchObject({ status: 'stage_advanced', nextStageIndex: expectedIndex, nextStageName: expectedName });
    expect(getWorkflowRun(run.id)?.current_stage_index).toBe(expectedIndex);
  });

  it('advances cursor on approve (gate-off)', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    // Bypass gate: set current to stage 1 (gateEnabled=false)
    db.prepare('UPDATE workflow_runs SET current_stage_id = ?, current_stage_index = 1 WHERE id = ?').run('stage-2', run.id);

    const tool = createAdvanceStageTool({
      runId: run.id,
      projectId: PROJECT_ID,
      getRun: () => getWorkflowRun(run.id),
    });

    // Simulate deepagents executing tool callback after approve resume
    const result = await tool.invoke({
      report: {
        acceptanceSelfCheck: [{ criterion: '方案完整', passed: true, notes: 'OK' }],
        artifacts: [],
        summary: 'done',
      },
    });

    expect(result).toHaveProperty('status', 'completed');

    // Terminal completion retains the stable terminal Stage identity.
    const advanced = getWorkflowRun(run.id)!;
    expect(advanced).toMatchObject({ current_stage_id: 'stage-2', current_stage_index: 1 });
    expect(advanced.status).toBe('completed');
    expect(advanced.ended_at).not.toBeNull();
  });

  it('advances cursor to next stage on partial progress', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);

    // Start at stage 0, approve stage 0 via tool callback (need gate=true to go through interrupt)
    // For tool callback test, we directly invoke the tool (simulating approve resume)
    const tool = createAdvanceStageTool({
      runId: run.id,
      projectId: PROJECT_ID,
      getRun: () => getWorkflowRun(run.id),
    });

    const result = await tool.invoke({
      report: {
        acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
        artifacts: [],
        summary: 'stage 0 done',
      },
    });

    // Cursor advanced
    expect(result).toHaveProperty('status', 'stage_advanced');
    expect(result).toHaveProperty('nextStageIndex', 1);
    expect(result).toHaveProperty('nextStageName', '方案设计');

    const advanced = getWorkflowRun(run.id)!;
    expect(advanced.current_stage_index).toBe(1);
    expect(advanced.status).toBe('running');
  });

  it('throws when run not found', () => {
    const tool = createAdvanceStageTool({
      runId: 'no-such-run',
      projectId: PROJECT_ID,
      getRun: () => undefined,
    });

    expect(tool.invoke({
      report: {
        acceptanceSelfCheck: [],
        artifacts: [],
        summary: 'test',
      },
    })).rejects.toThrow('Workflow run not found');
  });
});

describe('Stage Route Blocker', () => {
  it('waits for ordinary user input in the same Stage and later resumes valid routing', async () => {
    const { run, sessionId } = startRun(lastWorkflowId, PROJECT_ID);
    const planned = createTask(run.id, 'stage-1', 'Clarify scope', 'Need user input');
    const blocker = createStageRouteBlockerTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });

    const observation = await blocker.invoke({ explanation: '请确认需要覆盖的平台。' });
    expect(observation).toMatchObject({ status: 'waiting_input', explanation: '请确认需要覆盖的平台。' });
    expect(getWorkflowRun(run.id)).toMatchObject({ status: 'waiting_input', current_stage_index: 0 });
    expect(getTask(planned.id)).toMatchObject({ id: planned.id, status: 'planned' });
    expect(listStageGates(run.id)).toEqual([]);

    const resumed = resumeWorkflowRunFromInput(sessionId);
    expect(resumed).toMatchObject({ status: 'running', current_stage_index: 0 });
    expect(listStageGates(run.id)).toEqual([]);

    const advance = createAdvanceStageTool({ runId: run.id, projectId: PROJECT_ID, getRun: () => getWorkflowRun(run.id) });
    await advance.invoke({ report: { acceptanceSelfCheck: [], artifacts: [], summary: 'now enough information' } });
    expect(getWorkflowRun(run.id)?.current_stage_index).toBe(1);
  });
});

// =============================================================================
// 5-6. 查询 / Session 标记 / 重启恢复
// =============================================================================

describe('query and session markers', () => {
  it('listWorkflowRuns returns created runs', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const list = listWorkflowRuns(lastWorkflowId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(run.id);
  });

  it('getWorkflowRun returns by id', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const found = getWorkflowRun(run.id);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(run.id);
  });

  it('getRunBySessionId returns run for session', () => {
    const { run, sessionId } = startRun(lastWorkflowId, PROJECT_ID);
    const found = getRunBySessionId(sessionId);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(run.id);
  });

  it('session has workflow_run_id and workflow_run_status', () => {
    const { run, sessionId } = startRun(lastWorkflowId, PROJECT_ID);

    // 直接查 sessions 表验证两列
    const sessionRows = db.prepare('SELECT id, workflow_run_id, workflow_run_status FROM sessions WHERE project_id = ?').all(PROJECT_ID) as SessionRow[];
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].workflow_run_id).toBe(run.id);
    expect(sessionRows[0].workflow_run_status).toBe('running');
  });

  it('pending gates survive restart (queryable DB, not memory-dependent)', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: '提交',
    };
    const promise = handleAdvanceStageInterrupt(run.id, report);
    await new Promise(r => setTimeout(r, 0));

    // 模拟重启：从 DB 重新查询
    const savedGates = getPendingStageGates(run.id);
    expect(savedGates).toHaveLength(1);
    expect(savedGates[0].status).toBe('pending');

    const savedRun = getWorkflowRun(run.id)!;
    expect(savedRun.status).toBe('waiting_gate');

    // 仍然可以解析
    resolveGateFromExternal(savedGates[0].id, { decision: 'approve' });
    await promise;

    const afterResolve = getWorkflowRun(run.id)!;
    // Cursor NOT advanced by interrupt handler (tool callback does it after resume)
    expect(afterResolve.current_stage_index).toBe(0);
    expect(afterResolve.status).toBe('running');
  });

  it('listStageGates returns all gates; getPendingStageGates only pending', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [],
      artifacts: [],
      summary: 'Stage report',
    };

    // 创建一个 pending gate
    const gate = createStageGate(run.id, 'stage-2', '方案设计', report);
    expect(gate.status).toBe('pending');

    // listStageGates（无 status 过滤）返回所有 gate
    let allGates = listStageGates(run.id);
    expect(allGates).toHaveLength(1);
    expect(allGates[0].status).toBe('pending');

    // 解析为 approved
    const resolved = resolveStageGate(gate.id, 'approved');
    expect(resolved?.status).toBe('approved');

    // listStageGates 仍返回该 gate，状态已变
    allGates = listStageGates(run.id);
    expect(allGates).toHaveLength(1);
    expect(allGates[0].status).toBe('approved');
    expect(allGates[0].id).toBe(gate.id);

    // getPendingStageGates 只返回 pending
    const pendingGates = getPendingStageGates(run.id);
    expect(pendingGates).toHaveLength(0);

    // 对同一个 run 再做两个 gate，验证不同 status 都被返回
    const gate2 = createStageGate(run.id, 'stage-1', '需求分析', report);
    resolveStageGate(gate2.id, 'rejected');
    const gate3 = createStageGate(run.id, 'stage-2', '方案设计', report);
    // gate3 保持 pending

    allGates = listStageGates(run.id);
    expect(allGates).toHaveLength(3);

    // 验证三个 gate 都在结果中（order 不确定因为 created_at 可能相同毫秒）
    const byId = Object.fromEntries(allGates.map(g => [g.id, g]));
    expect(byId[gate.id].status).toBe('approved');
    expect(byId[gate2.id].status).toBe('rejected');
    expect(byId[gate3.id].status).toBe('pending');

    // ORDER BY created_at DESC 确保顺序稳定（毫秒不同时排序生效）
    // 验证结果按 created_at 降序
    for (let i = 1; i < allGates.length; i++) {
      expect(allGates[i - 1].created_at).toBeGreaterThanOrEqual(allGates[i].created_at);
    }
    // 至少不会出现 status 全部相同的 gate 相邻（顺序稳定检验）
    const statuses = allGates.map(g => g.status);
    expect(new Set(statuses).size).toBe(3);

    // getPendingStageGates 只返回 pending 的 gate（仅 gate3 未解析）
    const pendingOnly = getPendingStageGates(run.id);
    expect(pendingOnly).toHaveLength(1);
    expect(pendingOnly[0].id).toBe(gate3.id);
  });
});

describe('Run Task Graph orchestration', () => {
  it('persists planned tasks, dependencies, status transitions, and rejects cycles', () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const first = createTask(run.id, 'stage-1', '调研', '收集约束');
    const second = createTask(run.id, 'stage-1', '实现', '完成实现');

    expect(getPendingTasks(run.id, 'stage-1').map((task) => task.id)).toEqual([first.id, second.id]);
    expect(setTaskDependencies(second.id, [first.id])).toEqual({ success: true });
    expect(getTask(second.id)?.dependencies).toEqual([first.id]);
    expect(setTaskDependencies(first.id, [second.id])).toEqual({
      detectCycle: [second.id, first.id],
    });

    expect(updateTaskStatus(first.id, 'in_progress')?.status).toBe('in_progress');
    expect(updateTaskStatus(first.id, 'completed')?.completed_at).not.toBeNull();
    expect(listRunTasks(run.id, 'stage-1')).toHaveLength(2);
  });

  it('creates tasks in the authoritative current Stage and enforces run ownership', async () => {
    const firstRun = startRun(lastWorkflowId, PROJECT_ID).run;
    const otherRun = startRun(lastWorkflowId, PROJECT_ID).run;
    const otherTask = createTask(otherRun.id, 'stage-1', '外部任务', '不能跨 Run 修改');
    const tools = createTaskGraphTools({
      runId: firstRun.id,
      getRun: () => getWorkflowRun(firstRun.id),
    });
    const createTool = tools.find((candidate) => candidate.name === 'create_task')!;
    const dependencyTool = tools.find((candidate) => candidate.name === 'set_task_dependencies')!;
    const statusTool = tools.find((candidate) => candidate.name === 'update_task_status')!;

    db.prepare('UPDATE workflow_runs SET current_stage_id = ?, current_stage_index = 1 WHERE id = ?').run('stage-2', firstRun.id);
    const created = JSON.parse(String(await createTool.invoke({
      title: '方案任务',
      description: '当前阶段任务',
      dependencies: [],
    }))) as { taskId: string };
    expect(getTask(created.taskId)?.stage_id).toBe('stage-2');

    expect(String(await dependencyTool.invoke({
      taskId: created.taskId,
      dependencies: [otherTask.id],
    }))).toContain('not in same run');
    expect(String(await statusTool.invoke({
      taskId: otherTask.id,
      status: 'completed',
    }))).toContain('does not belong');
  });

  it('attaches the persisted Stage task terminal state to the Stage Report', async () => {
    const { run } = startRun(lastWorkflowId, PROJECT_ID);
    const task = createTask(run.id, 'stage-1', '验收', '运行验证');
    updateTaskStatus(task.id, 'completed');
    const report: WorkflowStageReport = {
      acceptanceSelfCheck: [{ criterion: '需求清晰', passed: true, notes: 'OK' }],
      artifacts: [],
      summary: '完成',
      tasks: [],
    };

    const pending = handleAdvanceStageInterrupt(run.id, report);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const gate = getPendingStageGates(run.id)[0];
    expect(getStageGate(gate.id)?.report.tasks).toEqual([
      expect.objectContaining({ id: task.id, status: 'completed' }),
    ]);
    resolveGateFromExternal(gate.id, { decision: 'reject', feedback: '继续' });
    await pending;
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentCatalog, GENERAL_PURPOSE_AGENT_ID, MASTER_AGENT_ID } from './agent-catalog';
import { getOrCaptureConversationSystemContextSnapshot } from './conversation-system-context-snapshot';
import { captureDelegatedAgentConfigurationSnapshot } from './deepagent/delegated-agent-configuration-snapshot';
import { DelegatedAgentRunCoordinator } from './deepagent/delegated-agent-run-coordinator';
import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './deepagent/delegated-agent-run-repository';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('global Agent cross-Project and Scene integration', () => {
  it('shares one Agent definition while freezing Scene and delegated-run state at their boundaries', async () => {
    const generalPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-global-agent-general-'));
    const researchPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-global-agent-research-'));
    cleanupPaths.push(generalPath, researchPath);

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE llm_providers (id TEXT PRIMARY KEY);
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        scene TEXT NOT NULL
      );
    `);
    const baseCatalog = createAgentCatalog(db, { now: () => 1 });
    db.exec(`
      CREATE TABLE mcp_servers (id TEXT PRIMARY KEY);
      CREATE TABLE agent_mcp_exclusions (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, mcp_server_id)
      );
      CREATE TABLE agent_skills (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_name TEXT NOT NULL,
        PRIMARY KEY (agent_id, skill_name)
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        prompt_snapshot TEXT,
        skill_snapshot TEXT
      );
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE workflow_run_tasks (id TEXT PRIMARY KEY);
    `);
    initializeDelegatedAgentRunSchema(db);
    db.prepare('INSERT INTO projects (id, path, scene) VALUES (?, ?, ?), (?, ?, ?)')
      .run('general-project', generalPath, 'general', 'research-project', researchPath, 'research');
    db.prepare('INSERT INTO sessions (id, project_id, agent_id) VALUES (?, ?, ?), (?, ?, ?)')
      .run(
        'general-conversation', 'general-project', MASTER_AGENT_ID,
        'research-conversation', 'research-project', MASTER_AGENT_ID,
      );
    db.prepare('INSERT INTO agent_runs (id, session_id) VALUES (?, ?), (?, ?)')
      .run('general-root-run', 'general-conversation', 'research-root-run', 'research-conversation');

    baseCatalog.saveMasterPrompts([
      { scene: 'general', systemPrompt: 'General Scene Master Prompt' },
      { scene: 'research', systemPrompt: 'Research Scene Master Prompt' },
    ]);
    const catalog = createAgentCatalog(db, {
      createId: () => 'shared-custom-agent',
      initializeSchema: false,
      listGlobalSkillIds: () => [],
    });
    const custom = catalog.createCustom({
      name: 'Shared Analyst',
      system_prompt: 'Custom prompt v1',
      config: { model: 'model-v1', toolScope: { mode: 'inherit' } },
    });

    const generalContext = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'general-conversation',
      projectPath: generalPath,
      sceneId: 'general',
      promptSnapshot: catalog.resolveMaster('general').system_prompt,
    });
    const researchContext = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'research-conversation',
      projectPath: researchPath,
      sceneId: 'research',
      promptSnapshot: catalog.resolveMaster('research').system_prompt,
    });
    expect(generalContext.promptSnapshot).toBe('General Scene Master Prompt');
    expect(researchContext.promptSnapshot).toBe('Research Scene Master Prompt');

    const stableTarget = catalog.listDelegationTargets().find((agent) => agent.id === custom.id)!;
    const targetSet = [stableTarget];
    const captureCurrent = () => {
      const current = catalog.get(stableTarget.id);
      if (!current) throw new Error(`Delegated target Agent not found: ${stableTarget.slug}`);
      return captureDelegatedAgentConfigurationSnapshot({
        target: current,
        targetIdentity: stableTarget,
        mcpServerExclusionIds: current.mcpServerExclusionIds,
        skillNames: current.skillNames,
        conversationSkillSnapshot: researchContext.skillSnapshot,
      });
    };
    const executions: Array<{ projectId: string; targetId: string; prompt: string; stateValue: number }> = [];
    const coordinator = new DelegatedAgentRunCoordinator(
      new DelegatedAgentRunRepository(db),
      {
        run: vi.fn(async (request) => {
          const isolatedState = { calls: 0 };
          isolatedState.calls += 1;
          const projectId = (request.input as { projectId: string }).projectId;
          executions.push({
            projectId,
            targetId: request.configurationSnapshot!.target.id,
            prompt: request.configurationSnapshot!.target.system_prompt ?? '',
            stateValue: isolatedState.calls,
          });
          return {
            status: 'success' as const,
            artifacts: [],
            summary: `${projectId}:${isolatedState.calls}`,
          };
        }),
      },
      { createId: (() => { let id = 0; return () => `delegated-${++id}`; })(), now: () => 10 },
    );

    const generalOutcome = await coordinator.runSingle({
      parentAgentRunId: 'general-root-run',
      targetAgentId: custom.id,
      targetAgentSlug: stableTarget.slug,
      targetAgentName: stableTarget.name,
      taskToolCallId: 'general-task',
      goal: 'general work',
      configurationSnapshot: captureCurrent(),
      input: { projectId: 'general-project', projectPath: generalPath, scene: 'general' },
    });

    catalog.updateCustom(custom.id, {
      name: 'Renamed Shared Analyst',
      system_prompt: 'Custom prompt v2',
      config: { model: 'model-v2', toolScope: { mode: 'narrow', builtInTools: ['read_file'] } },
    });
    expect(targetSet.map((target) => target.slug)).toEqual(['shared-analyst']);
    const researchOutcome = await coordinator.runSingle({
      parentAgentRunId: 'research-root-run',
      targetAgentId: custom.id,
      targetAgentSlug: stableTarget.slug,
      targetAgentName: stableTarget.name,
      taskToolCallId: 'research-task',
      goal: 'research work',
      resolveConfigurationSnapshot: captureCurrent,
      input: { projectId: 'research-project', projectPath: researchPath, scene: 'research' },
    });

    expect(generalOutcome.summary).toBe('general-project:1');
    expect(researchOutcome.summary).toBe('research-project:1');
    expect(executions).toEqual([
      expect.objectContaining({ projectId: 'general-project', targetId: custom.id, prompt: 'Custom prompt v1', stateValue: 1 }),
      expect.objectContaining({ projectId: 'research-project', targetId: custom.id, prompt: 'Custom prompt v2', stateValue: 1 }),
    ]);

    db.prepare('DELETE FROM projects WHERE id = ?').run('general-project');
    expect(catalog.get(MASTER_AGENT_ID)).not.toBeNull();
    expect(catalog.get(GENERAL_PURPOSE_AGENT_ID)).not.toBeNull();
    expect(catalog.get(custom.id)).not.toBeNull();

    const queuedSnapshot = captureCurrent();
    const queued = coordinator.queueSingle({
      parentAgentRunId: 'research-root-run',
      targetAgentId: custom.id,
      targetAgentSlug: stableTarget.slug,
      targetAgentName: stableTarget.name,
      taskToolCallId: 'queued-before-delete',
      goal: 'finish after deletion',
      configurationSnapshot: queuedSnapshot,
    });
    catalog.deleteCustom(custom.id);
    expect(new DelegatedAgentRunRepository(db).get(queued.id)).toMatchObject({
      target_agent_id: null,
      target_agent_name: 'Shared Analyst',
      target_agent_slug: 'shared-analyst',
    });
    await expect(coordinator.runSingle({
      parentAgentRunId: 'research-root-run',
      targetAgentId: null,
      targetAgentSlug: stableTarget.slug,
      targetAgentName: stableTarget.name,
      taskToolCallId: 'queued-before-delete',
      goal: 'finish after deletion',
      configurationSnapshot: captureDelegatedAgentConfigurationSnapshot({
        target: queuedSnapshot.target,
        mcpServerExclusionIds: queuedSnapshot.mcpServerExclusionIds,
        skillNames: queuedSnapshot.globalSkillPreloadRefs,
        conversationSkillSnapshot: researchContext.skillSnapshot,
      }),
      input: { projectId: 'research-project' },
    })).resolves.toMatchObject({ status: 'success' });

    await expect(coordinator.runSingle({
      parentAgentRunId: 'research-root-run',
      targetAgentId: null,
      targetAgentSlug: stableTarget.slug,
      targetAgentName: stableTarget.name,
      taskToolCallId: 'after-delete',
      goal: 'must fail',
      resolveConfigurationSnapshot: captureCurrent,
      input: { projectId: 'research-project' },
    })).rejects.toThrow('Delegated target Agent not found: shared-analyst');
    expect(catalog.listDelegationTargets().some((agent) => agent.id === custom.id)).toBe(false);

    db.close();
  });
});

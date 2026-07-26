import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAISubscriptionEntries } from '@shared/ai-subscriptions';
import type { LLMProvider } from '@shared/providers';
import type { Workflow, WorkflowRun } from '@shared/types';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { initialProjectionState } from '../WorkflowRunView/workflowRunProjection';
import { WorkflowList } from './WorkflowList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const labels: Record<string, string> = {
        'workflow.list.title': `Workflow Skeletons (${options?.count ?? 0})`,
        'workflow.list.newWorkflow': 'New Workflow Skeleton',
        'workflow.list.enabled': 'Enabled',
        'workflow.list.disabled': 'Disabled',
        'workflow.list.stageCount': `${options?.count ?? 0} Stages`,
        'workflow.list.run': 'Run',
        'workflow.list.edit': 'Edit',
        'workflow.list.delete': 'Delete',
        'workflow.list.runModel': 'Run model',
        'workflow.list.runDirectly': 'Run directly',
        'workflow.list.startingWorkflow': 'Starting Workflow Run...',
        'workflow.list.workflowStarted': 'Workflow Run started',
        'chat.selectModel': 'Select model',
        'chat.modelSelection.label': 'Model',
        'chat.modelSelection.refreshConfig': 'Refresh config',
        'chat.modelSelection.refreshingConfig': 'Refreshing...',
        'chat.reasoningEffort.depthLabel': 'Reasoning depth',
        'chat.reasoningEffort.agentCountLabel': 'Collaboration scale',
        'chat.reasoningEffort.efforts.none': 'Off',
        'chat.reasoningEffort.efforts.low': 'Fast',
        'chat.reasoningEffort.efforts.medium': 'Balanced',
        'chat.reasoningEffort.efforts.high': 'Deep',
        'chat.reasoningEffort.efforts.xhigh': 'Very deep',
        'chat.reasoningEffort.efforts.max': 'Maximum',
      };
      return labels[key] ?? key;
    },
    i18n: { language: 'en-US' },
  }),
}));

const workflow: Workflow = {
  id: 'workflow-1',
  project_id: 'project-1',
  name: 'Model research',
  description: 'Research recently released models',
  status: 'active',
  stages: [{
    id: 'stage-1',
    name: 'Research',
    taskDescription: 'Research recently released models',
    acceptanceCriteria: '',
    gateEnabled: false,
    terminal: true,
    routes: [],
  }],
  created_at: 1_000,
  updated_at: 1_000,
};

function workflowRun(): WorkflowRun {
  return {
    id: 'run-1',
    workflow_id: workflow.id,
    project_id: workflow.project_id,
    session_id: 'workflow-session',
    master_agent_id: 'system-master-agent',
    status: 'running',
    current_stage_id: 'stage-1',
    current_stage_index: 0,
    total_stages: 1,
    stages: JSON.stringify(workflow.stages),
    skeleton_snapshot: null,
    error: null,
    started_at: 1_000,
    ended_at: null,
    created_at: 1_000,
    updated_at: 1_000,
  };
}

describe('WorkflowList model selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    window.electronAPI = {
      store: { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) },
      db: {
        getWorkflows: vi.fn(async () => [workflow]),
        getMessages: vi.fn(),
        saveMessage: vi.fn(),
      },
      llm: {
        chat: vi.fn(),
        onChunk: vi.fn(() => () => {}),
      },
      deepagents: { onParallelTaskStep: vi.fn(() => () => {}) },
      workflowRun: {
        start: vi.fn(async () => ({
          runId: 'run-1',
          sessionId: 'workflow-session',
          firstStage: workflow.stages[0],
        })),
        getRunBySession: vi.fn(async () => workflowRun()),
        getStageGates: vi.fn(async () => []),
        getTasks: vi.fn(async () => []),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

    useWorkflowStore.setState({
      workflows: [workflow],
      currentWorkflow: null,
      isLoading: false,
      error: null,
      fetchWorkflows: vi.fn(async () => {}),
    });
    useWorkflowRunStore.setState({
      activeRun: null,
      projectionState: initialProjectionState,
      isGraphView: true,
      isLoading: false,
      error: null,
      _requestSeq: 0,
    });
    useProjectStore.setState({ currentProjectId: 'project-1', activeView: 'workflows' });
    useAgentStore.setState({
      agents: [{
        id: 'system-master-agent',
        role: 'master',
        name: 'Master Agent',
        created_at: 1_000,
        updated_at: 1_000,
      }],
    });
    useLLMStore.setState({
      providers: [{
        id: 'provider-1',
        name: 'OpenAI',
        provider_type: 'custom',
        default_model: 'deepseek-v4-flash',
        context_limit: 128_000,
        is_active: 1,
        models: [],
        hasKey: true,
        created_at: 1_000,
        updated_at: 1_000,
      }],
      activeProvider: null,
    });
    useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connected' } },
      }),
    });
    useSessionStore.setState({
      pendingApproval: null,
      sessionModelOverrides: {},
      fetchSessions: vi.fn(async () => {}),
      selectSession: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => ({ ok: true as const })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('runs with an explicitly selected AI Subscription model even when an API Provider is available', async () => {
    render(
      <WorkflowList
        onSelectWorkflow={() => {}}
        onCreateWorkflow={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'deepseek-v4-flash' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: 'Codex OAuth • GPT-5.6 Sol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(useSessionStore.getState().sendMessage).toHaveBeenCalledWith(
        'project-1',
        expect.stringContaining('Research'),
        expect.objectContaining({
          modelSource: 'ai_subscription',
          sourceId: 'codex-oauth',
          model: 'gpt-5.6-sol',
        }),
        'workflow-session',
      );
    });
  });

  it('waits for the complete default model state when the user has not selected a model', async () => {
    let releaseModelSources!: () => void;
    const modelSourcesReady = new Promise<void>((resolve) => {
      releaseModelSources = resolve;
    });
    const loadedProvider: LLMProvider = {
      id: 'provider-1',
      name: 'OpenAI',
      provider_type: 'custom',
      default_model: 'deepseek-v4-flash',
      context_limit: 128_000,
      is_active: 1,
      models: [],
      hasKey: true,
      created_at: 1_000,
      updated_at: 1_000,
    };
    const fetchProviders = vi.fn(async () => {
      await modelSourcesReady;
      useLLMStore.setState({ providers: [loadedProvider] });
    });
    const fetchAgents = vi.fn(async () => {
      await modelSourcesReady;
      useAgentStore.setState({
        agents: [{
          id: 'system-master-agent',
          role: 'master',
          name: 'Master Agent',
          provider_id: 'provider-1',
          created_at: 1_000,
          updated_at: 1_000,
        }],
      });
    });
    useLLMStore.setState({ providers: [], fetchProviders });
    useAgentStore.setState({ agents: [], fetchAgents });
    useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'minimax-token-plan': { status: 'connected' } },
      }),
    });

    render(
      <WorkflowList
        onSelectWorkflow={() => {}}
        onCreateWorkflow={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    releaseModelSources();

    await waitFor(() => {
      expect(useSessionStore.getState().sendMessage).toHaveBeenCalledWith(
        'project-1',
        expect.stringContaining('Research'),
        expect.objectContaining({
          modelSource: 'llm_provider',
          sourceId: 'provider-1',
          model: 'deepseek-v4-flash',
        }),
        'workflow-session',
      );
    });
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Agent, AgentApprovalRequest, LLMProvider, Message, Session } from '@shared/types';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useConversationWorkspaceModel } from './useConversationWorkspaceModel';

function provider(overrides: Partial<LLMProvider> & Pick<LLMProvider, 'id' | 'name' | 'default_model'>): LLMProvider {
  return {
    provider_type: 'openai',
    context_limit: 128_000,
    is_active: 1,
    models: [],
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'project_id' | 'name' | 'provider_id'>): Agent {
  return {
    description: '',
    avatar: '',
    system_prompt: '',
    model: 'gpt-4.1',
    is_default: 0,
    is_active: 1,
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

function session(overrides: Partial<Session> & Pick<Session, 'id' | 'project_id' | 'name'>): Session {
  return {
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    session_id: 'session-1',
    created_at: 1_000,
    ...overrides,
  };
}

describe('useConversationWorkspaceModel', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProjectId: null,
      projects: [],
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      activeRunId: null,
      delegatedTasks: [],
      parallelBatches: [],
      todos: [],
      pendingApproval: null,
      error: null,
      sessionGoals: new Map(),
      goalJudgeStatus: new Map(),
      viewingSubagentId: null,
      viewingParallelWorker: null,
      sessionModelOverrides: {},
    });
    useAgentStore.setState({ agents: [] });
    useLLMStore.setState({ providers: [], activeProvider: null });
  });

  it('uses the active Conversation Agent before the project default Agent for the master provider', () => {
    const defaultProvider = provider({ id: 'provider-default', name: 'Default Provider', default_model: 'default-model' });
    const sessionProvider = provider({ id: 'provider-session', name: 'Session Provider', default_model: 'session-model' });
    const defaultAgent = agent({
      id: 'agent-default',
      project_id: 'project-1',
      name: 'Default Agent',
      provider_id: defaultProvider.id,
      is_default: 1,
    });
    const sessionAgent = agent({
      id: 'agent-session',
      project_id: 'project-1',
      name: 'Session Agent',
      provider_id: sessionProvider.id,
    });
    const activeSession = session({
      id: 'session-1',
      project_id: 'project-1',
      name: 'Active Conversation',
      agent_id: sessionAgent.id,
    });

    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'Project One', path: '/tmp/project-one' }],
    });
    useSessionStore.setState({
      sessions: [activeSession],
      activeSessionId: activeSession.id,
    });
    useAgentStore.setState({ agents: [defaultAgent, sessionAgent] });
    useLLMStore.setState({ providers: [defaultProvider, sessionProvider] });

    const { result } = renderHook(() => useConversationWorkspaceModel());

    expect(result.current.workspace.activeSession).toEqual(activeSession);
    expect(result.current.agent.activeSessionAgent).toEqual(sessionAgent);
    expect(result.current.agent.defaultAgent).toEqual(defaultAgent);
    expect(result.current.agent.masterProvider).toEqual(sessionProvider);
    expect(result.current.workspace.currentProjectRoot).toBe('/tmp/project-one');
  });

  it('uses the project default Agent for the master provider before a Conversation is active', () => {
    const defaultProvider = provider({ id: 'provider-default', name: 'Default Provider', default_model: 'default-model' });
    const otherProvider = provider({ id: 'provider-other', name: 'Other Provider', default_model: 'other-model' });
    const defaultAgent = agent({
      id: 'agent-default',
      project_id: 'project-1',
      name: 'Default Agent',
      provider_id: defaultProvider.id,
      is_default: 1,
    });
    const otherAgent = agent({
      id: 'agent-other',
      project_id: 'project-1',
      name: 'Other Agent',
      provider_id: otherProvider.id,
    });

    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'Project One', path: '/tmp/project-one' }],
    });
    useAgentStore.setState({ agents: [defaultAgent, otherAgent] });
    useLLMStore.setState({ providers: [defaultProvider, otherProvider] });

    const { result } = renderHook(() => useConversationWorkspaceModel());

    expect(result.current.workspace.activeSession).toBeNull();
    expect(result.current.composer.mode).toBe('welcome');
    expect(result.current.agent.activeSessionAgent).toEqual(defaultAgent);
    expect(result.current.agent.masterProvider).toEqual(defaultProvider);
  });

  it('resolves delegated and parallel detail targets for the Conversation viewport', () => {
    const delegatedTask = {
      taskId: 'task-1',
      agentSlug: 'reviewer',
      agentName: 'Reviewer',
      goal: 'Review the patch',
      status: 'running' as const,
      chunks: [],
      steps: [],
    };
    const selectedWorker = {
      workerId: 'worker-2',
      agentSlug: 'tester',
      agentName: 'Tester',
      status: 'success' as const,
      steps: [],
      textBuffer: 'done',
      startedAt: 1_000,
    };

    useSessionStore.setState({
      delegatedTasks: [delegatedTask],
      viewingSubagentId: delegatedTask.taskId,
      parallelBatches: [
        {
          batchId: 'batch-1',
          startedAt: 1_000,
          workers: [
            {
              workerId: 'worker-1',
              agentSlug: 'tester',
              status: 'running',
              steps: [],
              textBuffer: '',
              startedAt: 1_000,
            },
            selectedWorker,
          ],
        },
      ],
      viewingParallelWorker: {
        batchId: 'batch-1',
        agentSlug: selectedWorker.agentSlug,
        workerId: selectedWorker.workerId,
      },
    });

    const { result } = renderHook(() => useConversationWorkspaceModel());

    expect(result.current.viewport.viewingTask).toEqual(delegatedTask);
    expect(result.current.viewport.viewingWorkerData).toEqual(selectedWorker);
  });

  it('projects streaming timeline items with pending approval for the Conversation viewport', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'write a file' });
    const assistantMessage = message({ id: 'assistant-1', role: 'assistant', content: 'I need approval' });
    const pendingApproval: AgentApprovalRequest = {
      id: 'approval-1',
      toolCallId: 'tool-call-1',
      name: 'write_file',
      args: { file_path: '/tmp/a.ts', content: 'hello' },
      description: 'Tool execution requires approval',
    };

    useSessionStore.setState({
      messages: [userMessage, assistantMessage],
      isStreaming: true,
      pendingApproval,
    });

    const { result } = renderHook(() => useConversationWorkspaceModel());

    expect(result.current.viewport.timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      { type: 'message', id: 'assistant-1', message: assistantMessage },
      {
        type: 'pending_approval_block',
        id: 'pending-approval-approval-1',
        approval: pendingApproval,
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Message } from '@shared/types';
import {
  createConversationRuntimeState,
  projectConversationRuntime,
  restoreConversationRuntime,
  type ConversationRuntimeProjectionDeps,
} from './conversationRuntimeProjection';

describe('Conversation Runtime Projection', () => {
  const deps: ConversationRuntimeProjectionDeps = {
    now: () => 1000,
    createId: (() => {
      const ids = ['assistant-next'];
      return () => ids.shift() ?? 'fallback-id';
    })(),
    estimateTokens: (text) => text.length,
  };

  it('persists Skill attribution stream events as system messages', () => {
    const localDeps: ConversationRuntimeProjectionDeps = {
      now: () => 1234,
      createId: () => 'skill-attribution-1',
      estimateTokens: (text) => text.length,
    };
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });

    const result = projectConversationRuntime(
      initial,
      {
        kind: 'llm',
        event: {
          type: 'skill_attribution',
          attributions: [
            {
              phase: 'preload',
              name: 'review',
              qualifiedName: 'review',
              sourceKind: 'project',
              sourceLabel: 'Project Skill',
              skillPath: '/project/.cdf/skills/review/SKILL.md',
              visibility: 'on',
              modelDiscovery: 'full',
              userInvocable: true,
            },
          ],
        },
      },
      localDeps,
    );

    expect(result.state.messages).toEqual([
      {
        id: 'skill-attribution-1',
        session_id: 'session-1',
        role: 'system',
        content: JSON.stringify({
          type: 'skill_attribution',
          attributions: [
            {
              phase: 'preload',
              name: 'review',
              qualifiedName: 'review',
              sourceKind: 'project',
              sourceLabel: 'Project Skill',
              skillPath: '/project/.cdf/skills/review/SKILL.md',
              visibility: 'on',
              modelDiscovery: 'full',
              userInvocable: true,
            },
          ],
        }),
        created_at: 1234,
        tokens: 0,
      },
    ]);
    expect(result.effects).toEqual([
      {
        type: 'saveMessage',
        message: result.state.messages[0],
      },
    ]);
  });

  it('saves an assistant segment and starts a tool card when tool activity begins', () => {
    const assistant: Message = {
      id: 'assistant-current',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      created_at: 900,
      tokens: 0,
    };

    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
      activeRunId: 'run-1',
      messages: [assistant],
    });

    const withChunk = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'message_chunk', text: 'I will inspect files.' } },
      deps,
    );
    const result = projectConversationRuntime(
      withChunk.state,
      { kind: 'llm', event: { type: 'tool_start', id: 'tool-1', name: 'read_file', input: { path: '/tmp/a.ts' } } },
      deps,
    );

    expect(result.state.currentAssistantMsgId).toBe('assistant-next');
    expect(result.state.accumulatedContent).toBe('');
    expect(result.state.messages).toEqual([
      { ...assistant, content: 'I will inspect files.' },
      {
        id: 'tool-1',
        session_id: 'session-1',
        role: 'system',
        content: JSON.stringify({
          type: 'tool',
          name: 'read_file',
          status: 'running',
          input: { path: '/tmp/a.ts' },
        }),
        created_at: 1000,
        tokens: 0,
      },
    ]);
    expect(result.state.agentToolCalls).toEqual([
      {
        id: 'tool-1',
        run_id: 'run-1',
        tool_name: 'read_file',
        input: JSON.stringify({ path: '/tmp/a.ts' }),
        output: null,
        status: 'running',
        error: null,
        started_at: 1000,
        ended_at: null,
        approval_status: null,
      },
    ]);
    expect(result.effects).toEqual([
      { type: 'openActivityPanel' },
      {
        type: 'saveMessage',
        message: {
          id: 'assistant-current',
          session_id: 'session-1',
          role: 'assistant',
          content: 'I will inspect files.',
          tokens: 21,
        },
      },
      {
        type: 'saveMessage',
        message: {
          id: 'tool-1',
          session_id: 'session-1',
          role: 'system',
          content: JSON.stringify({
            type: 'tool',
            name: 'read_file',
            status: 'running',
            input: { path: '/tmp/a.ts' },
          }),
          created_at: 1000,
          tokens: 0,
        },
      },
    ]);
  });

  it('updates a running tool card when tool activity completes', () => {
    const toolMessage: Message = {
      id: 'tool-1',
      session_id: 'session-1',
      role: 'system',
      content: JSON.stringify({
        type: 'tool',
        name: 'read_file',
        status: 'running',
        input: { path: '/tmp/a.ts' },
      }),
      created_at: 900,
      tokens: 0,
    };
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
      messages: [toolMessage],
      agentToolCalls: [
        {
          id: 'tool-1',
          run_id: 'run-1',
          tool_name: 'read_file',
          input: JSON.stringify({ path: '/tmp/a.ts' }),
          output: null,
          status: 'running',
          error: null,
          started_at: 900,
          ended_at: null,
          approval_status: null,
        },
      ],
    });

    const result = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'tool_end', id: 'tool-1', name: 'read_file', output: 'file contents' } },
      deps,
    );

    const expectedContent = JSON.stringify({
      type: 'tool',
      name: 'read_file',
      status: 'success',
      input: { path: '/tmp/a.ts' },
      output: 'file contents',
    });
    expect(result.state.messages).toEqual([
      { ...toolMessage, content: expectedContent },
    ]);
    expect(result.state.agentToolCalls[0]).toEqual({
      id: 'tool-1',
      run_id: 'run-1',
      tool_name: 'read_file',
      input: JSON.stringify({ path: '/tmp/a.ts' }),
      output: JSON.stringify('file contents'),
      status: 'success',
      error: null,
      started_at: 900,
      ended_at: 1000,
      approval_status: null,
    });
    expect(result.effects).toEqual([
      {
        type: 'saveMessage',
        message: {
          id: 'tool-1',
          session_id: 'session-1',
          role: 'system',
          content: expectedContent,
          created_at: 900,
          tokens: 0,
        },
      },
    ]);
  });

  it('saves the final assistant segment and completes streaming on message done', () => {
    const assistant: Message = {
      id: 'assistant-current',
      session_id: 'session-1',
      role: 'assistant',
      content: 'Final answer',
      created_at: 900,
      tokens: 0,
    };
    const emptyAssistant: Message = {
      id: 'assistant-empty',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      created_at: 950,
      tokens: 0,
    };
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
      messages: [assistant, emptyAssistant],
      accumulatedContent: 'Final answer',
      pendingApproval: {
        id: 'approval-1',
        runId: 'run-1',
        actions: [],
      },
    });

    const result = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'message_done' } },
      deps,
    );

    expect(result.state.messages).toEqual([
      { ...assistant, tokens: 12 },
    ]);
    expect(result.state.isStreaming).toBe(false);
    expect(result.state.streamingMessageId).toBe(null);
    expect(result.state.pendingApproval).toBe(null);
    expect(result.effects).toEqual([
      {
        type: 'saveMessage',
        message: {
          id: 'assistant-current',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Final answer',
          tokens: 12,
        },
      },
      { type: 'cleanupStream' },
      { type: 'resolveStream' },
    ]);
  });

  it('removes live run artifacts and surfaces a retryable error on runtime failure', () => {
    const userMessage: Message = {
      id: 'user-1',
      session_id: 'session-1',
      role: 'user',
      content: 'Run task',
      created_at: 800,
    };
    const assistantPlaceholder: Message = {
      id: 'assistant-start',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      created_at: 900,
    };
    const currentAssistant: Message = {
      id: 'assistant-current',
      session_id: 'session-1',
      role: 'assistant',
      content: 'Partial answer',
      created_at: 950,
    };
    const toolMessage: Message = {
      id: 'tool-1',
      session_id: 'session-1',
      role: 'system',
      content: JSON.stringify({ type: 'tool', name: 'read_file', status: 'running' }),
      created_at: 960,
      tokens: 0,
    };
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-start',
      currentAssistantMsgId: 'assistant-current',
      messages: [userMessage, assistantPlaceholder, currentAssistant, toolMessage],
      pendingApproval: {
        id: 'approval-1',
        runId: 'run-1',
        actions: [],
      },
      runtimeToolMessageIds: ['tool-1'],
      pendingToolMessages: { read_file: ['tool-1'] },
    });

    const result = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'runtime_error', error: 'graph failed' } },
      deps,
    );

    expect(result.state.messages).toEqual([userMessage]);
    expect(result.state.isStreaming).toBe(false);
    expect(result.state.streamingMessageId).toBe(null);
    expect(result.state.pendingApproval).toBe(null);
    expect(result.effects).toEqual([
      { type: 'cleanupStream' },
      { type: 'setRetryableError', message: 'graph failed' },
      { type: 'rejectStream', error: 'graph failed' },
    ]);
  });

  it('projects pending approval state until the approval is resolved', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });
    const approval = {
      id: 'approval-1',
      runId: 'run-1',
      actions: [
        { name: 'edit_file', args: { file_path: '/tmp/a.ts' } },
      ],
    };

    const waiting = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'approval_required', approval } },
      deps,
    );
    const resolved = projectConversationRuntime(
      waiting.state,
      { kind: 'llm', event: { type: 'approval_resolved', approvalId: 'approval-1', status: 'approved' } },
      deps,
    );

    expect(waiting.state.pendingApproval).toBe(approval);
    expect(waiting.effects).toEqual([]);
    expect(resolved.state.pendingApproval).toBe(null);
    expect(resolved.effects).toEqual([]);
  });

  it('projects run lifecycle events into active run state', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
      agentToolCalls: [
        {
          id: 'stale-tool',
          run_id: 'old-run',
          tool_name: 'read_file',
          input: null,
          output: null,
          status: 'running',
          error: null,
          started_at: 900,
          ended_at: null,
          approval_status: null,
        },
      ],
    });

    const started = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'run_started', runId: 'run-1', agentId: 'agent-1', status: 'running' } },
      deps,
    );
    const completed = projectConversationRuntime(
      started.state,
      { kind: 'llm', event: { type: 'run_updated', runId: 'run-1', status: 'completed' } },
      deps,
    );

    expect(started.state.activeRunId).toBe('run-1');
    expect(started.state.agentToolCalls).toEqual([]);
    expect(started.state.agentRuns).toEqual([
      {
        id: 'run-1',
        session_id: 'session-1',
        agent_id: 'agent-1',
        request_id: 'assistant-current',
        status: 'running',
        started_at: 1000,
        ended_at: null,
        aborted: 0,
      },
    ]);
    expect(completed.state.agentRuns[0]).toEqual({
      id: 'run-1',
      session_id: 'session-1',
      agent_id: 'agent-1',
      request_id: 'assistant-current',
      status: 'completed',
      started_at: 1000,
      ended_at: 1000,
      aborted: 0,
      error: null,
    });
  });

  it('projects todo updates from stream events and write_todos output', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });

    const updated = projectConversationRuntime(
      initial,
      {
        kind: 'llm',
        event: {
          type: 'todos_update',
          todos: [
            { content: 'Inspect files', status: 'in_progress' },
            { content: 'Summarize', status: 'pending' },
          ],
        },
      },
      deps,
    );
    const fromTool = projectConversationRuntime(
      updated.state,
      {
        kind: 'llm',
        event: {
          type: 'tool_end',
          id: 'todo-tool-1',
          name: 'write_todos',
          output: {
            update: {
              todos: [{ content: 'Inspect files', status: 'completed' }],
            },
          },
        },
      },
      deps,
    );

    expect(updated.state.todos).toEqual([
      { content: 'Inspect files', status: 'in_progress' },
      { content: 'Summarize', status: 'pending' },
    ]);
    expect(fromTool.state.todos).toEqual([
      { content: 'Inspect files', status: 'completed' },
    ]);
  });

  it('projects delegated task lifecycle events into one delegated task', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });
    const step = { type: 'tool_call' as const, tool: 'read_file', args: { path: '/tmp/a.ts' }, ts: 1000 };
    const resultPayload = { status: 'success' as const, artifacts: [], summary: 'Done' };

    const started = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'delegated_task_start', taskId: 'task-1', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files' } },
      deps,
    );
    const chunked = projectConversationRuntime(
      started.state,
      { kind: 'llm', event: { type: 'delegated_task_chunk', taskId: 'task-1', text: 'Reading...' } },
      deps,
    );
    const stepped = projectConversationRuntime(
      chunked.state,
      { kind: 'llm', event: { type: 'delegated_task_step', taskId: 'task-1', step } },
      deps,
    );
    const ended = projectConversationRuntime(
      stepped.state,
      { kind: 'llm', event: { type: 'delegated_task_end', taskId: 'task-1', status: 'success', result: resultPayload } },
      deps,
    );

    expect(started.effects).toEqual([{ type: 'openActivityPanel' }]);
    expect(ended.state.delegatedTasks).toEqual([
      {
        taskId: 'task-1',
        agentSlug: 'code',
        agentName: 'Code Agent',
        goal: 'Inspect files',
        status: 'success',
        chunks: ['Reading...'],
        steps: [step],
        startedAt: 1000,
        completedAt: 1000,
        result: resultPayload,
        errorCode: undefined,
      },
    ]);
  });

  it('keeps delegated task start idempotent when approval resumes replay task events', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });

    const started = projectConversationRuntime(
      initial,
      { kind: 'llm', event: { type: 'delegated_task_start', taskId: 'task-1', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files' } },
      deps,
    );
    const replayed = projectConversationRuntime(
      started.state,
      { kind: 'llm', event: { type: 'delegated_task_start', taskId: 'task-2', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files again' } },
      deps,
    );

    expect(replayed.state.delegatedTasks).toEqual([
      {
        taskId: 'task-2',
        agentSlug: 'code',
        agentName: 'Code Agent',
        goal: 'Inspect files again',
        status: 'running',
        chunks: [],
        steps: [],
        startedAt: 1000,
      },
    ]);
  });

  it('projects parallel task step events by worker id', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });

    const started = projectConversationRuntime(
      initial,
      {
        kind: 'parallelTaskStep',
        event: {
          batchId: 'batch-1',
          agentSlug: 'code',
          workerId: 'worker-1',
          step: { type: 'task_start', label: 'Code Agent', goal: 'Inspect files', ts: 1000 },
        },
      },
      deps,
    );
    const chunked = projectConversationRuntime(
      started.state,
      {
        kind: 'parallelTaskStep',
        event: {
          batchId: 'batch-1',
          agentSlug: 'code',
          workerId: 'worker-1',
          step: { type: 'text_chunk', content: 'Reading...', ts: 1000 },
        },
      },
      deps,
    );
    const ended = projectConversationRuntime(
      chunked.state,
      {
        kind: 'parallelTaskStep',
        event: {
          batchId: 'batch-1',
          agentSlug: 'code',
          workerId: 'worker-1',
          step: { type: 'task_end', success: true, summary: 'Done', ts: 1000 },
        },
      },
      deps,
    );

    expect(ended.state.parallelBatches).toEqual([
      {
        batchId: 'batch-1',
        startedAt: 1000,
        workers: [
          {
            workerId: 'worker-1',
            agentSlug: 'code',
            agentName: 'Code Agent',
            goal: 'Inspect files',
            status: 'success',
            steps: [],
            textBuffer: 'Reading...',
            startedAt: 1000,
            completedAt: 1000,
            summary: 'Done',
          },
        ],
      },
    ]);
  });

  it('updates parallel worker statuses from parallel_tasks tool output without losing live text', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
      parallelBatches: [
        {
          batchId: 'batch-1',
          startedAt: 900,
          workers: [
            {
              agentSlug: 'code',
              status: 'running',
              steps: [],
              textBuffer: 'Live text',
              startedAt: 900,
            },
          ],
        },
      ],
    });

    const result = projectConversationRuntime(
      initial,
      {
        kind: 'llm',
        event: {
          type: 'tool_end',
          id: 'parallel-tool-1',
          name: 'parallel_tasks',
          output: JSON.stringify({
            batchId: 'batch-1',
            results: [{ name: 'code', status: 'failure' }],
          }),
        },
      },
      deps,
    );

    expect(result.state.parallelBatches[0].workers[0]).toEqual({
      agentSlug: 'code',
      status: 'failure',
      steps: [],
      textBuffer: 'Live text',
      startedAt: 900,
      completedAt: 1000,
    });
  });

  it('restores activity facts and marks stale running work as failed when no stream is active', () => {
    const restored = restoreConversationRuntime({
      sessionId: 'session-1',
      isStreaming: false,
      agentRuns: [
        {
          id: 'run-1',
          session_id: 'session-1',
          agent_id: 'agent-1',
          request_id: 'assistant-1',
          status: 'failed',
          started_at: 800,
          ended_at: 1000,
          aborted: 0,
        },
      ],
      agentToolCalls: [
        {
          id: 'task-call-1',
          run_id: 'run-1',
          tool_name: 'task',
          input: JSON.stringify({
            subagent_type: 'code',
            task: JSON.stringify({ goal: 'Inspect files' }),
          }),
          output: null,
          status: 'running',
          error: null,
          started_at: 900,
          ended_at: null,
          approval_status: null,
        },
        {
          id: 'parallel-call-1',
          run_id: 'run-1',
          tool_name: 'parallel_tasks',
          input: JSON.stringify({
            tasks: [{ name: 'reviewer', description: 'Review output' }],
          }),
          output: null,
          status: 'running',
          error: null,
          started_at: 920,
          ended_at: null,
          approval_status: null,
        },
      ],
      latestTodos: [{ content: 'Inspect files', status: 'in_progress' }],
    });

    expect(restored.activeRunId).toBe('run-1');
    expect(restored.todos).toEqual([{ content: 'Inspect files', status: 'in_progress' }]);
    expect(restored.delegatedTasks).toEqual([
      {
        taskId: 'task-call-1',
        agentSlug: 'code',
        agentName: 'code',
        goal: 'Inspect files',
        status: 'failure',
        chunks: [],
        steps: [],
        result: {
          status: 'failure',
          artifacts: [],
          summary: '',
          error: { code: 'DISCONNECTED', message: '会话流已结束，任务未正常完成' },
        },
        errorCode: 'DISCONNECTED',
        startedAt: 900,
        completedAt: undefined,
      },
    ]);
    expect(restored.parallelBatches).toEqual([
      {
        batchId: 'parallel-call-1',
        startedAt: 920,
        workers: [
          {
            agentSlug: 'reviewer',
            agentName: undefined,
            goal: 'Review output',
            status: 'failure',
            steps: [],
            textBuffer: '',
            startedAt: 920,
            completedAt: undefined,
          },
        ],
      },
    ]);
  });

  it('restores completed task results and parallel worker output from persisted tool calls', () => {
    const restored = restoreConversationRuntime({
      sessionId: 'session-1',
      isStreaming: false,
      agentRuns: [
        {
          id: 'run-1',
          session_id: 'session-1',
          agent_id: 'agent-1',
          request_id: 'assistant-1',
          status: 'completed',
          started_at: 800,
          ended_at: 1000,
          aborted: 0,
        },
      ],
      agentToolCalls: [
        {
          id: 'task-call-1',
          run_id: 'run-1',
          tool_name: 'task',
          input: JSON.stringify({
            subagent_type: 'code',
            task: JSON.stringify({ goal: 'Implement feature' }),
          }),
          output: JSON.stringify({ status: 'success', artifacts: ['a.ts'], summary: 'Implemented' }),
          status: 'success',
          error: null,
          started_at: 900,
          ended_at: 950,
          approval_status: null,
        },
        {
          id: 'parallel-call-1',
          run_id: 'run-1',
          tool_name: 'parallel_tasks',
          input: JSON.stringify({
            tasks: [{ name: 'reviewer', description: 'Review output' }],
          }),
          output: JSON.stringify({
            batchId: 'batch-1',
            results: [{ name: 'reviewer', agentName: 'Reviewer', status: 'success', output: 'Looks good' }],
          }),
          status: 'success',
          error: null,
          started_at: 920,
          ended_at: 980,
          approval_status: null,
        },
      ],
    });

    expect(restored.delegatedTasks[0]).toEqual({
      taskId: 'task-call-1',
      agentSlug: 'code',
      agentName: 'code',
      goal: 'Implement feature',
      status: 'success',
      chunks: [],
      steps: [],
      result: { status: 'success', artifacts: ['a.ts'], summary: 'Implemented' },
      errorCode: undefined,
      startedAt: 900,
      completedAt: 950,
    });
    expect(restored.parallelBatches).toEqual([
      {
        batchId: 'batch-1',
        startedAt: 920,
        workers: [
          {
            agentSlug: 'reviewer',
            agentName: 'Reviewer',
            goal: 'Review output',
            status: 'success',
            steps: [],
            textBuffer: 'Looks good',
            startedAt: 920,
            completedAt: 980,
          },
        ],
      },
    ]);
  });
});

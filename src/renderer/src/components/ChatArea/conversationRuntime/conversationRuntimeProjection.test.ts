import { describe, expect, it } from 'vitest';
import type { Message } from '@shared/types';
import {
  createConversationRuntimeState,
  hydrateConversationRuntimeStream,
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

    expect(result.state.currentAssistantMsgId).toBe('assistant-current:assistant:1');
    expect(result.state.assistantSegmentIndex).toBe(1);
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
      pendingApprovals: [{ id: 'approval-1', runId: 'run-1', actions: [] }],
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
    expect(result.state.pendingApprovals).toEqual([]);
    expect(result.state.approvalHistory).toEqual([
      expect.objectContaining({ status: 'invalidated', executionStatus: 'rejected' }),
    ]);
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
      pendingApprovals: [{ id: 'approval-1', runId: 'run-1', actions: [] }],
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
    expect(result.state.pendingApprovals).toEqual([]);
    expect(result.state.approvalHistory).toEqual([
      expect.objectContaining({ status: 'invalidated', executionStatus: 'rejected', error: 'graph failed' }),
    ]);
    expect(result.effects).toEqual([
      { type: 'cleanupStream' },
      { type: 'setRetryableError', message: 'graph failed' },
      { type: 'rejectStream', error: 'graph failed' },
    ]);
  });

  it('keeps runtime error translation metadata for user-visible alerts', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-start',
      currentAssistantMsgId: 'assistant-current',
      messages: [
        {
          id: 'user-1',
          session_id: 'session-1',
          role: 'user',
          content: 'use subscription',
          created_at: 900,
          tokens: 1,
        },
        {
          id: 'assistant-current',
          session_id: 'session-1',
          role: 'assistant',
          content: '',
          created_at: 950,
          tokens: 0,
        },
      ],
    });

    const result = projectConversationRuntime(
      initial,
      {
        kind: 'llm',
        event: {
          type: 'runtime_error',
          error: 'settings.aiSubscriptions.runtimeError.notConnected',
          errorMessageKey: 'settings.aiSubscriptions.runtimeError.notConnected',
          errorMessageParams: { name: 'Codex OAuth', status: 'expired' },
        },
      },
      deps,
    );

    expect(result.effects).toEqual([
      { type: 'cleanupStream' },
      {
        type: 'setRetryableError',
        message: 'settings.aiSubscriptions.runtimeError.notConnected',
        messageParams: { name: 'Codex OAuth', status: 'expired' },
      },
      {
        type: 'rejectStream',
        error: 'settings.aiSubscriptions.runtimeError.notConnected',
        messageParams: { name: 'Codex OAuth', status: 'expired' },
      },
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

  it('resolves concurrent delegated approvals in reverse order and ignores stale duplicates', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });
    const first = {
      id: 'approval-1', runId: 'run-1', delegatedRunId: 'child-1', targetAgentName: 'Writer',
      actions: [{ name: 'write_file', args: { path: 'a.md' } }],
    };
    const second = {
      id: 'approval-2', runId: 'run-1', delegatedRunId: 'child-2', targetAgentName: 'Cleaner',
      actions: [{ name: 'delete_file', args: { path: 'b.md' } }],
    };
    const withFirst = projectConversationRuntime(initial, { kind: 'llm', event: { type: 'approval_required', approval: first } }, deps).state;
    const withBoth = projectConversationRuntime(withFirst, { kind: 'llm', event: { type: 'approval_required', approval: second } }, deps).state;
    const duplicate = projectConversationRuntime(withBoth, { kind: 'llm', event: { type: 'approval_required', approval: first } }, deps).state;
    const resolvedSecond = projectConversationRuntime(duplicate, {
      kind: 'llm',
      event: { type: 'approval_resolved', approvalId: second.id, status: 'rejected', resolvedAt: 123, executionStatus: 'rejected' },
    }, deps).state;
    const staleResolution = projectConversationRuntime(resolvedSecond, {
      kind: 'llm',
      event: { type: 'approval_resolved', approvalId: 'unknown-approval', status: 'approved', resolvedAt: 124 },
    }, deps).state;

    expect(duplicate.pendingApprovals.map((item) => item.id)).toEqual(['approval-1', 'approval-2']);
    expect(resolvedSecond.pendingApprovals).toEqual([first]);
    expect(resolvedSecond.pendingApproval).toBe(first);
    expect(resolvedSecond.approvalHistory).toEqual([
      expect.objectContaining({ approval: second, status: 'rejected', resolvedAt: 123, executionStatus: 'rejected' }),
    ]);
    expect(staleResolution).toBe(resolvedSecond);
  });

  it('projects run lifecycle events into active run state', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      requestId: 'background-continuation:batch-1',
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
        request_id: 'background-continuation:batch-1',
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
      request_id: 'background-continuation:batch-1',
      status: 'completed',
      started_at: 1000,
      ended_at: 1000,
      aborted: 0,
      error: null,
    });
  });

  it('hydrates a background run snapshot through the projection state', () => {
    const initial = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: null,
      currentAssistantMsgId: 'unused',
      messages: [],
      isStreaming: false,
    });

    const hydrated = hydrateConversationRuntimeStream(initial, {
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
      sequence: 4,
      content: '已生成',
      runId: 'run-1',
      agentId: 'agent-1',
      events: [],
    }, deps);

    expect(hydrated).toMatchObject({
      requestId: 'background-continuation:batch-1',
      streamingMessageId: 'background-continuation-output:batch-1',
      currentAssistantMsgId: 'background-continuation-output:batch-1',
      activeRunId: 'run-1',
      isStreaming: true,
      accumulatedContent: '已生成',
    });
    expect(hydrated.messages).toContainEqual(expect.objectContaining({
      id: 'background-continuation-output:batch-1',
      content: '已生成',
    }));
    expect(hydrated.agentRuns).toContainEqual(expect.objectContaining({
      id: 'run-1',
      request_id: 'background-continuation:batch-1',
    }));
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
      { kind: 'llm', event: { type: 'delegated_task_start', delegatedRunId: 'delegated-1', taskId: 'task-1', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files' } },
      deps,
    );
    const chunked = projectConversationRuntime(
      started.state,
      { kind: 'llm', event: { type: 'delegated_task_chunk', delegatedRunId: 'delegated-1', taskId: 'task-1', text: 'Reading...' } },
      deps,
    );
    const stepped = projectConversationRuntime(
      chunked.state,
      { kind: 'llm', event: { type: 'delegated_task_step', delegatedRunId: 'delegated-1', taskId: 'task-1', step } },
      deps,
    );
    const ended = projectConversationRuntime(
      stepped.state,
      { kind: 'llm', event: { type: 'delegated_task_end', delegatedRunId: 'delegated-1', taskId: 'task-1', status: 'success', result: resultPayload } },
      deps,
    );

    expect(started.effects).toEqual([{ type: 'openActivityPanel' }]);
    expect(ended.state.delegatedTasks).toEqual([
      {
        delegatedRunId: 'delegated-1',
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
      { kind: 'llm', event: { type: 'delegated_task_start', delegatedRunId: 'delegated-1', taskId: 'task-1', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files' } },
      deps,
    );
    const replayed = projectConversationRuntime(
      started.state,
      { kind: 'llm', event: { type: 'delegated_task_start', delegatedRunId: 'delegated-1', taskId: 'task-2', agentSlug: 'code', agentName: 'Code Agent', goal: 'Inspect files again' } },
      deps,
    );

    expect(replayed.state.delegatedTasks).toEqual([
      {
        delegatedRunId: 'delegated-1',
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

  it('projects parallel task step events by delegated-run identity', () => {
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
          delegatedRunId: 'delegated-1',
          agentSlug: 'code',
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
          delegatedRunId: 'delegated-1',
          agentSlug: 'code',
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
          delegatedRunId: 'delegated-1',
          agentSlug: 'code',
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
            delegatedRunId: 'delegated-1',
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

  it('keeps same-Agent parallel workers separate by delegated-run identity', () => {
    let state = createConversationRuntimeState({
      sessionId: 'session-1',
      streamingMessageId: 'assistant-current',
      currentAssistantMsgId: 'assistant-current',
    });

    for (const delegatedRunId of ['delegated-1', 'delegated-2']) {
      state = projectConversationRuntime(
        state,
        {
          kind: 'parallelTaskStep',
          event: {
            batchId: 'batch-1',
            delegatedRunId,
            agentSlug: 'code',
            step: { type: 'task_start', label: 'Code Agent', goal: delegatedRunId, ts: 1000 },
          },
        },
        deps,
      ).state;
    }

    expect(state.parallelBatches[0].workers.map((worker) => worker.delegatedRunId))
      .toEqual(['delegated-1', 'delegated-2']);
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
              delegatedRunId: 'delegated-1',
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
            results: [{ delegatedRunId: 'delegated-1', name: 'code', status: 'failure' }],
          }),
        },
      },
      deps,
    );

    expect(result.state.parallelBatches[0].workers[0]).toEqual({
      delegatedRunId: 'delegated-1',
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
    expect(restored.delegatedTasks).toEqual([]);
    expect(restored.parallelBatches).toEqual([]);
  });

  it('restores resolved and startup-invalidated delegated approvals as read-only history', () => {
    const delegatedRun = {
      id: 'child-1', parent_run_id: 'run-1', target_agent_id: 'agent-child',
      target_agent_slug: 'writer', target_agent_name: 'Writer', launch_form: 'single' as const,
      task_tool_call_id: 'task-1', batch_id: null, workflow_run_task_id: null,
      goal: 'Write a report', status: 'interrupted' as const, outcome: null,
      error_code: 'INTERRUPTED', error_message: 'stopped', created_at: 1,
      started_at: 2, ended_at: 5, updated_at: 5,
    };
    const action = (approvalStatus: 'approved' | 'invalidated', id: string) => ({
      id, delegated_run_id: delegatedRun.id, parent_run_id: 'run-1', action_id: `${id}-action`,
      tool_name: 'write_file', arguments: { path: 'report.md' }, description: 'Write report',
      sequence: 1, requires_approval: true, approval_status: approvalStatus,
      decision: approvalStatus === 'approved' ? 'approve' as const : null,
      execution_status: approvalStatus === 'approved' ? 'success' as const : 'rejected' as const,
      output: approvalStatus === 'approved' ? 'written' : null,
      error: approvalStatus === 'invalidated' ? 'Application stopped' : null,
      created_at: 2, decided_at: approvalStatus === 'approved' ? 3 : null,
      ended_at: 4, updated_at: 4,
    });

    const restored = restoreConversationRuntime({
      sessionId: 'session-1', isStreaming: false, agentRuns: [], agentToolCalls: [],
      delegatedAgentRuns: [delegatedRun],
      delegatedToolActions: [action('approved', 'approval-1'), action('invalidated', 'approval-2')],
    });

    expect(restored.approvalHistory).toEqual([
      expect.objectContaining({
        approval: expect.objectContaining({ id: 'approval-1', targetAgentName: 'Writer', delegatedTask: 'Write a report' }),
        status: 'approved', executionStatus: 'success',
      }),
      expect.objectContaining({ status: 'invalidated', executionStatus: 'rejected', error: 'Application stopped' }),
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
      delegatedAgentRuns: [
        {
          id: 'delegated-single', parent_run_id: 'run-1', target_agent_id: 'code-id', target_agent_slug: 'code', target_agent_name: 'Code',
          launch_form: 'single', task_tool_call_id: 'task-call-1', batch_id: null, workflow_run_task_id: null, goal: 'Implement feature',
          status: 'completed', outcome: { status: 'success', artifacts: ['a.ts'], summary: 'Implemented' }, error_code: null, error_message: null,
          created_at: 850, started_at: 900, ended_at: 950, updated_at: 950,
        },
        {
          id: 'delegated-parallel', parent_run_id: 'run-1', target_agent_id: 'reviewer-id', target_agent_slug: 'reviewer', target_agent_name: 'Reviewer',
          launch_form: 'parallel', task_tool_call_id: null, batch_id: 'batch-1', workflow_run_task_id: null, goal: 'Review output',
          status: 'completed', outcome: { status: 'success', artifacts: [], summary: 'Looks good' }, error_code: null, error_message: null,
          created_at: 920, started_at: 920, ended_at: 980, updated_at: 980,
        },
      ],
    });

    expect(restored.delegatedTasks[0]).toEqual({
      delegatedRunId: 'delegated-single',
      taskId: 'task-call-1',
      agentSlug: 'code',
      agentName: 'Code',
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
            delegatedRunId: 'delegated-parallel',
            agentSlug: 'reviewer',
            agentName: 'Reviewer',
            goal: 'Review output',
            summary: 'Looks good',
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

  it('restores parallel workers from first-class delegated-run records', () => {
    const makeRun = (id: string, status: 'completed' | 'failed') => ({
      id,
      parent_run_id: 'run-1',
      target_agent_id: 'agent-code',
      target_agent_slug: 'code',
      target_agent_name: 'Code Agent',
      launch_form: 'parallel' as const,
      task_tool_call_id: null,
      batch_id: 'batch-durable',
      workflow_run_task_id: null,
      goal: id,
      status,
      outcome: status === 'completed'
        ? { status: 'success' as const, artifacts: [], summary: 'done' }
        : { status: 'failure' as const, artifacts: [], summary: '', error: { code: 'TOOL_FAILED', message: 'failed' } },
      error_code: status === 'failed' ? 'TOOL_FAILED' : null,
      error_message: status === 'failed' ? 'failed' : null,
      created_at: 100,
      started_at: 110,
      ended_at: 200,
      updated_at: 200,
    });

    const restored = restoreConversationRuntime({
      sessionId: 'session-1',
      isStreaming: false,
      agentRuns: [],
      agentToolCalls: [],
      delegatedAgentRuns: [makeRun('delegated-1', 'completed'), makeRun('delegated-2', 'failed')],
    });

    expect(restored.delegatedTasks).toEqual([]);
    expect(restored.parallelBatches[0].workers.map((worker) => ({
      delegatedRunId: worker.delegatedRunId,
      status: worker.status,
    }))).toEqual([
      { delegatedRunId: 'delegated-1', status: 'success' },
      { delegatedRunId: 'delegated-2', status: 'failure' },
    ]);
  });

  it('restores delegated activity from first-class records without inferring ownership from tool timing', () => {
    const restored = restoreConversationRuntime({
      sessionId: 'session-1',
      isStreaming: false,
      agentRuns: [],
      agentToolCalls: [],
      delegatedAgentRuns: [{
        id: 'delegated-42',
        parent_run_id: 'run-1',
        target_agent_id: null,
        target_agent_slug: 'code',
        target_agent_name: 'Code Agent',
        launch_form: 'single',
        task_tool_call_id: 'task-42',
        batch_id: null,
        workflow_run_task_id: null,
        goal: 'Implement feature',
        status: 'completed',
        outcome: { status: 'success', artifacts: ['a.ts'], summary: 'Implemented' },
        error_code: null,
        error_message: null,
        created_at: 100,
        started_at: 110,
        ended_at: 200,
        updated_at: 200,
      }],
    });

    expect(restored.delegatedTasks).toEqual([expect.objectContaining({
      delegatedRunId: 'delegated-42',
      taskId: 'task-42',
      agentName: 'Code Agent',
      status: 'success',
      startedAt: 110,
      completedAt: 200,
    })]);
  });
});

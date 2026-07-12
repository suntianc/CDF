import { describe, expect, it } from 'vitest';
import {
  createRuntimeStreamState,
  projectRuntimeStream,
  type RuntimeStreamEvent,
  type RuntimeStreamProjectionDeps,
} from './runtime-stream-projection';

// Runtime Stream Projection 的测试通过「事件序列」驱动纯核心，
// 断言产出的 renderer 事件（LLMStreamEvent）与 effect 序列。
// 事件序列即并发交织的全序化表示——死锁/乱序场景在这里可以枚举。

function makeDeps(overrides: Partial<RuntimeStreamProjectionDeps> = {}): RuntimeStreamProjectionDeps {
  return {
    takeBufferedReasoning: () => '',
    takeFallbackText: () => '',
    lookupAgentName: (slug) => slug,
    generateToolCallId: () => 'generated-call-id',
    generateSubagentTaskId: (slug) => `subagent-${slug}-fixed`,
    ...overrides,
  };
}

function drive(events: RuntimeStreamEvent[], deps = makeDeps()) {
  let state = createRuntimeStreamState();
  const emitted: unknown[] = [];
  const effects: unknown[] = [];
  for (const event of events) {
    const result = projectRuntimeStream(state, event, deps);
    state = result.state;
    emitted.push(...result.events);
    effects.push(...result.effects);
  }
  return { state, emitted, effects };
}

describe('Runtime Stream Projection — text streaming', () => {
  it('passes plain text tokens through as message_chunk when the message has no reasoning source', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: false },
      { kind: 'text-token', token: '你好' },
      { kind: 'text-token', token: '，世界' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '你好' },
      { type: 'message_chunk', text: '，世界' },
    ]);
  });
});

describe('Runtime Stream Projection — tool call lifecycle', () => {
  it('translates a non-task tool call into tool_start / tool_end with DB effects', () => {
    const { emitted, effects } = drive([
      { kind: 'tool-call-started', callId: 'call-1', toolName: 'read_file', input: { path: '/a' } },
      { kind: 'tool-output', output: 'file contents' },
    ]);

    expect(emitted).toEqual([
      { type: 'tool_start', id: 'call-1', name: 'read_file', input: { path: '/a' } },
      { type: 'tool_end', id: 'call-1', name: 'read_file', output: 'file contents' },
    ]);
    expect(effects).toEqual([
      { type: 'upsert-tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: '/a' } },
      { type: 'update-tool-call', toolCallId: 'call-1', status: 'success', output: 'file contents' },
    ]);
  });

  it('generates a tool call id when the stream provides none', () => {
    const { emitted } = drive([
      { kind: 'tool-call-started', callId: undefined, toolName: 'bash', input: {} },
    ]);
    expect(emitted).toEqual([
      { type: 'tool_start', id: 'generated-call-id', name: 'bash', input: {} },
    ]);
  });

  it('drains pending buffered reasoning as a think block before tool_start', () => {
    const deps = makeDeps({ takeBufferedReasoning: () => '调用工具前的思考' });
    const { emitted } = drive(
      [{ kind: 'tool-call-started', callId: 'c1', toolName: 'bash', input: {} }],
      deps,
    );
    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '调用工具前的思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'tool_start', id: 'c1', name: 'bash', input: {} },
    ]);
  });

  it('reports a non-interrupt tool failure as tool_error with a DB error effect', () => {
    const { emitted, effects } = drive([
      { kind: 'tool-call-started', callId: 'c1', toolName: 'bash', input: {} },
      { kind: 'tool-failed', message: 'command exploded', isInterrupt: false },
    ]);
    expect(emitted[1]).toEqual({ type: 'tool_error', id: 'c1', name: 'bash', error: 'command exploded' });
    expect(effects[1]).toEqual({
      type: 'update-tool-call',
      toolCallId: 'c1',
      status: 'error',
      errorMessage: 'command exploded',
    });
  });

  it('stays silent on interrupt-classified tool failures (approval flow will surface them)', () => {
    const { emitted, effects } = drive([
      { kind: 'tool-call-started', callId: 'c1', toolName: 'write_file', input: {} },
      { kind: 'tool-failed', message: 'INTERRUPT', isInterrupt: true },
    ]);
    expect(emitted).toHaveLength(1); // 只有 tool_start
    expect(effects).toHaveLength(1); // 只有 upsert
  });
});

describe('Runtime Stream Projection — delegated task (task tool)', () => {
  const startTask = (goal = '写测试') =>
    ({
      kind: 'tool-call-started',
      callId: 'call-t1',
      toolName: 'task',
      input: { subagent_type: 'coder', task: JSON.stringify({ name: 'coder', goal }) },
    }) as const;

  it('emits delegated_task_start with parsed goal and looked-up agent name', () => {
    const deps = makeDeps({ lookupAgentName: (slug) => (slug === 'coder' ? 'Code Writer' : slug) });
    const { emitted } = drive([startTask('实现登录')], deps);

    expect(emitted).toEqual([
      {
        type: 'tool_start',
        id: 'call-t1',
        name: 'task',
        input: { subagent_type: 'coder', task: JSON.stringify({ name: 'coder', goal: '实现登录' }) },
      },
      {
        type: 'delegated_task_start',
        taskId: 'call-t1',
        agentSlug: 'coder',
        agentName: 'Code Writer',
        goal: '实现登录',
      },
    ]);
  });

  it('falls back to description for goal when task JSON is absent', () => {
    const { emitted } = drive([
      {
        kind: 'tool-call-started',
        callId: 'call-t2',
        toolName: 'task',
        input: { subagent_type: 'coder', description: '目标描述' },
      },
    ]);
    const started = emitted.find((e) => (e as { type: string }).type === 'delegated_task_start');
    expect(started).toMatchObject({ goal: '目标描述' });
  });

  it('parses a standard delegated result and emits delegated_task_end success', () => {
    const result = { status: 'success', artifacts: [], summary: '完成' };
    const { emitted, effects } = drive([
      startTask(),
      { kind: 'tool-output', output: JSON.stringify(result) },
    ]);

    expect(emitted.at(-1)).toEqual({
      type: 'delegated_task_end',
      taskId: 'call-t1',
      status: 'success',
      result,
      errorCode: undefined,
    });
    // D-11：解析后的标准结果覆写 DB，供 sessionStore 直接重建 summary。
    expect(effects.at(-1)).toEqual({
      type: 'update-tool-call',
      toolCallId: 'call-t1',
      status: 'success',
      output: result,
    });
  });

  it('extracts the result from a LangChain Command envelope (fallback level 2)', () => {
    const inner = { status: 'success', artifacts: [], summary: '来自Command' };
    const command = {
      lg_name: 'Command',
      update: { messages: [{ kwargs: { content: JSON.stringify(inner) } }] },
    };
    const { emitted } = drive([startTask(), { kind: 'tool-output', output: JSON.stringify(command) }]);
    expect(emitted.at(-1)).toMatchObject({ type: 'delegated_task_end', status: 'success', result: inner });
  });

  it('treats non-JSON Command content as a plain-text summary (fallback level 3)', () => {
    const command = {
      lg_name: 'Command',
      update: { messages: [{ kwargs: { content: '纯文本结果' } }] },
    };
    const { emitted } = drive([startTask(), { kind: 'tool-output', output: JSON.stringify(command) }]);
    expect(emitted.at(-1)).toMatchObject({
      type: 'delegated_task_end',
      status: 'success',
      result: { status: 'success', artifacts: [], summary: '纯文本结果' },
    });
  });

  it('reports PARSE_FAILED when the output matches no known shape', () => {
    const { emitted } = drive([startTask(), { kind: 'tool-output', output: '!!!not json!!!' }]);
    expect(emitted.at(-1)).toMatchObject({
      type: 'delegated_task_end',
      status: 'failure',
      errorCode: 'PARSE_FAILED',
    });
  });

  it('classifies timeout failures as TIMEOUT in delegated_task_end', () => {
    const { emitted } = drive([
      startTask(),
      { kind: 'tool-failed', message: 'Request timeout after 60s', isInterrupt: false },
    ]);
    expect(emitted.at(-1)).toMatchObject({
      type: 'delegated_task_end',
      status: 'failure',
      errorCode: 'TIMEOUT',
    });
  });

  // undici/fetch stream cut: TypeError message is literally "terminated".
  // Must not collapse to opaque UNKNOWN (UI shows "UNKNOWN terminated").
  it('classifies undici stream termination as NETWORK in delegated_task_end', () => {
    const { emitted } = drive([
      startTask(),
      { kind: 'tool-failed', message: 'terminated', isInterrupt: false },
    ]);
    expect(emitted.at(-1)).toMatchObject({
      type: 'delegated_task_end',
      status: 'failure',
      errorCode: 'NETWORK',
      result: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: 'NETWORK', message: 'terminated' },
      },
    });
  });
});

describe('Runtime Stream Projection — subagent stream correlation', () => {
  const startCoderTask = {
    kind: 'tool-call-started',
    callId: 'task-call-9',
    toolName: 'task',
    input: { subagent_type: 'coder', task: JSON.stringify({ name: 'coder', goal: 'x' }) },
  } as const;

  it('routes subagent text to the taskId registered by an earlier task call', () => {
    const { emitted } = drive([
      startCoderTask,
      { kind: 'subagent-started', slug: 'coder' },
      { kind: 'subagent-text', slug: 'coder', text: '子代理输出' },
    ]);

    expect(emitted.at(-1)).toEqual({
      type: 'delegated_task_chunk',
      taskId: 'task-call-9',
      text: '子代理输出',
    });
  });

  it('synthesizes a taskId and emits delegated_task_start when the subagent appears before any task call', () => {
    const { emitted } = drive([
      { kind: 'subagent-started', slug: 'coder' },
      { kind: 'subagent-text', slug: 'coder', text: '先到的输出' },
    ]);

    expect(emitted).toEqual([
      {
        type: 'delegated_task_start',
        taskId: 'subagent-coder-fixed',
        agentSlug: 'coder',
        agentName: 'coder',
        goal: '',
      },
      { type: 'delegated_task_chunk', taskId: 'subagent-coder-fixed', text: '先到的输出' },
    ]);
  });

  it('reuses the pre-registered subagent taskId for the matching task tool call', () => {
    // subagent 先出现（合成 id）→ 随后 task 调用同 slug：toolCallId 复用合成 id
    //（原逻辑 toolCallId = existingSubagentTaskId || call.callId || uuid）。
    const { emitted } = drive([
      { kind: 'subagent-started', slug: 'coder' },
      startCoderTask,
    ]);

    const toolStart = emitted.find((e) => (e as { type: string }).type === 'tool_start');
    expect(toolStart).toMatchObject({ id: 'subagent-coder-fixed' });
  });

  it('routes runtime accumulator text and steps to the in-flight task', () => {
    const { emitted } = drive([
      startCoderTask,
      { kind: 'accumulator-text', text: '任务途中的文本' },
      { kind: 'accumulator-step', step: { type: 'tool_call', ts: 1 } as never },
    ]);

    expect(emitted.slice(-2)).toEqual([
      { type: 'delegated_task_chunk', taskId: 'task-call-9', text: '任务途中的文本' },
      { type: 'delegated_task_step', taskId: 'task-call-9', step: { type: 'tool_call', ts: 1 } },
    ]);
  });

  it('drops accumulator text when no task is in flight (non-task periods)', () => {
    const { emitted } = drive([{ kind: 'accumulator-text', text: '无处安放' }]);
    expect(emitted).toEqual([]);
  });

  it('clears the slug registration after delegated_task_end so a new task gets a fresh id', () => {
    const { emitted } = drive([
      startCoderTask,
      { kind: 'tool-output', output: JSON.stringify({ status: 'success', artifacts: [], summary: 'ok' }) },
      { kind: 'subagent-started', slug: 'coder' },
      { kind: 'subagent-text', slug: 'coder', text: '第二轮' },
    ]);

    expect(emitted.at(-1)).toEqual({
      type: 'delegated_task_chunk',
      taskId: 'subagent-coder-fixed',
      text: '第二轮',
    });
  });
});

describe('Runtime Stream Projection — model-triggered skill attribution', () => {
  const attribution = {
    phase: 'model-discovery',
    name: 'deploy',
    qualifiedName: 'project:deploy',
    sourceKind: 'project',
    sourceLabel: 'Project Skill',
    skillPath: '/repo/.cdf/skills/deploy/SKILL.md',
    visibility: 'on',
    modelDiscovery: 'visible',
    userInvocable: true,
  } as never;

  it('emits skill_attribution once when read_file targets a discovered skill path', () => {
    const { emitted } = drive(
      [
        {
          kind: 'run-started',
          runId: 'run-attr',
          skillAttributions: [attribution],
        },
        {
          kind: 'tool-call-started',
          callId: 'c1',
          toolName: 'read_file',
          input: { file_path: '/repo/.cdf/skills/deploy/SKILL.md' },
        },
        { kind: 'tool-output', output: 'skill body' },
        {
          kind: 'tool-call-started',
          callId: 'c2',
          toolName: 'read_file',
          input: { file_path: '/repo/.cdf/skills/deploy/SKILL.md' },
        },
      ],
    );

    const attributions = emitted.filter((e) => (e as { type: string }).type === 'skill_attribution');
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({
      attributions: [{ phase: 'model-triggered', skillPath: '/repo/.cdf/skills/deploy/SKILL.md' }],
    });
  });
});

describe('Runtime Stream Projection — turn end protocol', () => {
  const runStart = { kind: 'run-started', runId: 'run-1', skillAttributions: [] } as const;

  it('completes the run: run_updated completed + update-run effect + stop directive', () => {
    const { emitted, effects } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'turn-stream-ended', interrupted: false, terminal: 'completed', latestAssistantContent: null },
    ]);

    expect(emitted.at(-1)).toEqual({ type: 'run_updated', runId: 'run-1', status: 'completed' });
    expect(effects).toEqual([
      { type: 'clear-accumulator-text' },
      { type: 'update-run', status: 'completed' },
      { type: 'stop-turn-loop' },
    ]);
  });

  it('requests approval on interrupt instead of completing', () => {
    const { emitted, effects } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'turn-stream-ended', interrupted: true, terminal: null, latestAssistantContent: null },
    ]);

    expect(emitted.filter((e) => (e as { type: string }).type === 'run_updated')).toHaveLength(0);
    expect(effects).toEqual([
      { type: 'clear-accumulator-text' },
      { type: 'await-approval' },
    ]);
  });

  it('keeps looping on subagent failure so the LLM can react to the failure output', () => {
    const { emitted, effects } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'turn-stream-ended', interrupted: false, terminal: 'failed', latestAssistantContent: null },
    ]);

    expect(emitted.at(-1)).toEqual({
      type: 'run_updated',
      runId: 'run-1',
      status: 'failed',
      error: 'Subagent execution failed',
    });
    expect(effects).toEqual([
      { type: 'clear-accumulator-text' },
      { type: 'update-run', status: 'failed' },
      { type: 'continue-turn-loop' },
    ]);
  });

  it('closes a dangling think block left open by an aborted reasoning stream', () => {
    const { emitted } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-token', token: '未闭合的思考' },
      // reasoning-ended 缺失（中断场景），message-ended 也未到达
      { kind: 'turn-stream-ended', interrupted: false, terminal: 'completed', latestAssistantContent: null },
    ]);

    const closeChunks = emitted.filter(
      (e) => (e as { text?: string }).text === '</think>\n\n',
    );
    expect(closeChunks).toHaveLength(1);
  });

  it('backfills the assistant content when streaming produced no visible text', () => {
    const { emitted } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'turn-stream-ended', interrupted: false, terminal: 'completed', latestAssistantContent: '<think>内心</think>补发的完整回答' },
    ]);

    expect(emitted).toContainEqual({
      type: 'message_chunk',
      text: '<think>内心</think>补发的完整回答',
    });
  });

  it('falls back to accumulator text when neither stream nor output produced content', () => {
    const deps = makeDeps({ takeFallbackText: () => '兜底正文' });
    const { emitted } = drive(
      [
        runStart,
        { kind: 'turn-started' },
        { kind: 'turn-stream-ended', interrupted: false, terminal: 'completed', latestAssistantContent: null },
      ],
      deps,
    );

    expect(emitted).toContainEqual({ type: 'message_chunk', text: '兜底正文' });
  });

  it('does not backfill when visible text already streamed this turn', () => {
    const { emitted } = drive([
      runStart,
      { kind: 'turn-started' },
      { kind: 'message-started', hasReasoningSource: false },
      { kind: 'text-token', token: '已流式的正文' },
      { kind: 'message-ended' },
      { kind: 'turn-stream-ended', interrupted: false, terminal: 'completed', latestAssistantContent: '不该出现' },
    ]);

    expect(emitted.filter((e) => (e as { text?: string }).text === '不该出现')).toHaveLength(0);
  });

  it('marks the run aborted on run-aborted', () => {
    const { emitted, effects } = drive([
      runStart,
      { kind: 'run-aborted' },
    ]);
    expect(emitted).toEqual([{ type: 'run_updated', runId: 'run-1', status: 'aborted' }]);
    expect(effects).toEqual([{ type: 'update-run', status: 'aborted', aborted: true }]);
  });
});

describe('Runtime Stream Projection — buffered reasoning drain (deps)', () => {
  it('drains accumulator reasoning as one think block before the first visible text', () => {
    // llm-adapter 把思考捕获进 accumulator 而非流式 reasoning 时，
    // 首个可见正文前核心应通过 deps 抽干并补发完整 think 块。
    const deps = makeDeps({ takeBufferedReasoning: () => '缓冲的思考' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: false },
        { kind: 'text-token', token: '正文' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '缓冲的思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文' },
    ]);
  });

  it('drains buffered reasoning at most once per message', () => {
    let calls = 0;
    const deps = makeDeps({
      takeBufferedReasoning: () => {
        calls += 1;
        return calls === 1 ? '只此一次' : '不应出现';
      },
    });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: false },
        { kind: 'text-token', token: 'A' },
        { kind: 'text-token', token: 'B' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '只此一次' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: 'A' },
      { type: 'message_chunk', text: 'B' },
    ]);
  });

  it('drains buffered reasoning when flushing backpressured text after a zero-token reasoning stream', () => {
    // reasoning 源存在但一个 token 都没产出（部分模型行为）：
    // 积压文本在 reasoning-ended 冲刷时，仍要先补发 accumulator 里捕获的思考。
    const deps = makeDeps({ takeBufferedReasoning: () => '适配器捕获的思考' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: true },
        { kind: 'text-token', token: '被积压的正文' },
        { kind: 'reasoning-ended' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '适配器捕获的思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '被积压的正文' },
    ]);
  });

  it('does not drain when reasoning already streamed in this message', () => {
    const deps = makeDeps({ takeBufferedReasoning: () => '不应出现' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: true },
        { kind: 'reasoning-token', token: '流式思考' },
        { kind: 'reasoning-ended' },
        { kind: 'text-token', token: '正文' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '流式思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文' },
    ]);
  });
});

describe('Runtime Stream Projection — streamed reasoning', () => {
  it('wraps streamed reasoning tokens in think tags: open before first token, close after reasoning ends', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-token', token: '思考中' },
      { kind: 'reasoning-token', token: '…继续' },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '思考中' },
      { type: 'message_chunk', text: '…继续' },
      { type: 'message_chunk', text: '</think>\n\n' },
    ]);
  });

  it('buffers text tokens that arrive while reasoning is still streaming, flushing them after the think block closes', () => {
    // 并发交织的全序化：text token 与 reasoning token 交错到达。
    // 现网行为：reasoning 未完成前 text 积压，思考块闭合后按序冲刷。
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-token', token: '先想' },
      { kind: 'text-token', token: '正文A' },
      { kind: 'reasoning-token', token: '再想' },
      { kind: 'text-token', token: '正文B' },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '先想' },
      { type: 'message_chunk', text: '再想' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文A' },
      { type: 'message_chunk', text: '正文B' },
    ]);
  });

  it('does not buffer text when the message has no reasoning source, even before any reasoning-ended', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: false },
      { kind: 'text-token', token: '直发' },
      { kind: 'message-ended' },
    ]);
    expect(emitted).toEqual([{ type: 'message_chunk', text: '直发' }]);
  });

  it('emits no think tags when the reasoning source exists but yields zero tokens', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([]);
  });
});
import type { DelegatedTaskResult, ExecutionStep, LLMStreamEvent, SkillAttribution } from '../shared/types';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../shared/types';
import { classifyDelegatedRunFailure } from './deepagent/delegated-run-failure';

export const THINK_OPEN_TAG = '<think>';
export const THINK_CLOSE_TAG = '</think>';

function getPotentialThinkTagSuffixLength(text: string): number {
  const tags = [THINK_OPEN_TAG, THINK_CLOSE_TAG];
  const maxLength = Math.min(Math.max(...tags.map((tag) => tag.length - 1)), text.length);
  for (let length = maxLength; length > 0; length--) {
    const suffix = text.slice(-length);
    if (tags.some((tag) => tag.startsWith(suffix))) {
      return length;
    }
  }
  return 0;
}

// 流式可见文本过滤器：透传 <think>…</think> 标记本身（renderer 折叠用），
// 但保证跨 token 撕裂的标记不闪现（尾部悬挂半个标记时先扣留）。
export class VisibleTextThinkTagFilter {
  private buffer = '';
  private rawThinkDepth = 0;

  push(text: string): string {
    this.buffer += text;
    let output = '';

    while (this.buffer.length > 0) {
      const openIdx = this.buffer.indexOf(THINK_OPEN_TAG);
      const closeIdx = this.buffer.indexOf(THINK_CLOSE_TAG);
      const nextIdx = [openIdx, closeIdx].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];

      if (nextIdx === undefined) {
        const pendingLength = getPotentialThinkTagSuffixLength(this.buffer);
        output += pendingLength > 0 ? this.buffer.slice(0, -pendingLength) : this.buffer;
        this.buffer = pendingLength > 0 ? this.buffer.slice(-pendingLength) : '';
        break;
      }

      output += this.buffer.slice(0, nextIdx);
      if (nextIdx === openIdx) {
        output += THINK_OPEN_TAG;
        this.rawThinkDepth += 1;
        this.buffer = this.buffer.slice(nextIdx + THINK_OPEN_TAG.length);
      } else {
        if (this.rawThinkDepth > 0) {
          output += THINK_CLOSE_TAG;
          this.rawThinkDepth -= 1;
        }
        this.buffer = this.buffer.slice(nextIdx + THINK_CLOSE_TAG.length);
      }
    }

    return output;
  }

  flush(): string {
    const text = this.buffer;
    this.buffer = '';
    return text;
  }
}

// Runtime Stream Projection —— 主进程侧的纯投影核心（镜像 renderer 的
// Conversation Runtime Projection，ADR-0005/0006 纪律的延伸，见 ADR-0053）。
//
// 壳层（runLLMChat）把 4 路并发 async iterator 串行化为带标签的
// RuntimeStreamEvent 全序，逐条喂给本核心；核心以纯函数形态维护
// think-tag 开合、reasoning/text 背压、taskId 关联等全部流协议状态，
// 产出待发 renderer 事件（LLMStreamEvent）与待执行 effect。
// I/O（webContents.send / DB 写 / LangGraph 迭代）永不出现在这里。

export type RuntimeStreamEvent =
  | { kind: 'message-started'; hasReasoningSource: boolean }
  | { kind: 'reasoning-token'; token: string }
  | { kind: 'reasoning-ended' }
  | { kind: 'text-token'; token: string }
  | { kind: 'message-ended' }
  | {
      kind: 'tool-call-started';
      callId: string | undefined;
      toolName: string;
      input: unknown;
      delegatedRun?: {
        id: string;
        targetAgentSlug: string;
        targetAgentName: string;
        goal: string;
      };
    }
  | { kind: 'tool-output'; output: unknown }
  | { kind: 'tool-failed'; message: string; isInterrupt: boolean }
  | { kind: 'run-started'; runId: string; skillAttributions: readonly SkillAttribution[] }
  | { kind: 'turn-started' }
  | {
      kind: 'turn-stream-ended';
      interrupted: boolean;
      terminal: 'completed' | 'interrupted' | 'failed' | null;
      latestAssistantContent: string | null;
    }
  | { kind: 'run-aborted' }
  | { kind: 'accumulator-text'; delegatedRunId: string; text: string }
  | { kind: 'accumulator-step'; delegatedRunId: string; step: ExecutionStep };

// 与现网字节一致：开标记裸发，闭标记带双换行（renderer 折叠块之后需要空行分隔正文）。
const THINK_CLOSE_CHUNK = `${THINK_CLOSE_TAG}\n\n`;

export interface RuntimeStreamProjectionDeps {
  // 从 stream accumulator 抽干缓冲的思考文本（llm-adapter 捕获、跨层传递）。
  takeBufferedReasoning: () => string;
  // 轮次结束仍无正文时的兜底文本来源。
  takeFallbackText: () => string;
  // 流未携带 callId 时为工具调用生成 id。
  generateToolCallId: () => string;
}

export type RuntimeStreamProjectionEffect =
  | { type: 'upsert-tool-call'; toolCallId: string; delegatedRunId?: string; toolName: string; input: unknown }
  | {
      type: 'update-tool-call';
      toolCallId: string;
      status: 'success' | 'error' | 'skipped';
      output?: unknown;
      errorMessage?: string;
    }
  | { type: 'update-run'; status: 'completed' | 'failed' | 'aborted'; aborted?: boolean }
  | { type: 'clear-accumulator-text' }
  | { type: 'await-approval' }
  | { type: 'stop-turn-loop' }
  | { type: 'continue-turn-loop' };

interface ActiveToolCall {
  toolCallId: string;
  toolName: string;
  // task 工具专属：Delegated Agent Run 是 activity ownership 的权威身份。
  delegatedRunId: string | null;
}

interface MessageState {
  hasReasoningSource: boolean;
  reasoningDone: boolean;
  reasoningStreamed: boolean;
  // 本消息是否已呈现过思考（流式或补发），guard 缓冲思考至多补发一次。
  sentReasoning: boolean;
  textBuffer: string[];
  visibleTextFilter: VisibleTextThinkTagFilter;
}

interface TurnState {
  sentText: boolean;
  sentReasoningOpen: boolean;
  sentReasoningClosed: boolean;
}

export interface RuntimeStreamProjectionState {
  runId: string | null;
  turn: TurnState;
  message: MessageState | null;
  // 工具调用在壳层是顺序 await 的，任一时刻至多一个在途。
  activeToolCall: ActiveToolCall | null;
  // run 级：模型可发现的 Skill 归因 + 已发路径去重。
  skillAttributions: readonly SkillAttribution[];
  emittedSkillPaths: Set<string>;
}

export interface RuntimeStreamProjectionResult {
  state: RuntimeStreamProjectionState;
  events: LLMStreamEvent[];
  effects: RuntimeStreamProjectionEffect[];
}

export function createRuntimeStreamState(): RuntimeStreamProjectionState {
  return {
    runId: null,
    turn: { sentText: false, sentReasoningOpen: false, sentReasoningClosed: false },
    message: null,
    activeToolCall: null,
    skillAttributions: [],
    emittedSkillPaths: new Set(),
  };
}

// 完整文本的 think 过滤（补发路径用）：与流式过滤器同一状态机、一次吃整段。
function sanitizeVisibleText(text: string): string {
  const filter = new VisibleTextThinkTagFilter();
  return filter.push(text) + filter.flush();
}

function getToolInputPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const rawPath = record.path ?? record.file_path ?? record.filePath ?? record.AbsolutePath ?? record.TargetFile;
  return typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : null;
}

// read_file 命中 model-discovery 归因路径时升格为 model-triggered，一条路径只发一次。
function findModelTriggeredSkill(
  state: RuntimeStreamProjectionState,
  toolName: string,
  input: unknown,
): SkillAttribution | null {
  if (toolName !== 'read_file') return null;
  const requestedPath = getToolInputPath(input);
  if (!requestedPath || !state.skillAttributions.length) return null;
  const attribution = state.skillAttributions.find(
    (item) => item.phase === 'model-discovery' && item.skillPath === requestedPath,
  );
  if (!attribution || state.emittedSkillPaths.has(attribution.skillPath)) return null;
  state.emittedSkillPaths.add(attribution.skillPath);
  return { ...attribution, phase: 'model-triggered' };
}

function pushReasoningBlock(
  state: RuntimeStreamProjectionState,
  text: string,
  events: LLMStreamEvent[],
): void {
  state.turn.sentReasoningOpen = true;
  state.turn.sentReasoningClosed = true;
  events.push({ type: 'message_chunk', text: THINK_OPEN_TAG });
  events.push({ type: 'message_chunk', text });
  events.push({ type: 'message_chunk', text: THINK_CLOSE_CHUNK });
}

function drainReasoningAtToolBoundary(
  state: RuntimeStreamProjectionState,
  deps: RuntimeStreamProjectionDeps,
  events: LLMStreamEvent[],
): void {
  const reasoningText = deps.takeBufferedReasoning();
  if (!reasoningText) return;
  pushReasoningBlock(state, reasoningText, events);
}

function drainBufferedReasoning(
  state: RuntimeStreamProjectionState,
  message: MessageState,
  deps: RuntimeStreamProjectionDeps,
  events: LLMStreamEvent[],
): void {
  if (message.sentReasoning) return;
  const reasoningText = deps.takeBufferedReasoning();
  if (!reasoningText) return;
  message.sentReasoning = true;
  pushReasoningBlock(state, reasoningText, events);
}

interface ParsedDelegatedOutput {
  status: 'success' | 'failure';
  result: DelegatedTaskResult;
  errorCode: string | undefined;
}

// 委派任务输出解析：标准 schema → LangChain Command 信封 → 纯文本 content 三层回退。
// 逻辑与原 runLLMChat 内联版本逐语义对应（PARSE_FAILED 兜底）。
function parseDelegatedTaskOutput(output: unknown): ParsedDelegatedOutput {
  try {
    const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
    const direct = DELEGATED_TASK_RESULT_SCHEMA.safeParse(JSON.parse(rawOutput));
    if (direct.success) {
      const result = direct.data;
      if (result.status === 'failure') {
        return { status: 'failure', result, errorCode: result.error?.code };
      }
      return { status: 'success', result, errorCode: undefined };
    }

    const cmd = JSON.parse(rawOutput) as {
      lg_name?: string;
      update?: { messages?: Array<{ kwargs?: { content?: unknown } } | string> };
    };
    if (cmd?.lg_name === 'Command' && cmd?.update?.messages?.length) {
      const toolMsg = cmd.update.messages[cmd.update.messages.length - 1];
      const content = typeof toolMsg === 'object' ? toolMsg.kwargs?.content : toolMsg;
      if (typeof content === 'string') {
        try {
          const inner = DELEGATED_TASK_RESULT_SCHEMA.safeParse(JSON.parse(content));
          if (inner.success) {
            const result = inner.data;
            if (result.status === 'failure') {
              return { status: 'failure', result, errorCode: result.error?.code };
            }
            return { status: 'success', result, errorCode: undefined };
          }
          return {
            status: 'success',
            result: { status: 'success', artifacts: [], summary: content.slice(0, 500) },
            errorCode: undefined,
          };
        } catch {
          return {
            status: 'success',
            result: {
              status: 'success',
              artifacts: [],
              summary: typeof content === 'string' ? content.slice(0, 500) : String(content).slice(0, 500),
            },
            errorCode: undefined,
          };
        }
      }
      return {
        status: 'success',
        result: { status: 'success', artifacts: [], summary: '任务执行完成' },
        errorCode: undefined,
      };
    }

    const rawSlice = rawOutput.slice(0, 200);
    return {
      status: 'failure',
      result: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: 'PARSE_FAILED', message: `无法解析子Agent返回: ${rawSlice}` },
      },
      errorCode: 'PARSE_FAILED',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown parse error';
    return {
      status: 'failure',
      result: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: 'PARSE_FAILED', message },
      },
      errorCode: 'PARSE_FAILED',
    };
  }
}

export function projectRuntimeStream(
  state: RuntimeStreamProjectionState,
  event: RuntimeStreamEvent,
  deps: RuntimeStreamProjectionDeps,
): RuntimeStreamProjectionResult {
  const events: LLMStreamEvent[] = [];

  switch (event.kind) {
    case 'message-started': {
      return {
        state: {
          ...state,
          message: {
            hasReasoningSource: event.hasReasoningSource,
            reasoningDone: false,
            reasoningStreamed: false,
            sentReasoning: false,
            textBuffer: [],
            visibleTextFilter: new VisibleTextThinkTagFilter(),
          },
        },
        events,
        effects: [],
      };
    }
    case 'reasoning-token': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      if (!message.reasoningStreamed) {
        message.reasoningStreamed = true;
        message.sentReasoning = true;
        state.turn.sentReasoningOpen = true;
        state.turn.sentReasoningClosed = false;
        events.push({ type: 'message_chunk', text: THINK_OPEN_TAG });
      }
      events.push({ type: 'message_chunk', text: event.token });
      return { state, events, effects: [] };
    }
    case 'reasoning-ended': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      if (message.reasoningStreamed) {
        state.turn.sentReasoningClosed = true;
        events.push({ type: 'message_chunk', text: THINK_CLOSE_CHUNK });
      }
      message.reasoningDone = true;
      // 背压冲刷：reasoning 期间积压的 text token 在思考块闭合后按到达序补发。
      // 与直发路径同规：首个可见正文前先补发 accumulator 捕获的思考。
      for (const buffered of message.textBuffer) {
        const visibleText = message.visibleTextFilter.push(buffered);
        if (visibleText) {
          drainBufferedReasoning(state, message, deps, events);
          state.turn.sentText = true;
          events.push({ type: 'message_chunk', text: visibleText });
        }
      }
      message.textBuffer = [];
      return { state, events, effects: [] };
    }
    case 'text-token': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      // 背压：reasoning 源存在且尚未完成时积压，避免正文插入思考块中间。
      if (message.hasReasoningSource && !message.reasoningDone) {
        message.textBuffer.push(event.token);
        return { state, events, effects: [] };
      }
      const visibleText = message.visibleTextFilter.push(event.token);
      if (visibleText) {
        drainBufferedReasoning(state, message, deps, events);
        state.turn.sentText = true;
        events.push({ type: 'message_chunk', text: visibleText });
      }
      return { state, events, effects: [] };
    }
    case 'message-ended': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      const remaining = message.visibleTextFilter.flush();
      if (remaining) {
        drainBufferedReasoning(state, message, deps, events);
        state.turn.sentText = true;
        events.push({ type: 'message_chunk', text: remaining });
      }
      return { state: { ...state, message: null }, events, effects: [] };
    }
    case 'tool-call-started': {
      const effects: RuntimeStreamProjectionEffect[] = [];
      // 现网行为：任何工具调用前先冲刷 accumulator 中未呈现的思考。
      drainReasoningAtToolBoundary(state, deps, events);
      const toolCallId = event.callId || deps.generateToolCallId();
      const delegatedRunId = event.delegatedRun?.id;
      effects.push({
        type: 'upsert-tool-call',
        toolCallId,
        ...(delegatedRunId ? { delegatedRunId } : {}),
        toolName: event.toolName,
        input: event.input,
      });
      const triggeredSkill = findModelTriggeredSkill(state, event.toolName, event.input);
      if (triggeredSkill) {
        events.push({ type: 'skill_attribution', attributions: [triggeredSkill] });
      }
      events.push({
        type: 'tool_start',
        id: toolCallId,
        ...(delegatedRunId ? { delegatedRunId } : {}),
        name: event.toolName,
        input: event.input,
      });

      if (event.toolName === 'task' && event.delegatedRun) {
        events.push({
          type: 'delegated_task_start',
          delegatedRunId: event.delegatedRun.id,
          taskId: toolCallId,
          agentSlug: event.delegatedRun.targetAgentSlug,
          agentName: event.delegatedRun.targetAgentName,
          goal: event.delegatedRun.goal,
        });
      }

      return {
        state: {
          ...state,
          activeToolCall: {
            toolCallId,
            toolName: event.toolName,
            delegatedRunId: delegatedRunId ?? null,
          },
        },
        events,
        effects,
      };
    }
    case 'tool-output': {
      const active = state.activeToolCall;
      if (!active) return { state, events, effects: [] };
      const effects: RuntimeStreamProjectionEffect[] = [
        { type: 'update-tool-call', toolCallId: active.toolCallId, status: 'success', output: event.output },
      ];
      events.push({
        type: 'tool_end',
        id: active.toolCallId,
        ...(active.delegatedRunId ? { delegatedRunId: active.delegatedRunId } : {}),
        name: active.toolName,
        output: event.output,
      });

      if (active.delegatedRunId !== null) {
        const parsed = parseDelegatedTaskOutput(event.output);
        effects.push({
          type: 'update-tool-call',
          toolCallId: active.toolCallId,
          status: parsed.status === 'failure' ? 'error' : 'success',
          output: parsed.result,
        });
        events.push({
          type: 'delegated_task_end',
          delegatedRunId: active.delegatedRunId,
          taskId: active.toolCallId,
          status: parsed.status,
          result: parsed.result,
          errorCode: parsed.errorCode,
        });
      }
      return { state: { ...state, activeToolCall: null }, events, effects };
    }
    case 'tool-failed': {
      const active = state.activeToolCall;
      if (!active) return { state, events, effects: [] };
      if (event.isInterrupt) {
        return { state: { ...state, activeToolCall: null }, events, effects: [] };
      }
      const effects: RuntimeStreamProjectionEffect[] = [
        { type: 'update-tool-call', toolCallId: active.toolCallId, status: 'error', errorMessage: event.message },
      ];
      events.push({
        type: 'tool_error',
        id: active.toolCallId,
        ...(active.delegatedRunId ? { delegatedRunId: active.delegatedRunId } : {}),
        name: active.toolName,
        error: event.message,
      });

      if (active.delegatedRunId !== null) {
        const { code: errorCode } = classifyDelegatedRunFailure(event.message);
        events.push({
          type: 'delegated_task_end',
          delegatedRunId: active.delegatedRunId,
          taskId: active.toolCallId,
          status: 'failure',
          result: {
            status: 'failure',
            artifacts: [],
            summary: '',
            error: { code: errorCode, message: event.message },
          },
          errorCode,
        });
      }
      return { state: { ...state, activeToolCall: null }, events, effects };
    }
    case 'run-started': {
      return {
        state: {
          ...state,
          runId: event.runId,
          skillAttributions: event.skillAttributions,
          emittedSkillPaths: new Set(),
        },
        events,
        effects: [],
      };
    }
    case 'turn-started': {
      return {
        state: {
          ...state,
          turn: { sentText: false, sentReasoningOpen: false, sentReasoningClosed: false },
        },
        events,
        effects: [],
      };
    }
    case 'turn-stream-ended': {
      const effects: RuntimeStreamProjectionEffect[] = [];
      // 1) 中断残留的思考流：闭合未收口的 think 块。
      if (state.turn.sentReasoningOpen && !state.turn.sentReasoningClosed) {
        state.turn.sentReasoningClosed = true;
        events.push({ type: 'message_chunk', text: THINK_CLOSE_CHUNK });
      }
      // 2) 整轮未呈现过思考：最后一次抽干补发。
      if (!state.turn.sentReasoningOpen) {
        const reasoningText = deps.takeBufferedReasoning();
        if (reasoningText) {
          pushReasoningBlock(state, reasoningText, events);
        }
      }
      // 3) 整轮未流式过正文：output 补发 → accumulator 兜底。
      if (!state.turn.sentText) {
        const assistantContent = event.latestAssistantContent;
        if (assistantContent && assistantContent.trim()) {
          const visibleContent = sanitizeVisibleText(assistantContent);
          state.turn.sentText = true;
          events.push({ type: 'message_chunk', text: visibleContent });
        } else {
          const fallbackText = deps.takeFallbackText();
          if (fallbackText.trim()) {
            const visibleContent = sanitizeVisibleText(fallbackText);
            state.turn.sentText = true;
            events.push({ type: 'message_chunk', text: visibleContent });
          }
        }
      }
      effects.push({ type: 'clear-accumulator-text' });
      // 4) 三向决策：审批 / 失败续跑 / 完成收束。
      if (event.interrupted) {
        effects.push({ type: 'await-approval' });
      } else if (event.terminal === 'failed') {
        if (state.runId) {
          events.push({
            type: 'run_updated',
            runId: state.runId,
            status: 'failed',
            error: 'Subagent execution failed',
          });
        }
        effects.push({ type: 'update-run', status: 'failed' });
        effects.push({ type: 'continue-turn-loop' });
      } else {
        if (state.runId) {
          events.push({ type: 'run_updated', runId: state.runId, status: 'completed' });
        }
        effects.push({ type: 'update-run', status: 'completed' });
        effects.push({ type: 'stop-turn-loop' });
      }
      return { state, events, effects };
    }
    case 'run-aborted': {
      if (state.runId) {
        events.push({ type: 'run_updated', runId: state.runId, status: 'aborted' });
      }
      return {
        state,
        events,
        effects: [{ type: 'update-run', status: 'aborted', aborted: true }],
      };
    }
    case 'accumulator-text': {
      const active = state.activeToolCall;
      if (!active || active.delegatedRunId !== event.delegatedRunId || !event.text) {
        return { state, events, effects: [] };
      }
      events.push({
        type: 'delegated_task_chunk',
        delegatedRunId: event.delegatedRunId,
        taskId: active.toolCallId,
        text: event.text,
      });
      return { state, events, effects: [] };
    }
    case 'accumulator-step': {
      const active = state.activeToolCall;
      if (!active || active.delegatedRunId !== event.delegatedRunId) {
        return { state, events, effects: [] };
      }
      const step = { ...event.step, delegatedRunId: event.delegatedRunId };
      events.push({
        type: 'delegated_task_step',
        delegatedRunId: event.delegatedRunId,
        taskId: active.toolCallId,
        step,
      });
      return { state, events, effects: [] };
    }
    default:
      return { state, events, effects: [] };
  }
}
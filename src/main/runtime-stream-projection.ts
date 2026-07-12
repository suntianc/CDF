import type { DelegatedTaskResult, ExecutionStep, LLMStreamEvent, SkillAttribution } from '../shared/types';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../shared/types';

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
  | { kind: 'tool-call-started'; callId: string | undefined; toolName: string; input: unknown }
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
  | { kind: 'subagent-started'; slug: string }
  | { kind: 'subagent-text'; slug: string; text: string }
  | { kind: 'accumulator-text'; text: string }
  | { kind: 'accumulator-step'; step: ExecutionStep };

// 与现网字节一致：开标记裸发，闭标记带双换行（renderer 折叠块之后需要空行分隔正文）。
const THINK_CLOSE_CHUNK = `${THINK_CLOSE_TAG}\n\n`;

export interface RuntimeStreamProjectionDeps {
  // 从 stream accumulator 抽干缓冲的思考文本（llm-adapter 捕获、跨层传递）。
  takeBufferedReasoning: () => string;
  // 轮次结束仍无正文时的兜底文本来源。
  takeFallbackText: () => string;
  // 委派任务显示名（agents 表查询，注入以保持核心纯净）。
  lookupAgentName: (slug: string) => string;
  // 流未携带 callId 时为工具调用生成 id。
  generateToolCallId: () => string;
  // subagent 流先于 task 工具调用出现时合成 taskId。
  generateSubagentTaskId: (slug: string) => string;
}

export type RuntimeStreamProjectionEffect =
  | { type: 'upsert-tool-call'; toolCallId: string; toolName: string; input: unknown }
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
  // task 工具专属：委派任务关联（tool_end 后据此发 delegated_task_end 并解注册）。
  agentSlug: string | null;
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
  // slug → 在途委派任务 id（task 调用注册 / subagent 先到时合成；task_end 解注册）。
  subagentTaskIds: Map<string, string>;
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
    subagentTaskIds: new Map(),
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
      const input = event.input as {
        name?: string;
        task?: string;
        subagent_type?: string;
        description?: string;
      } | null;
      const isTask = event.toolName === 'task';
      const agentSlug = isTask ? input?.subagent_type || input?.name || 'unknown' : null;
      // subagent 流先出现时已合成 taskId：task 调用复用它保证两路事件对齐。
      const existingSubagentTaskId = agentSlug ? state.subagentTaskIds.get(agentSlug) : undefined;
      const toolCallId = existingSubagentTaskId || event.callId || deps.generateToolCallId();
      effects.push({
        type: 'upsert-tool-call',
        toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
      const triggeredSkill = findModelTriggeredSkill(state, event.toolName, event.input);
      if (triggeredSkill) {
        events.push({ type: 'skill_attribution', attributions: [triggeredSkill] });
      }
      events.push({ type: 'tool_start', id: toolCallId, name: event.toolName, input: event.input });

      if (isTask && agentSlug) {
        // D-03：task 输入的 task 字段是含 goal 的 JSON 串；缺失时回退 description。
        let goal = '';
        if (input?.task) {
          try {
            goal = (JSON.parse(input.task) as { goal?: string }).goal || '';
          } catch {
            goal = input?.name || '任务执行';
          }
        } else if (input?.description) {
          goal = input.description;
        }
        events.push({
          type: 'delegated_task_start',
          taskId: toolCallId,
          agentSlug,
          agentName: deps.lookupAgentName(agentSlug),
          goal,
        });
        if (!existingSubagentTaskId) {
          state.subagentTaskIds.set(agentSlug, toolCallId);
        }
      }

      return {
        state: { ...state, activeToolCall: { toolCallId, toolName: event.toolName, agentSlug } },
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
      events.push({ type: 'tool_end', id: active.toolCallId, name: active.toolName, output: event.output });

      if (active.agentSlug !== null) {
        const parsed = parseDelegatedTaskOutput(event.output);
        // D-11：解析后的标准结果覆写 DB，sessionStore 无需再做 Command 回退。
        effects.push({
          type: 'update-tool-call',
          toolCallId: active.toolCallId,
          status: parsed.status === 'failure' ? 'error' : 'success',
          output: parsed.result,
        });
        events.push({
          type: 'delegated_task_end',
          taskId: active.toolCallId,
          status: parsed.status,
          result: parsed.result,
          errorCode: parsed.errorCode,
        });
        if (active.agentSlug) state.subagentTaskIds.delete(active.agentSlug);
      }
      return { state: { ...state, activeToolCall: null }, events, effects };
    }
    case 'tool-failed': {
      const active = state.activeToolCall;
      if (!active) return { state, events, effects: [] };
      if (event.isInterrupt) {
        // 审批中断以 interrupt 形态浮出，错误路径保持静默（现网行为）。
        return { state: { ...state, activeToolCall: null }, events, effects: [] };
      }
      const effects: RuntimeStreamProjectionEffect[] = [
        { type: 'update-tool-call', toolCallId: active.toolCallId, status: 'error', errorMessage: event.message },
      ];
      events.push({ type: 'tool_error', id: active.toolCallId, name: active.toolName, error: event.message });

      if (active.agentSlug !== null) {
        const lower = event.message.toLowerCase();
        let errorCode = 'UNKNOWN';
        if (lower.includes('timeout') || lower.includes('timed out')) errorCode = 'TIMEOUT';
        // undici/fetch stream cut (TypeError: terminated) — see isTransientRuntimeError
        else if (lower === 'terminated' || lower.includes('network') || lower.includes('fetch failed')) {
          errorCode = 'NETWORK';
        } else if (lower.includes('interrupt') || lower.includes('cancel') || lower.includes('aborted')) {
          errorCode = 'INTERRUPTED';
        }
        events.push({
          type: 'delegated_task_end',
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
        if (active.agentSlug) state.subagentTaskIds.delete(active.agentSlug);
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
    case 'subagent-started': {
      if (state.subagentTaskIds.has(event.slug)) {
        return { state, events, effects: [] };
      }
      const taskId = deps.generateSubagentTaskId(event.slug);
      state.subagentTaskIds.set(event.slug, taskId);
      events.push({
        type: 'delegated_task_start',
        taskId,
        agentSlug: event.slug,
        agentName: event.slug,
        goal: '',
      });
      return { state, events, effects: [] };
    }
    case 'subagent-text': {
      const taskId = state.subagentTaskIds.get(event.slug);
      if (!taskId || !event.text) return { state, events, effects: [] };
      events.push({ type: 'delegated_task_chunk', taskId, text: event.text });
      return { state, events, effects: [] };
    }
    case 'accumulator-text': {
      const active = state.activeToolCall;
      if (!active || active.agentSlug === null) return { state, events, effects: [] };
      events.push({ type: 'delegated_task_chunk', taskId: active.toolCallId, text: event.text });
      return { state, events, effects: [] };
    }
    case 'accumulator-step': {
      const active = state.activeToolCall;
      if (!active || active.agentSlug === null) return { state, events, effects: [] };
      events.push({ type: 'delegated_task_step', taskId: active.toolCallId, step: event.step });
      return { state, events, effects: [] };
    }
    default:
      return { state, events, effects: [] };
  }
}
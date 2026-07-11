import type { LLMStreamEvent } from '../shared/types';

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
  | { kind: 'message-ended' };

// 与现网字节一致：开标记裸发，闭标记带双换行（renderer 折叠块之后需要空行分隔正文）。
const THINK_CLOSE_CHUNK = `${THINK_CLOSE_TAG}\n\n`;

export interface RuntimeStreamProjectionDeps {
  // 从 stream accumulator 抽干缓冲的思考文本（llm-adapter 捕获、跨层传递）。
  takeBufferedReasoning: () => string;
  // 轮次结束仍无正文时的兜底文本来源。
  takeFallbackText: () => string;
  // 委派任务显示名（agents 表查询，注入以保持核心纯净）。
  lookupAgentName: (slug: string) => string;
  // 为 subagent 流首次出现时合成 taskId。
  generateTaskId: () => string;
}

export type RuntimeStreamProjectionEffect = never; // S1 尚无 effect；S2/S3 扩展。

interface MessageState {
  hasReasoningSource: boolean;
  reasoningDone: boolean;
  reasoningStreamed: boolean;
  // 本消息是否已呈现过思考（流式或补发），guard 缓冲思考至多补发一次。
  sentReasoning: boolean;
  textBuffer: string[];
  visibleTextFilter: VisibleTextThinkTagFilter;
}

export interface RuntimeStreamProjectionState {
  message: MessageState | null;
}

export interface RuntimeStreamProjectionResult {
  state: RuntimeStreamProjectionState;
  events: LLMStreamEvent[];
  effects: RuntimeStreamProjectionEffect[];
}

export function createRuntimeStreamState(): RuntimeStreamProjectionState {
  return { message: null };
}

function drainBufferedReasoning(
  message: MessageState,
  deps: RuntimeStreamProjectionDeps,
  events: LLMStreamEvent[],
): void {
  if (message.sentReasoning) return;
  const reasoningText = deps.takeBufferedReasoning();
  if (!reasoningText) return;
  message.sentReasoning = true;
  events.push({ type: 'message_chunk', text: THINK_OPEN_TAG });
  events.push({ type: 'message_chunk', text: reasoningText });
  events.push({ type: 'message_chunk', text: THINK_CLOSE_CHUNK });
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
        events.push({ type: 'message_chunk', text: THINK_OPEN_TAG });
      }
      events.push({ type: 'message_chunk', text: event.token });
      return { state, events, effects: [] };
    }
    case 'reasoning-ended': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      if (message.reasoningStreamed) {
        events.push({ type: 'message_chunk', text: THINK_CLOSE_CHUNK });
      }
      message.reasoningDone = true;
      // 背压冲刷：reasoning 期间积压的 text token 在思考块闭合后按到达序补发。
      // 与直发路径同规：首个可见正文前先补发 accumulator 捕获的思考。
      for (const buffered of message.textBuffer) {
        const visibleText = message.visibleTextFilter.push(buffered);
        if (visibleText) {
          drainBufferedReasoning(message, deps, events);
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
        drainBufferedReasoning(message, deps, events);
        events.push({ type: 'message_chunk', text: visibleText });
      }
      return { state, events, effects: [] };
    }
    case 'message-ended': {
      const message = state.message;
      if (!message) return { state, events, effects: [] };
      const remaining = message.visibleTextFilter.flush();
      if (remaining) {
        drainBufferedReasoning(message, deps, events);
        events.push({ type: 'message_chunk', text: remaining });
      }
      return { state: { ...state, message: null }, events, effects: [] };
    }
    default:
      return { state, events, effects: [] };
  }
}
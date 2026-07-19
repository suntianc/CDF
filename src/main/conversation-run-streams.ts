import type {
  ConversationRunIdentity,
  ConversationRunStreamEnvelope,
  ConversationRunStreamSnapshot,
  LLMStreamEvent,
} from '../shared/types';
import type { LLMChatEventSender } from './llm';

interface ConversationRunStreamsDeps {
  emit: (event: ConversationRunStreamEnvelope) => void;
}

interface ActiveConversationRun extends ConversationRunStreamSnapshot {
  deferredDone: boolean;
}

export interface ActiveConversationRunStream {
  sender: LLMChatEventSender;
  commit: () => void;
  fail: () => void;
}

export class ConversationRunStreams {
  private readonly active = new Map<string, ActiveConversationRun>();

  constructor(private readonly deps: ConversationRunStreamsDeps) {}

  begin(identity: ConversationRunIdentity): ActiveConversationRunStream {
    if (this.active.has(identity.sessionId)) {
      throw new Error(`Conversation ${identity.sessionId} already has an active streamed run`);
    }

    const state: ActiveConversationRun = {
      ...identity,
      sequence: 0,
      content: '',
      runId: null,
      agentId: null,
      events: [],
      deferredDone: false,
    };
    this.active.set(identity.sessionId, state);

    let closed = false;
    const close = () => {
      if (closed) return false;
      closed = true;
      if (this.active.get(identity.sessionId) === state) {
        this.active.delete(identity.sessionId);
      }
      return true;
    };

    return {
      sender: {
        send: (_channel, payload) => {
          if (closed || !isLLMStreamEvent(payload)) return;
          if (payload.type === 'message_done') {
            state.deferredDone = true;
            return;
          }
          if (payload.type === 'message_chunk') state.content += payload.text;
          if (payload.type === 'run_started') {
            state.runId = payload.runId;
            state.agentId = payload.agentId;
          }
          this.publish(state, payload);
        },
      },
      commit: () => {
        if (!close()) return;
        if (state.deferredDone) this.publish(state, { type: 'message_done' });
      },
      fail: () => {
        close();
      },
    };
  }

  getActive(sessionId: string): ConversationRunStreamSnapshot | null {
    const state = this.active.get(sessionId);
    if (!state) return null;
    const { deferredDone: _deferredDone, ...snapshot } = state;
    return { ...snapshot, events: [...snapshot.events] };
  }

  private publish(state: ActiveConversationRun, event: LLMStreamEvent): void {
    state.events.push(event);
    state.sequence += 1;
    this.deps.emit({
      sessionId: state.sessionId,
      requestId: state.requestId,
      messageId: state.messageId,
      origin: state.origin,
      sequence: state.sequence,
      event,
    });
  }
}

function isLLMStreamEvent(value: unknown): value is LLMStreamEvent {
  return Boolean(value && typeof value === 'object' && 'type' in value && typeof value.type === 'string');
}

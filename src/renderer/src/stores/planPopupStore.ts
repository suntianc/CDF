import { create } from 'zustand';
import { useSessionStore } from './sessionStore';
import { useProjectStore } from './projectStore';

/** 08.2 C-3a: /plan popup state machine (Codex 弹窗模式 + modify loop). */
export type PlanStatus =
  | 'closed'
  | 'generating'
  | 'reviewing'
  | 'modifying'
  | 'executing'
  | 'cap-reached';

export interface ModifyHistoryEntry {
  opinion: string;
  planAfter: string;
}

export interface PlanPopupState {
  isOpen: boolean;
  status: PlanStatus;
  description: string;
  planContent: string;
  currentRequestId: string | null;
  iterationCount: number;
  modifyHistory: ModifyHistoryEntry[];
  open: (description: string) => void;
  close: () => void;
  appendChunk: (chunk: string) => void;
  startModify: (opinion: string) => Promise<void>;
  execute: () => Promise<void>;
  cancelCurrent: () => Promise<void>;
}

const MAX_ITERATIONS = 20;

const INITIAL_STATE: Pick<
  PlanPopupState,
  'isOpen' | 'status' | 'description' | 'planContent' | 'currentRequestId' | 'iterationCount' | 'modifyHistory'
> = {
  isOpen: false,
  status: 'closed',
  description: '',
  planContent: '',
  currentRequestId: null,
  iterationCount: 0,
  modifyHistory: [],
};

export const usePlanPopupStore = create<PlanPopupState>((set, get) => ({
  ...INITIAL_STATE,

  open: (description) => {
    const trimmed = (description || '').trim();
    set({
      isOpen: true,
      status: 'generating',
      description: trimmed,
      planContent: '',
      currentRequestId: null,
      iterationCount: 0,
      modifyHistory: [],
    });
  },

  close: () => {
    // P11: best-effort stop of any in-flight request so we don't leave an
    // orphan streaming response pointing at a closed popup.
    const requestId = get().currentRequestId ?? useSessionStore.getState().streamingMessageId;
    if (requestId) {
      window.electronAPI?.llm?.stopChat(requestId)?.catch((err: unknown) => {
        console.warn('[planPopupStore] stopChat during close failed:', err);
      });
    }
    set({ ...INITIAL_STATE });
  },

  appendChunk: (chunk) => {
    if (!chunk) return;
    set((state) => ({
      planContent: state.planContent + chunk,
      // First non-empty chunk after open() flips generating → reviewing so
      // the UI can swap Skeleton for the MarkdownRenderer.
      status: state.status === 'generating' ? 'reviewing' : state.status,
    }));
  },

  startModify: async (opinion: string) => {
    // 1. Cancel the in-flight plan request to avoid orphan LLM runs (P11).
    await get().cancelCurrent();

    // 2. P7: 20-turn cap. If we've already used all iterations, refuse to
    //    trigger a new request and force the UI to either execute or close.
    if (get().iterationCount >= MAX_ITERATIONS) {
      set({ status: 'cap-reached' });
      return;
    }

    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) {
      console.warn('[planPopupStore] startModify: no active project');
      return;
    }

    // 3. Update state for the new round.
    set((state) => ({
      status: 'modifying',
      planContent: '',
      iterationCount: state.iterationCount + 1,
      modifyHistory: [...state.modifyHistory, { opinion, planAfter: '' }],
    }));

    // 4. Send the modification opinion as a user message with planOnly=true
    //    so the LLM regenerates a plan rather than executing.
    const trimmed = (opinion || '').trim();
    await useSessionStore.getState().sendMessage(projectId, `修改意见：${trimmed}`, {
      planOnly: true,
    });

    // 5. Capture the new streaming requestId so a subsequent close() /
    //    startModify() can stop the in-flight response cleanly.
    const newRequestId = useSessionStore.getState().streamingMessageId;
    if (newRequestId) {
      set({ currentRequestId: newRequestId });
    }
  },

  execute: async () => {
    // C3-03: 「立即执行」 is just a synthetic user message with NO planOnly
    // override, so the next sendMessage call drives the agent into
    // execution mode.
    set({ status: 'executing' });
    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) {
      await get().close();
      return;
    }
    try {
      await useSessionStore.getState().sendMessage(projectId, '立即执行', undefined);
    } finally {
      await get().close();
    }
  },

  cancelCurrent: async () => {
    const requestId = get().currentRequestId ?? useSessionStore.getState().streamingMessageId;
    if (!requestId) return;
    try {
      await window.electronAPI.llm.stopChat(requestId);
    } catch (err) {
      console.warn('[planPopupStore] stopChat failed:', err);
    }
    set({ currentRequestId: null });
  },
}));

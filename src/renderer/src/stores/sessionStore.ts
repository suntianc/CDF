// Public entry of the session store (#235). The implementation is split by
// concern under ./session/ (conversation lifecycle / runtime streaming /
// approvals / goal judge / model overrides + the registry adapter); this file
// composes the slices and re-exports the public surface so consumer imports
// stay unchanged.
import { create } from 'zustand';
import { createRuntimeRegistryAdapter } from './session/runtimeRegistryAdapter';
import { createConversationLifecycleSlice } from './session/conversationLifecycleSlice';
import { createRuntimeStreamSlice } from './session/runtimeStreamSlice';
import { createAgentActivitySlice } from './session/agentActivitySlice';
import { createApprovalSlice } from './session/approvalSlice';
import { createGoalJudgeSlice } from './session/goalJudgeSlice';
import { createModelOverridesSlice } from './session/modelOverridesSlice';
import type { SessionState, SessionSliceContext } from './session/types';

export { estimateTokens } from './session/estimateTokens';
export type {
  DelegatedTask,
  GoalJudgeStatusEntry,
  JudgeStatus,
  ParallelBatch,
  ParallelWorker,
  SendMessageResult,
  SessionError,
} from './session/types';

export const useSessionStore = create<SessionState>((set, get) => {
  const registry = createRuntimeRegistryAdapter(set, get);
  const ctx: SessionSliceContext = { set, get, registry };

  return {
    ...createRuntimeStreamSlice(ctx),
    ...createConversationLifecycleSlice(ctx),
    ...createAgentActivitySlice(ctx),
    ...createApprovalSlice(ctx),
    ...createGoalJudgeSlice(ctx),
    ...createModelOverridesSlice(ctx),
  };
});

// Uses the raw i18next singleton rather than '@/i18n' to avoid eager i18n init
// via import side effects (see runtimeRegistryAdapter.ts).
import i18next from 'i18next';
import type { SessionSliceContext, SessionState } from './types';

export type ApprovalSlice = Pick<SessionState,
  | 'pendingApproval'
  | 'pendingApprovals'
  | 'approvalHistory'
  | 'resolveApproval'
>;

export function createApprovalSlice({ set, get }: SessionSliceContext): ApprovalSlice {
  return {
    pendingApproval: null,
    pendingApprovals: [],
    approvalHistory: [],

    resolveApproval: async (decision, editedArgs, approvalId) => {
      const { streamingMessageId, pendingApproval, pendingApprovals } = get();
      const selectedApproval = approvalId
        ? pendingApprovals.find((item) => item.id === approvalId) ?? null
        : pendingApproval;
      if (!selectedApproval) return;

      const isWorkflowStageGate = selectedApproval.actions.length === 1
        && selectedApproval.actions[0].name === 'advance_stage';
      if (isWorkflowStageGate) {
        if (decision === 'edit') {
          set({ error: { message: '阶段门禁仅支持批准或打回。' } });
          return;
        }
        try {
          await window.electronAPI.workflowRun.resolveStageGate(selectedApproval.id, {
            decision: decision === 'approve' ? 'approve' : 'reject',
            feedback: decision === 'reject' ? '用户打回了当前阶段，请继续完善。' : undefined,
          });
          set((state) => {
            const next = state.pendingApprovals.filter((item) => item.id !== selectedApproval.id);
            return { pendingApprovals: next, pendingApproval: next[0] ?? null };
          });
        } catch (err: unknown) {
          set({ error: { message: err instanceof Error ? err.message : String(err) } });
        }
        return;
      }

      if (!streamingMessageId) return;
      let editedAction: unknown;
      if (decision === 'edit') {
        try {
          editedAction = editedArgs ? JSON.parse(editedArgs) : undefined;
        } catch (err: any) {
          set({ error: { message: err.message || '审批参数不是合法 JSON' } });
          return;
        }
      }

      await window.electronAPI.llm.resolveApproval(streamingMessageId, {
        approvalId: selectedApproval.id,
        decisions: selectedApproval.actions.map((action) => ({
          type: decision,
          editedAction: decision === 'edit' ? { name: action.name, args: editedAction } : undefined,
          message: decision === 'reject' ? i18next.t('chat.toolRejectedByUser') : undefined,
        })),
      });
    },
  };
}

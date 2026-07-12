/**
 * index.ts — Workflow Run 模块入口
 *
 * 导出模块公共 API：IPC 注册、中断检测、gate 处理逻辑。
 * llm.ts 与 ipc-handlers.ts 通过此入口集成。
 */

export { registerWorkflowRunIpcHandlers } from './ipc';
export { createAdvanceStageTool, isAdvanceStageInterrupt, createTaskGraphTools } from './tools';
export type { AdvanceStageToolContext, TaskGraphToolContext } from './tools';
export {
  startRun,
  getRunBySessionId,
  handleAdvanceStageInterrupt,
  getWorkflowRun,
  getPendingStageGates,
  registerResumeAgentCallback,
} from './runtime';

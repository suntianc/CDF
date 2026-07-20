/**
 * subagent-step-storage.ts — 子代理步骤流的跨层 AsyncLocalStorage 载体
 *
 * 装配域在委派执行时 run({ onStep })，流式投影 / IPC 侧 getStore() 取出回调，
 * 把子代理步骤接入 Conversation 事件流。它是装配域与流式投影域之间共享的 seam，
 * 有两个真实消费方（runtime.ts 生产、llm.ts 运行），故独立成模块。
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { ExecutionStep } from '../../shared/types';

export interface SubagentStepContext {
  onStep: (step: ExecutionStep) => void;
}

export const subagentStepStorage = new AsyncLocalStorage<SubagentStepContext>();

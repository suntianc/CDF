/**
 * Workflow State Schema — LangGraph.js StateGraph 状态定义
 *
 * 基于 @langchain/langgraph 的 StateSchema + ReducedValue 模式。
 * nodeOutputs 使用 spread-merge reducer（并行安全：各节点写独立 key）。
 * routing/errors/artifacts 使用各自的 reducer 保证数据完整性。
 */

import { StateSchema, ReducedValue, MessagesValue } from '@langchain/langgraph';
import { z } from 'zod';

/**
 * 工作流执行状态 Schema
 *
 * - inputs: 用户输入参数
 * - nodeOutputs: 每节点独立写入（spread-merge reducer，fan-out 并行安全）
 * - routing: 控制路由决策（merge reducer）
 * - artifacts: 产出物累积（append reducer）
 * - errors: 错误累积（append reducer）
 * - messages: 消息累积（LangGraph 内置 MessagesValue）
 */
export const WorkflowState = new StateSchema({
  inputs: z.record(z.string(), z.unknown()),

  nodeOutputs: new ReducedValue(
    z.record(z.string(), z.unknown()).default(() => ({})),
    {
      reducer: (existing: Record<string, unknown>, update: Record<string, unknown>) => ({
        ...existing,
        ...update,
      }),
    }
  ),

  routing: new ReducedValue(
    z.record(z.string(), z.string()).default(() => ({})),
    {
      reducer: (existing: Record<string, string>, update: Record<string, string>) => ({
        ...existing,
        ...update,
      }),
    }
  ),

  artifacts: new ReducedValue(
    z.array(z.unknown()).default(() => []),
    {
      reducer: (existing: unknown[], update: unknown[]) => [...existing, ...update],
    }
  ),

  errors: new ReducedValue(
    z.array(z.object({
      nodeId: z.string(),
      error: z.string(),
      timestamp: z.number(),
    })).default(() => []),
    {
      reducer: (
        existing: Array<{ nodeId: string; error: string; timestamp: number }>,
        update: Array<{ nodeId: string; error: string; timestamp: number }>
      ) => [...existing, ...update],
    }
  ),

  messages: MessagesValue,
});

/** WorkflowState 的 TypeScript 类型推导 */
export type WorkflowStateType = z.infer<typeof WorkflowState>;

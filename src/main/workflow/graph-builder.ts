/**
 * Graph Builder — ReactFlow 图定义 → LangGraph.js StateGraph 转换
 *
 * 包含：
 * - 条件路由 + 循环保护（D-09/D-10）
 * - ReactFlow → StateGraph 转换（D-13/D-14/D-15）
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { WorkflowState } from './state-schema';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../shared/types';

/** 全局循环迭代硬限制（D-10: 循环保护） */
export const MAX_LOOP_ITERATIONS = 10;

/**
 * 创建条件路由函数
 *
 * 从 state.routing 中读取路由决策，支持循环保护计数器。
 * D-09: 条件分支由 Agent 输出决定或 Master Agent 介入。
 * D-10: 循环条件由 Agent 输出或 Master Agent 判断，带最大迭代次数保护。
 */
export function createConditionalRouter(
  condition: string,
  maxIterations?: number,
): (state: Record<string, unknown>) => string {
  return (state: Record<string, unknown>): string => {
    const routing = (state.routing as Record<string, unknown>) ?? {};

    // 循环保护：检查迭代计数器
    if (maxIterations !== undefined) {
      const loopKey = `__loop_${condition}`;
      const count = (routing[loopKey] as number) ?? 0;
      if (count >= maxIterations) {
        return '__max_iterations_exceeded__';
      }
    }

    // 读取路由决策
    const decision = routing[condition];
    if (!decision) {
      // 没有路由决策时返回默认值，避免抛异常中断整个图
      console.warn(`[graph-builder] No routing decision found for condition "${condition}", returning default`);
      return '__default__';
    }

    return String(decision);
  };
}

/**
 * 将 ReactFlow 图定义转换为 LangGraph StateGraph builder
 *
 * D-13: 执行引擎采用 LangGraph.js 驱动
 * D-14: 节点间数据传递采用共享 State 模式
 * D-15: 并行执行采用 LangGraph fan-out/fan-in 模式
 *
 * @param workflowDef - ReactFlow 图定义（nodes + edges）
 * @param nodeExecutor - 节点执行器工厂，接受 WorkflowNode 返回 state 更新函数
 * @returns StateGraph builder（未 compile）
 */
export function buildWorkflowGraph(
  workflowDef: WorkflowDefinition,
  nodeExecutor: (node: WorkflowNode) => (state: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  const builder = new StateGraph(WorkflowState);

  // 1. 添加 Agent 节点（跳过 start/end — 它们是边的哨兵，不是可执行节点）
  for (const node of workflowDef.nodes) {
    if (node.type === 'start' || node.type === 'end') continue;

    // 分析上游节点（用于 state 切片提取）
    const upstreamNodeIds = workflowDef.edges
      .filter((e) => e.target === node.id && e.source !== 'start')
      .map((e) => e.source);

    const executor = nodeExecutor(node);

    builder.addNode(node.id, async (state: Record<string, unknown>) => {
      try {
        const result = await executor(state);
        // 每个节点只写入自己的 nodeOutputs[nodeId]（D-14）
        return {
          nodeOutputs: { [node.id]: result },
        };
      } catch (err) {
        // 节点失败策略：记录错误，由 router 决定（D-11）
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorType = err instanceof Error ? err.name : 'UnknownError';
        return {
          errors: [{
            nodeId: node.id,
            error: errorMessage,
            timestamp: Date.now(),
          }],
          routing: { [`${node.id}_status`]: 'failed' as const },
          nodeOutputs: {
            [node.id]: {
              error: errorMessage,
              errorType,
              nodeId: node.id,
              failed: true,
            },
          },
        };
      }
    }, {
      retryPolicy: { maxAttempts: node.data.retryCount ?? 1 },
    });
  }

  // 2. 添加边（从 ReactFlow 连接转换）
  for (const edge of workflowDef.edges) {
    const sourceNode = edge.source === 'start' ? START : edge.source;
    const targetNode = edge.target === 'end' ? END : edge.target;

    if (edge.metadata?.condition) {
      // 条件边（D-09: Agent 输出或 Master Agent 决定）
      const targets = edge.metadata.targets ?? {};
      const targetValues = Object.values(targets);

      builder.addConditionalEdges(
        sourceNode,
        createConditionalRouter(edge.metadata.condition, edge.metadata.maxIterations),
        // 构建路由映射：condition 值 → 目标节点
        // 包含默认路由和循环保护终止路由
        [...targetValues, '__default__', '__max_iterations_exceeded__'].reduce(
          (acc, t) => {
            // 将路由值映射到目标节点（如果目标节点存在）
            if (t === '__default__' || t === '__max_iterations_exceeded__') {
              // 默认路由和循环保护终止路由映射到 END
              acc[t] = END;
            } else {
              acc[t] = t;
            }
            return acc;
          },
          {} as Record<string, string>,
        ),
      );
    } else {
      // 普通边
      builder.addEdge(sourceNode, targetNode);
    }
  }

  return builder;
}

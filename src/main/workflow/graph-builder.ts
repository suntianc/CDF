/**
 * Graph Builder — ReactFlow 图定义 → LangGraph.js StateGraph 转换
 *
 * 包含：
 * - 条件路由 + 循环保护（D-09/D-10）
 * - ReactFlow → StateGraph 转换（D-13/D-14/D-15）
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { WorkflowState } from './state-schema';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowEdgeOperator } from '../../shared/types';

/** 全局循环迭代硬限制（D-10: 循环保护） */
export const MAX_LOOP_ITERATIONS = 10;

/**
 * 创建条件路由函数
 *
 * 从 state.routing 中读取路由决策，支持循环保护计数器。
 * D-09: 条件分支由 Agent 输出决定或 Master Agent 介入。
 * D-10: 循环条件由 Agent 输出或 Master Agent 判断，带最大迭代次数保护。
 */
interface RouteMatcher {
  routeKey: string;
  operator: WorkflowEdgeOperator;
  expected: string;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function matchesCondition(
  actual: unknown,
  operator: WorkflowEdgeOperator = 'eq',
  expected: string,
): boolean {
  const actualText = String(actual ?? '').trim();
  const expectedText = expected.trim();
  if (operator === 'eq') return actualText === expectedText;
  if (operator === 'ne') return actualText !== expectedText;

  const actualNumber = asNumber(actual);
  const expectedNumber = asNumber(expectedText);
  if (actualNumber === undefined || expectedNumber === undefined) return false;

  if (operator === 'gt') return actualNumber > expectedNumber;
  if (operator === 'lt') return actualNumber < expectedNumber;
  if (operator === 'gte') return actualNumber >= expectedNumber;
  if (operator === 'lte') return actualNumber <= expectedNumber;
  return false;
}

export function createConditionalRouter(
  condition: string,
  maxIterations?: number,
  routeMatchers?: RouteMatcher[],
): (state: Record<string, unknown>) => string {
  const effectiveMax = maxIterations ?? MAX_LOOP_ITERATIONS;
  return (state: Record<string, unknown>): string => {
    const routing = (state.routing as Record<string, unknown>) ?? {};

    // 循环保护：检查迭代计数器（由计数器递增节点维护）
    const loopKey = `__loop_${condition}`;
    const count = (routing[loopKey] as number) ?? 0;
    if (count >= effectiveMax) {
      return '__max_iterations_exceeded__';
    }

    // 读取路由决策
    const decision = routing[condition];
    if (decision === undefined || decision === null || decision === '') {
      // 没有路由决策时返回默认值，避免抛异常中断整个图
      console.warn(`[graph-builder] No routing decision found for condition "${condition}", returning default`);
      return '__default__';
    }

    if (routeMatchers?.length) {
      const matched = routeMatchers.find((matcher) => matchesCondition(decision, matcher.operator, matcher.expected));
      return matched?.routeKey ?? '__default__';
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
  nodeExecutor: (node: WorkflowNode, upstreamNodeIds: string[]) => (state: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  const builder = new StateGraph(WorkflowState);
  const startNodeIds = new Set(workflowDef.nodes.filter((node) => node.type === 'start').map((node) => node.id));
  const endNodeIds = new Set(workflowDef.nodes.filter((node) => node.type === 'end').map((node) => node.id));

  const toGraphNode = (nodeId: string, role: 'source' | 'target') => {
    if (role === 'source' && startNodeIds.has(nodeId)) return START;
    if (role === 'target' && endNodeIds.has(nodeId)) return END;
    return nodeId;
  };

  // 1. 添加 Agent 节点（跳过 start/end — 它们是边的哨兵，不是可执行节点）
  for (const node of workflowDef.nodes) {
    if (node.type === 'start' || node.type === 'end') continue;

    // 分析上游节点（用于 state 切片提取）
    const upstreamNodeIds = workflowDef.edges
      .filter((e) => e.target === node.id && !startNodeIds.has(e.source))
      .map((e) => e.source);

    const executor = nodeExecutor(node, upstreamNodeIds);

    builder.addNode(node.id, async (state: Record<string, unknown>) => {
      try {
        const result = await executor(state);
        // 每个节点只写入自己的 nodeOutputs[nodeId]（D-14）
        const routing = (result.routing && typeof result.routing === 'object') ? result.routing as Record<string, string> : undefined;
        const artifacts = Array.isArray(result.artifacts) ? result.artifacts : undefined;
        return {
          nodeOutputs: { [node.id]: result },
          ...(routing ? { routing } : {}),
          ...(artifacts ? { artifacts } : {}),
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
  // NOTE: addEdge/addConditionalEdges 泛型 N 仅包含 "__start__"，动态节点 ID 需要 cast
  const conditionalGroups = new Map<string, WorkflowEdge[]>();
  const normalEdges: WorkflowEdge[] = [];

  for (const edge of workflowDef.edges) {
    const condition = edge.metadata?.condition?.trim();
    if (!condition) {
      normalEdges.push(edge);
      continue;
    }

    const groupKey = `${edge.source}::${condition}`;
    conditionalGroups.set(groupKey, [...(conditionalGroups.get(groupKey) ?? []), edge]);
  }

  for (const edge of normalEdges) {
    builder.addEdge(toGraphNode(edge.source, 'source') as any, toGraphNode(edge.target, 'target') as any);
  }

  for (const [groupKey, groupEdges] of conditionalGroups) {
    const firstEdge = groupEdges[0];
    const condition = firstEdge.metadata!.condition!.trim();
    const sourceNode = toGraphNode(firstEdge.source, 'source');
    const counterNodeName = `__counter_${groupKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const maxIterations = Math.max(
      ...groupEdges.map((edge) => edge.metadata?.maxIterations ?? MAX_LOOP_ITERATIONS),
    );

    builder.addNode(counterNodeName, ((state: Record<string, unknown>) => {
        const routing = (state.routing as Record<string, unknown>) ?? {};
        const loopKey = `__loop_${condition}`;
        const count = (routing[loopKey] as number) ?? 0;
        return { routing: { [loopKey]: count + 1 } };
    }) as any);

    builder.addEdge(sourceNode as any, counterNodeName as any);

    const routeMap: Record<string, string> = {};
    const routeMatchers: RouteMatcher[] = [];
    for (const edge of groupEdges) {
      const configuredTargets = edge.metadata?.targets ?? {};
      for (const [value, targetId] of Object.entries(configuredTargets)) {
        routeMap[value] = toGraphNode(targetId, 'target') as string;
      }
      if (edge.metadata?.routeValue?.trim()) {
        const routeKey = edge.id;
        const expected = (edge.metadata.compareValue ?? edge.metadata.routeValue).trim();
        routeMap[routeKey] = toGraphNode(edge.target, 'target') as string;
        routeMatchers.push({
          routeKey,
          operator: edge.metadata.operator ?? 'eq',
          expected,
        });
      }
    }
    routeMap.__default__ = END;
    routeMap.__max_iterations_exceeded__ = END;

    builder.addConditionalEdges(
      counterNodeName as any,
      createConditionalRouter(condition, maxIterations, routeMatchers.length > 0 ? routeMatchers : undefined),
      routeMap as any,
    );
  }

  return builder;
}

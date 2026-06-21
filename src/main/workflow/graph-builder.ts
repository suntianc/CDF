/**
 * Graph Builder — ReactFlow 图定义 → LangGraph.js StateGraph 转换
 *
 * 包含：
 * - 条件路由（D-09）
 * - ReactFlow → StateGraph 转换（D-13/D-14/D-15）
 * - 并行 fan-out/fan-in（D-15: Send API）
 */

import { StateGraph, START, END, Send } from '@langchain/langgraph';
import { WorkflowState } from './state-schema';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowEdgeOperator } from '../../shared/types';

/** 并行节点每次分发的最大 item 数（防止 DoS） */
const MAX_PARALLEL_ITEMS = 50;

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
  routeMatchers?: RouteMatcher[],
): (state: Record<string, unknown>) => string {
  return (state: Record<string, unknown>): string => {
    const routing = (state.routing as Record<string, unknown>) ?? {};

    const decision = routing[condition];
    if (decision === undefined || decision === null || decision === '') {
      throw new Error(
        `[workflow-routing] 路由条件 "${condition}" 未找到决策值。节点必须在输出中设置 routing["${condition}"]。当前 routing 状态: ${JSON.stringify(routing)}`,
      );
    }

    if (routeMatchers?.length) {
      const matched = routeMatchers.find((matcher) => matchesCondition(decision, matcher.operator, matcher.expected));
      if (!matched) {
        console.warn(
          `[graph-builder] routing["${condition}"]="${decision}" 不匹配任何配置的条件边，fallback 到 END。已配置的匹配值: ${routeMatchers.map((m) => m.expected).join(', ')}`,
        );
      }
      return matched?.routeKey ?? '__default__';
    }

    return String(decision);
  };
}

/**
 * 创建 fan-out 路由函数（用于 parallel 节点的 addConditionalEdges）
 *
 * dispatcher node 执行后，在 state.nodeOutputs[nodeId] 中写入 { items, count }。
 * 路由函数读取这些 items，为每个 item 返回一个 Send 对象，触发并行执行。
 *
 * @param nodeId - parallel 节点 ID（dispatcher 的 ID）
 * @param workerNodeId - worker 节点 ID（`${nodeId}__worker`）
 * @param concurrencyLimit - 最大并行 item 数
 */
export function createFanOutRouter(
  nodeId: string,
  workerNodeId: string,
  concurrencyLimit: number = MAX_PARALLEL_ITEMS,
): (state: Record<string, unknown>) => Send[] | string {
  return (state: Record<string, unknown>): Send[] | string => {
    const nodeOutputs = (state.nodeOutputs as Record<string, unknown>) ?? {};
    const dispatcherOutput = nodeOutputs[nodeId] as Record<string, unknown> | undefined;
    const items = dispatcherOutput?.items as unknown[] | undefined;

    if (!items || items.length === 0) {
      // 空 items → 直接路由到 END
      return END;
    }

    const limit = Math.min(items.length, concurrencyLimit);
    const sends: Send[] = [];
    for (let i = 0; i < limit; i++) {
      sends.push(new Send(workerNodeId, {
        ...state,
        __fanout_item: items[i],
        __fanout_index: i,
        __fanout_total: items.length,
        __fanout_node_id: nodeId,
      }));
    }
    return sends;
  };
}

/**
 * 将 ReactFlow 图定义转换为 LangGraph StateGraph builder
 */
export function buildWorkflowGraph(
  workflowDef: WorkflowDefinition,
  nodeExecutor: (node: WorkflowNode, upstreamNodeIds: string[]) => (state: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  const builder = new StateGraph(WorkflowState);
  const startNodeIds = new Set(workflowDef.nodes.filter((node) => node.type === 'start').map((node) => node.id));
  const endNodeIds = new Set(workflowDef.nodes.filter((node) => node.type === 'end').map((node) => node.id));
  const parallelNodeIds = new Set(workflowDef.nodes.filter((node) => node.type === 'parallel').map((node) => node.id));

  const toGraphNode = (nodeId: string, role: 'source' | 'target') => {
    if (role === 'source' && startNodeIds.has(nodeId)) return START;
    if (role === 'target' && endNodeIds.has(nodeId)) return END;
    return nodeId;
  };

  // 1. 添加 Agent 节点（跳过 start/end）
  for (const node of workflowDef.nodes) {
    if (node.type === 'start' || node.type === 'end') continue;

    const upstreamNodeIds = workflowDef.edges
      .filter((e) => e.target === node.id && !startNodeIds.has(e.source))
      .map((e) => e.source);

    const executor = nodeExecutor(node, upstreamNodeIds);

    if (node.type === 'parallel') {
      // parallel 节点：注册 dispatcher node（node.id）和 worker node（node.id__worker）
      const workerNodeId = `${node.id}__worker`;

      // dispatcher node: 执行 nodeExecutor 读取 items，写入 nodeOutputs[node.id]
      builder.addNode(node.id, async (state: Record<string, unknown>) => {
        try {
          const result = await executor(state);
          return {
            nodeOutputs: { [node.id]: result },
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorType = err instanceof Error ? err.name : 'UnknownError';
          return {
            errors: [{
              nodeId: node.id,
              error: errorMessage,
              timestamp: Date.now(),
            }],
            nodeOutputs: {
              [node.id]: {
                error: errorMessage,
                errorType,
                nodeId: node.id,
                failed: true,
                items: [],
              },
            },
          };
        }
      }, {
        retryPolicy: { maxAttempts: node.data.retryCount ?? 1 },
      });

      // worker node: 从 Send args（state 中）读取 __fanout_item，执行 agent
      builder.addNode(workerNodeId, async (state: Record<string, unknown>) => {
        const fanoutIndex = state.__fanout_index as number;
        const fanoutNodeId = (state.__fanout_node_id as string) || node.id;

        try {
          const result = await executor(state);
          const workerKey = `${fanoutNodeId}__worker:${fanoutIndex}`;
          return {
            nodeOutputs: { [workerKey]: result },
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorType = err instanceof Error ? err.name : 'UnknownError';
          const workerKey = `${fanoutNodeId}__worker:${fanoutIndex}`;
          return {
            errors: [{
              nodeId: workerKey,
              error: errorMessage,
              timestamp: Date.now(),
            }],
            nodeOutputs: {
              [workerKey]: {
                error: errorMessage,
                errorType,
                nodeId: workerKey,
                failed: true,
              },
            },
          };
        }
      });
    } else {
      // 普通节点
      builder.addNode(node.id, async (state: Record<string, unknown>) => {
        try {
          const result = await executor(state);
          const routing = (result.routing && typeof result.routing === 'object') ? result.routing as Record<string, string> : undefined;
          const artifacts = Array.isArray(result.artifacts) ? result.artifacts : undefined;
          return {
            nodeOutputs: { [node.id]: result },
            ...(routing ? { routing } : {}),
            ...(artifacts ? { artifacts } : {}),
          };
        } catch (err) {
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
  }

  // 2. 添加边
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
    const sourceId = edge.source;
    const targetId = edge.target;

    // parallel 节点的 out-edges：source 替换为 worker node
    if (parallelNodeIds.has(sourceId)) {
      const workerNodeId = `${sourceId}__worker`;
      builder.addEdge(workerNodeId as any, toGraphNode(targetId, 'target') as any);
      continue;
    }

    // parallel 节点作为 target 的 in-edges：正常处理（连接到 dispatcher）
    builder.addEdge(toGraphNode(sourceId, 'source') as any, toGraphNode(targetId, 'target') as any);
  }

  // 为 parallel 节点添加 fan-out conditional edges（dispatcher → Send[]）
  for (const node of workflowDef.nodes) {
    if (node.type !== 'parallel') continue;
    const workerNodeId = `${node.id}__worker`;
    const concurrencyLimit = node.data.concurrencyLimit ?? MAX_PARALLEL_ITEMS;
    const fanOutRouter = createFanOutRouter(node.id, workerNodeId, concurrencyLimit);
    builder.addConditionalEdges(node.id as any, fanOutRouter as any, [workerNodeId, END] as any);
  }

  for (const [, groupEdges] of conditionalGroups) {
    const firstEdge = groupEdges[0];
    const condition = firstEdge.metadata!.condition!.trim();
    const sourceNode = toGraphNode(firstEdge.source, 'source');

    const routeMap: Record<string, string> = {};
    const routeMatchers: RouteMatcher[] = [];
    for (const edge of groupEdges) {
      // targets → 统一转为 routeMatcher（eq 精确匹配）
      const configuredTargets = edge.metadata?.targets ?? {};
      for (const [value, targetId] of Object.entries(configuredTargets)) {
        routeMap[value] = toGraphNode(targetId, 'target') as string;
        routeMatchers.push({ routeKey: value, operator: 'eq', expected: value });
      }
      // routeValue → 支持自定义操作符
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

    builder.addConditionalEdges(
      sourceNode as any,
      createConditionalRouter(condition, routeMatchers),
      routeMap as any,
    );
  }

  return builder;
}

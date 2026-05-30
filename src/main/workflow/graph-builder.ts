/**
 * Graph Builder — ReactFlow 图定义 → LangGraph.js StateGraph 转换
 *
 * 包含：
 * - 条件路由（D-09）
 * - ReactFlow → StateGraph 转换（D-13/D-14/D-15）
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { WorkflowState } from './state-schema';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowEdgeOperator } from '../../shared/types';

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

  // 1. 添加 Agent 节点（跳过 start/end）
  for (const node of workflowDef.nodes) {
    if (node.type === 'start' || node.type === 'end') continue;

    const upstreamNodeIds = workflowDef.edges
      .filter((e) => e.target === node.id && !startNodeIds.has(e.source))
      .map((e) => e.source);

    const executor = nodeExecutor(node, upstreamNodeIds);

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
    builder.addEdge(toGraphNode(edge.source, 'source') as any, toGraphNode(edge.target, 'target') as any);
  }

  for (const [, groupEdges] of conditionalGroups) {
    const firstEdge = groupEdges[0];
    const condition = firstEdge.metadata!.condition!.trim();
    const sourceNode = toGraphNode(firstEdge.source, 'source');

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

    builder.addConditionalEdges(
      sourceNode as any,
      createConditionalRouter(condition, routeMatchers.length > 0 ? routeMatchers : undefined),
      routeMap as any,
    );
  }

  return builder;
}

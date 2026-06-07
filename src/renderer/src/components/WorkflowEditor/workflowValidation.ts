import i18next from 'i18next';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNode, WorkflowDefinition, WorkflowEdge } from '../../../../shared/types';

/**
 * Workflow validation and normalization utilities.
 * Extracted from WorkflowEditor.tsx to reduce file size.
 */

import { isExecutableNodeType } from './nodeTypeRegistry';

export { isExecutableNodeType };

export const START_NODE_ID = 'start';
export const END_NODE_ID = 'end';

export const DELETE_KEY_CODE: string[] = ['Delete', 'Backspace'];

export function getDefaultNodeData(type: string): Record<string, unknown> {
  const t = (key: string) => i18next.t(key);
  if (type === 'start') return { label: t('workflow.nodeTypes.start.label'), workspace: '', workArea: '' };
  if (type === 'end') return { label: t('workflow.nodeTypes.end.label') };
  if (type === 'loop') return { label: t('workflow.nodeTypes.loop.label'), nodeKind: 'loop', taskDescription: '', loopCount: 3, failureStrategy: 'stop', retryCount: 3 };
  if (type === 'review') return { label: t('workflow.nodeTypes.review.label'), nodeKind: 'review', reviewSpec: '', reviewRules: '', failureStrategy: 'stop', retryCount: 3 };
  if (type === 'foreach') return { label: t('workflow.nodeTypes.foreach.label'), nodeKind: 'foreach', taskDescription: '', dataSource: '', itemPrompt: '', failureStrategy: 'stop', retryCount: 3 };
  return { label: t('workflow.nodeTypes.task.label'), nodeKind: 'task', taskDescription: '', failureStrategy: 'stop', retryCount: 3 };
}

export function getEdgeLabel(metadata?: WorkflowEdge['metadata']): string | undefined {
  if (!metadata?.condition) return undefined;
  const value = metadata.compareValue ?? metadata.routeValue;
  const operatorLabel: Record<string, string> = { eq: '=', ne: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=' };
  return value ? `${operatorLabel[metadata.operator || 'eq']} ${value}` : metadata.condition;
}

export function getNodeType(nodes: Node[], nodeId?: string | null): string | undefined {
  return nodes.find((node) => node.id === nodeId)?.type;
}

export function edgeMetadata(edge: Edge): WorkflowEdge['metadata'] | undefined {
  return (edge as Edge & { metadata?: WorkflowEdge['metadata'] }).metadata;
}

export const defaultNodes: Node[] = [
  { id: START_NODE_ID, type: 'start', position: { x: 250, y: 50 }, data: getDefaultNodeData('start'), deletable: false, width: 150, height: 50 },
  { id: END_NODE_ID, type: 'end', position: { x: 250, y: 400 }, data: { label: i18next.t('workflow.nodeTypes.end.label') }, deletable: false, width: 150, height: 50 },
] as Node[];

export function normalizeWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition {
  const idMap = new Map<string, string>();
  let startSeen = false;
  let endSeen = false;

  const nodes = (def.nodes?.length ? def.nodes : defaultNodes as WorkflowNode[]).map((node: WorkflowNode) => {
    if (node.type === 'start' && !startSeen) {
      startSeen = true;
      idMap.set(node.id, START_NODE_ID);
      return { ...node, id: START_NODE_ID, data: { ...getDefaultNodeData('start'), ...node.data, label: node.data.label || i18next.t('workflow.nodeTypes.start.label') } };
    }
    if (node.type === 'end' && !endSeen) {
      endSeen = true;
      idMap.set(node.id, END_NODE_ID);
      return { ...node, id: END_NODE_ID, data: { ...node.data, label: node.data.label || i18next.t('workflow.nodeTypes.end.label') } };
    }
    if (node.type === 'agent') {
      return { ...node, data: { ...getDefaultNodeData('task'), ...node.data, nodeKind: node.data.nodeKind || 'task' } };
    }
    if (isExecutableNodeType(node.type)) {
      return { ...node, data: { ...getDefaultNodeData(node.type), ...node.data } };
    }
    return node;
  });

  const edges = (def.edges ?? []).map((edge) => ({
    ...edge,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }));

  return { ...def, nodes, edges };
}

export function validateWorkflowGraph(nodes: Node[], edges: Edge[], mode: 'save' | 'run'): string[] {
  const errors: string[] = [];
  const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);
  const startNodes = nodes.filter((node) => node.type === 'start');
  const endNodes = nodes.filter((node) => node.type === 'end');
  const agentNodes = nodes.filter((node) => isExecutableNodeType(node.type));

  if (startNodes.length !== 1) errors.push(t('workflow.validation.startNodeCount'));
  if (endNodes.length !== 1) errors.push(t('workflow.validation.endNodeCount'));

  // 检查重复节点标签
  const labelCounts = new Map<string, string[]>();
  for (const node of nodes) {
    const label = (node.data as Record<string, unknown>).label as string || '';
    if (!label) continue;
    const ids = labelCounts.get(label) || [];
    ids.push(node.id);
    labelCounts.set(label, ids);
  }
  for (const [label, ids] of labelCounts) {
    if (ids.length > 1) {
      errors.push(t('workflow.validation.duplicateLabel', { label, count: ids.length }));
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(t('workflow.validation.edgeMissingNode', { id: edge.id }));
    }
    if (getNodeType(nodes, edge.source) === 'end') {
      errors.push(t('workflow.validation.endNodeOutEdge'));
    }
    if (getNodeType(nodes, edge.target) === 'start') {
      errors.push(t('workflow.validation.startNodeInEdge'));
    }
  }

  const startId = startNodes[0]?.id;
  const endId = endNodes[0]?.id;

  if (mode === 'run') {
    if (agentNodes.length === 0) errors.push(t('workflow.validation.noExecutableNode'));
    if (startId && !edges.some((edge) => edge.source === startId)) {
      errors.push(t('workflow.validation.startNotConnected'));
    }
    if (endId && !edges.some((edge) => edge.target === endId)) {
      errors.push(t('workflow.validation.endNoUpstream'));
    }

    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    }
    const collect = (seed: string | undefined, graph: Map<string, string[]>) => {
      const visited = new Set<string>();
      const stack = seed ? [seed] : [];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of graph.get(current) ?? []) stack.push(next);
      }
      return visited;
    };
    const reachableFromStart = collect(startId, outgoing);
    const canReachEnd = collect(endId, incoming);
    for (const node of agentNodes) {
      if (!reachableFromStart.has(node.id)) {
        errors.push(t('workflow.validation.taskNotReachableFromStart', { label: (node.data as Record<string, unknown>).label || node.id }));
      }
      if (!canReachEnd.has(node.id)) {
        errors.push(t('workflow.validation.taskCannotReachEnd', { label: (node.data as Record<string, unknown>).label || node.id }));
      }
    }

    for (const node of agentNodes) {
      if (!(node.data as Record<string, unknown>).agentId) {
        errors.push(t('workflow.validation.taskNoAgent', { label: (node.data as Record<string, unknown>).label || node.id }));
      }
      if ((node.type === 'task' || node.type === 'loop' || node.type === 'agent') && !String((node.data as Record<string, unknown>).taskDescription || (node.data as Record<string, unknown>).description || '').trim()) {
        errors.push(t('workflow.validation.taskMissingDescription', { label: (node.data as Record<string, unknown>).label || node.id }));
      }
      if (node.type === 'review' && !String((node.data as Record<string, unknown>).reviewSpec || '').trim()) {
        errors.push(t('workflow.validation.reviewMissingSpec', { label: (node.data as Record<string, unknown>).label || node.id }));
      }
    }
    for (const edge of edges) {
      const metadata = edgeMetadata(edge);
      if (metadata?.condition && !metadata.routeValue && !metadata.compareValue && !metadata.targets) {
        errors.push(t('workflow.validation.conditionalEdgeMissingValue', { id: edge.id }));
      }
    }
  }

  return Array.from(new Set(errors));
}

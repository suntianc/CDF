import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNode, WorkflowDefinition, WorkflowEdge } from '../../../../shared/types';

/**
 * Workflow validation and normalization utilities.
 * Extracted from WorkflowEditor.tsx to reduce file size.
 */

export const START_NODE_ID = 'start';
export const END_NODE_ID = 'end';

export const EXECUTABLE_NODE_TYPES = new Set(['agent', 'task', 'loop', 'review']);
export const DELETE_KEY_CODE: string[] = ['Delete', 'Backspace'];

export function isExecutableNodeType(type?: string | null): boolean {
  return EXECUTABLE_NODE_TYPES.has(type || '');
}

export function getDefaultNodeData(type: string): Record<string, unknown> {
  if (type === 'start') return { label: '开始', workspace: '', workArea: '' };
  if (type === 'end') return { label: '结束' };
  if (type === 'loop') return { label: 'Loop 节点', nodeKind: 'loop', taskDescription: '', loopCount: 3, failureStrategy: 'stop', retryCount: 3 };
  if (type === 'review') return { label: '审查节点', nodeKind: 'review', reviewSpec: '', reviewRules: '', failureStrategy: 'stop', retryCount: 3 };
  return { label: '普通任务节点', nodeKind: 'task', taskDescription: '', failureStrategy: 'stop', retryCount: 3 };
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
  { id: END_NODE_ID, type: 'end', position: { x: 250, y: 400 }, data: { label: '结束' }, deletable: false, width: 150, height: 50 },
] as Node[];

export function normalizeWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition {
  const idMap = new Map<string, string>();
  let startSeen = false;
  let endSeen = false;

  const nodes = (def.nodes?.length ? def.nodes : defaultNodes as WorkflowNode[]).map((node: WorkflowNode) => {
    if (node.type === 'start' && !startSeen) {
      startSeen = true;
      idMap.set(node.id, START_NODE_ID);
      return { ...node, id: START_NODE_ID, data: { ...getDefaultNodeData('start'), ...node.data, label: node.data.label || '开始' } };
    }
    if (node.type === 'end' && !endSeen) {
      endSeen = true;
      idMap.set(node.id, END_NODE_ID);
      return { ...node, id: END_NODE_ID, data: { ...node.data, label: node.data.label || '结束' } };
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
  const startNodes = nodes.filter((node) => node.type === 'start');
  const endNodes = nodes.filter((node) => node.type === 'end');
  const agentNodes = nodes.filter((node) => isExecutableNodeType(node.type));

  if (startNodes.length !== 1) errors.push('工作流必须且只能有一个开始节点');
  if (endNodes.length !== 1) errors.push('工作流必须且只能有一个结束节点');

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`边 ${edge.id} 指向了不存在的节点`);
    }
    if (getNodeType(nodes, edge.source) === 'end') {
      errors.push('结束节点不能有出边');
    }
    if (getNodeType(nodes, edge.target) === 'start') {
      errors.push('开始节点不能有入边');
    }
  }

  const startId = startNodes[0]?.id;
  const endId = endNodes[0]?.id;

  if (mode === 'run') {
    if (agentNodes.length === 0) errors.push('至少需要一个可执行任务节点');
    if (startId && !edges.some((edge) => edge.source === startId)) {
      errors.push('开始节点必须连接到后续节点');
    }
    if (endId && !edges.some((edge) => edge.target === endId)) {
      errors.push('结束节点必须有上游节点');
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
        errors.push(`任务节点「${(node.data as Record<string, unknown>).label || node.id}」无法从开始节点到达`);
      }
      if (!canReachEnd.has(node.id)) {
        errors.push(`任务节点「${(node.data as Record<string, unknown>).label || node.id}」无法到达结束节点`);
      }
    }

    for (const node of agentNodes) {
      if (!(node.data as Record<string, unknown>).agentId) {
        errors.push(`任务节点「${(node.data as Record<string, unknown>).label || node.id}」未绑定 Agent`);
      }
      if ((node.type === 'task' || node.type === 'loop' || node.type === 'agent') && !String((node.data as Record<string, unknown>).taskDescription || (node.data as Record<string, unknown>).description || '').trim()) {
        errors.push(`任务节点「${(node.data as Record<string, unknown>).label || node.id}」缺少任务描述`);
      }
      if (node.type === 'review' && !String((node.data as Record<string, unknown>).reviewSpec || '').trim()) {
        errors.push(`审查节点「${(node.data as Record<string, unknown>).label || node.id}」缺少规范`);
      }
    }
    for (const edge of edges) {
      const metadata = edgeMetadata(edge);
      if (metadata?.condition && !metadata.routeValue && !metadata.compareValue && !metadata.targets) {
        errors.push(`条件边 ${edge.id} 缺少匹配值`);
      }
    }
  }

  return Array.from(new Set(errors));
}

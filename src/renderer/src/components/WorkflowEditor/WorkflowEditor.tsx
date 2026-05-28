import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Panel,
  type ReactFlowInstance,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { Workflow, WorkflowNode, WorkflowDefinition, WorkflowEdge, WorkflowStreamEvent } from '../../../../shared/types';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';
import { AgentNode } from './AgentNode';
import { ToolNode } from './ToolNode';
import { ConditionNode } from './ConditionNode';
import { DataNode } from './DataNode';
import { NodeConfigDrawer } from './NodeConfigDrawer';
import { EdgeConfigDrawer } from './EdgeConfigDrawer';
import { ExecutionPanel } from './ExecutionPanel';
import { useFlowStore } from '../../stores/flowStore';
import {
  ArrowLeft, Save, Play, Square, Bot, Info, Trash2, Target, Repeat2, ShieldCheck, ListTodo, Loader2, Undo2, Redo2,
  Wrench, Globe, Variable, Shuffle, GitBranch
} from 'lucide-react';


interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface WorkflowEditorProps {
  workflow: Workflow;
  onBack: () => void;
}

const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  task: AgentNode,
  loop: AgentNode,
  review: AgentNode,
  end: EndNode,
  tool_mcp: ToolNode,
  tool_http: ToolNode,
  variable: DataNode,
  transform: DataNode,
  condition: ConditionNode,
} satisfies NodeTypes;

const START_NODE_ID = 'start';
const END_NODE_ID = 'end';

const EXECUTABLE_NODE_TYPES = new Set(['agent', 'task', 'loop', 'review', 'tool_mcp', 'tool_http', 'transform']);
const DELETE_KEY_CODE: string[] = ['Delete', 'Backspace'];

function isExecutableNodeType(type?: string | null): boolean {
  return EXECUTABLE_NODE_TYPES.has(type || '');
}

function getDefaultNodeData(type: string): Record<string, unknown> {
  if (type === 'start') return { label: '开始', workspace: '', workArea: '' };
  if (type === 'end') return { label: '结束' };
  if (type === 'loop') return { label: 'Loop 节点', nodeKind: 'loop', taskDescription: '', loopCount: 3, failureStrategy: 'stop', retryCount: 3 };
  if (type === 'review') return { label: '审查节点', nodeKind: 'review', reviewSpec: '', reviewRules: '', failureStrategy: 'stop', retryCount: 3 };
  return { label: '普通任务节点', nodeKind: 'task', taskDescription: '', failureStrategy: 'stop', retryCount: 3 };
}

function getEdgeLabel(metadata?: WorkflowEdge['metadata']): string | undefined {
  if (!metadata?.condition) return undefined;
  const value = metadata.compareValue ?? metadata.routeValue;
  const operatorLabel: Record<string, string> = { eq: '=', ne: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=' };
  return value ? `${operatorLabel[metadata.operator || 'eq']} ${value}` : metadata.condition;
}

const defaultNodes: Node[] = [
  { id: START_NODE_ID, type: 'start', position: { x: 250, y: 50 }, data: getDefaultNodeData('start'), deletable: false },
  { id: END_NODE_ID, type: 'end', position: { x: 250, y: 400 }, data: { label: '结束' }, deletable: false },
] as Node[];

function normalizeWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition {
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

function getNodeType(nodes: Node[], nodeId?: string | null): string | undefined {
  return nodes.find((node) => node.id === nodeId)?.type;
}

function edgeMetadata(edge: Edge): WorkflowEdge['metadata'] | undefined {
  return (edge as Edge & { metadata?: WorkflowEdge['metadata'] }).metadata;
}

function validateWorkflowGraph(nodes: Node[], edges: Edge[], mode: 'save' | 'run'): string[] {
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

export function WorkflowEditor({ workflow, onBack }: WorkflowEditorProps) {
  const { saveWorkflow, runWorkflow, stopWorkflow, workflows } = useWorkflowStore();
  const { currentProjectId } = useProjectStore();
  const { theme } = useThemeStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // Refs for stale closure prevention (ReactFlow best practice)
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [workflowName, setWorkflowName] = useState(workflow.name || '新建工作流');
  const [taskGoal, setTaskGoal] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null as Node | null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [edgeDrawerOpen, setEdgeDrawerOpen] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [workflowId, setWorkflowId] = useState(workflow.id || window.crypto.randomUUID());

  // Load existing workflow data
  useEffect(() => {
    setWorkflowId(workflow.id || window.crypto.randomUUID());
    if (workflow.id && workflow.graph_data) {
      const def = normalizeWorkflowDefinition(workflow.graph_data as WorkflowDefinition);
      if (def.nodes?.length) {
        setNodes(def.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { ...n.data },
          deletable: isExecutableNodeType(n.type),
        })));
      }
      if (def.edges?.length) {
        setEdges(def.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          label: getEdgeLabel(e.metadata),
          animated: Boolean(e.metadata?.condition),
          style: e.metadata?.condition ? { stroke: 'var(--color-warning)' } : undefined,
          metadata: e.metadata,
        })));
      } else {
        setEdges([] as Edge[]);
      }
      setWorkflowName(workflow.name || '新建工作流');
    } else {
      setNodes(defaultNodes as Node[]);
      setEdges([] as Edge[]);
      setWorkflowName('新建工作流');
    }
  }, [workflow.id, workflow.name, workflow.graph_data, setNodes, setEdges]);

  // Stable viewport reference to avoid unnecessary re-application
  const viewportRef = useRef(workflow.graph_data?.viewport);
  useEffect(() => {
    viewportRef.current = workflow.graph_data?.viewport;
  }, [workflow.graph_data?.viewport]);

  useEffect(() => {
    if (rfInstance && viewportRef.current) {
      rfInstance.setViewport(viewportRef.current);
    }
  }, [rfInstance]);

  useEffect(() => {
    if (!executionId) return;

    const unsubscribe = window.electronAPI.workflow.onWorkflowEvent(executionId, (_event: unknown, data: WorkflowStreamEvent) => {
      if (data.type === 'workflow_start') {
        setNodes((nds) => nds.map((node) => isExecutableNodeType(node.type)
          ? { ...node, data: { ...node.data, status: 'pending' } }
          : node));
        // Animate all edges during execution
        setEdges((eds) => eds.map((edge) => ({ ...edge, animated: true })));
      }
      if (data.type === 'node_start') {
        setNodes((nds) => nds.map((node) => node.id === data.nodeId
          ? { ...node, data: { ...node.data, status: 'running' } }
          : node));
      }
      if (data.type === 'node_end') {
        setNodes((nds) => nds.map((node) => node.id === data.nodeId
          ? { ...node, data: { ...node.data, status: 'completed' } }
          : node));
      }
      if (data.type === 'node_error') {
        setNodes((nds) => nds.map((node) => node.id === data.nodeId
          ? { ...node, data: { ...node.data, status: 'failed' } }
          : node));
      }
      if (data.type === 'workflow_end') {
        setIsRunning(false);
        // Remove animation from all edges when execution ends
        setEdges((eds) => eds.map((edge) => ({ ...edge, animated: Boolean((edge as any).metadata?.condition) })));
      }
    });

    return unsubscribe;
  }, [executionId, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const sourceIsReview = sourceNode?.type === 'review' || (sourceNode?.data as Record<string, unknown> | undefined)?.nodeKind === 'review';
      const metadata: WorkflowEdge['metadata'] | undefined = sourceIsReview
        ? { condition: connection.source || '', operator: 'eq', routeValue: '通过', compareValue: '通过', maxIterations: 10 }
        : undefined;
      setEdges((eds) => addEdge({
        ...connection,
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        type: 'smoothstep',
        label: getEdgeLabel(metadata),
        animated: Boolean(metadata),
        style: metadata ? { stroke: 'var(--color-warning)' } : undefined,
        metadata,
      } as Edge, eds));
    },
    [nodes, setEdges],
  );

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const currentNodes = nodesRef.current;
    const guardedChanges = changes.filter((change) => {
      if (change.type !== 'remove') return true;
      const nodeType = getNodeType(currentNodes, change.id);
      if (nodeType === 'start' || nodeType === 'end') {
        showToast('开始/结束节点不能删除', 'error');
        return false;
      }
      return true;
    });
    onNodesChange(guardedChanges);

    const removedIds = guardedChanges
      .filter((change) => change.type === 'remove')
      .map((change) => change.id);
    if (removedIds.length > 0) {
      const removedIdSet = new Set(removedIds);
      setEdges((eds) => eds.filter((edge) => !removedIdSet.has(edge.source) && !removedIdSet.has(edge.target)));
      setSelectedNodeIds((ids) => ids.filter((id) => !removedIdSet.has(id)));
      setSelectedEdgeIds([]);
      if (selectedNode && removedIdSet.has(selectedNode.id)) {
        setSelectedNode(null);
        setDrawerOpen(false);
      }
    }
  }, [onNodesChange, selectedNode, setEdges, showToast]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);

    const removedIds = changes
      .filter((change) => change.type === 'remove')
      .map((change) => change.id);
    if (removedIds.length > 0) {
      const removedIdSet = new Set(removedIds);
      setSelectedEdgeIds((ids) => ids.filter((id) => !removedIdSet.has(id)));
      if (selectedEdge && removedIdSet.has(selectedEdge.id)) {
        setSelectedEdge(null);
        setEdgeDrawerOpen(false);
      }
    }
  }, [onEdgesChange, selectedEdge]);

  const deleteEdgesById = useCallback((edgeIds: string[]) => {
    const edgeIdSet = new Set(edgeIds);
    if (edgeIdSet.size === 0) return;
    setEdges((eds) => eds.filter((edge) => !edgeIdSet.has(edge.id)));
    setSelectedEdgeIds((ids) => ids.filter((id) => !edgeIdSet.has(id)));
    if (selectedEdge && edgeIdSet.has(selectedEdge.id)) {
      setSelectedEdge(null);
      setEdgeDrawerOpen(false);
    }
    showToast(`已删除 ${edgeIdSet.size} 条边`, 'success');
  }, [selectedEdge, setEdges, showToast]);

  const deleteNodesById = useCallback((nodeIds: string[]) => {
    const requestedIds = new Set(nodeIds);
    const deletableIds = new Set(
      nodes
        .filter((node) => requestedIds.has(node.id) && isExecutableNodeType(node.type))
        .map((node) => node.id)
    );

    if (deletableIds.size === 0) {
      if (requestedIds.size > 0) showToast('开始/结束节点不能删除', 'error');
      return;
    }

    setNodes((nds) => nds.filter((node) => !deletableIds.has(node.id)));
    setEdges((eds) => eds.filter((edge) => !deletableIds.has(edge.source) && !deletableIds.has(edge.target)));
    setSelectedNodeIds((ids) => ids.filter((id) => !deletableIds.has(id)));
    setSelectedEdgeIds([]);
    if (selectedNode && deletableIds.has(selectedNode.id)) {
      setSelectedNode(null);
      setDrawerOpen(false);
    }
    showToast(`已删除 ${deletableIds.size} 个节点`, 'success');
  }, [nodes, selectedNode, setEdges, setNodes, showToast]);

  const handleDeleteSelected = useCallback(() => {
    deleteEdgesById(selectedEdgeIds);
    deleteNodesById(selectedNodeIds);
  }, [deleteEdgesById, deleteNodesById, selectedEdgeIds, selectedNodeIds]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    setSelectedNodeIds(selectedNodes.map((node) => node.id));
    setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
  }, []);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceType = getNodeType(currentNodes, connection.source);
    const targetType = getNodeType(currentNodes, connection.target);
    if (sourceType === 'end') return false;
    if (targetType === 'start') return false;
    return !currentEdges.some((edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.targetHandle === connection.targetHandle
    );
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'start' || isExecutableNodeType(node.type)) {
      setSelectedNode(node);
      setDrawerOpen(true);
    }
  }, []);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation();
    setSelectedEdge(edge);
    setEdgeDrawerOpen(true);
  }, []);

  const handleUpdateNode = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
        ),
      );
    },
    [setNodes],
  );

  const handleUpdateEdge = useCallback(
    (edgeId: string, updates: Partial<Edge>) => {
      setEdges((eds) => eds.map((edge) => edge.id === edgeId ? { ...edge, ...updates } : edge));
    },
    [setEdges],
  );

  // Drag & drop from panel
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !rfInstance || !reactFlowWrapper.current) return;
      const currentNodes = nodesRef.current;
      if ((type === 'start' && currentNodes.some((node) => node.type === 'start')) || (type === 'end' && currentNodes.some((node) => node.type === 'end'))) {
        showToast(`${type === 'start' ? '开始' : '结束'}节点只能有一个`, 'error');
        return;
      }

      const position = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id = type === 'start' ? START_NODE_ID : type === 'end' ? END_NODE_ID : `${type}-${crypto.randomUUID()}`;
      const newNode: Node = {
        id,
        type,
        position,
        deletable: isExecutableNodeType(type),
        data: getDefaultNodeData(type),
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [rfInstance, setNodes, showToast],
  );

  const handleSave = useCallback(async (mode: 'save' | 'run' = 'save') => {
    if (!currentProjectId || !rfInstance) return false;

    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      showToast('工作流名称不能为空', 'error');
      return false;
    }

    const nameExists = workflows.some(
      (w) => w.name.trim().toLowerCase() === trimmedName.toLowerCase() && w.id !== workflowId
    );
    if (nameExists) {
      showToast(`工作流「${trimmedName}」已存在，请使用其他名称`, 'error');
      return false;
    }

    const validationErrors = validateWorkflowGraph(nodes, edges, mode);
    if (validationErrors.length > 0) {
      showToast(validationErrors[0], 'error');
      return false;
    }

    setIsSaving(true);
    try {
      const flow = rfInstance.toObject();
      const graphData: WorkflowDefinition = {
        nodes: flow.nodes.map((n) => ({
          id: n.id,
          type: (n.type || 'agent') as WorkflowNode['type'],
          position: n.position,
          data: {
            label: (n.data as Record<string, unknown>).label as string || '',
            nodeKind: (n.data as Record<string, unknown>).nodeKind as WorkflowNode['data']['nodeKind'],
            agentId: (n.data as Record<string, unknown>).agentId as string | undefined,
            description: (n.data as Record<string, unknown>).description as string | undefined,
            taskDescription: (n.data as Record<string, unknown>).taskDescription as string | undefined,
            workspace: (n.data as Record<string, unknown>).workspace as string | undefined,
            workArea: (n.data as Record<string, unknown>).workArea as string | undefined,
            loopCount: (n.data as Record<string, unknown>).loopCount as number | undefined,
            reviewSpec: (n.data as Record<string, unknown>).reviewSpec as string | undefined,
            reviewRules: (n.data as Record<string, unknown>).reviewRules as string | undefined,
            failureStrategy: (n.data as Record<string, unknown>).failureStrategy as 'retry' | 'skip' | 'stop' | undefined,
            retryCount: (n.data as Record<string, unknown>).retryCount as number | undefined,
          },
        })),
        edges: flow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          metadata: edgeMetadata(e),
        })) as WorkflowDefinition['edges'],
        viewport: flow.viewport,
      };

      await saveWorkflow({
        id: workflowId,
        project_id: currentProjectId,
        name: trimmedName,
        description: workflow.description || '',
        graph_data: graphData,
        status: workflow.status || 'draft',
      });
      showToast('✓ 工作流保存成功', 'success');
      return true;
    } catch (err: unknown) {
      console.error('Failed to save workflow:', err);
      showToast(err instanceof Error ? err.message : '保存工作流失败', 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, rfInstance, workflow, workflowName, saveWorkflow, workflows, workflowId, showToast, nodes, edges]);

  const handleRun = useCallback(async () => {
    if (!currentProjectId) return;
    // Save first
    const trimmedGoal = taskGoal.trim();
    if (!trimmedGoal) {
      showToast('请先填写本次执行的任务目标', 'error');
      return;
    }
    const saved = await handleSave('run');
    if (!saved) return;
    try {
      setNodes((nds) => nds.map((node) => isExecutableNodeType(node.type)
        ? { ...node, data: { ...node.data, status: 'pending' } }
        : node));
      const execId = await runWorkflow(workflowId, currentProjectId, 'editor', {
        taskGoal: trimmedGoal,
      });
      setExecutionId(execId);
      setIsRunning(true);
    } catch (err: unknown) {
      console.error('Failed to run workflow:', err);
      // Reset node pending status on failure
      setNodes((nds) => nds.map((node) => isExecutableNodeType(node.type)
        ? { ...node, data: { ...node.data, status: undefined } }
        : node));
      showToast(err instanceof Error ? err.message : '启动工作流失败', 'error');
    }
  }, [currentProjectId, workflowId, handleSave, runWorkflow, showToast, taskGoal]);

  const handleStop = useCallback(async () => {
    if (executionId) {
      await stopWorkflow(executionId);
      setIsRunning(false);
    }
  }, [executionId, stopWorkflow]);

  const handleCloseExecution = useCallback(() => {
    setExecutionId(null);
    setIsRunning(false);
  }, []);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };



  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden relative">
      {/* Toast Notification Container */}
      <div className="absolute top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg transition-all duration-300 animate-slide-in pointer-events-auto border ${
              t.type === 'success' 
                ? 'bg-[var(--color-success-dim)] border-[var(--color-success)]/20 text-[var(--color-success)]' 
                : t.type === 'error'
                  ? 'bg-[var(--color-danger-dim)] border-[var(--color-danger)]/20 text-[var(--color-danger)]'
                  : 'bg-[var(--color-bg-active)] border-[var(--color-border)]/40 text-[var(--color-text-primary)]'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Top Toolbar */}
      <div className="main-topbar shrink-0 h-12 border-b border-[var(--color-border)]/50 px-4 !pl-36">
        <div className="main-topbar-left">
          <button onClick={onBack} className="topbar-btn cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
            <span>返回</span>
          </button>
          <input
            className="bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] transition-colors px-1 py-0.5 w-[200px]"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
        </div>
        <div className="topbar-actions">
          <button
            className="topbar-btn cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30"
            onClick={() => {
              const { undo } = useFlowStore.getState();
              const result = undo();
              if (result) { setNodes(result.nodes); setEdges(result.edges); }
            }}
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="topbar-btn cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30"
            onClick={() => {
              const { redo } = useFlowStore.getState();
              const result = redo();
              if (result) { setNodes(result.nodes); setEdges(result.edges); }
            }}
            title="重做 (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="btn btn-secondary btn-sm cursor-pointer animate-none"
            onClick={() => handleSave('save')}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>保存</span>
          </button>
          {isRunning ? (
            <button className="btn btn-danger btn-sm cursor-pointer" onClick={handleStop}>
              <Square className="w-3.5 h-3.5" />
              <span>停止</span>
            </button>
          ) : (
            <button className="btn btn-primary btn-sm cursor-pointer" onClick={handleRun}>
              <Play className="w-3.5 h-3.5" />
              <span>运行</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Node Panel */}
        <div className="w-[200px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]/50 p-3 flex flex-col gap-1.5 shrink-0 overflow-y-auto">
          <div className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
            节点面板
          </div>

          {/* Flow nodes */}
          <div className="text-[10px] text-[var(--color-text-muted)] mt-1">流程控制</div>
          {[
            { type: 'start', label: '开始', color: 'var(--color-success)', dot: true },
            { type: 'end', label: '结束', color: 'var(--color-danger)', dot: true },
          ].map((n) => (
            <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
              onDragStart={(e) => onDragStart(e, n.type)} draggable>
              {n.dot ? <div className="w-2 h-2 rounded-full" style={{ background: n.color }} /> : null}
              {n.label}
            </div>
          ))}

          {/* Agent nodes */}
          <div className="text-[10px] text-[var(--color-text-muted)] mt-2">Agent 节点</div>
          {[
            { type: 'task', label: '任务节点', icon: ListTodo, color: 'var(--color-accent)' },
            { type: 'loop', label: 'Loop 节点', icon: Repeat2, color: 'var(--color-info)' },
            { type: 'review', label: '审查节点', icon: ShieldCheck, color: 'var(--color-warning)' },
          ].map((n) => (
            <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
              onDragStart={(e) => onDragStart(e, n.type)} draggable>
              <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              {n.label}
            </div>
          ))}

          {/* Tool nodes */}
          <div className="text-[10px] text-[var(--color-text-muted)] mt-2">工具节点</div>
          {[
            { type: 'tool_mcp', label: 'MCP 工具', icon: Wrench, color: '#06b6d4' },
            { type: 'tool_http', label: 'HTTP 请求', icon: Globe, color: '#8b5cf6' },
          ].map((n) => (
            <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
              onDragStart={(e) => onDragStart(e, n.type)} draggable>
              <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              {n.label}
            </div>
          ))}

          {/* Data nodes */}
          <div className="text-[10px] text-[var(--color-text-muted)] mt-2">数据处理</div>
          {[
            { type: 'variable', label: '变量', icon: Variable, color: '#10b981' },
            { type: 'transform', label: '数据转换', icon: Shuffle, color: '#f97316' },
          ].map((n) => (
            <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
              onDragStart={(e) => onDragStart(e, n.type)} draggable>
              <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              {n.label}
            </div>
          ))}

          {/* Logic nodes */}
          <div className="text-[10px] text-[var(--color-text-muted)] mt-2">逻辑判断</div>
          {[
            { type: 'condition', label: '条件判断', icon: GitBranch, color: '#ec4899' },
          ].map((n) => (
            <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
              onDragStart={(e) => onDragStart(e, n.type)} draggable>
              <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              {n.label}
            </div>
          ))}

          <div className="mt-4 pt-4 border-t border-[var(--color-border)]/40 flex flex-col gap-2">
            <label className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" />
              任务目标
            </label>
            <textarea
              className="w-full min-h-[120px] resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20"
              value={taskGoal}
              onChange={(event) => setTaskGoal(event.target.value)}
              placeholder="描述本次运行要完成的任务。运行时会作为 input.taskGoal 传给工作流节点。"
            />
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onSelectionChange={onSelectionChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onInit={(instance) => {
              setRfInstance(instance);
              instance.fitView();
            }}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            colorMode={theme}
            deleteKeyCode={DELETE_KEY_CODE}
            onlyRenderVisibleElements
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Execution Panel (right side when running) */}
        {executionId && (
          <ExecutionPanel executionId={executionId} taskGoal={taskGoal} onClose={handleCloseExecution} />
        )}
      </div>

      {/* Node Config Drawer */}
      <NodeConfigDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        node={selectedNode ? { id: selectedNode.id, type: selectedNode.type, data: selectedNode.data as Record<string, unknown> } as any : null}
        onUpdateNode={handleUpdateNode}
        onDeleteNode={(nodeId) => deleteNodesById([nodeId])}
      />
      <EdgeConfigDrawer
        isOpen={edgeDrawerOpen}
        onClose={() => setEdgeDrawerOpen(false)}
        edge={selectedEdge}
        onUpdateEdge={handleUpdateEdge}
        onDeleteEdge={(edgeId) => deleteEdgesById([edgeId])}
      />
    </div>
  );
}

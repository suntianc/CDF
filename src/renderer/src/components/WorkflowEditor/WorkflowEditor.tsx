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
import { NodeConfigDrawer } from './NodeConfigDrawer';
import { EdgeConfigDrawer } from './EdgeConfigDrawer';
import { ExecutionPanel } from './ExecutionPanel';
import { ExecutionHistoryDrawer } from './ExecutionHistoryDrawer';
import { NodePalette } from './NodePalette';
import { WorkflowToolbar } from './WorkflowToolbar';
import { useFlowStore } from '../../stores/flowStore';
import {
  isExecutableNodeType, getDefaultNodeData, getEdgeLabel, getNodeType, edgeMetadata,
  normalizeWorkflowDefinition, validateWorkflowGraph, defaultNodes, DELETE_KEY_CODE,
  START_NODE_ID, END_NODE_ID,
} from './workflowValidation';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';


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
  foreach: AgentNode,
  review: AgentNode,
  end: EndNode,
} satisfies NodeTypes;

export function WorkflowEditor({ workflow, onBack }: WorkflowEditorProps) {
  const { t } = useTranslation();
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
  const [workflowName, setWorkflowName] = useState(workflow.name || t('workflow.editor.newWorkflowName'));
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
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const historyIndex = useFlowStore((state) => state.historyIndex);
  const historyLength = useFlowStore((state) => state.history.length);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLength - 1;

  const takeSnapshot = useCallback((nextNodes?: Node[], nextEdges?: Edge[]) => {
    const { pushHistory } = useFlowStore.getState();
    pushHistory(nextNodes || nodesRef.current, nextEdges || edgesRef.current);
  }, []);

  const onNodeDragStop = useCallback(() => {
    takeSnapshot();
  }, [takeSnapshot]);

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
    let initialNodes: Node[] = [];
    let initialEdges: Edge[] = [];
    if (workflow.id && workflow.graph_data) {
      const def = normalizeWorkflowDefinition(workflow.graph_data as WorkflowDefinition);
      if (def.nodes?.length) {
        initialNodes = def.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          width: n.type === 'start' || n.type === 'end' ? 150 : 210,
          height: n.type === 'start' || n.type === 'end' ? 50 : 100,
          data: { ...n.data },
          deletable: isExecutableNodeType(n.type),
        }));
      }
      if (def.edges?.length) {
        initialEdges = def.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: null,
          targetHandle: null,
          type: 'default',
          label: getEdgeLabel(e.metadata),
          animated: Boolean(e.metadata?.condition),
          style: e.metadata?.condition ? { stroke: 'var(--color-warning)' } : undefined,
          metadata: e.metadata,
        }));
      }
      setNodes(initialNodes);
      setEdges(initialEdges);
      setWorkflowName(workflow.name || t('workflow.editor.newWorkflowName'));
    } else {
      initialNodes = defaultNodes as Node[];
      initialEdges = [];
      setNodes(initialNodes);
      setEdges(initialEdges);
      setWorkflowName(t('workflow.editor.newWorkflowName'));
    }
    const { clearHistory, pushHistory } = useFlowStore.getState();
    clearHistory();
    pushHistory(initialNodes, initialEdges);
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
        ? { condition: connection.source || '', operator: 'eq', routeValue: t('workflow.editor.defaultRoutePass'), compareValue: t('workflow.editor.defaultRoutePass') }
        : undefined;
      const newEdge = {
        ...connection,
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        type: 'default',
        label: getEdgeLabel(metadata),
        animated: Boolean(metadata),
        style: metadata ? { stroke: 'var(--color-warning)' } : undefined,
        metadata,
      } as Edge;
      const nextEds = addEdge(newEdge, edgesRef.current);
      setEdges(nextEds);
      takeSnapshot(nodesRef.current, nextEds);
    },
    [nodes, setEdges, takeSnapshot],
  );

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const currentNodes = nodesRef.current;
    const guardedChanges = changes.filter((change) => {
      if (change.type !== 'remove') return true;
      const nodeType = getNodeType(currentNodes, change.id);
      if (nodeType === 'start' || nodeType === 'end') {
        showToast(t('workflow.editor.cannotDeleteStartEnd'), 'error');
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
      const nextEds = edgesRef.current.filter((edge) => !removedIdSet.has(edge.source) && !removedIdSet.has(edge.target));
      const nextNds = currentNodes.filter((node) => !removedIdSet.has(node.id));
      setEdges(nextEds);
      takeSnapshot(nextNds, nextEds);
      setSelectedNodeIds((ids) => ids.filter((id) => !removedIdSet.has(id)));
      setSelectedEdgeIds([]);
      if (selectedNode && removedIdSet.has(selectedNode.id)) {
        setSelectedNode(null);
        setDrawerOpen(false);
      }
    }
  }, [onNodesChange, selectedNode, setEdges, showToast, takeSnapshot, t]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);

    const removedIds = changes
      .filter((change) => change.type === 'remove')
      .map((change) => change.id);
    if (removedIds.length > 0) {
      const removedIdSet = new Set(removedIds);
      const nextEds = edgesRef.current.filter((edge) => !removedIdSet.has(edge.id));
      takeSnapshot(nodesRef.current, nextEds);

      setSelectedEdgeIds((ids) => ids.filter((id) => !removedIdSet.has(id)));
      if (selectedEdge && removedIdSet.has(selectedEdge.id)) {
        setSelectedEdge(null);
        setEdgeDrawerOpen(false);
      }
    }
  }, [onEdgesChange, selectedEdge, takeSnapshot]);

  const deleteEdgesById = useCallback((edgeIds: string[]) => {
    const edgeIdSet = new Set(edgeIds);
    if (edgeIdSet.size === 0) return;
    const nextEds = edgesRef.current.filter((edge) => !edgeIdSet.has(edge.id));
    setEdges(nextEds);
    takeSnapshot(nodesRef.current, nextEds);
    setSelectedEdgeIds((ids) => ids.filter((id) => !edgeIdSet.has(id)));
    if (selectedEdge && edgeIdSet.has(selectedEdge.id)) {
      setSelectedEdge(null);
      setEdgeDrawerOpen(false);
    }
    showToast(t('workflow.editor.deletedEdges', { count: edgeIdSet.size }), 'success');
  }, [selectedEdge, setEdges, showToast, takeSnapshot, t]);

  const deleteNodesById = useCallback((nodeIds: string[]) => {
    const requestedIds = new Set(nodeIds);
    const deletableIds = new Set(
      nodesRef.current
        .filter((node) => requestedIds.has(node.id) && isExecutableNodeType(node.type))
        .map((node) => node.id)
    );

    if (deletableIds.size === 0) {
      if (requestedIds.size > 0) showToast(t('workflow.editor.cannotDeleteStartEnd'), 'error');
      return;
    }

    const nextNds = nodesRef.current.filter((node) => !deletableIds.has(node.id));
    const nextEds = edgesRef.current.filter((edge) => !deletableIds.has(edge.source) && !deletableIds.has(edge.target));

    setNodes(nextNds);
    setEdges(nextEds);
    takeSnapshot(nextNds, nextEds);

    setSelectedNodeIds((ids) => ids.filter((id) => !deletableIds.has(id)));
    setSelectedEdgeIds([]);
    if (selectedNode && deletableIds.has(selectedNode.id)) {
      setSelectedNode(null);
      setDrawerOpen(false);
    }
    showToast(t('workflow.editor.deletedNodes', { count: deletableIds.size }), 'success');
  }, [selectedNode, setEdges, setNodes, showToast, takeSnapshot, t]);

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
      const nextNds = nodesRef.current.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      );
      setNodes(nextNds);
      takeSnapshot(nextNds, edgesRef.current);
    },
    [setNodes, takeSnapshot],
  );

  const handleUpdateEdge = useCallback(
    (edgeId: string, updates: Partial<Edge>) => {
      const nextEds = edgesRef.current.map((edge) =>
        edge.id === edgeId ? { ...edge, ...updates } : edge
      );
      setEdges(nextEds);
      takeSnapshot(nodesRef.current, nextEds);
    },
    [setEdges, takeSnapshot],
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
        showToast(t('workflow.editor.singleNodeOnly', { type: type === 'start' ? t('workflow.nodeTypes.start.label') : t('workflow.nodeTypes.end.label') }), 'error');
        return;
      }

      const flowPos = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const nodeWidth = type === 'start' || type === 'end' ? 150 : 210;
      const nodeHeight = type === 'start' || type === 'end' ? 50 : 100;
      const position = {
        x: flowPos.x - nodeWidth / 2,
        y: flowPos.y - nodeHeight / 2,
      };

      const id = type === 'start' ? START_NODE_ID : type === 'end' ? END_NODE_ID : `${type}-${crypto.randomUUID()}`;
      const newNode: Node = {
        id,
        type,
        position,
        width: type === 'start' || type === 'end' ? 150 : 210,
        height: type === 'start' || type === 'end' ? 50 : 100,
        deletable: isExecutableNodeType(type),
        data: getDefaultNodeData(type),
      };
      const nextNds = [...currentNodes, newNode];
      setNodes(nextNds);
      takeSnapshot(nextNds, edgesRef.current);
    },
    [rfInstance, setNodes, showToast, takeSnapshot, t],
  );

  const handleSave = useCallback(async (mode: 'save' | 'run' = 'save') => {
    if (!currentProjectId || !rfInstance) return false;

    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      showToast(t('workflow.editor.nameEmpty'), 'error');
      return false;
    }

    const nameExists = workflows.some(
      (w) => w.name.trim().toLowerCase() === trimmedName.toLowerCase() && w.id !== workflowId
    );
    if (nameExists) {
      showToast(t('workflow.editor.nameExists', { name: trimmedName }), 'error');
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
        nodes: nodes.map((n) => ({
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
            taskGoal: (n.data as Record<string, unknown>).taskGoal as string | undefined,
            bgColor: (n.data as Record<string, unknown>).bgColor as string | undefined,
            dataSource: (n.data as Record<string, unknown>).dataSource as string | undefined,
            itemPrompt: (n.data as Record<string, unknown>).itemPrompt as string | undefined,
          },
        })),
        edges: edges.map((e) => ({
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
      showToast(t('workflow.editor.saveSuccess'), 'success');
      return true;
    } catch (err: unknown) {
      console.error('Failed to save workflow:', err);
      showToast(err instanceof Error ? err.message : t('workflow.editor.saveFailed'), 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, rfInstance, workflow, workflowName, saveWorkflow, workflows, workflowId, showToast, nodes, edges, t]);

  const handleRun = useCallback(async () => {
    if (!currentProjectId) return;
    // Save first
    const startNode = nodesRef.current.find((n) => n.type === 'start');
    const trimmedGoal = (startNode?.data?.taskGoal as string || '').trim();
    if (!trimmedGoal) {
      showToast(t('workflow.editor.taskGoalRequired'), 'error');
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
      showToast(err instanceof Error ? err.message : t('workflow.editor.runFailed'), 'error');
    }
  }, [currentProjectId, workflowId, handleSave, runWorkflow, showToast, t]);

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

  const handleUndo = useCallback(() => {
    const { undo } = useFlowStore.getState();
    const result = undo();
    if (result) {
      setNodes(result.nodes);
      setEdges(result.edges);
      showToast(t('workflow.editor.undone'), 'info');
    }
  }, [setNodes, setEdges, showToast]);

  const handleRedo = useCallback(() => {
    const { redo } = useFlowStore.getState();
    const result = redo();
    if (result) {
      setNodes(result.nodes);
      setEdges(result.edges);
      showToast(t('workflow.editor.redone'), 'info');
    }
  }, [setNodes, setEdges, showToast, t]);

  // Bind Keyboard Shortcuts: Save (Ctrl/Cmd + S), Undo (Ctrl/Cmd + Z), Redo (Ctrl/Cmd + Y)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      if (modifier) {
        const key = event.key.toLowerCase();
        if (key === 's') {
          event.preventDefault();
          handleSave('save').catch(() => {});
        } else if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (key === 'y') {
          event.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleSave, handleUndo, handleRedo]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden relative">
      {/* Toast Notification Container */}
      <div className="absolute top-14 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
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
      <WorkflowToolbar
        workflowName={workflowName}
        onWorkflowNameChange={setWorkflowName}
        onBack={onBack}
        onSave={() => handleSave('save')}
        onRun={handleRun}
        onStop={handleStop}
        onHistoryToggle={() => setHistoryDrawerOpen((v) => !v)}
        isSaving={isSaving}
        isRunning={isRunning}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Node Panel */}
        <NodePalette
          onDragStart={onDragStart}
        />

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
            onNodeDragStop={onNodeDragStop}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Execution Panel (right side when running) */}
        {executionId && (
          <ExecutionPanel
            executionId={executionId}
            taskGoal={nodes.find((n) => n.type === 'start')?.data?.taskGoal as string || ''}
            onClose={handleCloseExecution}
          />
        )}

        {/* Execution History Drawer (right side, toggled via toolbar) */}
        {historyDrawerOpen && (
          <ExecutionHistoryDrawer
            workflowId={workflowId}
            onClose={() => setHistoryDrawerOpen(false)}
          />
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

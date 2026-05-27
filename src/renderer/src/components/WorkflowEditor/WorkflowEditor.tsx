import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import { Workflow, WorkflowNode, WorkflowDefinition } from '../../../../shared/types';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';
import { AgentNode } from './AgentNode';
import { NodeConfigDrawer } from './NodeConfigDrawer';
import { ExecutionPanel } from './ExecutionPanel';
import {
  ArrowLeft, Save, Play, Square, GitBranch, Plus, Bot,
} from 'lucide-react';

interface WorkflowEditorProps {
  workflow: Workflow;
  onBack: () => void;
}

const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  end: EndNode,
} satisfies NodeTypes;

const defaultNodes: Node[] = [
  { id: 'start-1', type: 'start', position: { x: 250, y: 50 }, data: { label: '开始' } },
  { id: 'end-1', type: 'end', position: { x: 250, y: 400 }, data: { label: '结束' } },
] as Node[];

export function WorkflowEditor({ workflow, onBack }: WorkflowEditorProps) {
  const { saveWorkflow, runWorkflow, stopWorkflow, currentExecution } = useWorkflowStore();
  const { currentProjectId } = useProjectStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [workflowName, setWorkflowName] = useState(workflow.name || '新建工作流');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null as Node | null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Load existing workflow data
  useEffect(() => {
    if (workflow.id && workflow.graph_data) {
      const def = workflow.graph_data as WorkflowDefinition;
      if (def.nodes?.length) {
        setNodes(def.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { ...n.data },
        })));
      }
      if (def.edges?.length) {
        setEdges(def.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        })));
      }
      setWorkflowName(workflow.name || '新建工作流');
    }
  }, [workflow.id]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: `edge-${connection.source}-${connection.target}` }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'agent') {
      setSelectedNode(node);
      setDrawerOpen(true);
    }
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

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const id = `${type}-${Date.now()}`;
      const newNode: Node = {
        id,
        type,
        position,
        data: {
          label: type === 'start' ? '开始' : type === 'end' ? '结束' : 'Agent 节点',
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [rfInstance, setNodes],
  );

  const handleSave = useCallback(async () => {
    if (!currentProjectId || !rfInstance) return;
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
            agentId: (n.data as Record<string, unknown>).agentId as string | undefined,
            description: (n.data as Record<string, unknown>).description as string | undefined,
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
        })) as WorkflowDefinition['edges'],
        viewport: flow.viewport,
      };

      await saveWorkflow({
        id: workflow.id || undefined,
        project_id: currentProjectId,
        name: workflowName,
        description: workflow.description || '',
        graph_data: graphData,
        status: workflow.status || 'draft',
      });
    } catch (err) {
      console.error('Failed to save workflow:', err);
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, rfInstance, workflow, workflowName, saveWorkflow]);

  const handleRun = useCallback(async () => {
    if (!currentProjectId) return;
    // Save first
    await handleSave();
    try {
      const execId = await runWorkflow(workflow.id, currentProjectId, 'editor');
      setExecutionId(execId);
      setIsRunning(true);
    } catch (err) {
      console.error('Failed to run workflow:', err);
    }
  }, [currentProjectId, workflow.id, handleSave, runWorkflow]);

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
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      {/* Top Toolbar */}
      <div className="main-topbar shrink-0 h-12 border-b border-[var(--color-border)]/50 px-4">
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
            className="btn btn-secondary btn-sm cursor-pointer"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? '保存中...' : '保存'}</span>
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
        <div className="w-[200px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]/50 p-3 flex flex-col gap-2 shrink-0">
          <div className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
            节点面板
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-success)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
            onDragStart={(e) => onDragStart(e, 'start')}
            draggable
          >
            <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            开始节点
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
            onDragStart={(e) => onDragStart(e, 'agent')}
            draggable
          >
            <Bot className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            Agent 节点
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-danger)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
            onDragStart={(e) => onDragStart(e, 'end')}
            draggable
          >
            <div className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />
            结束节点
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRfInstance}
            onNodeClick={onNodeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right" className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-surface)]/80 px-2 py-1 rounded">
              拖拽左侧面板创建节点，连接 handle 创建边
            </Panel>
          </ReactFlow>
        </div>

        {/* Execution Panel (right side when running) */}
        {executionId && (
          <ExecutionPanel executionId={executionId} onClose={handleCloseExecution} />
        )}
      </div>

      {/* Node Config Drawer */}
      <NodeConfigDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        node={selectedNode ? { id: selectedNode.id, data: selectedNode.data as Record<string, unknown> } as any : null}
        onUpdateNode={handleUpdateNode}
      />
    </div>
  );
}

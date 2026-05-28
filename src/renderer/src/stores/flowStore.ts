import { create } from 'zustand';
import type { Node, Edge, Viewport } from '@xyflow/react';
import type { WorkflowNodeRunStatus } from '../../../shared/types';

/**
 * Flow Store — 画布级状态管理
 *
 * 参考 Langflow 的 flowStore 分片模式：
 * - 管理选中状态、视口、画布级 UI 状态
 * - 与 workflowStore（工作流 CRUD + 执行管理）分离
 */

interface FlowState {
  // Selection
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  selectedNode: Node | null;
  selectedEdge: Edge | null;

  // Drawer state
  nodeDrawerOpen: boolean;
  edgeDrawerOpen: boolean;

  // Execution overlay on canvas
  nodeStatuses: Record<string, WorkflowNodeRunStatus>;
  activeEdgeIds: Set<string>;

  // Undo/Redo
  history: Array<{ nodes: Node[]; edges: Edge[] }>;
  historyIndex: number;

  // Actions — Selection
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setSelectedNode: (node: Node | null) => void;
  setSelectedEdge: (edge: Edge | null) => void;
  clearSelection: () => void;

  // Actions — Drawer
  setNodeDrawerOpen: (open: boolean) => void;
  setEdgeDrawerOpen: (open: boolean) => void;

  // Actions — Execution status
  setNodeStatus: (nodeId: string, status: WorkflowNodeRunStatus) => void;
  setAllNodeStatuses: (statuses: Record<string, WorkflowNodeRunStatus>) => void;
  clearNodeStatuses: () => void;
  setActiveEdgeIds: (ids: string[]) => void;

  // Actions — Undo/Redo
  pushHistory: (nodes: Node[], edges: Edge[]) => void;
  undo: () => { nodes: Node[]; edges: Edge[] } | null;
  redo: () => { nodes: Node[]; edges: Edge[] } | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

function safeClone<T>(obj: T): T {
  try {
    return JSON.parse(
      JSON.stringify(obj, (_, value) => {
        if (
          typeof value === 'function' ||
          typeof value === 'symbol' ||
          (typeof Element !== 'undefined' && value instanceof Element)
        ) {
          return undefined;
        }
        return value;
      })
    );
  } catch (e) {
    console.error('Failed to clone object safely:', e);
    if (Array.isArray(obj)) {
      return [...obj] as any;
    }
    return { ...obj };
  }
}

export const useFlowStore = create<FlowState>((set, get) => ({
  // Selection
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedNode: null,
  selectedEdge: null,

  // Drawer
  nodeDrawerOpen: false,
  edgeDrawerOpen: false,

  // Execution
  nodeStatuses: {},
  activeEdgeIds: new Set<string>(),

  // Undo/Redo
  history: [],
  historyIndex: -1,

  // Selection actions
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),
  setSelectedNode: (node) => set({ selectedNode: node }),
  setSelectedEdge: (edge) => set({ selectedEdge: edge }),
  clearSelection: () => set({
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedNode: null,
    selectedEdge: null,
    nodeDrawerOpen: false,
    edgeDrawerOpen: false,
  }),

  // Drawer actions
  setNodeDrawerOpen: (open) => set({ nodeDrawerOpen: open }),
  setEdgeDrawerOpen: (open) => set({ edgeDrawerOpen: open }),

  // Execution status actions
  setNodeStatus: (nodeId, status) => set((state) => ({
    nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
  })),
  setAllNodeStatuses: (statuses) => set({ nodeStatuses: statuses }),
  clearNodeStatuses: () => set({ nodeStatuses: {}, activeEdgeIds: new Set() }),
  setActiveEdgeIds: (ids) => set({ activeEdgeIds: new Set(ids) }),

  // Undo/Redo actions
  pushHistory: (nodes, edges) => set((state) => {
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ nodes: safeClone(nodes), edges: safeClone(edges) });
    // Limit history to 50 entries
    if (newHistory.length > 50) newHistory.shift();
    return { history: newHistory, historyIndex: newHistory.length - 1 };
  }),
  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return null;
    const newIndex = state.historyIndex - 1;
    set({ historyIndex: newIndex });
    return state.history[newIndex];
  },
  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return null;
    const newIndex = state.historyIndex + 1;
    set({ historyIndex: newIndex });
    return state.history[newIndex];
  },
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
  clearHistory: () => set({ history: [], historyIndex: -1 }),
}));

import type { WorkflowNodeType, WorkflowNodeCategory, WorkflowNodeConfig } from '../../../../shared/types';

/**
 * Node Type Registry — 统一节点类型配置
 *
 * 参考 Flowise 的 INode 接口和 Dify 的节点分类体系。
 * 每种节点类型定义：分类、输入端口、输出端口、图标、颜色。
 */

export const NODE_TYPE_CONFIGS: Record<WorkflowNodeType, WorkflowNodeConfig> = {
  start: {
    category: 'flow',
    inputs: [],
    outputs: [{ id: 'out', label: '输出', type: 'any' }],
    icon: 'Play',
    color: '#22c55e',
  },
  end: {
    category: 'flow',
    inputs: [{ id: 'in', label: '输入', type: 'any' }],
    outputs: [],
    icon: 'Square',
    color: '#ef4444',
  },
  task: {
    category: 'agent',
    inputs: [
      { id: 'context', label: '上下文', type: 'string' },
      { id: 'task', label: '任务描述', type: 'string' },
    ],
    outputs: [
      { id: 'result', label: '执行结果', type: 'string' },
      { id: 'routing', label: '路由决策', type: 'object' },
    ],
    icon: 'ListTodo',
    color: '#7c3aed',
  },
  loop: {
    category: 'agent',
    inputs: [
      { id: 'context', label: '上下文', type: 'string' },
      { id: 'task', label: '任务描述', type: 'string' },
    ],
    outputs: [
      { id: 'result', label: '最终结果', type: 'string' },
      { id: 'iterations', label: '迭代次数', type: 'number' },
    ],
    icon: 'Repeat2',
    color: '#0ea5e9',
  },
  review: {
    category: 'agent',
    inputs: [
      { id: 'content', label: '审查内容', type: 'string' },
    ],
    outputs: [
      { id: 'result', label: '审查结果', type: 'string' },
      { id: 'score', label: '评分', type: 'number' },
      { id: 'routing', label: '路由决策', type: 'object' },
    ],
    icon: 'ShieldCheck',
    color: '#f59e0b',
  },
  agent: {
    category: 'agent',
    inputs: [
      { id: 'context', label: '上下文', type: 'string' },
    ],
    outputs: [
      { id: 'result', label: '执行结果', type: 'string' },
    ],
    icon: 'Bot',
    color: '#7c3aed',
  },
  foreach: {
    category: 'agent',
    inputs: [
      { id: 'context', label: '上下文', type: 'string' },
      { id: 'task', label: '任务描述', type: 'string' },
    ],
    outputs: [
      { id: 'result', label: '执行结果', type: 'string' },
    ],
    icon: 'Layers',
    color: '#22c55e',
  },
};

/** Get node category for palette grouping */
export function getNodeCategory(type: WorkflowNodeType): WorkflowNodeCategory {
  return NODE_TYPE_CONFIGS[type]?.category ?? 'flow';
}

/** Get all node types in a category */
export function getNodeTypesByCategory(category: WorkflowNodeCategory): WorkflowNodeType[] {
  return (Object.entries(NODE_TYPE_CONFIGS) as [WorkflowNodeType, WorkflowNodeConfig][])
    .filter(([, config]) => config.category === category)
    .map(([type]) => type);
}

/** Check if a node type is executable (runs Agent logic) */
export function isExecutableNodeType(type?: string | null): boolean {
  return type === 'agent' || type === 'task' || type === 'loop' || type === 'review' || type === 'foreach';
}

/** Category display names */
export const CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  flow: '流程控制',
  agent: 'Agent 节点',
};

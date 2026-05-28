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
  tool_mcp: {
    category: 'tool',
    inputs: [
      { id: 'params', label: '参数', type: 'object' },
    ],
    outputs: [
      { id: 'result', label: '工具返回', type: 'any' },
    ],
    icon: 'Wrench',
    color: '#06b6d4',
  },
  tool_http: {
    category: 'tool',
    inputs: [
      { id: 'url', label: 'URL', type: 'string' },
      { id: 'headers', label: '请求头', type: 'object' },
      { id: 'body', label: '请求体', type: 'any' },
    ],
    outputs: [
      { id: 'response', label: '响应', type: 'any' },
      { id: 'status', label: '状态码', type: 'number' },
    ],
    icon: 'Globe',
    color: '#8b5cf6',
  },
  variable: {
    category: 'data',
    inputs: [
      { id: 'value', label: '值', type: 'any' },
    ],
    outputs: [
      { id: 'value', label: '变量值', type: 'any' },
    ],
    icon: 'Variable',
    color: '#10b981',
  },
  transform: {
    category: 'data',
    inputs: [
      { id: 'input', label: '输入数据', type: 'any' },
    ],
    outputs: [
      { id: 'output', label: '转换结果', type: 'any' },
    ],
    icon: 'Shuffle',
    color: '#f97316',
  },
  condition: {
    category: 'logic',
    inputs: [
      { id: 'value', label: '判断值', type: 'any' },
    ],
    outputs: [
      { id: 'true', label: 'True', type: 'any' },
      { id: 'false', label: 'False', type: 'any' },
    ],
    icon: 'GitBranch',
    color: '#ec4899',
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
  return type === 'agent' || type === 'task' || type === 'loop' || type === 'review'
    || type === 'tool_mcp' || type === 'tool_http' || type === 'transform';
}

/** Category display names */
export const CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  flow: '流程控制',
  agent: 'Agent 节点',
  tool: '工具节点',
  data: '数据处理',
  logic: '逻辑判断',
};

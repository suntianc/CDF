import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Wrench, Globe } from 'lucide-react';
import type { WorkflowNodeRunStatus } from '../../../../shared/types';

interface ToolNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  toolType?: 'mcp' | 'http';
  toolId?: string;
  httpMethod?: string;
  httpUrl?: string;
  status?: WorkflowNodeRunStatus;
}

type ToolFlowNode = Node<ToolNodeData, 'tool_mcp' | 'tool_http'>;

const statusStyles: Record<string, { border: string; glow: string; dot: string }> = {
  pending: { border: 'var(--border)', glow: 'none', dot: 'bg-[var(--color-text-muted)]' },
  running: { border: '#06b6d4', glow: '0 0 12px rgba(6, 182, 212, 0.3)', dot: 'bg-[#06b6d4] animate-pulse' },
  completed: { border: 'var(--color-success)', glow: 'none', dot: 'bg-[var(--color-success)]' },
  failed: { border: 'var(--color-danger)', glow: 'none', dot: 'bg-[var(--color-danger)]' },
  skipped: { border: 'var(--color-warning)', glow: 'none', dot: 'bg-[var(--color-warning)]' },
};

export const ToolNode = memo(function ToolNode({ data, selected }: NodeProps<ToolFlowNode>) {
  const status = data.status || 'pending';
  const style = statusStyles[status] || statusStyles.pending;
  const isHttp = data.toolType === 'http' || data.httpUrl;

  return (
    <div
      className="rounded-lg border-2 bg-[var(--color-bg-surface)] min-w-[160px] max-w-[220px] shadow-md transition-all"
      style={{
        borderColor: selected ? 'var(--color-accent)' : style.border,
        boxShadow: selected ? '0 0 0 2px var(--color-accent-dim)' : style.glow,
      }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="px-3 py-2 border-b border-[var(--color-border)]/30 flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-[#06b6d4]/10">
          {isHttp ? <Globe className="w-3.5 h-3.5 text-[#8b5cf6]" /> : <Wrench className="w-3.5 h-3.5 text-[#06b6d4]" />}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {data.label || (isHttp ? 'HTTP 请求' : 'MCP 工具')}
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      </div>

      {data.description && (
        <div className="px-3 pb-2 text-[11px] text-[var(--color-text-secondary)] line-clamp-2">
          {data.description}
        </div>
      )}

      {isHttp && data.httpMethod && (
        <div className="px-3 pb-2 text-[10px] text-[var(--color-text-muted)]">
          <span className="font-mono bg-[var(--color-bg-active)] px-1 rounded">{data.httpMethod}</span>
          <span className="ml-1 truncate">{data.httpUrl}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});

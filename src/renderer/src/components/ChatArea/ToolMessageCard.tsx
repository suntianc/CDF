import { useState } from 'react';
import { 
  Terminal, FileCode, Wrench, ChevronDown, ChevronUp, Check, X, Loader2 
} from 'lucide-react';

interface ToolInfo {
  type: 'tool';
  name: string;
  status: 'running' | 'success' | 'error';
  input?: any;
  output?: any;
  error?: string;
}

export function ToolMessageCard({ toolInfo, createdAt }: { toolInfo: ToolInfo; createdAt: number }) {
  const [expanded, setExpanded] = useState(false);
  const { name, status, input, output, error } = toolInfo;

  // Match icon based on tool name
  const getToolIcon = () => {
    const n = name.toLowerCase();
    if (n.includes('file') || n.includes('content') || n.includes('write') || n.includes('read')) {
      return <FileCode className="w-3.5 h-3.5" />;
    }
    if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('ls') || n.includes('command')) {
      return <Terminal className="w-3.5 h-3.5" />;
    }
    return <Wrench className="w-3.5 h-3.5" />;
  };

  // Format arguments & outputs
  const formatData = (data: any) => {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  };

  // Get styles & labels based on status
  const getStatusDetails = () => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader2 className="w-3 h-3 animate-spin text-[var(--color-accent)]" />,
          bgColor: 'bg-[var(--color-bg-subtle)]/30 border-[var(--color-border)]/40',
          textColor: 'text-[var(--color-text-secondary)]',
          label: `正在调用 ${name}...`,
        };
      case 'success':
        return {
          icon: <Check className="w-3 h-3 text-[var(--color-success)]" />,
          bgColor: 'bg-[var(--color-bg-subtle)]/20 border-[var(--color-border)]/25',
          textColor: 'text-[var(--color-text-primary)]',
          label: `已调用 ${name}`,
        };
      case 'error':
        return {
          icon: <X className="w-3 h-3 text-[var(--color-danger)]" />,
          bgColor: 'bg-[var(--color-danger-dim)]/5 border-[var(--color-danger)]/15',
          textColor: 'text-[var(--color-danger)]',
          label: `调用 ${name} 失败`,
        };
    }
  };

  const details = getStatusDetails();
  const timeString = new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-1 select-none">
      <div className={`flex flex-col border rounded-lg overflow-hidden shadow-sm transition-all duration-200 ${details.bgColor}`}>
        {/* Header */}
        <div 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none hover:bg-[var(--color-bg-hover)]/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            {/* Tool Category Icon */}
            <div className="flex items-center justify-center w-5.5 h-5.5 rounded-md bg-[var(--color-bg-active)] text-[var(--color-text-secondary)] border border-[var(--color-border)]/30 shadow-sm animate-pop-in">
              {getToolIcon()}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className={`text-[11px] font-semibold tracking-wide ${details.textColor}`}>
                {details.label}
              </span>
              <span className="text-[9px] text-[var(--color-text-muted)]">
                {timeString}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2.5">
            {/* Status Indicator */}
            <div className="flex items-center justify-center w-4.5 h-4.5 rounded-full bg-[var(--color-bg-active)] border border-[var(--color-border)]/30">
              {details.icon}
            </div>
            
            {/* Expand / Collapse Chevron */}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            )}
          </div>
        </div>

        {/* Collapsible Details */}
        {expanded && (
          <div className="px-3 pb-3 border-t border-[var(--color-border)]/20 bg-black/5 dark:bg-white/5 flex flex-col gap-2 pt-2.5 animate-slide-down">
            {input && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">输入参数 (Input)</span>
                <pre className="p-2 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/35 rounded-md text-xs font-mono text-[var(--color-text-primary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                  <code>{formatData(input)}</code>
                </pre>
              </div>
            )}
            
            {output && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">执行结果 (Output)</span>
                <pre className="p-2 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/35 rounded-md text-xs font-mono text-[var(--color-text-primary)] overflow-x-auto select-text max-h-60 overflow-y-auto leading-relaxed">
                  <code>{formatData(output)}</code>
                </pre>
              </div>
            )}

            {error && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-[var(--color-danger)] uppercase tracking-wider">错误信息 (Error)</span>
                <pre className="p-2 bg-[var(--color-danger-dim)]/20 border border-[var(--color-danger)]/25 rounded-md text-xs font-mono text-[var(--color-danger)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                  <code>{formatData(error)}</code>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

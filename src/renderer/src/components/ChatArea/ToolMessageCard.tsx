import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Terminal, FileCode, Wrench, Search, Loader2
} from 'lucide-react';

interface ToolInfo {
  type: 'tool';
  name: string;
  status: 'running' | 'success' | 'error';
  input?: any;
  output?: any;
  error?: string;
}

// Translate tool action parameters to readable text
export const translateToolAction = (toolName: string, toolInput: any, t: TFunction): string => {
  if (!toolInput) return t('toolMessage.callTool', { name: toolName });
  try {
    const args = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    switch (toolName) {
      case 'view_file': {
        const pathVal = args.AbsolutePath || args.TargetFile || '';
        const filename = pathVal.split('/').pop() || pathVal;
        return t('toolMessage.readFile', { filename });
      }
      case 'write_to_file': {
        const pathVal = args.TargetFile || '';
        const filename = pathVal.split('/').pop() || pathVal;
        return t('toolMessage.writeFile', { filename });
      }
      case 'replace_file_content':
      case 'multi_replace_file_content': {
        const pathVal = args.TargetFile || '';
        const filename = pathVal.split('/').pop() || pathVal;
        return t('toolMessage.editFile', { filename });
      }
      case 'grep_search': {
        const query = args.Query || '';
        return t('toolMessage.searchFor', { query });
      }
      case 'run_command': {
        const cmd = args.CommandLine || '';
        return cmd.length > 50 ? t('toolMessage.runCommandTruncated', { cmd: cmd.slice(0, 50) }) : t('toolMessage.runCommand', { cmd });
      }
      default: {
        return t('toolMessage.callTool', { name: toolName });
      }
    }
  } catch (e) {
    // JSON parse error fallback
  }
  return t('toolMessage.callTool', { name: toolName });
};

// Translate multi-tools group action description
export const translateToolGroup = (tools: any[], t: TFunction): string => {
  const count = tools.length;
  let viewCount = 0;
  let editCount = 0;
  let cmdCount = 0;

  tools.forEach(msg => {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed && parsed.type === 'tool') {
        const name = parsed.name;
        if (name === 'view_file' || name === 'grep_search') viewCount++;
        else if (name === 'write_to_file' || name === 'replace_file_content' || name === 'multi_replace_file_content') editCount++;
        else if (name === 'run_command') cmdCount++;
      }
    } catch (e) {}
  });

  if (editCount > 0) {
    return t('toolMessage.modifiedFiles', { count: editCount });
  }
  if (viewCount > 0) {
    return t('toolMessage.exploredFiles', { count: viewCount });
  }
  if (cmdCount > 0) {
    return t('toolMessage.ranCommands', { count: cmdCount });
  }
  return t('toolMessage.executedSteps', { count });
};

// Single tool message item component
export function ToolMessageCard({
  toolInfo,
  createdAt,
  isSubRow = false
}: {
  toolInfo: ToolInfo;
  createdAt: number;
  isSubRow?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { name, status, input, output, error } = toolInfo;

  // Match icon based on tool name
  const getToolIcon = () => {
    const n = name.toLowerCase();
    if (n.includes('file') || n.includes('content') || n.includes('write') || n.includes('read')) {
      return <FileCode className="w-3 h-3 text-[var(--color-text-muted)]" />;
    }
    if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('ls') || n.includes('command')) {
      return <Search className="w-3 h-3 text-[var(--color-text-muted)]" />;
    }
    return <Wrench className="w-3 h-3 text-[var(--color-text-muted)]" />;
  };

  const formatData = (data: any) => {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  };

  const actionText = translateToolAction(name, input, t);

  const cardContent = (
    <div className="flex flex-col">
      {/* Header Trigger */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 cursor-pointer select-none text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors py-0.5 w-fit"
      >
        {/* Status/Category Icon */}
        <span className="flex items-center justify-center shrink-0">
          {status === 'running' ? (
            <Loader2 className="w-3 h-3 animate-spin text-[var(--color-accent)]" />
          ) : (
            <span className="opacity-70">{getToolIcon()}</span>
          )}
        </span>

        {/* Action Description */}
        <span className={`font-medium ${status === 'error' ? 'text-[var(--color-danger)]' : ''}`}>
          {actionText}
        </span>

        {/* Micro Status Label */}
        {status === 'success' && <span className="text-[var(--color-success)] text-[8px] font-bold">✔</span>}
        {status === 'error' && <span className="text-[var(--color-danger)] text-[8px] font-bold">❌</span>}

        {/* Expand/Collapse Chevron Indicator */}
        {(input || output || error) && (
          <span className="text-[8px] opacity-40 font-mono ml-0.5">
            {expanded ? '▼' : '▶'}
          </span>
        )}
      </div>

      {/* Collapsible Details */}
      {expanded && (
        <div className="mt-1 pl-4 pb-2 flex flex-col gap-1.5 border-l border-[var(--color-border)]/15 ml-1.5 animate-slide-down">
          {input && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[8.5px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Input</span>
              <pre className="p-1.5 bg-[var(--color-bg-sidebar)]/50 border border-[var(--color-border)]/20 rounded text-[10.5px] font-mono text-[var(--color-text-secondary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                <code>{formatData(input)}</code>
              </pre>
            </div>
          )}
          
          {output && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[8.5px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Output</span>
              <pre className="p-1.5 bg-[var(--color-bg-sidebar)]/50 border border-[var(--color-border)]/20 rounded text-[10.5px] font-mono text-[var(--color-text-secondary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                <code>{formatData(output)}</code>
              </pre>
            </div>
          )}

          {error && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[8.5px] font-bold text-[var(--color-danger)] uppercase tracking-wider">Error</span>
              <pre className="p-1.5 bg-[var(--color-danger-dim)]/10 border border-[var(--color-danger)]/20 rounded text-[10.5px] font-mono text-[var(--color-danger)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                <code>{formatData(error)}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isSubRow) {
    return cardContent;
  }

  return (
    <div className="w-full py-0.5 select-none">
      {cardContent}
    </div>
  );
}

// Collapsible aggregation card for consecutive tool invocations
export function ToolGroupCard({ tools }: { tools: any[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Parse list of consecutive tools in group
  const parsedTools = useMemo(() => {
    return tools.map(msg => {
      try {
        return {
          id: msg.id,
          createdAt: msg.created_at,
          info: JSON.parse(msg.content) as ToolInfo
        };
      } catch (e) {
        return {
          id: msg.id,
          createdAt: msg.created_at,
          info: { type: 'tool', name: 'unknown', status: 'error', error: t('toolMessage.parseError') } as ToolInfo
        };
      }
    });
  }, [tools]);

  // Overall status of the tools in the group
  const groupStatus = useMemo(() => {
    if (parsedTools.some(t => t.info.status === 'running')) return 'running';
    if (parsedTools.some(t => t.info.status === 'error')) return 'error';
    return 'success';
  }, [parsedTools]);

  const groupLabel = useMemo(() => {
    if (groupStatus === 'running') {
      const runningIdx = parsedTools.findIndex(t => t.info.status === 'running');
      const currentName = parsedTools[runningIdx]?.info.name || t('toolMessage.toolFallback');
      return t('toolMessage.executingTool', { name: currentName, current: runningIdx + 1, total: parsedTools.length });
    }
    return translateToolGroup(tools, t);
  }, [groupStatus, parsedTools, tools, t]);

  const getGroupIcon = () => {
    if (groupStatus === 'running') {
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />;
    }
    // Match icon based on tool names (locale-independent)
    const toolNames = parsedTools.map(t => t.info.name);
    const hasEdit = toolNames.some(n => n === 'write_to_file' || n === 'replace_file_content' || n === 'multi_replace_file_content');
    const hasView = toolNames.some(n => n === 'view_file' || n === 'grep_search');
    if (hasEdit) {
      return <FileCode className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
    }
    if (hasView) {
      return <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
    }
    return <Terminal className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
  };

  return (
    <div className="w-full py-0.5 select-none">
      <div className="flex flex-col">
        {/* Group Title Bar */}
        <div 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors py-1 w-fit"
        >
          <span className="flex items-center justify-center shrink-0 animate-pop-in">
            {getGroupIcon()}
          </span>

          <span className={`font-semibold tracking-wide ${groupStatus === 'error' ? 'text-[var(--color-danger)]/90' : ''}`}>
            {groupLabel}
          </span>

          {groupStatus === 'success' && <span className="text-[var(--color-success)] text-[9px] font-bold">✔</span>}
          {groupStatus === 'error' && <span className="text-[var(--color-danger)] text-[9px] font-bold">❌</span>}

          <span className="text-[9px] opacity-40 font-mono ml-0.5">
            {expanded ? '▼' : '▶'}
          </span>
        </div>

        {/* Collapsed List showing child tool rows */}
        {expanded && (
          <div className="mt-1 pl-4 pb-1.5 flex flex-col gap-2 border-l border-[var(--color-border)]/25 ml-1.5 animate-slide-down">
            {parsedTools.map(t => (
              <div key={t.id} className="py-0.5">
                <ToolMessageCard 
                  toolInfo={t.info} 
                  createdAt={t.createdAt} 
                  isSubRow={true} 
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

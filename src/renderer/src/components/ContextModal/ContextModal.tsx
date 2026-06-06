import { useEffect, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  ChevronDown,
  Server,
  Wrench,
  FileText,
  GitBranch,
  Terminal,
  AlertCircle,
  Cpu,
  Database,
  Sparkles,
  MessageSquare,
  RefreshCw,
  Activity
} from 'lucide-react';
import { useContextModalStore } from '@/stores/contextModalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useLLMStore } from '@/stores/llmStore';
import { cn } from '@/lib/utils';

interface MCPToolDetail {
  tool: string;
  server: string;
  tokens: number;
}
interface SkillDetail {
  name: string;
  scope: 'global' | 'project';
  tokens: number;
}
interface WorkflowDetail {
  id: string;
  name: string;
  tokens: number;
}
interface SystemToolDetail {
  name: string;
  tokens: number;
}
interface ProjectCommandDetail {
  name: string;
  tokens: number;
}

interface ContextBreakdown {
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
  systemPrompt: number;
  systemTools: number;
  customAgents: number;
  memoryFiles: number;
  messages: number;
  projectCommandBodies: number;
  freeSpace: number;
  autocompactBuffer: number;
  mcpPerTool: MCPToolDetail[];
  skillsPerSkill: SkillDetail[];
  workflowsPerWorkflow: WorkflowDetail[];
  systemToolsPerTool: SystemToolDetail[];
  projectCommandsPerFile: ProjectCommandDetail[];
}

interface ContextAggregate {
  breakdown: ContextBreakdown;
  total: number;
  modelName: string;
  contextLimit: number;
  used: number;
  usedPct: number;
  freePct: number;
  mcpPerTool: MCPToolDetail[];
}

const categoryConfigs: Record<string, { icon: ReactNode; colorClass: string; borderClass: string; iconBg: string; iconColor: string }> = {
  'System prompt': {
    icon: <Cpu className="size-3.5" />,
    colorClass: 'bg-sky-500 dark:bg-sky-400',
    borderClass: 'hover:border-sky-500/30',
    iconBg: 'bg-sky-500/10',
    iconColor: 'text-sky-600 dark:text-sky-400'
  },
  'System tools': {
    icon: <Wrench className="size-3.5" />,
    colorClass: 'bg-indigo-500 dark:bg-indigo-400',
    borderClass: 'hover:border-indigo-500/30',
    iconBg: 'bg-indigo-500/10',
    iconColor: 'text-indigo-600 dark:text-indigo-400'
  },
  'MCP tools': {
    icon: <Server className="size-3.5" />,
    colorClass: 'bg-blue-500 dark:bg-blue-400',
    borderClass: 'hover:border-blue-500/30',
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400'
  },
  'Workflows': {
    icon: <GitBranch className="size-3.5" />,
    colorClass: 'bg-purple-500 dark:bg-purple-400',
    borderClass: 'hover:border-purple-500/30',
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-600 dark:text-purple-400'
  },
  'Custom agents': {
    icon: <Sparkles className="size-3.5" />,
    colorClass: 'bg-pink-500 dark:bg-pink-400',
    borderClass: 'hover:border-pink-500/30',
    iconBg: 'bg-pink-500/10',
    iconColor: 'text-pink-600 dark:text-pink-400'
  },
  'Memory files': {
    icon: <Database className="size-3.5" />,
    colorClass: 'bg-amber-500 dark:bg-amber-400',
    borderClass: 'hover:border-amber-500/30',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400'
  },
  'Skills': {
    icon: <FileText className="size-3.5" />,
    colorClass: 'bg-violet-500 dark:bg-violet-400',
    borderClass: 'hover:border-violet-500/30',
    iconBg: 'bg-violet-500/10',
    iconColor: 'text-violet-600 dark:text-violet-400'
  },
  'Messages': {
    icon: <MessageSquare className="size-3.5" />,
    colorClass: 'bg-rose-500 dark:bg-rose-400',
    borderClass: 'hover:border-rose-500/30',
    iconBg: 'bg-rose-500/10',
    iconColor: 'text-rose-600 dark:text-rose-400'
  },
  'Project command bodies': {
    icon: <Terminal className="size-3.5" />,
    colorClass: 'bg-teal-500 dark:bg-teal-400',
    borderClass: 'hover:border-teal-500/30',
    iconBg: 'bg-teal-500/10',
    iconColor: 'text-teal-600 dark:text-teal-400'
  },
  'Free space': {
    icon: <Activity className="size-3.5" />,
    colorClass: 'bg-emerald-500 dark:bg-emerald-400',
    borderClass: 'hover:border-emerald-500/30',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400'
  },
  'Autocompact buffer': {
    icon: <RefreshCw className="size-3.5" />,
    colorClass: 'bg-orange-500 dark:bg-orange-400',
    borderClass: 'hover:border-orange-500/30',
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-600 dark:text-orange-400'
  }
};

export function ContextModal() {
  const isOpen = useContextModalStore((s: ReturnType<typeof useContextModalStore.getState>) => s.isOpen);
  const close = useContextModalStore((s: ReturnType<typeof useContextModalStore.getState>) => s.close);
  const [data, setData] = useState<ContextAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) {
      setData(null);
      setError(null);
      setLoading(false);
      setExpanded({});
      return;
    }

    const activeSessionId = useSessionStore.getState().activeSessionId;
    if (!activeSessionId) {
      setError('当前没有活跃 session，无法读取 context 占用。');
      return;
    }

    setLoading(true);
    setError(null);

    const active = useLLMStore.getState().activeProvider;
    const limit = active?.context_limit;

    let cancelled = false;
    window.electronAPI.context
      .currentSession(activeSessionId, limit)
      .then((payload: ContextAggregate) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const progressBarColor = (() => {
    if (!data) return 'bg-[var(--color-bg-active)]';
    if (data.usedPct >= 85) return 'bg-[var(--color-danger)]';
    if (data.usedPct >= 70) return 'bg-[var(--color-warning)]';
    return 'bg-[var(--color-accent)]';
  })();

  const renderRow = (label: string, value: number, contextLimit: number) => {
    const config = categoryConfigs[label] || {
      icon: <Cpu className="size-3.5" />,
      colorClass: 'bg-[var(--color-accent)]',
      borderClass: 'hover:border-[var(--color-accent)]/30',
      iconBg: 'bg-[var(--color-accent-dim)]',
      iconColor: 'text-[var(--color-accent)]'
    };
    const pct = contextLimit > 0 ? (value * 100) / contextLimit : 0;
    return (
      <div
        key={label}
        className={cn(
          "group py-2 px-3 hover:bg-[var(--color-bg-hover)]/15 rounded-xl transition-all duration-200 flex flex-col gap-2 border border-[var(--color-border)]/20 hover:shadow-sm hover:scale-[1.01] active:scale-[0.99]",
          config.borderClass
        )}
        data-testid={`context-row-${label}`}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn("p-1.5 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105", config.iconBg, config.iconColor)}>
              {config.icon}
            </div>
            <span className="text-[var(--color-text-secondary)] font-medium group-hover:text-[var(--color-text-primary)] transition-colors truncate">
              {label}
            </span>
          </div>
          <span className="font-mono text-[var(--color-text-primary)] font-medium shrink-0 ml-1">
            {(value / 1000).toFixed(1)}k <span className="text-[var(--color-text-muted)] text-[10px] font-normal">({pct.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[var(--color-bg-active)]/30 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500 ease-out', config.colorClass)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  const renderDetailSection = (
    sectionKey: string,
    label: string,
    icon: ReactNode,
    rows: Array<{ key: string; name: string; meta?: string; tokens: number }>,
    contextLimit: number
  ) => {
    if (rows.length === 0) return null;
    const isOpen = !!expanded[sectionKey];
    return (
      <div
        key={sectionKey}
        className="border border-[var(--color-border)]/30 rounded-xl overflow-hidden shadow-sm bg-[var(--color-bg-sidebar)]/5 hover:border-[var(--color-border)]/50 transition-colors"
        data-testid={`context-modal-detail-${sectionKey}`}
      >
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]/15 transition-all duration-200"
          onClick={() => setExpanded((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
          data-testid={`context-modal-detail-toggle-${sectionKey}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent)]">
              {icon}
            </div>
            <span className="font-semibold text-[var(--color-text-primary)]">{label} 明细</span>
            <Badge variant="secondary" className="font-mono font-semibold text-[10px] px-2 py-0.5 rounded-md bg-[var(--color-bg-active)]/60 text-[var(--color-text-primary)] border-none">
              {rows.length}
            </Badge>
          </div>
          <ChevronDown className={cn("size-4 text-[var(--color-text-muted)] transition-transform duration-300 ease-in-out", isOpen && "rotate-180")} />
        </button>
        {isOpen && (
          <div className="border-t border-[var(--color-border)]/30 divide-y divide-[var(--color-border)]/15 bg-[var(--color-bg-app)]/30 px-4 py-2 max-h-[200px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200 ease-out">
            {rows.map((r, i) => {
              const pct = contextLimit > 0 ? (r.tokens * 100) / contextLimit : 0;
              return (
                <div
                  key={`${sectionKey}-${r.key}-${i}`}
                  className="flex items-center justify-between text-xs py-2.5 first:pt-1.5 last:pb-1.5 hover:bg-[var(--color-bg-hover)]/5 px-2 rounded-lg transition-colors duration-150"
                  data-testid={`context-modal-detail-row-${sectionKey}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[var(--color-text-primary)] truncate font-medium">
                      {r.name}
                    </span>
                    {r.meta && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 rounded border-[var(--color-accent)]/20 text-[var(--color-accent)] font-medium bg-[var(--color-accent-dim)]/20">
                        {r.meta}
                      </Badge>
                    )}
                  </span>
                  <span className="font-mono text-[var(--color-text-secondary)] ml-2 flex-shrink-0">
                    {(r.tokens / 1000).toFixed(1)}k <span className="text-[var(--color-text-muted)] text-[10px] font-normal">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open: boolean) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-testid="context-modal"
        className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden gap-0 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
      >
        <style>{`
          /* Hide scrollbar for Webkit browsers */
          [data-testid="context-modal"] ::-webkit-scrollbar,
          [data-testid="context-modal"]::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
            background: transparent !important;
          }
          /* Hide scrollbar for IE, Edge and Firefox */
          [data-testid="context-modal"],
          [data-testid="context-modal"] * {
            -ms-overflow-style: none !important;
            scrollbar-width: none !important;
          }
        `}</style>

        <DialogHeader className="border-b border-[var(--color-border)]/40 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
            <div className="p-2 rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-accent)] shadow-sm">
              <BarChart3 className="size-5" />
            </div>
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--color-text-primary)]">Context 资源占用监控</span>
                <span className={cn("w-2 h-2 rounded-full animate-pulse shrink-0", progressBarColor)} />
              </div>
              <span className="text-[11px] text-[var(--color-text-muted)] font-normal">实时分析与统计当前会话的 Token 消耗情况</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div
            className="text-sm text-[var(--color-danger)] py-3 px-3 rounded-md bg-[var(--color-danger)]/10 my-4 shrink-0 animate-in fade-in slide-in-from-top-2 duration-300"
            data-testid="context-modal-error"
          >
            Context 数据加载失败。{error}. 关闭后重试或检查 IPC 通道 commands:readBody 健康。
          </div>
        )}

        {loading && !data && (
          <div data-testid="context-modal-loading" className="space-y-2 py-4 flex-1 overflow-y-auto animate-in fade-in duration-300">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {data && (() => {
          const segments = [
            { label: '系统提示词', value: data.breakdown.systemPrompt, color: 'bg-gradient-to-r from-sky-500 to-cyan-400', dotColor: 'bg-sky-500' },
            { label: '内置与 MCP 工具', value: data.breakdown.systemTools + data.breakdown.mcp, color: 'bg-gradient-to-r from-indigo-500 to-violet-500', dotColor: 'bg-indigo-500' },
            { label: '技能与工作流', value: data.breakdown.skills + data.breakdown.workflows + data.breakdown.projectCommandBodies, color: 'bg-gradient-to-r from-purple-500 to-fuchsia-500', dotColor: 'bg-purple-500' },
            { label: '会话消息', value: data.breakdown.messages, color: 'bg-gradient-to-r from-pink-500 to-rose-500', dotColor: 'bg-pink-500' },
            { label: '内存与缓存', value: data.breakdown.memoryFiles + data.breakdown.customAgents, color: 'bg-gradient-to-r from-amber-500 to-orange-400', dotColor: 'bg-amber-500' },
          ];
          return (
            <div data-testid="context-modal-body" className="space-y-5 pt-4 flex-1 overflow-y-auto pr-1 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
              {/* Stats Hero Cards */}
              <div className="grid grid-cols-3 gap-3">
                {/* Used Context Card */}
                <div className="relative overflow-hidden bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-[var(--color-accent)]/30 transition-all duration-300 group hover:shadow-[0_8px_24px_rgba(124,58,237,0.12)] hover:-translate-y-1">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 group-hover:opacity-25 transition-all duration-300 text-[var(--color-accent)]">
                    <BarChart3 className="size-12" />
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider block">已使用 Context</span>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{(data.used / 1000).toFixed(1)}k</span>
                      <span className="text-xs text-[var(--color-text-muted)]">/ {(data.contextLimit / 1000).toFixed(0)}k</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]/15 pt-2">
                    <span>使用占比</span>
                    <span className="font-bold font-mono text-[var(--color-accent)] text-xs">{data.usedPct}%</span>
                  </div>
                </div>

                {/* Free Space Card */}
                <div className="relative overflow-hidden bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-[var(--color-success)]/30 transition-all duration-300 group hover:shadow-[0_8px_24px_rgba(34,197,94,0.12)] hover:-translate-y-1">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 group-hover:opacity-25 transition-all duration-300 text-[var(--color-success)]">
                    <Activity className="size-12" />
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider block">剩余可用</span>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{(data.breakdown.freeSpace / 1000).toFixed(1)}k</span>
                      <span className="text-xs text-[var(--color-text-muted)] font-mono">tokens</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]/15 pt-2">
                    <span>剩余占比</span>
                    <span className="font-bold font-mono text-[var(--color-success)] text-xs">{(data.breakdown.freeSpace * 100 / data.contextLimit).toFixed(1)}%</span>
                  </div>
                </div>

                {/* Model Info Card */}
                <div className="relative overflow-hidden bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-[var(--color-info)]/30 transition-all duration-300 group hover:shadow-[0_8px_24px_rgba(59,130,246,0.12)] hover:-translate-y-1">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 group-hover:opacity-25 transition-all duration-300 text-[var(--color-info)]">
                    <Cpu className="size-12" />
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider block">当前模型</span>
                    <div className="mt-2 truncate">
                      <span className="text-base font-bold font-mono text-[var(--color-text-primary)] truncate block" title={data.modelName}>
                        {data.modelName || '(未知)'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]/15 pt-2">
                    <span>运行状态</span>
                    <span className="flex items-center gap-1 font-medium text-[var(--color-success)] text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                      正常
                    </span>
                  </div>
                </div>
              </div>

              {/* Stacked Progress Bar */}
              <div className="border border-[var(--color-border)]/30 rounded-xl p-4 bg-[var(--color-bg-sidebar)]/10 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-center text-xs text-[var(--color-text-secondary)] mb-3">
                  <span className="font-semibold text-[var(--color-text-primary)]">Context 占用分配堆叠图</span>
                  <span className="font-mono text-[var(--color-text-muted)] text-[10px]">分类比例统计</span>
                </div>
                <div
                  className="h-3 w-full rounded-full bg-[var(--color-bg-active)]/40 overflow-hidden flex shadow-inner border border-[var(--color-border)]/10"
                  role="progressbar"
                  aria-valuenow={data.usedPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`已用 ${data.usedPct}%`}
                  data-testid="context-modal-progress"
                >
                  {segments.map((seg, idx) => {
                    const pct = data.contextLimit > 0 ? (seg.value * 100) / data.contextLimit : 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          'h-full transition-all duration-300 hover:brightness-110 hover:scale-y-110 cursor-help border-r border-[var(--color-bg-sidebar)]/30 last:border-r-0',
                          seg.color
                        )}
                        style={{ width: `${pct}%` }}
                        title={`${seg.label}: ${(seg.value / 1000).toFixed(1)}k (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-3 gap-y-2 mt-4 justify-center text-[10px]">
                  {segments.map((seg, idx) => {
                    const pct = data.contextLimit > 0 ? (seg.value * 100) / data.contextLimit : 0;
                    if (pct <= 0) return null;
                    return (
                      <div key={idx} className="flex items-center gap-1.5 text-[var(--color-text-secondary)] bg-[var(--color-bg-surface)]/40 hover:bg-[var(--color-bg-surface)]/80 hover:scale-105 px-2.5 py-1 rounded-full border border-[var(--color-border)]/10 transition-all duration-200">
                        <span className={cn('w-2 h-2 rounded-full shrink-0', seg.dotColor)} />
                        <span className="font-medium">{seg.label}</span>
                        <span className="font-mono text-[var(--color-text-muted)]">{(seg.value / 1000).toFixed(1)}k ({pct.toFixed(1)}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Grid breakdown */}
              <div>
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2.5 px-1">
                  按类别细分统计
                </div>
                <div className="grid grid-cols-2 gap-2 border border-[var(--color-border)]/30 rounded-xl p-3 bg-[var(--color-bg-sidebar)]/10 shadow-sm">
                  {renderRow('System prompt', data.breakdown.systemPrompt, data.contextLimit)}
                  {renderRow('System tools', data.breakdown.systemTools, data.contextLimit)}
                  {renderRow('MCP tools', data.breakdown.mcp, data.contextLimit)}
                  {renderRow('Workflows', data.breakdown.workflows, data.contextLimit)}
                  {renderRow('Custom agents', data.breakdown.customAgents, data.contextLimit)}
                  {renderRow('Memory files', data.breakdown.memoryFiles, data.contextLimit)}
                  {renderRow('Skills', data.breakdown.skills, data.contextLimit)}
                  {renderRow('Messages', data.breakdown.messages, data.contextLimit)}
                  {renderRow('Project command bodies', data.breakdown.projectCommandBodies, data.contextLimit)}
                  {renderRow('Free space', data.breakdown.freeSpace, data.contextLimit)}
                  {renderRow('Autocompact buffer', data.breakdown.autocompactBuffer, data.contextLimit)}
                </div>
              </div>

              {/* Details Accordion Sections */}
              <div className="space-y-2.5">
                {renderDetailSection(
                  'mcp',
                  'MCP tools',
                  <Server className="size-3.5" />,
                  (data.breakdown.mcpPerTool ?? []).map((t) => ({
                    key: t.tool,
                    name: t.tool,
                    meta: t.server,
                    tokens: t.tokens,
                  })),
                  data.contextLimit
                )}
                {renderDetailSection(
                  'skills',
                  'Skills',
                  <FileText className="size-3.5" />,
                  (data.breakdown.skillsPerSkill ?? []).map((s) => ({
                    key: s.name,
                    name: s.name,
                    meta: s.scope,
                    tokens: s.tokens,
                  })),
                  data.contextLimit
                )}
                {renderDetailSection(
                  'workflows',
                  'Workflows',
                  <GitBranch className="size-3.5" />,
                  (data.breakdown.workflowsPerWorkflow ?? []).map((w) => ({
                    key: w.id,
                    name: w.name,
                    tokens: w.tokens,
                  })),
                  data.contextLimit
                )}
                {renderDetailSection(
                  'systemTools',
                  'System tools',
                  <Wrench className="size-3.5" />,
                  (data.breakdown.systemToolsPerTool ?? []).map((t) => ({
                    key: t.name,
                    name: t.name,
                    tokens: t.tokens,
                  })),
                  data.contextLimit
                )}
                {renderDetailSection(
                  'projectCommands',
                  'Project commands',
                  <Terminal className="size-3.5" />,
                  (data.breakdown.projectCommandsPerFile ?? []).map((f) => ({
                    key: f.name,
                    name: f.name,
                    tokens: f.tokens,
                  })),
                  data.contextLimit
                )}
              </div>

              {data.breakdown.freeSpace < data.contextLimit * 0.1 && (
                <div
                  className="text-xs text-[var(--color-danger)] px-4 py-3 rounded-xl bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 flex items-center gap-3 animate-pulse shadow-sm"
                  data-testid="context-modal-near-threshold"
                >
                  <div className="p-1 rounded-md bg-[var(--color-danger)]/15 text-[var(--color-danger)] shrink-0">
                    <AlertCircle className="size-4" />
                  </div>
                  <span className="font-medium">距离自动压缩仅剩 <span className="font-bold font-mono text-sm">{data.breakdown.freeSpace}</span> tokens</span>
                </div>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

export default ContextModal;

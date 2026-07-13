import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

// Low-saturation engineering palettes (OKLCH based) suitable for both Light and Dark themes
const categoryConfigs: Record<
  string,
  {
    icon: ReactNode;
    color: string;
    iconBg: string;
  }
> = {
  'System prompt': {
    icon: <Cpu className="size-3.5" />,
    color: 'oklch(0.65 0.08 250)', // tech blue-indigo
    iconBg: 'oklch(0.65 0.08 250 / 0.12)'
  },
  'System tools': {
    icon: <Wrench className="size-3.5" />,
    color: 'oklch(0.65 0.08 280)', // cool purple
    iconBg: 'oklch(0.65 0.08 280 / 0.12)'
  },
  'MCP tools': {
    icon: <Server className="size-3.5" />,
    color: 'oklch(0.62 0.09 220)', // cyan-blue
    iconBg: 'oklch(0.62 0.09 220 / 0.12)'
  },
  'Workflows': {
    icon: <GitBranch className="size-3.5" />,
    color: 'oklch(0.68 0.08 300)', // violet
    iconBg: 'oklch(0.68 0.08 300 / 0.12)'
  },
  'Custom agents': {
    icon: <Sparkles className="size-3.5" />,
    color: 'oklch(0.66 0.10 340)', // magenta-pink
    iconBg: 'oklch(0.66 0.10 340 / 0.12)'
  },
  'Memory files': {
    icon: <Database className="size-3.5" />,
    color: 'oklch(0.70 0.09 90)', // warm brown
    iconBg: 'oklch(0.70 0.09 90 / 0.12)'
  },
  'Skills': {
    icon: <FileText className="size-3.5" />,
    color: 'oklch(0.62 0.12 30)', // vermilion/red
    iconBg: 'oklch(0.62 0.12 30 / 0.12)'
  },
  'Messages': {
    icon: <MessageSquare className="size-3.5" />,
    color: 'oklch(0.65 0.10 140)', // muted green
    iconBg: 'oklch(0.65 0.10 140 / 0.12)'
  },
  'Project command bodies': {
    icon: <Terminal className="size-3.5" />,
    color: 'oklch(0.66 0.08 180)', // teal
    iconBg: 'oklch(0.66 0.08 180 / 0.12)'
  },
  'Free space': {
    icon: <Activity className="size-3.5" />,
    color: 'oklch(0.75 0.12 145)', // forest green
    iconBg: 'oklch(0.75 0.12 145 / 0.12)'
  },
  'Autocompact buffer': {
    icon: <RefreshCw className="size-3.5" />,
    color: 'oklch(0.72 0.11 60)', // amber-yellow
    iconBg: 'oklch(0.72 0.11 60 / 0.12)'
  }
};

// Precise LED indicators to mimic hardware dashboards
function LEDSegments({ pct, color }: { pct: number; color: string }) {
  const totalBars = 20;
  const activeBars = Math.round((pct / 100) * totalBars);
  return (
    <div className="flex gap-0.5 items-center mt-2.5 h-1.5 select-none" aria-hidden="true">
      {Array.from({ length: totalBars }).map((_, i) => {
        const isActive = i < activeBars;
        return (
          <div
            key={i}
            className="h-1 w-1.5 rounded-[1px] transition-all duration-300"
            style={{
              backgroundColor: isActive ? color : 'var(--color-border)',
              opacity: isActive ? 0.9 : 0.15,
            }}
          />
        );
      })}
    </div>
  );
}

export function ContextModal() {
  const { t } = useTranslation();
  const isOpen = useContextModalStore((s: ReturnType<typeof useContextModalStore.getState>) => s.isOpen);
  const close = useContextModalStore((s: ReturnType<typeof useContextModalStore.getState>) => s.close);
  const [data, setData] = useState<ContextAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionModelOverrides = useSessionStore((s) => s.sessionModelOverrides) || {};
  const override = activeSessionId ? sessionModelOverrides[activeSessionId] : null;
  const activeProvider = useLLMStore((s) => s.activeProvider);
  const providers = useLLMStore((s) => s.providers);

  useEffect(() => {
    if (!isOpen) {
      setData(null);
      setError(null);
      setLoading(false);
      setExpanded({});
      return;
    }

    if (!activeSessionId) {
      setError(t('context.noActiveSession'));
      return;
    }

    setLoading(true);
    setError(null);

    let active = activeProvider;
    if (override?.providerId) {
      const matched = providers.find((p) => p.id === override.providerId);
      if (matched) {
        active = matched;
      }
    }
    const limit = active?.context_limit;

    let cancelled = false;
    window.electronAPI.context
      .currentSession(activeSessionId, limit, override?.model || undefined)
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
  }, [isOpen, activeSessionId, override, activeProvider, providers]);

  const progressBarColor = (() => {
    if (!data) return 'bg-[var(--color-bg-active)]';
    if (data.usedPct >= 85) return 'var(--color-danger)';
    if (data.usedPct >= 70) return 'var(--color-warning)';
    return 'var(--color-accent)';
  })();

  const renderRow = (label: string, value: number, contextLimit: number, index: number) => {
    const config = categoryConfigs[label] || {
      icon: <Cpu className="size-3.5" />,
      color: 'var(--color-accent)',
      iconBg: 'var(--color-accent-dim)',
    };
    const pct = contextLimit > 0 ? (value * 100) / contextLimit : 0;
    const displayLabel = t(`context.category.${label}`);
    return (
      <div
        key={label}
        className="group py-1.5 px-2 hover:bg-[var(--color-bg-hover)]/10 rounded-md transition-colors flex flex-col gap-1.5"
        data-testid={`context-row-${label}`}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            {/* Index number */}
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono w-4 text-right select-none">
              {String(index + 1).padStart(2, '0')}
            </span>
            {/* Category Icon */}
            <div 
              className="p-1 rounded-sm flex items-center justify-center shrink-0" 
              style={{ backgroundColor: config.iconBg, color: config.color }}
            >
              {config.icon}
            </div>
            {/* Display label and raw label for screen reader & test runner */}
            <span className="text-[var(--color-text-secondary)] font-sans font-medium group-hover:text-[var(--color-text-primary)] transition-colors truncate">
              {displayLabel}
              <span className="sr-only">{label}</span>
            </span>
          </div>
          {/* Dotted Linker */}
          <div className="flex-1 border-b border-dotted border-[var(--color-border)]/40 mx-2 group-hover:border-[var(--color-border-strong)]/60 transition-colors" />
          {/* Token Values */}
          <span className="font-mono text-[var(--color-text-primary)] font-semibold shrink-0 ml-1">
            {(value / 1000).toFixed(1)}k <span className="text-[var(--color-text-muted)] text-[10px] font-normal">({pct.toFixed(1)}%)</span>
          </span>
        </div>
        {/* Precise Indicator line */}
        <div className="h-[2px] w-full rounded-full bg-[var(--color-border)]/15 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%`, backgroundColor: config.color }}
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
    const displayLabel = t(`context.category.${label}`);
    return (
      <div
        key={sectionKey}
        className="border-b border-[var(--color-border)]/20 last:border-b-0 py-1.5 transition-colors"
        data-testid={`context-modal-detail-${sectionKey}`}
      >
        <button
          type="button"
          className="w-full flex items-center justify-between py-2.5 px-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]/10 rounded-md transition-all duration-150"
          onClick={() => setExpanded((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
          data-testid={`context-modal-detail-toggle-${sectionKey}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-sm bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)]">
              {icon}
            </div>
            <span className="font-medium text-[var(--color-text-primary)]">
              {t('context.detailsOf', { label: displayLabel })}
              <span className="sr-only">{label}</span>
            </span>
            <Badge variant="secondary" className="font-mono text-[9px] px-1.5 py-0 rounded bg-[var(--color-border)]/20 text-[var(--color-text-primary)] border-none">
              {rows.length}
            </Badge>
          </div>
          <ChevronDown className={cn("size-3.5 text-[var(--color-text-muted)] transition-transform duration-200 ease-in-out", isOpen && "rotate-180")} />
        </button>
        {isOpen && (
          <div className="mt-1 border border-[var(--color-border)]/30 rounded-md bg-[var(--color-bg-sunken)]/40 px-3 py-2 max-h-[220px] overflow-y-auto font-mono text-[11px] animate-in fade-in slide-in-from-top-1 duration-150 ease-out">
            <div className="divide-y divide-[var(--color-border)]/15">
              {rows.map((r, i) => {
                const pct = contextLimit > 0 ? (r.tokens * 100) / contextLimit : 0;
                return (
                  <div
                    key={`${sectionKey}-${r.key}-${i}`}
                    className="flex items-center justify-between py-2 first:pt-1 last:pb-1 group/row"
                    data-testid={`context-modal-detail-row-${sectionKey}`}
                  >
                    <span className="flex items-center gap-2 min-w-0 max-w-[70%]">
                      <span className="text-[var(--color-text-primary)] truncate font-mono font-medium">
                        {r.name}
                      </span>
                      {r.meta && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded border border-[var(--color-border)]/40 text-[var(--color-text-muted)] font-mono shrink-0 select-none">
                          {r.meta}
                        </span>
                      )}
                    </span>
                    {/* Dotted Linker */}
                    <div className="flex-1 border-b border-dotted border-[var(--color-border)]/30 mx-2 group-hover/row:border-[var(--color-border-strong)]/50 transition-colors" />
                    <span className="text-[var(--color-text-secondary)] font-mono shrink-0">
                      {(r.tokens / 1000).toFixed(1)}k <span className="text-[var(--color-text-muted)] text-[9px] font-normal">({pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
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
        className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden gap-0 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 bg-[var(--color-bg-surface)] border border-[var(--color-border)]"
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
                <span className="font-semibold text-[var(--color-text-primary)]">{t('context.resourceMonitor')}</span>
                <span 
                  className="w-2 h-2 rounded-full animate-pulse shrink-0" 
                  style={{ backgroundColor: `var(${progressBarColor})` }}
                />
              </div>
              <span className="text-[11px] text-[var(--color-text-muted)] font-normal">{t('context.tokenAnalysisSubtitle')}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div
            className="text-sm text-[var(--color-danger)] py-3 px-3 rounded-md bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 my-4 shrink-0 animate-in fade-in slide-in-from-top-2 duration-300"
            data-testid="context-modal-error"
          >
            {t('context.dataLoadFailed', { error: typeof error === 'string' ? error : (error as Error)?.message ?? String(error) })}
          </div>
        )}

        {loading && !data && (
          <div data-testid="context-modal-loading" className="space-y-4 py-6 flex-1 overflow-y-auto animate-in fade-in duration-300">
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-16 w-full rounded-xl" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded" />
              ))}
            </div>
          </div>
        )}

        {data && (() => {
          const segments = [
            { label: t('context.segment.systemPrompt'), rawLabel: 'System prompt', value: data.breakdown.systemPrompt, color: 'oklch(0.65 0.08 250)' },
            { label: t('context.segment.builtInMcp'), rawLabel: 'Built-in / MCP tools', value: data.breakdown.systemTools + data.breakdown.mcp, color: 'oklch(0.62 0.09 220)' },
            { label: t('context.segment.skillsWorkflows'), rawLabel: 'Skills & Workflows', value: data.breakdown.skills + data.breakdown.workflows + data.breakdown.projectCommandBodies, color: 'oklch(0.68 0.08 300)' },
            { label: t('context.segment.sessionMessages'), rawLabel: 'Messages', value: data.breakdown.messages, color: 'oklch(0.62 0.12 30)' },
            { label: t('context.segment.memoryCache'), rawLabel: 'Memory / Cache', value: data.breakdown.memoryFiles + data.breakdown.customAgents, color: 'oklch(0.70 0.09 90)' },
          ];

          // Ordered list of categories to match design guidelines and tests
          const categoryList = [
            'System prompt',
            'System tools',
            'MCP tools',
            'Workflows',
            'Custom agents',
            'Memory files',
            'Skills',
            'Messages',
            'Project command bodies',
            'Free space',
            'Autocompact buffer'
          ];

          return (
            <div data-testid="context-modal-body" className="space-y-6 pt-4 flex-1 overflow-y-auto pr-1 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
              {/* Stats Hero Cards */}
              <div className="grid grid-cols-3 gap-3">
                {/* Used Context Card */}
                <div className="relative overflow-hidden min-w-0 bg-[var(--color-bg-sunken)]/60 border border-[var(--color-border)]/20 rounded-xl p-4 flex flex-col justify-between hover:border-[var(--color-border-strong)]/40 transition-colors group">
                  <div>
                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider block">{t('context.usedContext')}</span>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{(data.used / 1000).toFixed(1)}k</span>
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)]">/ {(data.contextLimit / 1000).toFixed(0)}k</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-[var(--color-border)]/15 pt-2 flex flex-col justify-between">
                    <div className="flex justify-between items-center text-[10px] text-[var(--color-text-secondary)] font-mono">
                      <span>{t('context.usagePct')}</span>
                      <span className="font-bold text-[var(--color-accent)]">{data.usedPct}%</span>
                    </div>
                    {/* Led Indicator */}
                    <LEDSegments pct={data.usedPct} color={`var(${progressBarColor})`} />
                  </div>
                </div>

                {/* Free Space Card */}
                <div className="relative overflow-hidden min-w-0 bg-[var(--color-bg-sunken)]/60 border border-[var(--color-border)]/20 rounded-xl p-4 flex flex-col justify-between hover:border-[var(--color-border-strong)]/40 transition-colors group">
                  <div>
                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider block">{t('context.freeAvailable')}</span>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{(data.breakdown.freeSpace / 1000).toFixed(1)}k</span>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">tokens</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-[var(--color-border)]/15 pt-2 flex flex-col justify-between">
                    <div className="flex justify-between items-center text-[10px] text-[var(--color-text-secondary)] font-mono">
                      <span>{t('context.freePct')}</span>
                      <span className="font-bold text-[var(--color-success)]">{(data.breakdown.freeSpace * 100 / data.contextLimit).toFixed(1)}%</span>
                    </div>
                    {/* Led Indicator */}
                    <LEDSegments pct={data.breakdown.freeSpace * 100 / data.contextLimit} color="oklch(0.75 0.12 145)" />
                  </div>
                </div>

                {/* Model Info Card */}
                <div className="relative overflow-hidden min-w-0 bg-[var(--color-bg-sunken)]/60 border border-[var(--color-border)]/20 rounded-xl p-4 flex flex-col justify-between hover:border-[var(--color-border-strong)]/40 transition-colors group">
                  <div>
                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider block">{t('context.currentModel')}</span>
                    <div className="mt-2.5 flex items-center gap-1.5 bg-[var(--color-bg-app)]/50 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)]/20">
                      <Cpu className="size-3.5 text-[var(--color-text-secondary)] shrink-0" />
                      <span className="text-xs font-bold font-mono text-[var(--color-text-primary)] truncate block" title={data.modelName}>
                        {data.modelName || t('context.unknownModel')}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]/15 pt-2 font-mono">
                    <span>{t('context.runtimeStatus')}</span>
                    <span className="flex items-center gap-1 font-semibold text-[var(--color-success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                      {t('context.normal')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stacked Progress Bar with ruler scale and threshold marker */}
              <div className="border border-[var(--color-border)]/30 rounded-xl p-4 bg-[var(--color-bg-sunken)]/30 relative overflow-hidden">
                <div className="flex justify-between items-center text-xs text-[var(--color-text-secondary)] mb-1">
                  <span className="font-semibold text-[var(--color-text-primary)]">{t('context.stackedChart')}</span>
                  <span className="font-mono text-[var(--color-text-muted)] text-[10px]">{t('context.categoryStats')}</span>
                </div>

                <div className="relative mt-2">
                  {/* Ruler scales */}
                  <div className="flex justify-between text-[8px] text-[var(--color-text-muted)] font-mono px-0.5 mb-1.5">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                    <span>75%</span>
                    <span className="text-[var(--color-accent)] font-semibold">100%</span>
                  </div>

                  <div className="relative h-2.5 w-full bg-[var(--color-border)]/15 rounded-full overflow-hidden flex"
                    role="progressbar"
                    aria-valuenow={data.usedPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('context.ariaUsedPct', { pct: data.usedPct })}
                    data-testid="context-modal-progress"
                  >
                    {segments.map((seg, idx) => {
                      const pct = data.contextLimit > 0 ? (seg.value * 100) / data.contextLimit : 0;
                      if (pct <= 0) return null;
                      return (
                        <div
                          key={idx}
                          className="h-full transition-all duration-300 hover:brightness-110 cursor-help border-r border-[var(--color-bg-surface)]/20 last:border-r-0"
                          style={{ width: `${pct}%`, backgroundColor: seg.color }}
                          title={`${seg.label}: ${(seg.value / 1000).toFixed(1)}k (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                  
                  {/* Autocompact Threshold Marker at 85% */}
                  <div 
                    className="absolute -top-3.5 bottom-0 w-[1.5px] bg-[var(--color-danger)]/50 z-10 pointer-events-none"
                    style={{ left: '85%' }}
                  >
                    <div className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-0.5">
                      <span className="text-[7px] font-mono text-[var(--color-danger)] bg-[var(--color-bg-surface)] border border-[var(--color-danger)]/20 px-1 py-0 rounded select-none font-bold uppercase tracking-tighter">
                        Limit
                      </span>
                    </div>
                  </div>
                </div>

                {/* Legend cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                  {segments.map((seg, idx) => {
                    const pct = data.contextLimit > 0 ? (seg.value * 100) / data.contextLimit : 0;
                    if (pct <= 0) return null;
                    return (
                      <div 
                        key={idx} 
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-[var(--color-border)]/20 bg-[var(--color-bg-surface)]/50 hover:bg-[var(--color-bg-surface)] transition-all duration-150"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span 
                            className="w-1.5 h-1.5 rounded-full shrink-0" 
                            style={{ backgroundColor: seg.color }} 
                          />
                          <span className="text-[10px] text-[var(--color-text-secondary)] font-medium truncate">
                            {seg.label}
                            <span className="sr-only">{seg.rawLabel}</span>
                          </span>
                        </div>
                        <span className="font-mono text-[10px] font-semibold text-[var(--color-text-primary)] shrink-0 ml-1">
                          {(seg.value / 1000).toFixed(1)}k
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dotted ledger by-category list */}
              <div>
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 px-1 flex items-center justify-between">
                  <span>{t('context.byCategory')}</span>
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)] font-normal">{t('context.categoryStats')}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 border border-[var(--color-border)]/20 rounded-xl p-3 bg-[var(--color-bg-sunken)]/20">
                  {categoryList.map((label, idx) => {
                    const val = (data.breakdown as any)[
                      label === 'Free space' ? 'freeSpace' : 
                      label === 'System prompt' ? 'systemPrompt' : 
                      label === 'System tools' ? 'systemTools' : 
                      label === 'MCP tools' ? 'mcp' : 
                      label === 'Workflows' ? 'workflows' : 
                      label === 'Custom agents' ? 'customAgents' : 
                      label === 'Memory files' ? 'memoryFiles' : 
                      label === 'Skills' ? 'skills' : 
                      label === 'Messages' ? 'messages' : 
                      label === 'Project command bodies' ? 'projectCommandBodies' : 
                      label === 'Autocompact buffer' ? 'autocompactBuffer' : 'freeSpace'
                    ] ?? 0;
                    return renderRow(label, val, data.contextLimit, idx);
                  })}
                </div>
              </div>

              {/* Details Accordion Sections wrapped in flat ledger frame */}
              <div className="border border-[var(--color-border)]/30 rounded-xl p-2 bg-[var(--color-bg-sunken)]/10 space-y-1">
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
                  className="text-xs text-[oklch(0.68 0.18 24)] px-4 py-3 rounded-xl bg-[oklch(0.68 0.18 24 / 0.08)] border-l-3 border-[oklch(0.68 0.18 24)] flex items-center gap-3 animate-pulse shadow-sm"
                  data-testid="context-modal-near-threshold"
                >
                  <div className="p-1 rounded bg-[oklch(0.68 0.18 24 / 0.15)] text-[oklch(0.68 0.18 24)] shrink-0">
                    <AlertCircle className="size-4" />
                  </div>
                  <span className="font-semibold">{t('context.compressWarning', { tokens: data.breakdown.freeSpace })}</span>
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

import { useEffect, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { BarChart3, ChevronDown, ChevronUp, Server, Wrench, FileText, GitBranch, Terminal } from 'lucide-react';
import { useContextModalStore } from '@/stores/contextModalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useLLMStore } from '@/stores/llmStore';
import { cn } from '@/lib/utils';

// Mirror of the IPC payload type (defined in main/deepagent/context-aggregator.ts).
// We re-declare it here to avoid a main → renderer import boundary.
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

/**
 * 08.2 P4 C2-02: Radix Dialog modal showing the Claude Code 完整版 context
 * breakdown. 11 category rows in UI-SPEC.md §Surface 2 fixed order; per-MCP-tool
 * list is expandable (collapsed by default to save vertical space).
 *
 * Dual entry: opened by /context slash command (C2-04) and the persistent
 * <ContextButton> next to the composer.
 *
 * Data fetch: useEffect on isOpen. Closing the modal clears data so the next
 * open always shows fresh values (per UI-SPEC.md empty state).
 */
export function ContextModal() {
  const isOpen = useContextModalStore((s) => s.isOpen);
  const close = useContextModalStore((s) => s.close);
  const [data, setData] = useState<ContextAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-source expansion state — each breakdown can be toggled independently.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) {
      // Reset on close so the next open always fetches fresh data.
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

    // P10: pin context_limit from the active provider (if any) so the
    // threshold math is provider-specific. Falls back to 200_000 server-side.
    const active = useLLMStore.getState().activeProvider;
    const limit = active?.context_limit;

    window.electronAPI.context
      .currentSession(activeSessionId, limit)
      .then((payload) => {
        setData(payload as unknown as ContextAggregate);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen]);

  const progressBarColor = (() => {
    if (!data) return 'bg-[var(--color-bg-active)]';
    if (data.usedPct >= 85) return 'bg-[var(--color-danger)]';
    if (data.usedPct >= 70) return 'bg-[var(--color-warning)]';
    return 'bg-[var(--color-accent)]';
  })();

  const renderRow = (label: string, value: number, contextLimit: number) => {
    const pct = contextLimit > 0 ? (value * 100) / contextLimit : 0;
    return (
      <div
        key={label}
        className="flex items-center justify-between text-sm py-1"
        data-testid={`context-row-${label}`}
      >
        <span className="text-[var(--color-text-secondary)]">{label}</span>
        <span className="font-mono text-[var(--color-text-primary)]">
          {(value / 1000).toFixed(1)}k ({(pct).toFixed(1)}%)
        </span>
      </div>
    );
  };

  // 08.2 polish: per-source breakdown section. Renders an expandable list
  // for any non-empty breakdown array (MCP / Skills / Workflows / System
  // tools / Project commands). Each section is collapsed by default to keep
  // the modal compact.
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
        className="border-t border-[var(--color-border)]/40 pt-2"
        data-testid={`context-modal-detail-${sectionKey}`}
      >
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          onClick={() => setExpanded((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
          data-testid={`context-modal-detail-toggle-${sectionKey}`}
        >
          {isOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {icon}
          {label} 明细 ({rows.length})
        </button>
        {isOpen && (
          <div className="mt-2 space-y-1 pl-3 border-l border-[var(--color-border)]/40">
            {rows.map((r, i) => {
              const pct = contextLimit > 0 ? (r.tokens * 100) / contextLimit : 0;
              return (
                <div
                  key={`${sectionKey}-${r.key}-${i}`}
                  className="flex items-center justify-between text-xs py-1"
                  data-testid={`context-modal-detail-row-${sectionKey}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[var(--color-text-secondary)] truncate">
                      {r.name}
                    </span>
                    {r.meta && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {r.meta}
                      </Badge>
                    )}
                  </span>
                  <span className="font-mono text-[var(--color-text-primary)] ml-2 flex-shrink-0">
                    {(r.tokens / 1000).toFixed(1)}k ({pct.toFixed(1)}%)
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
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-testid="context-modal"
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-[var(--color-info)]" />
            📊 Context usage
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div
            className="text-sm text-[var(--color-danger)] py-3 px-3 rounded-md bg-[var(--color-danger)]/10"
            data-testid="context-modal-error"
          >
            Context 数据加载失败。{error}. 关闭后重试或检查 IPC 通道 commands:readBody 健康。
          </div>
        )}

        {loading && !data && (
          <div data-testid="context-modal-loading" className="space-y-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {data && (
          <div data-testid="context-modal-body" className="space-y-3">
            <div className="text-base font-mono text-[var(--color-text-primary)] flex flex-wrap gap-x-4 gap-y-1">
              <span>
                当前模型：
                <span className="text-[var(--color-text-primary)]">
                  {data.modelName || '(未知)'}
                </span>
              </span>
              <span>
                总量：
                <span className="text-[var(--color-text-primary)]">
                  {(data.used / 1000).toFixed(1)}k/
                  {(data.contextLimit / 1000).toFixed(0)}k ({data.usedPct}%)
                </span>
              </span>
            </div>

            <div
              className="h-2 w-full rounded-full bg-[var(--color-bg-active)] overflow-hidden"
              role="progressbar"
              aria-valuenow={data.usedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`已用 ${data.usedPct}%`}
              data-testid="context-modal-progress"
            >
              <div
                className={cn('h-full transition-all duration-300', progressBarColor)}
                style={{ width: `${data.usedPct}%` }}
              />
            </div>

            <div>
              <div className="text-xs font-medium text-[var(--color-text-muted)] mb-1">
                按类别细分
              </div>
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

            {renderDetailSection(
              'mcp',
              'MCP tools',
              <Server className="size-3" />,
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
              <FileText className="size-3" />,
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
              <GitBranch className="size-3" />,
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
              <Wrench className="size-3" />,
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
              <Terminal className="size-3" />,
              (data.breakdown.projectCommandsPerFile ?? []).map((f) => ({
                key: f.name,
                name: f.name,
                tokens: f.tokens,
              })),
              data.contextLimit
            )}

            {data.breakdown.freeSpace < data.contextLimit * 0.1 && (
              <div
                className="text-xs text-[var(--color-danger)] px-3 py-2 rounded-md bg-[var(--color-danger)]/10"
                data-testid="context-modal-near-threshold"
              >
                ⚠️ 距离自动压缩仅剩 {data.breakdown.freeSpace} tokens
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ContextModal;

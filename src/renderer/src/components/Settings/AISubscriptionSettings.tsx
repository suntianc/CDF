import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Sparkles,
  Key,
  MessageSquare,
  Brain,
  Image as ImageIcon,
  Sliders,
  Volume2,
  Video,
  Music,
  Globe,
  Code2,
  CheckSquare,
  Clock,
} from 'lucide-react';
import type {
  AISubscriptionEntry,
  AISubscriptionUsageSummary,
  CapabilityId,
} from '@shared/ai-subscriptions';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import { ProviderIcon } from '../ui/ProviderIcon';

function formatResetsAt(resetsAt: number | undefined, t: TFunction): string | null {
  if (!resetsAt) return null;
  const now = Date.now();
  const target = resetsAt > 9999999999 ? resetsAt : resetsAt * 1000;
  const diffMs = target - now;
  if (diffMs <= 0) return null;
  
  const diffMin = Math.floor(diffMs / 1000 / 60);
  if (diffMin < 1) return t('settings.aiSubscriptions.usage.resetSoon');
  
  const minutes = diffMin % 60;
  const hours = Math.floor(diffMin / 60) % 24;
  const days = Math.floor(diffMin / 60 / 24);
  
  const parts: string[] = [];
  if (days > 0) parts.push(t('settings.aiSubscriptions.usage.durationDays', { count: days }));
  if (hours > 0) parts.push(t('settings.aiSubscriptions.usage.durationHours', { count: hours }));
  if (minutes > 0) parts.push(t('settings.aiSubscriptions.usage.durationMinutes', { count: minutes }));
  
  return t('settings.aiSubscriptions.usage.resetIn', { duration: parts.join(' ') });
}

function getSubscriptionPlan(id: string): string | null {
  if (id === 'minimax-token-plan') return 'Token Plan';
  return null;
}


function capabilityTranslationKey(capabilityId: CapabilityId): string {
  return `settings.aiSubscriptions.capability.${capabilityId.replace('.', '_')}`;
}

function statusTranslationKey(status: AISubscriptionEntry['status']): string {
  return `settings.aiSubscriptions.status.${status}`;
}

const capabilityIcons: Record<CapabilityId, React.ComponentType<{ className?: string }>> = {
  'text.chat': MessageSquare,
  'text.reasoning': Brain,
  'image.generate': ImageIcon,
  'image.edit': Sliders,
  'speech.synthesize': Volume2,
  'video.generate': Video,
  'music.generate': Music,
  'search.web': Globe,
  'code.agent': Code2,
  'quota.status': CheckSquare,
};

const mapSubscriptionIdToIconName = (id: string) => {
  if (id.includes('minimax')) return 'minimax';
  if (id === 'codex-oauth') return 'codex';
  if (id === 'xai-oauth') return 'grok';
  return id;
};

// Bind connection health to a semantic color: connected reads as success,
// expired/unavailable as danger, connecting as the accent in-progress signal;
// only logged-out stays neutral. Avoids muted grey for key status (DESIGN.md).
function statusBadgeClass(status: AISubscriptionEntry['status']): string {
  switch (status) {
    case 'connected':
      return 'bg-success-dim/40 text-success border border-success/15';
    case 'expired':
    case 'unavailable':
      return 'bg-danger-dim/40 text-danger border border-danger/15';
    case 'connecting':
      return 'bg-accent-dim/40 text-accent border border-accent/15';
    default:
      return 'bg-bg-sunken text-text-muted border border-border';
  }
}

function usagePeriodTranslationKey(period: AISubscriptionUsageSummary['period']): string {
  return `settings.aiSubscriptions.usage.period.${period}`;
}

export function AISubscriptionSettings() {
  const { t } = useTranslation();
  const {
    entries,
    isLoading,
    error,
    loginDescriptors,
    fetchEntries,
    refreshStatus,
    setCapabilityEnabled,
    connectWithKey,
    startLogin,
    disconnect,
  } = useAISubscriptionStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [keyEntryIds, setKeyEntryIds] = useState<Set<string>>(() => new Set());
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const expandedEntries = useMemo(() => expandedIds, [expandedIds]);

  const toggleExpanded = (entryId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const toggleKeyEntry = (entryId: string) => {
    setKeyEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const submitKey = async (entryId: 'minimax-token-plan') => {
    const draft = (keyDrafts[entryId] ?? '').trim();
    if (!draft) return;
    await connectWithKey(entryId, draft);
    setKeyDrafts((current) => ({ ...current, [entryId]: '' }));
    setKeyEntryIds((current) => {
      const next = new Set(current);
      next.delete(entryId);
      return next;
    });
  };

  const formatUsageSummary = (summary: AISubscriptionUsageSummary) => {
    const label = t(usagePeriodTranslationKey(summary.period), {
      defaultValue: summary.label,
    });
    if (typeof summary.used === 'number' && typeof summary.limit === 'number') {
      return t('settings.aiSubscriptions.usage.usedLimit', {
        label,
        used: numberFormatter.format(summary.used),
        limit: numberFormatter.format(summary.limit),
      });
    }
    if (summary.unavailableReason) {
      return t('settings.aiSubscriptions.usage.unavailable', { label });
    }
    return label;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-app overflow-hidden">
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      <div className="settings-content !pt-3 w-full max-w-none flex-1 overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between gap-4 mb-5 shrink-0">
          <div>
            <div className="text-sm font-semibold text-text-primary tracking-tight">
              {t('settings.aiSubscriptions.title')}
            </div>
            <div className="text-xs text-text-muted mt-1 leading-relaxed">
              {t('settings.aiSubscriptions.desc')}
            </div>
          </div>
          {isLoading && (
            <div className="text-xs text-text-muted flex items-center gap-1.5 px-2.5 py-1 rounded bg-bg-sunken border border-border/10">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              <span>{t('settings.aiSubscriptions.loading')}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-danger-dim/30 border border-danger/25 rounded-lg flex items-start gap-2.5 text-xs text-danger animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t(error, { defaultValue: error })}</span>
          </div>
        )}

        <div className="provider-list flex flex-col gap-4">
          {entries.map((entry) => {
            const expanded = expandedEntries.has(entry.id);
            const statusLabel = t(statusTranslationKey(entry.status));
            const subscriptionPlan = getSubscriptionPlan(entry.id);
            const canReconnect = entry.status === 'expired'
              || (
                entry.status === 'unavailable'
                && entry.id !== 'minimax-token-plan'
              );
            return (
              <div
                key={entry.id}
                className="provider-card p-5 border border-border hover:border-border-strong rounded-xl bg-bg-surface transition-all duration-normal ease-out flex flex-col group relative"
                role="group"
                aria-label={entry.displayName}
              >
                {/* Header Section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Brand & Status */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0">
                      <ProviderIcon provider={mapSubscriptionIdToIconName(entry.id)} size={32} shape="square" />
                    </div>
                    <div className="min-w-0 flex flex-col gap-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-text-primary tracking-tight truncate w-[130px] block">
                          {entry.displayName}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono tracking-wide uppercase shrink-0 ${statusBadgeClass(entry.status)}`}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {(entry.status === 'logged_out' || canReconnect) && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm flex items-center gap-1.5"
                        onClick={() => {
                          if (entry.id === 'minimax-token-plan') {
                            toggleKeyEntry(entry.id);
                          } else {
                            void startLogin(entry.id).catch(() => undefined);
                          }
                        }}
                        disabled={isLoading}
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>{t(canReconnect
                          ? 'settings.aiSubscriptions.reconnect'
                          : 'settings.aiSubscriptions.login')}</span>
                      </button>
                    )}
                    {entry.status !== 'logged_out' && (
                      <>
                        {(entry.status === 'connected' || entry.status === 'unavailable') && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm flex items-center gap-1.5"
                            onClick={() => void refreshStatus(entry.id).catch(() => undefined)}
                            disabled={isLoading}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t('settings.aiSubscriptions.refresh')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm flex items-center gap-1.5 hover:text-danger hover:border-danger/30 transition-colors"
                          onClick={() => void disconnect(entry.id).catch(() => undefined)}
                          disabled={isLoading}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>{t('settings.aiSubscriptions.disconnect')}</span>
                        </button>
                      </>
                    )}
                    {entry.capabilities.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm p-1.5"
                        aria-label={expanded
                          ? t('settings.aiSubscriptions.collapseEntry', { name: entry.displayName })
                          : t('settings.aiSubscriptions.expandEntry', { name: entry.displayName })}
                        title={expanded
                          ? t('settings.aiSubscriptions.collapseEntry', { name: entry.displayName })
                          : t('settings.aiSubscriptions.expandEntry', { name: entry.displayName })}
                        onClick={() => toggleExpanded(entry.id)}
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-normal ease-out ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Key Login Input */}
                {entry.status === 'logged_out' && entry.id === 'minimax-token-plan' && keyEntryIds.has(entry.id) && (
                  <div className="mt-4 p-4 rounded-xl bg-bg-sunken/40 border border-border/15 flex flex-col gap-3 animate-fade-in">
                    <div className="text-xs text-text-secondary font-semibold flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-accent" />
                      <span>{t('settings.aiSubscriptions.subscriptionKeyLabel')}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex-1">
                        <input
                          type="password"
                          className="w-full bg-bg-surface border border-border rounded-md pl-3 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus-visible:border-accent transition-colors"
                          aria-label={t('settings.aiSubscriptions.subscriptionKeyLabel')}
                          placeholder={t('settings.aiSubscriptions.subscriptionKeyPlaceholder')}
                          value={keyDrafts[entry.id] ?? ''}
                          onChange={(event) => setKeyDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm px-4 h-[32px] font-semibold text-text-inverse bg-accent hover:bg-accent-hover rounded-md transition-all duration-normal ease-out active:scale-[0.98]"
                        onClick={() => submitKey('minimax-token-plan')}
                        disabled={isLoading || !(keyDrafts[entry.id] ?? '').trim()}
                      >
                        {t('settings.aiSubscriptions.connect')}
                      </button>
                    </div>
                  </div>
                )}

                {loginDescriptors[entry.id] && (
                  <div className="mt-4 p-4 rounded-xl bg-bg-sunken/40 border border-border/15 flex flex-col gap-2 animate-fade-in">
                    <div className="text-xs text-text-secondary">
                      {t('settings.aiSubscriptions.deviceLogin.instructions')}
                    </div>
                    <code className="text-sm font-semibold tracking-wider text-text-primary">
                      {loginDescriptors[entry.id]?.userCode}
                    </code>
                    <div className="text-xs text-accent break-all">
                      {loginDescriptors[entry.id]?.verificationUrl}
                    </div>
                  </div>
                )}

                {/* Quota Progress Bars */}
                {entry.status === 'connected' && entry.usageSummaries.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/40 flex flex-col gap-3.5">
                    {subscriptionPlan && (
                      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-bg-sunken/30 border border-border/10">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-text-secondary font-medium">套餐：</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-accent-dim text-accent border border-accent/10">
                            {subscriptionPlan}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Quota Progress Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {entry.usageSummaries.map((summary, idx) => {
                        const label = t(usagePeriodTranslationKey(summary.period), {
                          defaultValue: summary.label,
                        });
                        const resetText = formatResetsAt(summary.resetsAt, t);
                        
                        if (typeof summary.used === 'number' && typeof summary.limit === 'number') {
                          const percent = summary.limit > 0 ? (summary.used / summary.limit) * 100 : 0;
                          const isHighUsage = percent > 85;
                          return (
                            <div key={idx} className="flex flex-col gap-2 p-3 rounded-lg bg-bg-sunken/45 border border-border/10">
                              <div className="flex justify-between items-center text-[11px] font-mono">
                                <span className="text-text-secondary font-medium">{label}</span>
                                <span className="text-text-muted">
                                  {`${numberFormatter.format(summary.used)} / ${numberFormatter.format(summary.limit)} (${percent.toFixed(0)}%)`}
                                </span>
                              </div>
                              <div className="h-1.5 w-full bg-bg-sunken rounded-full overflow-hidden border border-border/5">
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                                    isHighUsage ? 'bg-warning' : 'bg-accent'
                                  }`}
                                  style={{ width: `${Math.min(percent, 100)}%` }}
                                />
                              </div>
                              {resetText && (
                                <div className="flex items-center gap-1 text-[10px] text-text-muted mt-0.5">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>{resetText}</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div key={idx} className="text-xs text-text-muted flex items-center gap-2 p-2.5 rounded-lg bg-bg-sunken/30 border border-border/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-border-strong/50" />
                            <span>{formatUsageSummary(summary)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Capabilities Expand Panel */}
                {expanded && entry.capabilities.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {entry.capabilities.map((capability) => {
                      const capabilityLabel = t(
                        capabilityTranslationKey(capability.capabilityId),
                        capability.label
                      );
                      const Icon = capabilityIcons[capability.capabilityId] || Sparkles;
                      const isEnabled = capability.enabled;
                      return (
                        <label
                          key={capability.capabilityId}
                          className="flex items-center justify-between gap-4 rounded-lg bg-bg-sunken/30 hover:bg-bg-sunken/60 border border-border/10 px-3.5 py-2.5 transition-colors cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`p-1.5 rounded bg-bg-surface border border-border/10 shrink-0 ${
                              isEnabled && !capability.switchDisabled ? 'text-accent animate-pulse-subtle' : 'text-text-muted'
                            }`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <span className="text-xs text-text-primary font-medium truncate">
                              {capabilityLabel}
                            </span>
                          </div>
                          
                          <input
                            type="checkbox"
                            role="switch"
                            className="relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-border-strong/40 transition-colors duration-normal ease-out outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 checked:bg-accent disabled:opacity-50 disabled:cursor-not-allowed
                            before:pointer-events-none before:absolute before:top-[2px] before:left-[2px] before:h-4 before:w-4 before:rounded-full before:bg-white before:shadow before:ring-0 before:transition-transform before:duration-normal before:ease-out checked:before:translate-x-4"
                            aria-label={capabilityLabel}
                            checked={isEnabled}
                            disabled={capability.switchDisabled || isLoading}
                            onChange={(event) => setCapabilityEnabled(
                              entry.id,
                              capability.capabilityId,
                              event.currentTarget.checked
                            )}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

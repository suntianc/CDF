import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, Settings, RefreshCw } from 'lucide-react';
import type {
  ModelSelectionGroup,
  ModelSourceType,
} from './useModelSelectionController';
import type {
  ModelReasoningProfile,
  ReasoningEffort,
} from '@shared/ai-subscriptions';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '../../ui/dropdown-menu';
import { ProviderIcon } from '../../ui/ProviderIcon';
import { useLLMStore } from '../../../stores/llmStore';
import { useAISubscriptionStore } from '../../../stores/aiSubscriptionStore';

export interface ModelSelectionSurfaceProps {
  variant: 'welcome' | 'composer';
  modelGroups: ReadonlyArray<ModelSelectionGroup>;
  selectedSourceType: ModelSourceType;
  selectedSourceId: string;
  selectedModel: string;
  currentModelLabel: string;
  currentProviderType?: string;
  onSelectModel: (sourceType: ModelSourceType, sourceId: string, modelName: string) => void;
  onOpenSettings?: () => void;
  selectedReasoningEffort?: ReasoningEffort;
  onSelectReasoningEffort?: (effort?: ReasoningEffort) => void;
}


const isTestEnv = typeof navigator !== 'undefined' &&
  (navigator.userAgent.includes('jsdom') ||
   navigator.userAgent.includes('Node.js') ||
   (typeof process !== 'undefined' && process.env.NODE_ENV === 'test'));
export function ModelSelectionSurface({
  variant,
  modelGroups,
  selectedSourceType,
  selectedSourceId,
  selectedModel,
  currentModelLabel,
  currentProviderType,
  onSelectModel,
  onOpenSettings,
  selectedReasoningEffort,
  onSelectReasoningEffort,
}: ModelSelectionSurfaceProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const directionClass = variant === 'welcome'
    ? 'model-selector model-selector--welcome'
    : 'model-selector model-selector--composer';


  const activeCandidate = modelGroups
    .flatMap((group) => group.candidates)
    .find((candidate) => (
      candidate.sourceType === selectedSourceType &&
      candidate.sourceId === selectedSourceId &&
      candidate.model === selectedModel
    ));
  const reasoning = activeCandidate?.reasoning;
  const controlLabel = reasoning
    ? t(reasoning.control === 'agent_count' ? 'chat.reasoningEffort.agentCountLabel' : 'chat.reasoningEffort.depthLabel')
    : '';
  const selectedEffortDisplay = selectedReasoningEffort
    ? t(`chat.reasoningEffort.efforts.${selectedReasoningEffort}`)
    : reasoning?.defaultEffort
      ? t(`chat.reasoningEffort.efforts.${reasoning.defaultEffort}`)
      : '';
  const triggerLabel = activeCandidate?.label || currentModelLabel || t('chat.selectModel');
  const triggerAriaLabel = reasoning && selectedEffortDisplay
    ? `${triggerLabel} · ${selectedEffortDisplay}`
    : triggerLabel;
  const triggerProviderType = activeCandidate?.providerType || currentProviderType;

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        rootRef.current?.contains(target) ||
        target.closest('[role="menu"]') ||
        target.closest('[role="listbox"]')
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const handleRefresh = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        useLLMStore.getState().fetchProviders(),
        useAISubscriptionStore.getState().fetchEntries(),
      ]);
    } catch (error) {
      console.error('Failed to refresh providers/subscriptions:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div ref={rootRef} className={`${directionClass} ${open ? 'open' : ''}`}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="model-selector-trigger"
            aria-label={triggerAriaLabel}
            onClick={isTestEnv ? () => setOpen(!open) : undefined}
            title={triggerAriaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {(activeCandidate || triggerProviderType) && (
              <ProviderIcon
                provider={triggerProviderType || 'openai'}
                size={14}
                className="shrink-0"
              />
            )}
            <span
              className={`model-selector-label ${variant === 'composer' ? 'truncate max-w-[150px]' : ''}`}
              title={triggerAriaLabel}
            >
              {triggerLabel}{reasoning ? ` · ${selectedEffortDisplay}` : ''}
            </span>
            <ChevronDown className="model-chevron w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={variant === 'welcome' ? 'bottom' : 'top'}
          sideOffset={6}
          className="w-52 max-h-[360px] overflow-y-auto p-1 bg-[var(--color-bg-surface)] border border-[var(--color-border-strong)] rounded-md shadow-md"
        >
          {modelGroups.length === 0 ? (
            <DropdownMenuItem
              role="button"
              aria-label={t('chat.noProvidersAvailable')}
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
              className="w-full text-[var(--color-text-muted)] italic cursor-pointer text-center py-2 px-3 text-xs focus:bg-[var(--color-bg-hover)]"
            >
              {t('chat.noProvidersAvailable')}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--color-text-primary)] rounded cursor-pointer transition-colors focus:bg-[var(--color-bg-hover)]">
                  <span>{t('chat.modelSelection.label')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[240px] max-h-[320px] overflow-y-auto bg-[var(--color-bg-surface)] border border-[var(--color-border-strong)]">
                  {modelGroups.map((group, groupIndex) => (
                    <div key={group.id}>
                      {groupIndex > 0 && <DropdownMenuSeparator className="my-1 border-[var(--color-border)]" />}
                      <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                        {group.sourceName}
                      </DropdownMenuLabel>
                      {group.candidates.map((candidate) => {
                        const isSelected = selectedSourceType === candidate.sourceType &&
                          selectedSourceId === candidate.sourceId &&
                          selectedModel === candidate.model;

                        return (
                          <DropdownMenuItem
                            key={candidate.key}
                            role="option"
                            aria-selected={isSelected}
                            aria-label={`${candidate.sourceName} • ${candidate.label}`}
                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer transition-colors focus:bg-[var(--color-bg-hover)] ${isSelected ? 'bg-[var(--color-bg-hover)]/50 font-medium' : ''}`}
                            onClick={() => {
                              onSelectModel(candidate.sourceType, candidate.sourceId, candidate.model);
                              setOpen(false);
                            }}
                          >
                            <ProviderIcon
                              provider={candidate.providerType || 'openai'}
                              size={16}
                              className="shrink-0"
                            />
                            <span className="flex-1 min-w-0 truncate font-mono text-xs text-[var(--color-text-primary)]">
                              {candidate.label}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0 self-center" />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Reasoning effort submenu — only for selected model with a profile */}
              {reasoning && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--color-text-primary)] rounded cursor-pointer transition-colors focus:bg-[var(--color-bg-hover)]">
                    <span>{controlLabel}</span>
                    <span className="ml-auto text-[var(--color-text-muted)]">{selectedEffortDisplay}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-32 bg-[var(--color-bg-surface)] border border-[var(--color-border-strong)]">
                    <DropdownMenuRadioGroup
                      value={selectedReasoningEffort ?? reasoning.defaultEffort}
                      onValueChange={(value) => onSelectReasoningEffort?.(value as ReasoningEffort)}
                    >
                      {reasoning.supportedEfforts.map((effort) => (
                        <DropdownMenuRadioItem
                          key={effort}
                          value={effort}
                          showIndicator={false}
                          className="py-1.5 text-xs cursor-pointer"
                        >
                          <span>{t(`chat.reasoningEffort.efforts.${effort}`)}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </>
          )}

          {/* Bottom Actions Area */}
          <DropdownMenuSeparator className="my-1 border-[var(--color-border)]" />
          <div className="flex flex-col gap-0.5 p-0.5">
            {/* Refresh Config */}
            <DropdownMenuItem
              role="button"
              disabled={isRefreshing}
              onClick={handleRefresh}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded cursor-pointer text-left disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>
                {isRefreshing
                  ? t('chat.modelSelection.refreshingConfig') || '刷新中...'
                  : t('chat.modelSelection.refreshConfig') || '刷新配置'}
              </span>
            </DropdownMenuItem>

            {/* Add Model */}
            {onOpenSettings && (
              <DropdownMenuItem
                role="button"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded cursor-pointer text-left"
              >
                <Settings className="w-3 h-3" />
                <span>{t('chat.modelSelection.addModel') || '管理/添加模型'}</span>
              </DropdownMenuItem>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

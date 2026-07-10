import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, Settings, RefreshCw } from 'lucide-react';
import type {
  ModelSelectionGroup,
  ModelSourceType,
} from './useModelSelectionController';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  onSelectModel: (sourceType: ModelSourceType, sourceId: string, modelName: string) => void;
  onOpenSettings?: () => void;
}

const COMMON_MODEL_DESCRIPTIONS: Record<string, { zh: string; en: string }> = {
  // Anthropic
  'claude-3-5-sonnet-latest': {
    zh: 'Anthropic 旗舰模型，极强的主力智能与编程能力',
    en: 'Anthropic flagship model, exceptional coding and reasoning capability'
  },
  'claude-3-5-sonnet-20241022': {
    zh: 'Claude 3.5 Sonnet 升级版，业界顶尖的编程与 Agent 性能',
    en: 'Upgraded Claude 3.5 Sonnet, top-tier coding and agentic performance'
  },
  'claude-3-5-sonnet-20240620': {
    zh: 'Claude 3.5 Sonnet 第一版，性能出众的智能模型',
    en: 'First edition of Claude 3.5 Sonnet, highly capable model'
  },
  'claude-3-5-haiku-20241022': {
    zh: '速度极快、效率卓越的轻量级模型',
    en: 'Ultrafast and highly efficient lightweight model'
  },
  'claude-3-haiku-20240307': {
    zh: '高效实惠的快速模型',
    en: 'Efficient and cost-effective fast model'
  },
  'claude-3-opus-20240229': {
    zh: '擅长处理极其复杂的分析与深奥的推理任务',
    en: 'Excels at complex analysis and deep reasoning tasks'
  },

  // OpenAI
  'gpt-4o': {
    zh: 'OpenAI 旗舰模型，速度与智能极佳的通用模型',
    en: 'OpenAI flagship model, versatile with excellent speed and intelligence'
  },
  'gpt-4o-mini': {
    zh: '快速、低成本的轻量级旗舰模型',
    en: 'Fast, lightweight, and highly cost-effective model'
  },
  'o1-preview': {
    zh: 'OpenAI 深度推理模型，适合极其复杂的逻辑 and 数学问题',
    en: 'OpenAI deep reasoning model, optimized for complex logic and math'
  },
  'o1-mini': {
    zh: 'OpenAI 快速推理模型，特别针对编码和数学进行了优化',
    en: 'OpenAI fast reasoning model, optimized for coding and STEM'
  },
  'gpt-4-turbo': {
    zh: 'GPT-4 经典前沿模型，支持超长上下文',
    en: 'Classic GPT-4 frontier model with long context support'
  },

  // DeepSeek
  'deepseek-chat': {
    zh: 'DeepSeek V3 旗舰模型，极高性价比的多功能模型',
    en: 'DeepSeek V3 flagship model, highly versatile and cost-effective'
  },
  'deepseek-reasoner': {
    zh: 'DeepSeek R1 推理模型，深度思考、长链条推理首选',
    en: 'DeepSeek R1 reasoning model, optimal for deep thinking and math'
  },

  // MiniMax
  'MiniMax-M3': {
    zh: 'MiniMax 旗舰模型，卓越的多语言理解与复杂推理能力',
    en: 'MiniMax flagship model, excellent multilingual and reasoning capacity'
  },
  'MiniMax-M2.7': {
    zh: 'MiniMax 高性价比多用途模型',
    en: 'MiniMax cost-effective multi-purpose model'
  },
  'MiniMax-M2.7-highspeed': {
    zh: 'MiniMax 极速响应模型',
    en: 'MiniMax ultra-fast response model'
  },

  // Codex
  'gpt-5.6-sol': {
    zh: '最新的前沿 agentic coding 模型',
    en: 'The latest state-of-the-art agentic coding model'
  },
  'gpt-5.6-terra': {
    zh: '适合日常工作的均衡 agentic coding 模型',
    en: 'Balanced agentic coding model for daily workflows'
  },
  'gpt-5.6-luna': {
    zh: '快速且经济的 agentic coding 模型',
    en: 'Fast and cost-effective agentic coding model'
  },
  'gpt-5.5': {
    zh: '适合复杂编码、研究与真实工作流的前沿模型',
    en: 'Frontier model for complex coding, research, and agentic workflows'
  },
  'gpt-5.4': {
    zh: '适合日常编码的强力模型',
    en: 'Powerful model optimized for everyday coding'
  },
  'gpt-5.4-mini': {
    zh: '适合简单编码任务的小型、快速、低成本模型',
    en: 'Small, fast, low-cost model for simple coding tasks'
  },
  'gpt-5.3-codex': {
    zh: '针对编码优化的模型',
    en: 'Optimized model for software engineering'
  },
  'gpt-5.3-codex-spark': {
    zh: '超快速编码模型',
    en: 'Ultra-fast coding model'
  },
  'gpt-5.2': {
    zh: '适合专业工作与长时间 agent 任务的模型',
    en: 'Model designed for professional tasks and long agent sessions'
  },
};

const getModelDescription = (modelName: string, lang: 'zh' | 'en'): string | null => {
  const normalized = modelName.toLowerCase();
  let bestPartialMatch: { desc: { zh: string; en: string }; keyLength: number } | null = null;

  for (const [key, desc] of Object.entries(COMMON_MODEL_DESCRIPTIONS)) {
    const normalizedKey = key.toLowerCase();
    if (normalized === normalizedKey) return desc[lang];
    if (normalized.includes(normalizedKey) && key.length > (bestPartialMatch?.keyLength ?? 0)) {
      bestPartialMatch = { desc, keyLength: key.length };
    }
  }

  return bestPartialMatch?.desc[lang] ?? null;
};

export function ModelSelectionSurface({
  variant,
  modelGroups,
  selectedSourceType,
  selectedSourceId,
  selectedModel,
  currentModelLabel,
  onSelectModel,
  onOpenSettings,
}: ModelSelectionSurfaceProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const directionClass = variant === 'welcome'
    ? 'model-selector model-selector--welcome'
    : 'model-selector model-selector--composer';
  const triggerLabel = currentModelLabel || t('chat.selectModel');

  const currentLang = i18n?.language?.startsWith('zh') ? 'zh' : 'en';

  const activeCandidate = modelGroups
    .flatMap((group) => group.candidates)
    .find((candidate) => (
      candidate.sourceType === selectedSourceType &&
      candidate.sourceId === selectedSourceId &&
      candidate.model === selectedModel
    ));

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
            onClick={() => setOpen(!open)}
            title={triggerLabel}
            aria-label={triggerLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {activeCandidate && (
              <ProviderIcon
                provider={activeCandidate.providerType || 'openai'}
                size={14}
                className="shrink-0"
              />
            )}
            <span
              className={`model-selector-label ${variant === 'composer' ? 'truncate max-w-[150px]' : ''}`}
              title={triggerLabel}
            >
              {triggerLabel}
            </span>
            <ChevronDown className="model-chevron w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={variant === 'welcome' ? 'bottom' : 'top'}
          sideOffset={6}
          className="w-[280px] max-h-[360px] overflow-y-auto p-1 bg-[var(--color-bg-surface)] border border-[var(--color-border-strong)] rounded-md shadow-md"
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
            modelGroups.map((group, groupIndex) => (
              <div key={group.id}>
                {groupIndex > 0 && <DropdownMenuSeparator className="my-1 border-[var(--color-border)]" />}
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center justify-between">
                  <span>{group.sourceName}</span>
                  <span className="text-[9px] font-normal lowercase bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded text-[var(--color-text-muted)]">
                    {t(`chat.modelSelection.sourceKinds.${group.sourceType}`)}
                  </span>
                </DropdownMenuLabel>
                {group.candidates.map((candidate) => {
                  const isSelected = selectedSourceType === candidate.sourceType &&
                    selectedSourceId === candidate.sourceId &&
                    selectedModel === candidate.model;
                  const description = getModelDescription(candidate.model, currentLang);

                  return (
                    <DropdownMenuItem
                      key={candidate.key}
                      role="option"
                      aria-selected={isSelected}
                      aria-label={`${candidate.sourceName} • ${candidate.label}`}
                      className={`flex items-start gap-2.5 px-2 py-1.5 rounded cursor-pointer transition-colors focus:bg-[var(--color-bg-hover)] ${isSelected ? 'bg-[var(--color-bg-hover)]/50 font-medium' : ''}`}
                      onClick={() => {
                        onSelectModel(candidate.sourceType, candidate.sourceId, candidate.model);
                        setOpen(false);
                      }}
                    >
                      <ProviderIcon
                        provider={candidate.providerType || 'openai'}
                        size={16}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0 flex flex-col">
                        <span className="text-xs text-[var(--color-text-primary)] truncate">
                          {candidate.label}
                        </span>
                        {description && (
                          <span className="text-[10px] text-[var(--color-text-muted)] leading-tight whitespace-normal mt-0.5">
                            {description}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0 self-center" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))
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

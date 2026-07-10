import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { ModelReasoningProfile, ReasoningEffort } from '@shared/ai-subscriptions';

interface ReasoningEffortSelectorProps {
  variant: 'welcome' | 'composer';
  profile: ModelReasoningProfile;
  selectedEffort?: ReasoningEffort;
  onSelect: (effort?: ReasoningEffort) => void;
}

export function ReasoningEffortSelector({
  variant,
  profile,
  selectedEffort,
  onSelect,
}: ReasoningEffortSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const controlLabel = t(
    profile.control === 'agent_count'
      ? 'chat.reasoningEffort.agentCountLabel'
      : 'chat.reasoningEffort.depthLabel'
  );
  const effortLabel = (effort: ReasoningEffort) => t(`chat.reasoningEffort.efforts.${effort}`);
  const defaultLabel = profile.defaultEffort
    ? t('chat.reasoningEffort.defaultWithEffort', { effort: effortLabel(profile.defaultEffort) })
    : t('chat.reasoningEffort.default');
  const selectedLabel = selectedEffort ? effortLabel(selectedEffort) : defaultLabel;
  const directionClass = variant === 'welcome'
    ? 'model-selector model-selector--welcome'
    : 'model-selector model-selector--composer';

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const select = (effort?: ReasoningEffort) => {
    onSelect(effort);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`${directionClass} reasoning-effort-selector ${open ? 'open' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="model-selector-trigger"
        title={`${controlLabel}: ${selectedLabel}`}
        aria-label={`${controlLabel}: ${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-selector-label">{selectedLabel}</span>
        <ChevronDown className="model-chevron w-3.5 h-3.5" />
      </button>
      <div className="model-dropdown" role="listbox" aria-label={controlLabel}>
        <button
          type="button"
          role="option"
          aria-selected={selectedEffort === undefined}
          className={`model-select-option ${selectedEffort === undefined ? 'selected' : ''}`}
          onClick={() => select(undefined)}
        >
          {defaultLabel}
        </button>
        {profile.supportedEfforts.map((effort) => (
          <button
            type="button"
            role="option"
            aria-selected={selectedEffort === effort}
            key={effort}
            className={`model-select-option ${selectedEffort === effort ? 'selected' : ''}`}
            onClick={() => select(effort)}
          >
            {effortLabel(effort)}
          </button>
        ))}
      </div>
    </div>
  );
}

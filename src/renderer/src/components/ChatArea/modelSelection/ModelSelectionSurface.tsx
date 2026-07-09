import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type {
  ModelSelectionGroup,
  ModelSourceType,
} from './useModelSelectionController';

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const directionClass = variant === 'welcome'
    ? 'model-selector model-selector--welcome'
    : 'model-selector model-selector--composer';
  const triggerLabel = currentModelLabel || t('chat.selectModel');

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      rootRef.current
        ?.querySelector('.model-select-option.selected')
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);

    return () => clearTimeout(timer);
  }, [open, selectedSourceType, selectedSourceId, selectedModel, modelGroups]);

  return (
    <div
      ref={rootRef}
      className={`${directionClass} ${open ? 'open' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="model-selector-trigger"
        title={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`model-selector-label ${variant === 'composer' ? 'truncate max-w-[150px]' : ''}`}
          title={triggerLabel}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="model-chevron w-3.5 h-3.5" />
      </button>
      <div className="model-dropdown" role="listbox" aria-label={t('chat.selectModel')}>
        {modelGroups.length === 0 ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
            className="model-select-option text-[var(--color-text-muted)] italic cursor-pointer text-center py-2"
          >
            {t('chat.noProvidersAvailable')}
          </button>
        ) : (
          modelGroups.map((group) => (
            <div key={group.id} className="model-group">
              <div className="model-group-name">
                <span>{group.sourceName}</span>
                <span className="ml-1 text-[10px] font-normal text-[var(--color-text-muted)]">
                  {t(`chat.modelSelection.sourceKinds.${group.sourceType}`)}
                </span>
              </div>
              {group.candidates.map((candidate) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    selectedSourceType === candidate.sourceType &&
                    selectedSourceId === candidate.sourceId &&
                    selectedModel === candidate.model
                  }
                  key={candidate.key}
                  className={`model-select-option ${
                    selectedSourceType === candidate.sourceType &&
                    selectedSourceId === candidate.sourceId &&
                    selectedModel === candidate.model
                      ? 'selected'
                      : ''
                  }`}
                  title={`${candidate.sourceName} • ${candidate.label}`}
                  onClick={() => {
                    onSelectModel(candidate.sourceType, candidate.sourceId, candidate.model);
                    setOpen(false);
                  }}
                >
                  {candidate.sourceName} • {candidate.label}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

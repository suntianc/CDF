import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { LLMProvider } from '@shared/types';
import { getModelCandidates } from './useModelSelectionController';

export interface ModelSelectionSurfaceProps {
  variant: 'welcome' | 'composer';
  providers: ReadonlyArray<LLMProvider>;
  selectedProviderId: string;
  selectedModel: string;
  currentProvider: LLMProvider | null;
  currentModel: string;
  onSelectModel: (providerId: string, modelName: string) => void;
  onOpenSettings?: () => void;
}

export function ModelSelectionSurface({
  variant,
  providers,
  selectedProviderId,
  selectedModel,
  currentProvider,
  currentModel,
  onSelectModel,
  onOpenSettings,
}: ModelSelectionSurfaceProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const directionClass = variant === 'welcome'
    ? 'model-selector model-selector--welcome'
    : 'model-selector model-selector--composer';
  const currentModelLabel = currentProvider
    ? `${currentProvider.name} • ${currentModel || currentProvider.default_model}`
    : t('chat.selectModel');

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
  }, [open, selectedProviderId, selectedModel, providers]);

  return (
    <div
      ref={rootRef}
      className={`${directionClass} ${open ? 'open' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        onClick={() => setOpen(!open)}
        className="model-selector-trigger"
        title={currentModelLabel}
      >
        <span
          className={`model-selector-label ${variant === 'composer' ? 'truncate max-w-[150px]' : ''}`}
          title={currentModelLabel}
        >
          {currentModelLabel}
        </span>
        <ChevronDown className="model-chevron w-3.5 h-3.5" />
      </div>
      <div className="model-dropdown">
        {providers.length === 0 ? (
          <div
            onClick={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
            className="model-select-option text-[var(--color-text-muted)] italic cursor-pointer text-center py-2"
          >
            {t('chat.noProvidersAvailable')}
          </div>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="model-group">
              <div className="model-group-name">{provider.name}</div>
              {getModelCandidates(
                provider,
                provider.id === selectedProviderId ? selectedModel : undefined
              ).map((modelName) => (
                <div
                  key={modelName}
                  className={`model-select-option ${
                    currentProvider?.id === provider.id && currentModel === modelName
                      ? 'selected'
                      : ''
                  }`}
                  title={`${provider.name} • ${modelName}`}
                  onClick={() => {
                    onSelectModel(provider.id, modelName);
                    setOpen(false);
                  }}
                >
                  {modelName}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertCircle, Layers, Plus, Sliders, X } from 'lucide-react';
import type { SlashCommand } from '@shared/types';
import type { RegistryLoadingState, RegistryWarning } from '@/hooks/useCommandRegistry';
import type { SessionError } from '../../stores/sessionStore';
import { ComposerInputSurface } from './composerInput/ComposerInputSurface';
import type { ComposerInputController } from './composerInput/useComposerInputController';

export interface ConversationWelcomeSurfaceProps {
  visible?: boolean;
  currentProjectId: string | null;
  currentProjectName: string;
  composerController: ComposerInputController;
  error: SessionError | null;
  commands: ReadonlyArray<SlashCommand>;
  commandWarnings: ReadonlyArray<RegistryWarning>;
  commandLoading: RegistryLoadingState;
  onCommandSelect: (commandText: string) => void;
  onCommandInsert: (commandText: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  onClearError: () => void;
  onCreateProject: () => void;
  onOpenSettings?: () => void;
  onOpenPlugins?: () => void;
  leftToolbarSlot?: ReactNode;
  modelSelectorSlot?: ReactNode;
}

export function ConversationWelcomeSurface({
  visible = true,
  currentProjectId,
  currentProjectName,
  composerController,
  error,
  commands,
  commandWarnings,
  commandLoading,
  onCommandSelect,
  onCommandInsert,
  onSubmit,
  canSubmit,
  onClearError,
  onCreateProject,
  onOpenSettings,
  onOpenPlugins,
  leftToolbarSlot,
  modelSelectorSlot,
}: ConversationWelcomeSurfaceProps) {
  const { t } = useTranslation();
  const [welcomeText, setWelcomeText] = useState({
    headlineKey: 'chat.welcomeHeadlineIdle',
    sublineText: '',
  });

  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = setTimeout(() => {
      const headlineKey = currentProjectId && currentProjectId !== 'default-project'
        ? 'chat.welcomeHeadlineActive'
        : 'chat.welcomeHeadlineIdle';
      const sublineText = currentProjectId
        ? (currentProjectId === 'default-project'
            ? t('chat.welcomeSublineTempSession')
            : t('chat.welcomeSublineProjectLoaded', { name: currentProjectName }))
        : t('chat.welcomeSublineNoProject');
      setWelcomeText({ headlineKey, sublineText });
    }, 150);

    return () => clearTimeout(timer);
  }, [visible, currentProjectId, currentProjectName, t]);

  return (
    <main
      className={`absolute inset-0 flex flex-col items-center justify-center p-6 bg-[var(--color-bg-app)] overflow-hidden transition-all duration-300 ease-in-out ${
        visible
          ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10'
          : 'opacity-0 translate-y-4 scale-95 pointer-events-none z-0'
      }`}
    >
      <div className="center-bg-glow" />

      <div className="max-w-[640px] w-full flex flex-col items-center gap-6 z-10">
        <h1 className="center-headline">
          <Trans
            i18nKey={welcomeText.headlineKey}
            components={{ span: <span /> }}
          />
        </h1>
        <p className="center-subline">
          {welcomeText.sublineText}
        </p>

        {error && (
          <div role="alert" aria-live="assertive" className="w-full p-3 rounded-lg bg-[var(--color-danger-dim)] text-[var(--color-danger)] text-xs flex items-start gap-2 border border-[var(--color-danger)]/20 animate-fade-in shadow-sm">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{t(error.message, { defaultValue: error.message, ...(error.messageParams ?? {}) })}</div>
              {error.recoverableActions && error.recoverableActions.length > 0 && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {error.recoverableActions.map((action) => (
                    <button key={action.label} type="button" onClick={() => { action.action(); onClearError(); }} className="text-[var(--color-danger)] underline underline-offset-2 hover:no-underline font-medium cursor-pointer">
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClearError}
              className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)] shrink-0 transition-colors cursor-pointer"
              aria-label={t('chat.dismissError')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <ComposerInputSurface
          controller={composerController}
          variant="welcome"
          inputLabel={t('chat.welcomePlaceholder')}
          placeholder={t('chat.welcomePlaceholder')}
          commands={commands}
          commandWarnings={commandWarnings}
          commandLoading={commandLoading}
          onCommandSelect={onCommandSelect}
          onCommandInsert={onCommandInsert}
          onSubmit={onSubmit}
          canSubmit={canSubmit}
          sendLabel={t('chat.sendMessage')}
          popoverEnabled={visible}
          leftToolbarSlot={leftToolbarSlot}
          modelSelectorSlot={modelSelectorSlot}
        />

        <div className="feature-rows">
          <button type="button" className="feature-card" onClick={onCreateProject}>
            <div className="feature-card-icon">
              <Plus className="w-4 h-4" />
            </div>
            <div className="feature-card-title">{t('chat.createProjectTitle')}</div>
            <div className="feature-card-desc">{t('chat.createProjectDesc')}</div>
          </button>

          <button type="button" className="feature-card" onClick={onOpenPlugins}>
            <div className="feature-card-icon">
              <Layers className="w-4 h-4" />
            </div>
            <div className="feature-card-title">{t('chat.configurePluginsTitle')}</div>
            <div className="feature-card-desc">{t('chat.configurePluginsDesc')}</div>
          </button>

          <button type="button" className="feature-card" onClick={onOpenSettings}>
            <div className="feature-card-icon">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="feature-card-title">{t('chat.configureModelsTitle')}</div>
            <div className="feature-card-desc">{t('chat.configureModelsDesc')}</div>
          </button>
        </div>

        <div className="dialog-footer">
          <span className="dialog-footer-hint">
            <Trans
              i18nKey="chat.shortcutHint"
              components={{ kbd: <kbd /> }}
            />
          </span>
        </div>
      </div>
    </main>
  );
}

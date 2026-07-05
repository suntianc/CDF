import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Beaker, BookOpen, FileText, MessageSquare } from 'lucide-react';
import type { ProjectScene } from '@shared/types';

type ResearchPanel = 'conversation' | 'papers' | 'writing' | 'experiments';

interface SceneWorkspaceProps {
  scene: ProjectScene;
  conversation: ReactNode;
}

const researchPanels: Array<{
  id: ResearchPanel;
  labelKey: string;
  icon: typeof MessageSquare;
}> = [
  { id: 'conversation', labelKey: 'sceneWorkspace.conversation', icon: MessageSquare },
  { id: 'papers', labelKey: 'sceneWorkspace.paperLibrary', icon: BookOpen },
  { id: 'writing', labelKey: 'sceneWorkspace.writing', icon: FileText },
  { id: 'experiments', labelKey: 'sceneWorkspace.experiments', icon: Beaker },
];

export function SceneWorkspace({ scene, conversation }: SceneWorkspaceProps) {
  if (scene === 'research') {
    return <ResearchSceneWorkspace conversation={conversation} />;
  }

  return <>{conversation}</>;
}

function ResearchSceneWorkspace({ conversation }: { conversation: ReactNode }) {
  const { t } = useTranslation();
  const [activePanel, setActivePanel] = useState<ResearchPanel>('conversation');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-app)]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-3">
        <div role="tablist" aria-label={t('sceneWorkspace.researchTabs')} className="flex items-center gap-1">
          {researchPanels.map((panel) => {
            const Icon = panel.icon;
            const selected = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActivePanel(panel.id)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                  selected
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(panel.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activePanel === 'conversation' ? (
          <div role="tabpanel" className="absolute inset-0">
            {conversation}
          </div>
        ) : (
          <ResearchEmptyPanel panel={activePanel} />
        )}
      </div>
    </div>
  );
}

function ResearchEmptyPanel({ panel }: { panel: Exclude<ResearchPanel, 'conversation'> }) {
  const { t } = useTranslation();
  return (
    <div
      role="tabpanel"
      className="flex h-full items-center justify-center bg-[var(--color-bg-app)] px-6"
    >
      <div className="max-w-[360px] rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-5 py-4 text-center">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">
          {t(`sceneWorkspace.${panel}EmptyTitle`)}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t(`sceneWorkspace.${panel}EmptyDescription`)}
        </div>
      </div>
    </div>
  );
}

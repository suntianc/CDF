import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import type { Project, ProjectScene } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: (project: Project) => void | Promise<void>;
}

const sceneOptions: Array<{
  value: ProjectScene;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'general',
    labelKey: 'projectTree.sceneGeneralLabel',
    descriptionKey: 'projectTree.sceneGeneralDesc',
  },
  {
    value: 'research',
    labelKey: 'projectTree.sceneResearchLabel',
    descriptionKey: 'projectTree.sceneResearchDesc',
  },
];

const folderNameFromPath = (folderPath: string) => (
  folderPath.split(/[\\/]/).filter(Boolean).pop() || ''
);

export function CreateProjectDialog({
  open,
  onOpenChange,
  onProjectCreated,
}: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [scene, setScene] = useState<ProjectScene>('general');
  const [nameEdited, setNameEdited] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setProjectPath('');
      setProjectName('');
      setScene('general');
      setNameEdited(false);
      setCreating(false);
    }
  }, [open]);

  const canCreate = useMemo(() => (
    Boolean(projectPath && projectName.trim()) && !creating
  ), [creating, projectName, projectPath]);

  const chooseFolder = async () => {
    const selectedPath = await window.electronAPI.db.selectDirectory();
    if (!selectedPath) return;
    setProjectPath(selectedPath);
    if (!nameEdited) {
      setProjectName(folderNameFromPath(selectedPath) || t('projectTree.newProject'));
    }
  };

  const createProject = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const project = await window.electronAPI.db.createProject(projectName.trim(), projectPath, scene);
      await onProjectCreated(project);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create project:', error);
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('projectTree.createProjectTitle')}</DialogTitle>
          <DialogDescription>{t('projectTree.createProjectDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="create-project-path">
              {t('projectTree.projectPathLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="create-project-path"
                readOnly
                value={projectPath}
                placeholder={t('projectTree.projectPathPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-app)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none"
              />
              <button
                type="button"
                onClick={chooseFolder}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('projectTree.chooseFolder')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="create-project-name">
              {t('projectTree.projectNameLabel')}
            </label>
            <input
              id="create-project-name"
              value={projectName}
              onChange={(event) => {
                setNameEdited(true);
                setProjectName(event.target.value);
              }}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-app)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
              {t('projectTree.sceneLabel')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {sceneOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors ${
                    scene === option.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-app)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="project-scene"
                    value={option.value}
                    checked={scene === option.value}
                    onChange={() => setScene(option.value)}
                    className="mt-0.5 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[var(--color-text-primary)]">
                      {t(option.labelKey)}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-[var(--color-text-muted)]">
                      {t(option.descriptionKey)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            {t('projectTree.cancelCreateProject')}
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={createProject}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? t('projectTree.creatingProject') : t('projectTree.confirmCreateProject')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

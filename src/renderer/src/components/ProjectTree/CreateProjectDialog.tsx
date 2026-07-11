import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, FolderOpen, FolderPlus, MessageSquare } from 'lucide-react';
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
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProjectPath('');
      setProjectName('');
      setScene('general');
      setNameEdited(false);
      setCreating(false);
      setFormError(null);
    }
  }, [open]);

  const canCreate = useMemo(() => (
    Boolean(projectPath.trim() && projectName.trim()) && !creating
  ), [creating, projectName, projectPath]);

  const chooseFolder = async () => {
    if (creating) return;

    try {
      const selectedPath = await window.electronAPI.db.selectDirectory();
      if (!selectedPath) return;
      setProjectPath(selectedPath);
      setFormError(null);
      if (!nameEdited) {
        setProjectName(folderNameFromPath(selectedPath) || t('projectTree.newProject'));
      }
    } catch {
      setFormError(t('projectTree.createProjectFailed'));
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;

    setCreating(true);
    setFormError(null);
    try {
      const project = await window.electronAPI.db.createProject(projectName.trim(), projectPath, scene);
      await onProjectCreated(project);
      onOpenChange(false);
    } catch {
      setFormError(t('projectTree.createProjectFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!creating) onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-w-[540px] gap-0 overflow-hidden rounded-[var(--radius-lg)] p-0">
        <DialogHeader className="border-b border-[var(--color-border)] px-6 pb-5 pt-6 pr-14">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)]">
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="[text-wrap:balance]">{t('projectTree.createProjectTitle')}</DialogTitle>
              <DialogDescription className="mt-1.5 max-w-[44ch] leading-6 [text-wrap:pretty]">
                {t('projectTree.createProjectDescription')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="flex flex-col gap-5 px-6 py-5" onSubmit={createProject}>
          <div className="flex flex-col gap-2">
            <span id="create-project-path-label" className="text-[13px] font-medium text-[var(--color-text-secondary)]">
              {t('projectTree.projectPathLabel')}
            </span>
            <div className="flex items-center gap-2">
              <div
                aria-labelledby="create-project-path-label"
                aria-live="polite"
                title={projectPath || undefined}
                className="flex h-10 min-w-0 flex-1 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 font-[var(--font-mono)] text-xs"
              >
                <span className={`truncate ${projectPath ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                  {projectPath || t('projectTree.projectPathPlaceholder')}
                </span>
              </div>
              <button
                type="button"
                onClick={chooseFolder}
                disabled={creating}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('projectTree.chooseFolder')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text-secondary)]" htmlFor="create-project-name">
              {t('projectTree.projectNameLabel')}
            </label>
            <input
              id="create-project-name"
              value={projectName}
              onChange={(event) => {
                setNameEdited(true);
                setProjectName(event.target.value);
                setFormError(null);
              }}
              disabled={creating}
              required
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 text-[13px] text-[var(--color-text-primary)] caret-[var(--color-text-primary)] outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <fieldset disabled={creating} className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
              {t('projectTree.sceneLabel')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {sceneOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-20 items-start gap-2.5 rounded-[var(--radius-md)] border p-3 transition-[background-color,border-color] duration-150 ease-[var(--ease-out)] ${
                    creating ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                  } ${
                    scene === option.value
                      ? option.value === 'research'
                        ? 'border-[var(--color-info)] bg-[var(--color-info-dim)]'
                        : 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-sunken)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="project-scene"
                    value={option.value}
                    checked={scene === option.value}
                    onChange={() => {
                      setScene(option.value);
                      setFormError(null);
                    }}
                    className={`mt-0.5 shrink-0 ${option.value === 'research' ? 'accent-[var(--color-info)]' : 'accent-[var(--color-accent)]'}`}
                  />
                  {option.value === 'research' ? (
                    <FlaskConical className={`mt-0.5 h-4 w-4 shrink-0 ${scene === 'research' ? 'text-[var(--color-info)]' : 'text-[var(--color-text-secondary)]'}`} aria-hidden="true" />
                  ) : (
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">
                      {t(option.labelKey)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
                      {t(option.descriptionKey)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {formError && (
            <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-danger-dim)] px-3 py-2 text-xs leading-5 text-[var(--color-danger)]">
              {formError}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-5 mt-1 gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-6 py-4 sm:gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={creating}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('projectTree.cancelCreateProject')}
            </button>
            <button
              type="submit"
              disabled={!canCreate}
              className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-xs font-medium text-[var(--color-text-inverse)] transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[var(--color-accent-hover)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? t('projectTree.creatingProject') : t('projectTree.confirmCreateProject')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

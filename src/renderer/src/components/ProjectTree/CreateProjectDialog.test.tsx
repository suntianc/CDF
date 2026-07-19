import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateProjectDialog } from './CreateProjectDialog';

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'projectTree.createProjectTitle': 'Create project',
    'projectTree.createProjectDescription': 'Choose a local folder and Scene Workspace.',
    'projectTree.projectPathLabel': 'Folder',
    'projectTree.projectPathPlaceholder': 'Choose a local folder',
    'projectTree.chooseFolder': 'Choose folder',
    'projectTree.projectNameLabel': 'Project name',
    'projectTree.sceneLabel': 'Scene',
    'projectTree.sceneGeneralLabel': 'General',
    'projectTree.sceneGeneralDesc': 'Conversation workspace',
    'projectTree.sceneResearchLabel': 'Research',
    'projectTree.sceneResearchDesc': 'Research workspace',
    'projectTree.cancelCreateProject': 'Cancel',
    'projectTree.confirmCreateProject': 'Create',
    'projectTree.creatingProject': 'Creating...',
    'projectTree.createProjectFailed': 'Unable to create the project. Try again.',
    'projectTree.newProject': 'New project',
  };

  return {
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key,
    }),
  };
});

const dbApi = {
  selectDirectory: vi.fn(),
  createProject: vi.fn(),
};

const createdProject = {
  id: 'project-1',
  name: 'Research notes',
  path: '/tmp/research-notes',
  scene: 'research' as const,
  created_at: 1,
  updated_at: 1,
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof CreateProjectDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onProjectCreated = vi.fn();

  render(
    <CreateProjectDialog
      open
      onOpenChange={onOpenChange}
      onProjectCreated={onProjectCreated}
      {...overrides}
    />,
  );

  return { onOpenChange, onProjectCreated };
}

async function selectFolder() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
  await waitFor(() => {
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('research-notes');
  });
}

describe('CreateProjectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbApi.selectDirectory.mockResolvedValue('/tmp/research-notes');
    dbApi.createProject.mockResolvedValue(createdProject);
    Object.assign(window, { electronAPI: { db: dbApi } });
  });

  it('submits the selected Scene through the form and closes after creation', async () => {
    const { onOpenChange, onProjectCreated } = renderDialog();

    await selectFolder();
    fireEvent.click(screen.getByRole('radio', { name: /Research/ }));

    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(dbApi.createProject).toHaveBeenCalledWith('research-notes', '/tmp/research-notes', 'research');
    });
    expect(onProjectCreated).toHaveBeenCalledWith(createdProject);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open and describes a creation failure', async () => {
    dbApi.createProject.mockRejectedValue(new Error('disk unavailable'));
    const { onOpenChange } = renderDialog();

    await selectFolder();
    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to create the project. Try again.');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose folder' }).hasAttribute('disabled')).toBe(false);
  });
});

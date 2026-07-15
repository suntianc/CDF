import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTree } from './ProjectTree';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'projectTree.projectList': 'Projects',
    'projectTree.newProjectBtn': 'New project',
    'projectTree.noCustomProjects': 'No projects',
    'projectTree.tempSessions': 'Conversations',
    'projectTree.noHistorySessions': 'No conversations',
    'projectTree.noProjectSessions': 'No conversations',
    'projectTree.projectActions': 'Project actions',
    'projectTree.newChat': 'New chat',
    'projectTree.deleteSession': 'Delete session',
    'projectTree.renameProject': 'Rename',
    'projectTree.removeProject': 'Remove',
    'projectTree.createProjectTitle': 'Create project',
    'projectTree.createProjectDescription': 'Choose a folder and scene for this project.',
    'projectTree.projectPathLabel': 'Folder',
    'projectTree.chooseFolder': 'Choose folder',
    'projectTree.projectNameLabel': 'Project name',
    'projectTree.sceneLabel': 'Scene',
    'projectTree.sceneGeneralLabel': 'General',
    'projectTree.sceneGeneralDesc': 'Existing Conversation workspace.',
    'projectTree.sceneResearchLabel': 'Research',
    'projectTree.sceneResearchDesc': 'Conversation plus research workbench.',
    'projectTree.scene.research': 'Research scene',
    'projectTree.cancelCreateProject': 'Cancel',
    'projectTree.confirmCreateProject': 'Create',
  };

  return {
    useTranslation: () => ({
      t: (key: string, fallback?: string) => translations[key] ?? fallback ?? key,
    }),
  };
});

const dbApi = {
  getProjects: vi.fn(),
  getSessions: vi.fn(),
  selectDirectory: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
  deleteSession: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    taskPanelOpen: false,
    activeView: 'chat',
  });
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
  });

  dbApi.getProjects.mockResolvedValue([
    {
      id: 'default-project',
      name: 'Default',
      path: '/tmp/default-project',
      scene: 'general',
      created_at: 1,
      updated_at: 1,
    },
  ]);
  dbApi.getSessions.mockResolvedValue([]);
  dbApi.selectDirectory.mockResolvedValue('/tmp/cdf/research-lab');
  dbApi.createProject.mockResolvedValue({
    id: 'project-research',
    name: 'AI Papers',
    path: '/tmp/cdf/research-lab',
    scene: 'research',
    created_at: 2,
    updated_at: 2,
  });

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    db: dbApi,
  };
});

describe('ProjectTree Scene project creation', () => {
  it('creates a project from the dialog with the selected Scene persisted', async () => {
    render(<ProjectTree />);

    fireEvent.click(await screen.findByTitle('New project'));

    expect(screen.getByRole('heading', { name: 'Create project' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('research-lab');
    });

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'AI Papers' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Research/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(dbApi.createProject).toHaveBeenCalledWith(
        'AI Papers',
        '/tmp/cdf/research-lab',
        'research',
      );
    });
    expect(useProjectStore.getState().currentProjectId).toBe('project-research');
  });

  it('uses a blue academic icon for research projects', async () => {
    dbApi.getProjects.mockResolvedValue([
      {
        id: 'default-project',
        name: 'Default',
        path: '/tmp/default-project',
        scene: 'general',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'project-general',
        name: 'General Project',
        path: '/tmp/general-project',
        scene: 'general',
        created_at: 2,
        updated_at: 2,
      },
      {
        id: 'project-research',
        name: 'Research Project',
        path: '/tmp/research-project',
        isGit: true,
        scene: 'research',
        created_at: 3,
        updated_at: 3,
      },
      {
        id: 'project-unknown',
        name: 'Unknown Scene Project',
        path: '/tmp/unknown-scene-project',
        scene: 'archival' as never,
        created_at: 4,
        updated_at: 4,
      },
    ]);

    render(<ProjectTree />);

    expect(await screen.findByText('Research Project')).toBeTruthy();
    const sceneIcon = screen.getByTitle('Research scene');
    const svg = sceneIcon.querySelector('svg');

    expect(sceneIcon.tagName).toBe('SPAN');
    expect(svg?.getAttribute('class')).toContain('lucide-graduation-cap');
    expect(svg?.getAttribute('class')).toContain('w-4 h-4');
    expect(svg?.getAttribute('class')).toContain('text-[color-mix(in_srgb,var(--color-info)_72%,white)]');
    expect(svg?.getAttribute('class')).not.toContain('text-[var(--color-accent)]');
    expect(screen.queryByTitle('general')).toBeNull();
    expect(screen.queryByTitle('archival')).toBeNull();
  });

  it('expands a project without selecting it', async () => {
    useProjectStore.setState({ currentProjectId: 'default-project' });
    dbApi.getProjects.mockResolvedValue([
      {
        id: 'default-project',
        name: 'Default',
        path: '/tmp/default-project',
        scene: 'general',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'project-general',
        name: 'General Project',
        path: '/tmp/general-project',
        scene: 'general',
        created_at: 2,
        updated_at: 2,
      },
    ]);

    render(<ProjectTree />);

    fireEvent.click(await screen.findByText('General Project'));

    expect(useProjectStore.getState().currentProjectId).toBe('default-project');
  });
});

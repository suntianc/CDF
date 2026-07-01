import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { PluginsPanel } from './PluginsPanel';

describe('PluginsPanel Skills tab', () => {
  const getProjectSkillOverrides = vi.fn(async () => ({}));
  const setProjectSkillOverride = vi.fn(async () => ({ review: 'off' }));
  const storeGet = vi.fn(async () => ({}));
  const storeSet = vi.fn(async () => {});

  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    getProjectSkillOverrides.mockClear();
    setProjectSkillOverride.mockClear();
    storeGet.mockClear();
    storeSet.mockClear();
    getProjectSkillOverrides.mockResolvedValue({});
    setProjectSkillOverride.mockResolvedValue({ review: 'off' });
    storeGet.mockResolvedValue({});
    storeSet.mockResolvedValue(undefined);
    Object.assign(window, {
      electronAPI: {
        store: {
          get: storeGet,
          set: storeSet,
        },
        db: {
          getProjectSkillOverrides,
          setProjectSkillOverride,
          selectDirectory: vi.fn(async () => null),
          importSkillDirectory: vi.fn(async () => undefined),
        },
      },
    });
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'CDF Project', path: '/tmp/cdf' }],
      activeView: 'plugins',
      taskPanelOpen: false,
    });
    useSkillStore.setState({
      skills: [
        {
          id: 'project:review',
          name: 'review',
          qualifiedName: 'review',
          description: 'Project review workflow',
          scope: 'project',
          sourceKind: 'project',
          sourceLabel: 'Project Skill',
          resourceFiles: [],
          created_at: 0,
          updated_at: 0,
        },
        {
          id: 'global:teach',
          name: 'teach',
          qualifiedName: 'teach',
          description: 'Global teaching workflow',
          scope: 'global',
          sourceKind: 'user',
          sourceLabel: 'Global Skill',
          resourceFiles: [],
          created_at: 0,
          updated_at: 0,
        },
      ],
      isLoading: false,
      error: null,
      fetchSkills: vi.fn(async () => {}),
      deleteSkill: vi.fn(async () => {}),
    });
    useMcpServerStore.setState({
      mcpServers: [],
      isLoading: false,
      error: null,
    });
  });

  it('shows Project and Global Skills with source labels', () => {
    render(<PluginsPanel />);

    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.getByText('teach')).toBeTruthy();
    expect(screen.getByText('Project Skill')).toBeTruthy();
    expect(screen.getByText('Global Skill')).toBeTruthy();
  });

  it('uses resolved qualified names and source labels from the Skill catalog', () => {
    useSkillStore.setState({
      skills: [
        {
          id: 'project-additional:docs:review',
          name: 'review',
          qualifiedName: 'docs:review',
          description: 'Docs-specific review workflow',
          scope: 'project',
          sourceKind: 'project-additional',
          sourceLabel: 'Project Skill: docs',
          editable: false,
          resourceFiles: [],
          created_at: 0,
          updated_at: 0,
        },
      ],
    });

    render(<PluginsPanel />);

    expect(screen.getByText('docs:review')).toBeTruthy();
    expect(screen.getByText('Project Skill: docs')).toBeTruthy();
    expect(screen.queryByText('Project Skill')).toBeFalsy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeFalsy();
  });

  it('persists Project Skill Override from the Skills panel', async () => {
    render(<PluginsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /project override review off/i }));

    await waitFor(() => {
      expect(setProjectSkillOverride).toHaveBeenCalledWith('project-1', 'review', 'off');
    });
    expect(screen.getByText('Effective: Off · Project override')).toBeTruthy();
  });

  it('persists Project Skill Override on as an explicit project policy', async () => {
    setProjectSkillOverride.mockResolvedValueOnce({ review: 'on' });
    render(<PluginsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /project override review on/i }));

    await waitFor(() => {
      expect(setProjectSkillOverride).toHaveBeenCalledWith('project-1', 'review', 'on');
    });
    expect(screen.getByText('Effective: On · Project override')).toBeTruthy();
  });

  it('persists User Skill Override as local personal policy', async () => {
    render(<PluginsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /user override teach manual only/i }));

    await waitFor(() => {
      expect(storeSet).toHaveBeenCalledWith('skillOverrides', {
        teach: 'user-invocable-only',
      });
    });
    expect(setProjectSkillOverride).not.toHaveBeenCalled();
    expect(screen.getByText('Effective: Manual only · User override')).toBeTruthy();
  });

  it('persists User Skill Override on as an explicit user policy', async () => {
    render(<PluginsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /user override teach on/i }));

    await waitFor(() => {
      expect(storeSet).toHaveBeenCalledWith('skillOverrides', {
        teach: 'on',
      });
    });
    expect(setProjectSkillOverride).not.toHaveBeenCalled();
    expect(screen.getByText('Effective: On · User override')).toBeTruthy();
  });

  it('shows Project Override as the winning layer over User Override', async () => {
    getProjectSkillOverrides.mockResolvedValue({ teach: 'name-only' });
    storeGet.mockResolvedValue({ teach: 'off' });

    render(<PluginsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Effective: Name-only · Project override')).toBeTruthy();
    });
  });
});

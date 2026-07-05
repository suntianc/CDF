import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      projects: [{ id: 'project-1', name: 'CDF Project', path: '/tmp/cdf', scene: 'general' }],
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
          shadowedSkills: [
            {
              name: 'review',
              qualifiedName: 'review',
              sourceKind: 'built-in',
              sourceLabel: 'Built-in Skill',
              sourcePath: '/tmp/built-in-skills',
              skillPath: '/tmp/built-in-skills/review/SKILL.md',
            },
          ],
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
          userInvocable: false,
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
    expect(screen.getByText('Shadows 1 same-name Skill')).toBeTruthy();
    expect(screen.getByText('Not available in slash invocation')).toBeTruthy();
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

    fireEvent.click(screen.getByLabelText(/project level review visibility/i));
    fireEvent.click(screen.getByText('Off'));

    await waitFor(() => {
      expect(setProjectSkillOverride).toHaveBeenCalledWith('project-1', 'review', 'off');
    });
    expect(screen.queryByText(/Effective:/)).toBeNull();
  });

  it('persists Project Skill Override on as an explicit project policy', async () => {
    setProjectSkillOverride.mockResolvedValueOnce({ review: 'on' });
    render(<PluginsPanel />);

    const projectSelect = screen.getByLabelText(/project level review visibility/i);
    fireEvent.click(projectSelect);
    fireEvent.click(within(projectSelect.parentElement as HTMLElement).getAllByText('On')[1]);

    await waitFor(() => {
      expect(setProjectSkillOverride).toHaveBeenCalledWith('project-1', 'review', 'on');
    });
    expect(screen.queryByText(/Effective:/)).toBeNull();
  });

  it('persists User Skill Override as local personal policy', async () => {
    render(<PluginsPanel />);

    fireEvent.click(screen.getByLabelText(/user level teach visibility/i));
    fireEvent.click(screen.getByText('Manual only'));

    await waitFor(() => {
      expect(storeSet).toHaveBeenCalledWith('skillOverrides', {
        teach: 'user-invocable-only',
      });
    });
    expect(setProjectSkillOverride).not.toHaveBeenCalled();
    expect(screen.queryByText(/Effective:/)).toBeNull();
  });

  it('persists User Skill Override on as an explicit user policy', async () => {
    render(<PluginsPanel />);

    const userSelect = screen.getByLabelText(/user level teach visibility/i);
    fireEvent.click(userSelect);
    fireEvent.click(within(userSelect.parentElement as HTMLElement).getAllByText('On')[1]);

    await waitFor(() => {
      expect(storeSet).toHaveBeenCalledWith('skillOverrides', {
        teach: 'on',
      });
    });
    expect(setProjectSkillOverride).not.toHaveBeenCalled();
    expect(screen.queryByText(/Effective:/)).toBeNull();
  });

  it('shows Project level as the winning layer over User level', async () => {
    getProjectSkillOverrides.mockResolvedValue({ teach: 'name-only' });
    storeGet.mockResolvedValue({ teach: 'off' });

    render(<PluginsPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText(/project level teach visibility/i).textContent).toContain('Name-only');
    });
  });

  it('shows level help tooltips for Skill Override controls', () => {
    render(<PluginsPanel />);

    expect(screen.getAllByLabelText(/project level help/i)[0]).toBeTruthy();
    expect(screen.getAllByLabelText(/user level help/i)[0]).toBeTruthy();
    const tooltips = screen.getAllByRole('tooltip', { hidden: true });
    expect(tooltips.some(tooltip => tooltip.textContent?.includes('project Skills config'))).toBe(true);
    expect(tooltips.some(tooltip => tooltip.textContent?.includes('stored locally'))).toBe(true);
  });
});

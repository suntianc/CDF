import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import type { GlobalSkillReference, SceneSkillExposure } from '../../../../shared/skills';
import { PluginsPanel } from './PluginsPanel';

describe('PluginsPanel Skills tab', () => {
  const getGlobalSceneExposure = vi.fn(async (
    skill: GlobalSkillReference,
  ): Promise<SceneSkillExposure> => ({
    skill,
    exposures: { general: true, research: true },
  }));
  const setGlobalSceneExposure = vi.fn(async (
    skill: GlobalSkillReference,
    sceneId: string,
    exposed: boolean,
  ): Promise<SceneSkillExposure> => ({
    skill,
    exposures: {
      general: sceneId === 'general' ? exposed : true,
      research: sceneId === 'research' ? exposed : true,
    },
  }));

  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    getGlobalSceneExposure.mockClear();
    setGlobalSceneExposure.mockClear();
    getGlobalSceneExposure.mockImplementation(async (skill) => ({
      skill,
      exposures: { general: true, research: true },
    }));
    setGlobalSceneExposure.mockImplementation(async (skill, sceneId, exposed) => ({
      skill,
      exposures: {
        general: sceneId === 'general' ? exposed : true,
        research: sceneId === 'research' ? exposed : true,
      },
    }));
    Object.assign(window, {
      electronAPI: {
        skills: { getGlobalSceneExposure, setGlobalSceneExposure },
        db: {
          getGlobalSkills: vi.fn(async () => useSkillStore.getState().skills.filter(
            (skill) => skill.sourceKind === 'built-in' || skill.sourceKind === 'user',
          )),
          selectDirectory: vi.fn(async () => null),
          importSkillDirectory: vi.fn(async () => undefined),
        },
      },
    });
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'CDF Project', path: '/tmp/cdf', scene: 'general', created_at: 0, updated_at: 0 }],
      activeView: 'plugins',
      taskPanelOpen: false,
    });
    useSkillStore.setState({
      skills: [
        {
          id: 'built-in:knowledge-base', name: 'knowledge-base', qualifiedName: 'knowledge-base',
          description: 'Built-in workflow', scope: 'global', sourceKind: 'built-in', sourceLabel: 'Built-in Skill',
          resourceFiles: [], created_at: 0, updated_at: 0,
        },
        {
          id: 'global:teach', name: 'teach', qualifiedName: 'teach',
          description: 'Global teaching workflow', scope: 'global', sourceKind: 'user', sourceLabel: 'Global Skill',
          resourceFiles: [], created_at: 0, updated_at: 0,
        },
        {
          id: 'project:review', name: 'review', qualifiedName: 'review',
          description: 'Project review workflow', scope: 'project', sourceKind: 'project', sourceLabel: 'Project Skill',
          resourceFiles: [], created_at: 0, updated_at: 0,
        },
        {
          id: 'project-nested:apps:lint', name: 'lint', qualifiedName: 'apps:lint',
          description: 'Nested project workflow', scope: 'project', sourceKind: 'project-nested', sourceLabel: 'Nested Project Skill',
          resourceFiles: [], created_at: 0, updated_at: 0,
        },
        {
          id: 'project-additional:docs:docs-review', name: 'docs-review', qualifiedName: 'docs:docs-review',
          description: 'Additional project workflow', scope: 'project', sourceKind: 'project-additional', sourceLabel: 'Project Skill: docs',
          resourceFiles: [], created_at: 0, updated_at: 0,
        },
      ],
      isLoading: false,
      error: null,
      fetchSkills: vi.fn(async () => {}),
      deleteSkill: vi.fn(async () => {}),
    });
    useMcpServerStore.setState({ mcpServers: [], isLoading: false, error: null });
  });

  it('lists only Global Skills and omits every Project Skill source', async () => {
    render(<PluginsPanel />);

    await waitFor(() => expect(screen.getByText('knowledge-base')).toBeTruthy());
    expect(screen.getByText('teach')).toBeTruthy();
    expect(screen.queryByText('review')).toBeNull();
    expect(screen.queryByText('apps:lint')).toBeNull();
    expect(screen.queryByText('docs:docs-review')).toBeNull();
    expect(screen.getByText('Skills list (2)')).toBeTruthy();
    expect(screen.queryByText(/Project level|User level/)).toBeNull();
  });

  it('renders every registered Scene switch and persists a Global Skill exposure change', async () => {
    render(<PluginsPanel />);

    const researchSwitch = await screen.findByRole('switch', {
      name: 'knowledge-base exposure in Research',
    });
    expect(screen.getByRole('switch', { name: 'knowledge-base exposure in General' })).toBeTruthy();
    expect(researchSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(researchSwitch);

    await waitFor(() => {
      expect(setGlobalSceneExposure).toHaveBeenCalledWith(
        { sourceKind: 'built-in', name: 'knowledge-base' },
        'research',
        false,
      );
    });
    await waitFor(() => {
      expect(researchSwitch.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('explains that Scene exposure applies to new Conversations, not existing snapshots', async () => {
    render(<PluginsPanel />);

    expect(await screen.findByText(/existing Conversations keep their captured scope/i)).toBeTruthy();
    expect(screen.getByText(/discovery only/i)).toBeTruthy();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSkillStore } from '../../stores/skillStore';
import { AgentEditDialog } from './AgentEditDialog';

describe('AgentEditDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'CDF Project', path: '/tmp/cdf', scene: 'general' }],
      activeView: 'agents',
      taskPanelOpen: false,
    });
    useAgentStore.setState({
      agents: [],
      isLoading: false,
      error: null,
      saveAgent: vi.fn(async () => {}),
    });
    useLLMStore.setState({
      providers: [
        {
          id: 'provider-1',
          name: 'Local model',
          provider_type: 'ollama',
          default_model: 'llama3',
          context_limit: 8192,
          is_active: 1,
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProvider: null,
      isLoading: false,
      error: null,
    });
    useSkillStore.setState({
      skills: [
        {
          id: 'project:review',
          name: 'review',
          description: 'Review workflow',
          scope: 'project',
          resourceFiles: [],
          created_at: 0,
          updated_at: 0,
        },
      ],
      isLoading: false,
      error: null,
    });
    useMcpServerStore.setState({
      mcpServers: [],
      isLoading: false,
      error: null,
    });
  });

  it('describes Agent Skills as preload instead of access bindings', () => {
    const { container } = render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByText(/Preload Skills/)).toBeTruthy();
    expect(screen.getByText(/loads full instructions at startup/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Bind Skills|Skills bindings/);
  });

  it('offers Project Skills as preload candidates', () => {
    render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Manage Skill preload'));

    const preloadCandidate = screen.getByRole('button', { name: /preload review/i });
    expect(preloadCandidate).toBeTruthy();
    expect(preloadCandidate.textContent).toContain('Project Skill');
  });

  it('saves MCP Server Exclusions from the default-visible controls', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });
    useMcpServerStore.setState({
      mcpServers: [
        {
          id: 'github',
          name: 'GitHub',
          server_type: 'stdio',
          config: {},
          is_connected: true,
          created_at: 0,
          updated_at: 0,
        },
        {
          id: 'arxiv',
          name: 'arXiv',
          server_type: 'stdio',
          config: {},
          is_connected: true,
          created_at: 0,
          updated_at: 0,
        },
      ],
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'MCP Agent' },
    });
    fireEvent.click(screen.getByLabelText('GitHub visible to this Agent'));
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'MCP Agent',
      mcpServerExclusionIds: ['github'],
    }));
    expect(container.textContent).toContain('MCP servers visible');
    expect(container.textContent).toContain('Excluded');
  });

  it('uses resolved qualified names and source labels for preload and override controls', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });
    useSkillStore.setState({
      skills: [
        {
          id: 'project-additional:docs:review',
          name: 'review',
          qualifiedName: 'docs:review',
          description: 'Docs review workflow',
          scope: 'project',
          sourceKind: 'project-additional',
          sourceLabel: 'Project Skill: docs',
          resourceFiles: [],
          created_at: 0,
          updated_at: 0,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Docs Review Agent' },
    });
    fireEvent.click(screen.getByText('Manage Skill preload'));

    const preloadCandidate = screen.getByRole('button', { name: /preload docs:review/i });
    expect(preloadCandidate.textContent).toContain('docs:review');
    expect(preloadCandidate.textContent).toContain('Project Skill: docs');
    fireEvent.click(preloadCandidate);

    const overrideGroup = screen.getByRole('group', { name: /docs:review visibility override/i });
    expect(overrideGroup.parentElement?.textContent).toContain('docs:review');
    expect(overrideGroup.parentElement?.textContent).toContain('Project Skill: docs');
    fireEvent.click(screen.getByText('Off'));
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Docs Review Agent',
      skillNames: ['project-additional:docs:review'],
      config: expect.objectContaining({
        skillOverrides: {
          'docs:review': 'off',
        },
      }),
    }));
  });

  it('persists Agent Skill Override state separately from preload choices', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });

    render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Review Agent' },
    });
    fireEvent.click(screen.getByText('On'));
    fireEvent.click(screen.getByText('Off'));
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Review Agent',
      skillNames: [],
      config: expect.objectContaining({
        skillOverrides: {
          review: 'off',
        },
      }),
    }));
  });

  it('persists Agent Skill Override on as an explicit winning state', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });

    render(
      <AgentEditDialog
        isOpen
        agentId={null}
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Review Agent' },
    });
    fireEvent.click(screen.getByText('Off'));
    fireEvent.click(screen.getByText('On'));
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Review Agent',
      config: expect.objectContaining({
        skillOverrides: {
          review: 'on',
        },
      }),
    }));
  });
});

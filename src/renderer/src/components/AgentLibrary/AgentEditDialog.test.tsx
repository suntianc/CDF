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
      projects: [{ id: 'project-1', name: 'CDF Project', path: '/tmp/cdf', scene: 'general' , created_at: 0, updated_at: 0 }],
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

  it('uses resolved qualified names and source labels for Project Skill preload only', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });
    useSkillStore.setState({
      skills: [{
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
      }],
      isLoading: false,
      error: null,
    });

    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Docs Review Agent' },
    });
    fireEvent.click(screen.getByText('Manage Skill preload'));
    const preloadCandidate = screen.getByRole('button', { name: /preload docs:review/i });
    expect(preloadCandidate.textContent).toContain('Project Skill: docs');
    fireEvent.click(preloadCandidate);
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Docs Review Agent',
      skillNames: ['project-additional:docs:review'],
      config: expect.not.objectContaining({ skillOverrides: expect.anything() }),
    }));
  });

  it('removes all Skill Override controls and explanatory copy', () => {
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    expect(screen.queryByText(/Agent Skill Overrides/i)).toBeNull();
    expect(screen.queryByText(/visibility override/i)).toBeNull();
    expect(screen.queryByText('On')).toBeNull();
    expect(screen.queryByText('Name only')).toBeNull();
    expect(screen.queryByText('User only')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('lets Master edit and reset only the complete prompt, with changes scoped to new Conversations', () => {
    const saveAgent = vi.fn(async () => {});
    const resetMasterAgentPrompt = vi.fn(async () => {});
    useAgentStore.setState({
      agents: [{
        id: 'master-1',
        project_id: 'project-1',
        name: 'Master Agent',
        slug: 'master-agent',
        role: 'master',
        is_protected: true,
        description: 'Project Master Agent',
        provider_id: undefined,
        system_prompt: 'General complete prompt',
        config: { toolScope: { mode: 'inherit' } },
        is_default: 1,
        mcpServerExclusionIds: [],
        skillNames: [],
        created_at: 0,
        updated_at: 0,
      }],
      saveAgent,
      resetMasterAgentPrompt,
    });

    render(
      <AgentEditDialog
        isOpen
        agentId="master-1"
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByText(/only the complete prompt can be changed/i)).toBeTruthy();
    expect(screen.getByText(/Prompt changes apply only to new Conversations/i)).toBeTruthy();
    expect(screen.queryByText('Runtime safety configuration')).toBeNull();
    expect((screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/Enter detailed system prompt/i), {
      target: { value: 'Edited complete prompt' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(saveAgent).toHaveBeenCalledWith({
      id: 'master-1',
      project_id: 'project-1',
      system_prompt: 'Edited complete prompt',
    });

    fireEvent.click(screen.getByRole('button', { name: /Reset to Scene default/i }));
    expect(resetMasterAgentPrompt).toHaveBeenCalledWith('project-1');
  });

  it('shows the protected General-purpose identity and inherited model selection', () => {
    useAgentStore.setState({
      agents: [{
        id: 'general-1',
        project_id: 'project-1',
        name: 'General-purpose',
        slug: 'general-purpose',
        is_protected: true,
        provider_id: undefined,
        is_default: 0,
        created_at: 0,
        updated_at: 0,
      }],
    });

    render(
      <AgentEditDialog
        isOpen
        agentId="general-1"
        onClose={vi.fn()}
        showToast={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);
    expect(screen.getAllByText(/protected Project Agent/i)).toHaveLength(2);
    expect(screen.getByText(/inherits the invoking Agent's model/i)).toBeTruthy();
  });

  it('saves an explicitly narrowed built-in and MCP tool scope independently from Skills', () => {
    const saveAgent = vi.fn(async () => {});
    useAgentStore.setState({ saveAgent });
    useMcpServerStore.setState({
      mcpServers: [{
        id: 'github',
        name: 'GitHub',
        server_type: 'stdio',
        config: {},
        is_connected: true,
        created_at: 0,
        updated_at: 0,
      }],
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
      target: { value: 'Scoped Agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Explicitly narrow/i }));
    fireEvent.click(screen.getByLabelText(/Allow bash/i));
    fireEvent.click(screen.getByLabelText(/Allow GitHub MCP server/i));
    fireEvent.click(screen.getByText('Save'));

    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        toolScope: {
          mode: 'narrow',
          builtInTools: ['bash'],
          mcpServerIds: ['github'],
        },
      }),
    }));
  });
});

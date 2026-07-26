import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAISubscriptionEntries } from '@shared/ai-subscriptions';
import i18n from '../../i18n';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useSkillStore } from '../../stores/skillStore';
import { AgentEditDialog } from './AgentEditDialog';

const globalSkill = {
  id: 'global:review', name: 'review', description: 'Review workflow', scope: 'global' as const,
  sourceKind: 'user' as const, sourceLabel: 'Global Skill', resourceFiles: [], created_at: 0, updated_at: 0,
};

beforeEach(async () => {
  await i18n.changeLanguage('en-US');
  useAgentStore.setState({
    agents: [], masterScenePrompts: [], isLoading: false, error: null,
    isMasterPromptsLoading: false, masterPromptsError: null,
    createCustomAgent: vi.fn(async () => {}),
    updateCustomAgent: vi.fn(async () => {}),
    updateGeneralPurposeAgent: vi.fn(async () => {}),
    fetchMasterScenePrompts: vi.fn(async () => {}),
    saveMasterScenePrompts: vi.fn(async () => {}),
    deleteCustomAgent: vi.fn(async () => {}),
  });
  useLLMStore.setState({
    providers: [{
      id: 'provider-1', name: 'Local model', provider_type: 'ollama', default_model: 'llama3',
      context_limit: 8192, is_active: 1, created_at: 0, updated_at: 0,
    }], activeProvider: null, isLoading: false, error: null,
  });
  useAISubscriptionStore.setState({ entries: [], isLoading: false, error: null, loginDescriptors: {} });
  useSkillStore.setState({ skills: [globalSkill], isLoading: false, error: null });
  useMcpServerStore.setState({ mcpServers: [], isLoading: false, error: null });
});

describe('AgentEditDialog', () => {
  it('only offers Global Skills as preload candidates', () => {
    useSkillStore.setState({
      skills: [globalSkill, {
        id: 'project:review', name: 'project-review', description: 'Project workflow', scope: 'project',
        sourceKind: 'project', sourceLabel: 'Project Skill', resourceFiles: [], created_at: 0, updated_at: 0,
      }],
    });
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    fireEvent.click(screen.getByText('Manage Skill preload'));

    expect(screen.getByRole('button', { name: /preload review/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /preload project-review/i })).toBeNull();
  });

  it('hydrates a new Custom Agent model after sources finish loading without resetting its draft', () => {
    const createCustomAgent = vi.fn(async () => {});
    useLLMStore.setState({ providers: [], activeProvider: null });
    useAISubscriptionStore.setState({ entries: [] });
    useAgentStore.setState({ createCustomAgent });

    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);
    const nameInput = screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Late Source Agent' } });

    act(() => useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connected' } },
      }),
    }));

    expect(nameInput.value).toBe('Late Source Agent');
    expect(screen.getByRole('button', { name: /GPT-5\.6 Sol.*Balanced/ })).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(createCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Late Source Agent',
      provider_id: null,
      config: expect.objectContaining({
        modelSource: 'ai_subscription', sourceId: 'codex-oauth', model: 'gpt-5.6-sol',
      }),
    }));
  });

  it('waits for all model sources before choosing the default for a new Custom Agent', () => {
    useLLMStore.setState({ providers: [], activeProvider: null, isLoading: true });
    useAISubscriptionStore.setState({ entries: [], isLoading: true });

    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    act(() => useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connected' } },
      }),
      isLoading: false,
    }));
    expect(screen.getByRole('button', { name: 'Select model' })).toBeTruthy();

    act(() => useLLMStore.setState({
      providers: [{
        id: 'provider-late', name: 'Late local model', provider_type: 'ollama', default_model: 'llama3',
        context_limit: 8192, is_active: 1, created_at: 0, updated_at: 1,
      }],
      isLoading: false,
    }));
    expect(screen.getByRole('button', { name: 'llama3' })).toBeTruthy();
  });

  it('creates a Custom Agent without a Project transport field', () => {
    const createCustomAgent = vi.fn(async () => {});
    useAgentStore.setState({ createCustomAgent });
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    expect((screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Review Agent' },
    });
    fireEvent.click(screen.getByText('Manage Skill preload'));
    fireEvent.click(screen.getByRole('button', { name: /preload review/i }));
    fireEvent.click(screen.getByText('Save'));

    expect(createCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Review Agent', skillNames: ['global:review'],
    }));
    expect((createCustomAgent as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).not.toHaveProperty('project_id');
  });

  it('keeps General-purpose identity protected while saving its capability configuration', () => {
    const updateGeneralPurposeAgent = vi.fn(async () => {});
    useAgentStore.setState({
      agents: [{
        id: 'general-1', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose',
        provider_id: undefined, system_prompt: 'Delegate safely', config: { toolScope: { mode: 'inherit' } },
        created_at: 0, updated_at: 0,
      }],
      updateGeneralPurposeAgent,
    });
    render(<AgentEditDialog isOpen agentId="general-1" onClose={vi.fn()} showToast={vi.fn()} />);

    const nameInput = screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);
    expect(screen.getByText(/inherits the invoking Agent's model/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(updateGeneralPurposeAgent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ toolScope: { mode: 'inherit' } }),
    }));
  });

  it('offers connected AI subscription models as Agent LLM choices', () => {
    useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connected' } },
      }),
    });
    useAgentStore.setState({
      agents: [{
        id: 'general-1', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose',
        provider_id: undefined, system_prompt: 'Delegate safely', config: { toolScope: { mode: 'inherit' } },
        created_at: 0, updated_at: 0,
      }],
    });

    render(<AgentEditDialog isOpen agentId="general-1" onClose={vi.fn()} showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inherit invoking Agent model' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    expect(screen.getByRole('option', { name: 'Codex OAuth • GPT-5.6 Sol' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Codex OAuth • GPT-5.6 Terra' })).toBeTruthy();
  });

  it('preserves unsaved Agent fields and an unavailable model selection after refreshing config', async () => {
    const updateGeneralPurposeAgent = vi.fn(async () => {});
    const connectedEntries = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const fetchEntries = vi.fn(async () => {
      useAISubscriptionStore.setState({
        entries: buildAISubscriptionEntries({
          entries: { 'codex-oauth': { status: 'logged_out' } },
        }),
      });
    });
    useAISubscriptionStore.setState({ entries: connectedEntries, fetchEntries });
    useLLMStore.setState({ fetchProviders: vi.fn(async () => {}) });
    useAgentStore.setState({
      agents: [{
        id: 'general-1', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose',
        provider_id: undefined, system_prompt: 'Delegate safely',
        description: 'Saved description',
        config: {
          modelSource: 'ai_subscription', sourceId: 'codex-oauth', model: 'gpt-5.6-sol',
          toolScope: { mode: 'inherit' },
        },
        created_at: 0, updated_at: 0,
      }],
      updateGeneralPurposeAgent,
    });

    render(<AgentEditDialog isOpen agentId="general-1" onClose={vi.fn()} showToast={vi.fn()} />);
    const description = screen.getByPlaceholderText(/Brief description/i) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: 'Unsaved description' } });
    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh config' }));

    await waitFor(() => expect(fetchEntries).toHaveBeenCalledOnce());
    expect(description.value).toBe('Unsaved description');
    expect(screen.getByRole('menu', { name: 'gpt-5.6-sol' })).toBeTruthy();

    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByText('Save'));
    expect(updateGeneralPurposeAgent).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Unsaved description',
      provider_id: null,
      config: expect.objectContaining({
        modelSource: 'ai_subscription',
        sourceId: 'codex-oauth',
        model: 'gpt-5.6-sol',
      }),
    }));
  });

  it('persists an Agent AI subscription selection for delegated runtime resolution', () => {
    const updateGeneralPurposeAgent = vi.fn(async () => {});
    useAISubscriptionStore.setState({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connected' } },
      }),
    });
    useAgentStore.setState({
      agents: [{
        id: 'general-1', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose',
        provider_id: undefined, system_prompt: 'Delegate safely', config: { toolScope: { mode: 'inherit' } },
        created_at: 0, updated_at: 0,
      }],
      updateGeneralPurposeAgent,
    });

    render(<AgentEditDialog isOpen agentId="general-1" onClose={vi.fn()} showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inherit invoking Agent model' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: 'Codex OAuth • GPT-5.6 Sol' }));
    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol.*Balanced/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Reasoning depth/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deep' }));
    fireEvent.click(screen.getByText('Save'));

    expect(updateGeneralPurposeAgent).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: null,
      config: expect.objectContaining({
        modelSource: 'ai_subscription',
        sourceId: 'codex-oauth',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      }),
    }));
  });

  it('keeps independent Master Scene drafts, resets only the active draft, and saves atomically', () => {
    const saveMasterScenePrompts = vi.fn(async () => {});
    const prompts = [
      { scene: 'general' as const, systemPrompt: 'Saved general', defaultSystemPrompt: 'Default general' },
      { scene: 'research' as const, systemPrompt: 'Saved research', defaultSystemPrompt: 'Default research' },
    ];
    useAgentStore.setState({
      agents: [{ id: 'master-1', role: 'master', name: 'Master Agent', slug: 'master-agent', created_at: 0, updated_at: 0 }],
      masterScenePrompts: prompts,
      fetchMasterScenePrompts: vi.fn(async () => {}),
      saveMasterScenePrompts,
    });
    render(<AgentEditDialog isOpen agentId="master-1" onClose={vi.fn()} showToast={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Enter detailed system prompt/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Draft general' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    fireEvent.change(textarea, { target: { value: 'Draft research' } });
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(textarea.value).toBe('Draft general');
    fireEvent.click(screen.getByRole('button', { name: /Reset to Scene default/i }));
    expect(textarea.value).toBe('Default general');
    fireEvent.click(screen.getByText('Save'));

    expect(saveMasterScenePrompts).toHaveBeenCalledWith([
      { scene: 'general', systemPrompt: 'Default general' },
      { scene: 'research', systemPrompt: 'Draft research' },
    ]);
  });

  it('shows Master prompt loading and prevents an empty save', () => {
    const saveMasterScenePrompts = vi.fn(async () => {});
    useAgentStore.setState({
      agents: [{ id: 'master-1', role: 'master', name: 'Master Agent', slug: 'master-agent', created_at: 0, updated_at: 0 }],
      masterScenePrompts: [],
      isMasterPromptsLoading: true,
      fetchMasterScenePrompts: vi.fn(async () => {}),
      saveMasterScenePrompts,
    });

    render(<AgentEditDialog isOpen agentId="master-1" onClose={vi.fn()} showToast={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toMatch(/Loading General and Research prompts/i);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveMasterScenePrompts).not.toHaveBeenCalled();
  });

  it('keeps cached Master prompts read-only when refresh fails', () => {
    useAgentStore.setState({
      agents: [{ id: 'master-1', role: 'master', name: 'Master Agent', slug: 'master-agent', created_at: 0, updated_at: 0 }],
      masterScenePrompts: [
        { scene: 'general', systemPrompt: 'Cached general', defaultSystemPrompt: 'Default general' },
        { scene: 'research', systemPrompt: 'Cached research', defaultSystemPrompt: 'Default research' },
      ],
      isMasterPromptsLoading: false,
      masterPromptsError: 'refresh failed',
      fetchMasterScenePrompts: vi.fn(async () => {}),
    });

    render(<AgentEditDialog isOpen agentId="master-1" onClose={vi.fn()} showToast={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i);
    expect((screen.getByPlaceholderText(/Enter detailed system prompt/i) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('discards all unsaved Master Scene drafts when cancelled', () => {
    const prompts = [
      { scene: 'general' as const, systemPrompt: 'Saved general', defaultSystemPrompt: 'Default general' },
      { scene: 'research' as const, systemPrompt: 'Saved research', defaultSystemPrompt: 'Default research' },
    ];
    useAgentStore.setState({
      agents: [{ id: 'master-1', role: 'master', name: 'Master Agent', slug: 'master-agent', created_at: 0, updated_at: 0 }],
      masterScenePrompts: prompts,
      fetchMasterScenePrompts: vi.fn(async () => {}),
    });
    const onClose = vi.fn();
    const view = render(<AgentEditDialog isOpen agentId="master-1" onClose={onClose} showToast={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Enter detailed system prompt/i), {
      target: { value: 'Unsaved general' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(<AgentEditDialog isOpen={false} agentId="master-1" onClose={onClose} showToast={vi.fn()} />);
    view.rerender(<AgentEditDialog isOpen agentId="master-1" onClose={onClose} showToast={vi.fn()} />);
    expect((screen.getByPlaceholderText(/Enter detailed system prompt/i) as HTMLTextAreaElement).value)
      .toBe('Saved general');
  });

  // #236 safety net: pin form hydration, tool-scope/MCP interactions and
  // validation behavior before consolidating the form state into a reducer.
  const mcpServer = (id: string, name: string) => ({
    id, name, server_type: 'stdio' as const, config: {}, is_connected: true, created_at: 0, updated_at: 0,
  });

  it('hydrates an existing Custom Agent form and saves the unchanged configuration back', () => {
    const updateCustomAgent = vi.fn(async () => {});
    useMcpServerStore.setState({ mcpServers: [mcpServer('mcp-alpha', 'alpha')] });
    useAgentStore.setState({
      agents: [{
        id: 'custom-1', role: 'custom', name: 'Review Agent', slug: 'review-agent',
        description: 'Reviews PRs', provider_id: 'provider-1', system_prompt: 'Review carefully',
        mcpServerExclusionIds: ['mcp-alpha'], skillNames: ['global:review'],
        config: {
          modelSource: 'llm_provider', sourceId: 'provider-1', model: 'llama3',
          toolScope: { mode: 'narrow', builtInTools: ['read_file', 'grep'], mcpServerIds: ['mcp-alpha'] },
        },
        created_at: 0, updated_at: 0,
      }],
      updateCustomAgent,
    });

    render(<AgentEditDialog isOpen agentId="custom-1" onClose={vi.fn()} showToast={vi.fn()} />);

    expect((screen.getByPlaceholderText(/Full-stack refactoring assistant/i) as HTMLInputElement).value).toBe('Review Agent');
    expect((screen.getByPlaceholderText(/Brief description/i) as HTMLTextAreaElement).value).toBe('Reviews PRs');
    expect((screen.getByPlaceholderText(/Enter detailed system prompt/i) as HTMLTextAreaElement).value).toBe('Review carefully');
    expect((screen.getByRole('checkbox', { name: 'Allow read_file' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Allow write_todos' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Allow alpha MCP server' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'alpha visible to this Agent' }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByText('Save'));

    expect(updateCustomAgent).toHaveBeenCalledWith('custom-1', expect.objectContaining({
      name: 'Review Agent',
      description: 'Reviews PRs',
      provider_id: 'provider-1',
      system_prompt: 'Review carefully',
      mcpServerExclusionIds: ['mcp-alpha'],
      skillNames: ['global:review'],
      config: expect.objectContaining({
        modelSource: 'llm_provider', sourceId: 'provider-1', model: 'llama3',
        toolScope: { mode: 'narrow', builtInTools: ['read_file', 'grep'], mcpServerIds: ['mcp-alpha'] },
      }),
    }));
  });

  it('saves a narrow tool scope assembled through the checkbox controls', () => {
    const createCustomAgent = vi.fn(async () => {});
    useMcpServerStore.setState({ mcpServers: [mcpServer('mcp-alpha', 'alpha')] });
    useAgentStore.setState({ createCustomAgent });
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Scoped Agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use selected tools only' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow write_todos' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow alpha MCP server' }));
    fireEvent.click(screen.getByText('Save'));

    expect(createCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        toolScope: { mode: 'narrow', builtInTools: ['write_todos'], mcpServerIds: ['mcp-alpha'] },
      }),
    }));
  });

  it('excludes MCP servers via the visibility toggles and filters them by search', () => {
    const createCustomAgent = vi.fn(async () => {});
    useMcpServerStore.setState({ mcpServers: [mcpServer('mcp-alpha', 'alpha'), mcpServer('mcp-beta', 'beta')] });
    useAgentStore.setState({ createCustomAgent });
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    expect(screen.getByText('MCP servers visible (2/2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'alpha visible to this Agent' }));
    expect(screen.getByText('MCP servers visible (1/2)')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), { target: { value: 'be' } });
    expect(screen.queryByRole('checkbox', { name: 'alpha visible to this Agent' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'beta visible to this Agent' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Filter Agent' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(createCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      mcpServerExclusionIds: ['mcp-alpha'],
    }));
  });

  it('rejects a blank name, a non-English name, and a missing model source', () => {
    const createCustomAgent = vi.fn(async () => {});
    const showToast = vi.fn();
    useAgentStore.setState({ createCustomAgent });
    const view = render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={showToast} />);

    // A fully empty name is already blocked by the input's native `required`;
    // the store-level guard fires for whitespace-only names.
    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(showToast).toHaveBeenLastCalledWith('Agent name cannot be empty', 'error');

    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: '评审代理' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(showToast).toHaveBeenLastCalledWith(
      'Agent name must use English (may include digits, spaces, hyphens or underscores)',
      'error',
    );
    expect(createCustomAgent).not.toHaveBeenCalled();
    view.unmount();

    useLLMStore.setState({ providers: [], activeProvider: null });
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={showToast} />);
    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'No Source Agent' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(showToast).toHaveBeenLastCalledWith(
      "Please add and activate an LLM brain on the 'Model config' page first!",
      'error',
    );
    expect(createCustomAgent).not.toHaveBeenCalled();
  });

  it('clears the skill search query when the dropdown closes', () => {
    render(<AgentEditDialog isOpen agentId={null} onClose={vi.fn()} showToast={vi.fn()} />);

    fireEvent.click(screen.getByText('Manage Skill preload'));
    fireEvent.change(screen.getByPlaceholderText('Search skills...'), { target: { value: 'rev' } });
    fireEvent.click(screen.getByText('Manage Skill preload'));
    fireEvent.click(screen.getByText('Manage Skill preload'));

    expect((screen.getByPlaceholderText('Search skills...') as HTMLInputElement).value).toBe('');
  });
});

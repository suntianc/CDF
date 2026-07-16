import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSkillStore } from '../../stores/skillStore';
import { AgentLibrary } from './AgentLibrary';

const agents = [
  { id: 'master-1', role: 'master' as const, name: 'Master Agent', slug: 'master-agent', created_at: 0, updated_at: 0 },
  { id: 'general-1', role: 'general-purpose' as const, name: 'General-purpose', slug: 'general-purpose', created_at: 0, updated_at: 0 },
  { id: 'custom-1', role: 'custom' as const, name: 'Evidence Reviewer', slug: 'evidence-reviewer', provider_id: 'provider-1', created_at: 0, updated_at: 0 },
];

beforeEach(async () => {
  await i18n.changeLanguage('en-US');
  useProjectStore.setState({ currentProjectId: null });
  useAgentStore.setState({
    agents,
    masterScenePrompts: [],
    isLoading: false,
    error: null,
    isMasterPromptsLoading: false,
    masterPromptsError: null,
    fetchAgents: vi.fn(async () => {}),
    fetchMasterScenePrompts: vi.fn(async () => {}),
    createCustomAgent: vi.fn(async () => {}),
    updateCustomAgent: vi.fn(async () => {}),
    updateGeneralPurposeAgent: vi.fn(async () => {}),
    saveMasterScenePrompts: vi.fn(async () => {}),
    deleteCustomAgent: vi.fn(async () => {}),
  });
  useLLMStore.setState({
    providers: [{
      id: 'provider-1', name: 'Local model', provider_type: 'ollama', default_model: 'llama3',
      context_limit: 8192, is_active: 1, created_at: 0, updated_at: 0,
    }],
    activeProvider: null,
    isLoading: false,
    error: null,
    fetchProviders: vi.fn(async () => {}),
  });
  useSkillStore.setState({
    skills: [],
    isLoading: false,
    error: null,
    fetchGlobalSkills: vi.fn(async () => {}),
  });
  useMcpServerStore.setState({
    mcpServers: [],
    isLoading: false,
    error: null,
    fetchMcpServers: vi.fn(async () => {}),
  });
});

describe('AgentLibrary', () => {
  it('loads the global catalog without a selected Project and protects system identities', async () => {
    const fetchAgents = vi.fn(async () => {});
    useAgentStore.setState({ fetchAgents });

    render(<AgentLibrary />);

    await waitFor(() => expect(fetchAgents).toHaveBeenCalledOnce());
    expect(screen.getByText('Manage the global Agent Library shared across every Project.')).toBeTruthy();
    expect(screen.getByText('Master Agent')).toBeTruthy();
    expect(screen.getByText('General-purpose')).toBeTruthy();
    expect(screen.getByText('Evidence Reviewer')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('does not reload or filter the global catalog when the selected Project changes', async () => {
    const fetchAgents = vi.fn(async () => {});
    useAgentStore.setState({ fetchAgents });
    render(<AgentLibrary />);
    await waitFor(() => expect(fetchAgents).toHaveBeenCalledOnce());

    act(() => useProjectStore.setState({ currentProjectId: 'project-2' }));

    expect(fetchAgents).toHaveBeenCalledOnce();
    expect(screen.getByText('Evidence Reviewer')).toBeTruthy();
  });

  it('keeps a global identity conflict visible to the user', async () => {
    useAgentStore.setState({
      createCustomAgent: vi.fn(async () => {
        useAgentStore.setState({ error: 'Agent name conflicts with an existing Agent' });
        throw new Error('Agent name conflicts with an existing Agent');
      }),
    });
    render(<AgentLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    fireEvent.change(screen.getByPlaceholderText(/Full-stack refactoring assistant/i), {
      target: { value: 'Evidence Reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That Agent name is already used in the global Agent Library.')).toBeTruthy();
  });

  it('localizes global Catalog conflicts in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    useAgentStore.setState({ error: 'Agent delegation key conflicts with an existing Agent' });

    render(<AgentLibrary />);

    expect(screen.getByText('该名称生成的委派键已被全局 Agent Library 使用。')).toBeTruthy();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useAgentStore } from '../../stores/agentStore';
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
});

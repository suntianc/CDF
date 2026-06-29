import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { SlashCommand } from '@shared/types';
import { ConversationWelcomeSurface } from './ConversationWelcomeSurface';
import { useComposerInputController } from './composerInput/useComposerInputController';

const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set a session goal',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'chat.welcomeHeadlineActive': 'Ready to set them in motion?',
    'chat.welcomeHeadlineIdle': 'What shall we do now?',
    'chat.welcomeSublineTempSession': 'Temporary session mode · type to start chatting',
    'chat.welcomeSublineProjectLoaded': 'Project loaded: {{name}} · type to start chatting',
    'chat.welcomeSublineNoProject': 'Select a project on the left or start a new conversation, CDF is ready',
    'chat.welcomePlaceholder': 'Ask CDF',
    'chat.sendMessage': 'Send message',
    'chat.dismissError': 'Dismiss error',
    'chat.createProjectTitle': 'Create project',
    'chat.createProjectDesc': 'Start from a local folder',
    'chat.configureSkillsTitle': 'Configure skills',
    'chat.configureSkillsDesc': 'Choose the capabilities available to Agents',
    'chat.connectMcpTitle': 'Connect MCP',
    'chat.connectMcpDesc': 'Add local tools and servers',
    'chat.shortcutHint': 'Press / for commands · @ for files · Enter to send',
  };

  const translate = (key: string, values?: Record<string, string>) => (
    (translations[key] ?? key).replace('{{name}}', values?.name ?? '')
  );

  return {
    useTranslation: () => ({ t: translate }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{translate(i18nKey)}</>,
  };
});

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = globalThis.ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

function renderSurface(overrides: Partial<Omit<ComponentProps<typeof ConversationWelcomeSurface>, 'composerController'>> = {}) {
  const onSubmit = vi.fn();
  const props = {
    currentProjectId: 'project-1',
    currentProjectName: 'CDF Project',
    error: null,
    commands: [],
    commandWarnings: [],
    commandLoading: 'idle' as const,
    onCommandSelect: vi.fn(),
    onCommandInsert: vi.fn(),
    onSubmit,
    canSubmit: true,
    onClearError: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };

  function Harness() {
    const composerController = useComposerInputController({
      mode: 'welcome',
      isStreaming: false,
      projectId: props.currentProjectId,
      hasPathMentionProject: true,
      commands: props.commands,
      resolveCommand: () => null,
      listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
    });

    return <ConversationWelcomeSurface {...props} composerController={composerController} />;
  }

  return {
    ...render(<Harness />),
    props,
    onSubmit,
  };
}

describe('ConversationWelcomeSurface', () => {
  it('lets a user start a Conversation from the project welcome state', async () => {
    const { onSubmit } = renderSurface();

    await waitFor(() => {
      expect(screen.getByText(/Project loaded: CDF Project/)).toBeTruthy();
    });

    const input = screen.getByLabelText('Ask CDF');
    act(() => {
      fireEvent.change(input, { target: { value: 'Draft the release notes' } });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders welcome entry affordances and delegates their actions', () => {
    const recover = vi.fn();
    const onClearError = vi.fn();
    const onCreateProject = vi.fn();
    const onOpenSettings = vi.fn();
    renderSurface({
      error: {
        message: 'Provider missing',
        recoverableActions: [{ label: 'Open settings', action: recover }],
      },
      onClearError,
      onCreateProject,
      onOpenSettings,
      leftToolbarSlot: <button type="button">Approval mode</button>,
      modelSelectorSlot: <button type="button">Model picker</button>,
    });

    expect(screen.getByRole('alert').textContent).toContain('Provider missing');
    expect(screen.getByText('Approval mode')).toBeTruthy();
    expect(screen.getByText('Model picker')).toBeTruthy();

    fireEvent.click(screen.getByText('Open settings'));
    expect(recover).toHaveBeenCalledTimes(1);
    expect(onClearError).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Dismiss error'));
    expect(onClearError).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText('Create project').closest('button')!);
    expect(onCreateProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Configure skills').closest('button')!);
    fireEvent.click(screen.getByText('Connect MCP').closest('button')!);
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });

  it('delegates Command Entry selection from the Welcome Composer Input', async () => {
    const onCommandSelect = vi.fn();
    renderSurface({
      commands: [goalCommand],
      commandLoading: 'ready',
      onCommandSelect,
    });

    act(() => {
      fireEvent.change(screen.getByLabelText('Ask CDF'), {
        target: { value: '/' },
      });
    });

    fireEvent.click(await screen.findByText('/goal'));
    expect(onCommandSelect).toHaveBeenCalledWith('/goal');
  });

  it('describes the pre-Conversation project state in the welcome copy', async () => {
    const { rerender } = renderSurface({ currentProjectId: null });

    await waitFor(() => {
      expect(screen.getByText('Select a project on the left or start a new conversation, CDF is ready')).toBeTruthy();
    });

    rerender(<ProjectStateHarness currentProjectId="default-project" currentProjectName="Default" />);
    await waitFor(() => {
      expect(screen.getByText('Temporary session mode · type to start chatting')).toBeTruthy();
    });

    rerender(<ProjectStateHarness currentProjectId="project-2" currentProjectName="Research" />);
    await waitFor(() => {
      expect(screen.getByText('Project loaded: Research · type to start chatting')).toBeTruthy();
    });
  });
});

function ProjectStateHarness({
  currentProjectId,
  currentProjectName,
}: {
  currentProjectId: string | null;
  currentProjectName: string;
}) {
  const composerController = useComposerInputController({
    mode: 'welcome',
    isStreaming: false,
    projectId: currentProjectId,
    hasPathMentionProject: Boolean(currentProjectId),
    commands: [],
    resolveCommand: () => null,
    listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
  });

  return (
    <ConversationWelcomeSurface
      currentProjectId={currentProjectId}
      currentProjectName={currentProjectName}
      composerController={composerController}
      error={null}
      commands={[]}
      commandWarnings={[]}
      commandLoading="idle"
      onCommandSelect={() => {}}
      onCommandInsert={() => {}}
      onSubmit={() => {}}
      canSubmit={false}
      onClearError={() => {}}
      onCreateProject={() => {}}
    />
  );
}

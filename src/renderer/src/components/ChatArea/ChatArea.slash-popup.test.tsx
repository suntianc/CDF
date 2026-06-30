import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommand } from '@shared/types';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { ChatArea } from './ChatArea';

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
    'chat.unknownProject': 'Unknown project',
    'chat.welcomePlaceholder': 'Ask CDF',
    'chat.composerPlaceholder': 'Ask CDF',
    'chat.sendMessage': 'Send message',
    'chat.stopGenerating': 'Stop generating',
    'chat.addAttachment': 'Add attachment',
    'chat.hideTaskPanel': 'Hide task panel',
    'chat.showTaskPanel': 'Show task panel',
    'chat.newProjectFallback': 'New project',
    'chat.welcomeHeadlineActive': 'Ready to set them in motion?',
    'chat.welcomeHeadlineIdle': 'What shall we do now?',
    'chat.welcomeSublineTempSession': 'Temporary session mode',
    'chat.welcomeSublineProjectLoaded': 'Project loaded: {{name}}',
    'chat.welcomeSublineNoProject': 'Select a project',
    'chat.dismissError': 'Dismiss error',
    'chat.createProjectTitle': 'Create project',
    'chat.createProjectDesc': 'Start from a local folder',
    'chat.configureSkillsTitle': 'Configure Skills',
    'chat.configureSkillsDesc': 'Install and enable smart capabilities',
    'chat.connectMcpTitle': 'Connect MCP',
    'chat.connectMcpDesc': 'Configure data sources and tools',
    'chat.shortcutHint': 'Press / for commands',
  };

  const translate = (key: string, values?: Record<string, string>) => (
    (translations[key] ?? key).replace('{{name}}', values?.name ?? '')
  );

  return {
    useTranslation: () => ({ t: translate }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{translate(i18nKey)}</>,
  };
});

vi.mock('@/hooks/useCommandRegistry', () => ({
  useCommandRegistry: () => ({
    commands: [goalCommand],
    warnings: [],
    loading: 'ready',
  }),
}));

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
  if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = function () {};
  }
});

describe('ChatArea slash command popup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      value: {
        db: {
          getProviders: vi.fn(async () => []),
          getAgents: vi.fn(async () => []),
          selectDirectory: vi.fn(async () => null),
          createProject: vi.fn(),
        },
        store: {
          get: vi.fn(async () => 'agent_decides'),
          set: vi.fn(async () => {}),
        },
      },
      writable: true,
      configurable: true,
    });
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'Project One', path: '/tmp/project-one' }],
      taskPanelOpen: false,
      activeView: 'chat',
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      activeRunId: null,
      delegatedTasks: [],
      parallelBatches: [],
      todos: [],
      pendingApproval: null,
      error: null,
      sessionGoals: new Map(),
      goalJudgeStatus: new Map(),
      viewingSubagentId: null,
      viewingParallelWorker: null,
      sessionModelOverrides: {},
    });
    useAgentStore.setState({ agents: [] });
    useLLMStore.setState({ providers: [], activeProvider: null });
  });

  it('renders one Command Entry popup on the Conversation Welcome Surface', () => {
    render(<ChatArea />);

    act(() => {
      fireEvent.change(screen.getAllByLabelText('Ask CDF')[0], {
        target: { value: '/' },
      });
    });

    expect(screen.getAllByText('/goal')).toHaveLength(1);
  });
});

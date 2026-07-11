import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

const selectSession = vi.fn();
const fetchSessions = vi.fn();

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'sidebar.newChat': 'New Chat',
    'sidebar.agents': 'Agents',
    'sidebar.plugins': 'Plugins',
    'sidebar.workflows': 'Workflows',
    'sidebar.back': 'Back',
    'sidebar.collapse': 'Collapse sidebar',
    'sidebar.navigation': 'Settings navigation',
    'sidebar.settings.header': 'General Settings',
    'sidebar.settings.system': 'System Settings',
    'sidebar.settings.llm': 'LLM Management',
    'sidebar.settings.aiSubscriptions': 'AI Subscriptions',
    'sidebar.settings.agents': 'Agents',
    'sidebar.settings.skillsMcp': 'Skills & MCP',
    'sidebar.settings.tools': 'Tools',
    'sidebar.settings.research': 'Research Config',
    'sidebar.settings.workflows': 'Workflows',
  };

  return {
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key,
    }),
  };
});

vi.mock('../ProjectTree/ProjectTree', () => ({
  ProjectTree: () => <div data-testid="project-tree" />,
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: () => ({ currentProjectId: null }),
}));

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({
    sessions: [],
    activeSessionId: null,
    fetchSessions,
    createSession: vi.fn(),
    selectSession,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Sidebar', () => {
  it('exposes settings destinations as native navigation buttons with the active page', () => {
    const onChangeView = vi.fn();

    render(
      <Sidebar
        collapsed={false}
        width={280}
        activeView="settings"
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onChangeView={onChangeView}
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Settings navigation' });
    expect(navigation).toBeTruthy();
    expect(screen.getByRole('button', { name: 'LLM Management' }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: 'AI Subscriptions' }));
    expect(onChangeView).toHaveBeenCalledWith('ai-subscriptions');
  });

  it('keeps Settings navigation separate from Work navigation', () => {
    render(
      <Sidebar
        collapsed={false}
        width={280}
        activeView="system"
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onChangeView={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plugins' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
    expect(screen.queryByTestId('project-tree')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Settings navigation' })).toBeTruthy();
  });

  it('keeps the sidebar collapse control available as a labelled button', () => {
    const onCollapse = vi.fn();

    render(
      <Sidebar
        collapsed={false}
        width={280}
        activeView="chat"
        onCollapse={onCollapse}
        onResize={vi.fn()}
        onChangeView={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

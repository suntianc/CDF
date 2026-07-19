import type { ReactNode } from 'react';
import { act, fireEvent, render as renderWithTestingLibrary, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useFileStore } from '../../stores/fileStore';
import { useThemeStore } from '../../stores/themeStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { openProjectFile } from '../../lib/openProjectFile';
import { FilePanel } from './FilePanel';

function render(ui: ReactNode) {
  return renderWithTestingLibrary(
    <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>,
  );
}

const PROJECT_PATH = '/tmp/cdf-project';
const DIAGRAM_PATH = `${PROJECT_PATH}/diagrams/release.excalidraw`;
const DIAGRAM_CONTENT = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [],
  appState: { viewBackgroundColor: '#f8f9fa' },
  files: {},
});

const { excalidrawProps, editCount, loadFromBlob, serializeAsJSON } = vi.hoisted(() => ({
  excalidrawProps: { current: null as Record<string, unknown> | null },
  editCount: { current: 0 },
  loadFromBlob: vi.fn().mockResolvedValue({
    elements: [],
    appState: { viewBackgroundColor: '#f8f9fa' },
    files: {},
  }),
  serializeAsJSON: vi.fn((
    elements: unknown,
    appState: unknown,
    files: unknown,
  ) => JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState,
    files,
  })),
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('@excalidraw/excalidraw', () => ({
  MIME_TYPES: { excalidraw: 'application/vnd.excalidraw+json' },
  loadFromBlob,
  serializeAsJSON,
  Excalidraw: (props: Record<string, unknown>) => {
    excalidrawProps.current = props;
    return (
      <div data-testid="official-excalidraw">
        <button
          type="button"
          onClick={() => {
            editCount.current += 1;
            const onChange = props.onChange as ((elements: unknown[], appState: unknown, files: unknown) => void) | undefined;
            const suffix = editCount.current;
            onChange?.(
              [
                {
                  id: `rectangle-${suffix}`,
                  type: 'rectangle',
                  boundElements: [
                    { id: `label-${suffix}`, type: 'text' },
                    { id: `arrow-${suffix}`, type: 'arrow' },
                  ],
                },
                { id: `label-${suffix}`, type: 'text', containerId: `rectangle-${suffix}` },
                {
                  id: `arrow-${suffix}`,
                  type: 'arrow',
                  startBinding: { elementId: `rectangle-${suffix}`, focus: 0, gap: 1 },
                },
                { id: `image-${suffix}`, type: 'image', fileId: 'image-file-1' },
              ],
              { viewBackgroundColor: '#ffffff' },
              {
                'image-file-1': {
                  id: 'image-file-1',
                  mimeType: 'image/png',
                  dataURL: 'data:image/png;base64,AA==',
                  created: 1,
                },
              },
            );
          }}
        >
          Draw in diagram
        </button>
        {(props.renderTopRightUI as (() => React.ReactNode) | undefined)?.()}
      </div>
    );
  },
}));

const readFile = vi.fn();
const writeFile = vi.fn();
const directoryChangeListeners: Array<(
  event: unknown,
  data: { type: string; path: string },
) => void> = [];

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  excalidrawProps.current = null;
  editCount.current = 0;
  loadFromBlob.mockReset().mockResolvedValue({
    elements: [],
    appState: { viewBackgroundColor: '#f8f9fa' },
    files: {},
  });
  serializeAsJSON.mockClear();
  readFile.mockReset().mockResolvedValue({
    ok: true,
    data: { content: DIAGRAM_CONTENT },
  });
  writeFile.mockReset().mockResolvedValue({ ok: true, data: undefined });
  directoryChangeListeners.length = 0;

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    store: { get: vi.fn().mockResolvedValue(false) },
    fs: {
      readDirectory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      readFile,
      writeFile,
      watchDirectory: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      unwatchDirectory: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      onDirectoryChange: vi.fn((callback) => {
        directoryChangeListeners.push(callback);
        return vi.fn();
      }),
    },
  };

  useThemeStore.setState({ theme: 'system' });
  useProjectStore.setState({
    currentProjectId: 'project-1',
    projects: [{
      id: 'project-1',
      name: 'CDF Project',
      path: PROJECT_PATH,
      scene: 'general',
      created_at: 1,
      updated_at: 1,
    }],
  });

  act(() => {
    useFileStore.getState().setRootPath(PROJECT_PATH);
    useFileStore.setState({
      filePanelOpen: true,
      dirContents: {
        [PROJECT_PATH]: [{
          name: 'release.excalidraw',
          path: DIAGRAM_PATH,
          isDirectory: false,
        }],
      },
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Editable Flow Diagram workspace', () => {
  it('opens a standard document in the official editor and reuses its path-based tab', async () => {
    render(<main><FilePanel /></main>);

    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));

    await screen.findByTestId('official-excalidraw');
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().openTabs).toHaveLength(1);
    expect(useFileStore.getState().previewFile?.path).toBe(DIAGRAM_PATH);
    await waitFor(() => expect(excalidrawProps.current?.initialData).toMatchObject({
      elements: [],
      files: {},
    }));

    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().openTabs).toHaveLength(1);
    expect(useFileStore.getState().activeTabIndex).toBe(0);

    act(() => useFileStore.getState().setFilePanelOpen(false));
    await act(async () => {
      await openProjectFile(PROJECT_PATH, '/diagrams/release.excalidraw');
    });
    expect(useFileStore.getState().filePanelOpen).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().openTabs).toHaveLength(1);
    expect(useFileStore.getState().previewFile?.path).toBe(DIAGRAM_PATH);
  });

  it('reloads the current source after an Agent file notification', async () => {
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');

    const agentDiagram = {
      elements: [{ id: 'agent-node', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    loadFromBlob.mockResolvedValue(agentDiagram);
    readFile.mockResolvedValue({
      ok: true,
      data: { content: JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'https://cdf.local',
        ...agentDiagram,
      }) },
    });

    await act(async () => {
      for (const listener of directoryChangeListeners) {
        listener({}, { type: 'change', path: DIAGRAM_PATH });
      }
    });

    await waitFor(() => expect(excalidrawProps.current?.initialData).toMatchObject({
      elements: [{ id: 'agent-node', type: 'rectangle' }],
    }));
    expect(useFileStore.getState().previewFile?.content).toContain('agent-node');
    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(false);
  });

  it('opens the Agent version while preserving dirty local edits as an explicit conflict action', async () => {
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');
    act(() => {
      useFileStore.getState().openPreview({
        path: `${PROJECT_PATH}/diagrams/second.excalidraw`,
        name: 'second.excalidraw',
        content: DIAGRAM_CONTENT,
      });
      useFileStore.getState().setActiveTab(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draw in diagram' }));
    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(true);

    const agentDiagram = {
      elements: [{ id: 'agent-node', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    loadFromBlob.mockResolvedValue(agentDiagram);
    readFile.mockResolvedValue({
      ok: true,
      data: { content: JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'https://cdf.local',
        ...agentDiagram,
      }) },
    });

    await act(async () => {
      for (const listener of directoryChangeListeners) {
        listener({}, { type: 'change', path: DIAGRAM_PATH });
      }
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: /恢复我的编辑|Restore my edits/ })).toBeTruthy();
    expect(writeFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().previewFile?.content).toContain('agent-node');
    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(true);
    expect(excalidrawProps.current?.viewModeEnabled).toBe(true);

    fireEvent.click(screen.getByText('second.excalidraw'));
    await waitFor(() => expect(useFileStore.getState().activeTabIndex).toBe(0));

    fireEvent.click(screen.getByRole('button', { name: /关闭 release\.excalidraw|Close release\.excalidraw/ }));
    await waitFor(() => expect(useFileStore.getState().openTabs).toHaveLength(2));

    act(() => useProjectStore.setState({
      currentProjectId: 'project-2',
      projects: [
        ...useProjectStore.getState().projects,
        {
          id: 'project-2',
          name: 'Second Project',
          path: '/tmp/cdf-project-2',
          scene: 'general',
          created_at: 2,
          updated_at: 2,
        },
      ],
    }));
    await waitFor(() => expect(useFileStore.getState().rootPath).toBe(PROJECT_PATH));

    fireEvent.click(screen.getByRole('button', { name: /保留 Agent 版本|Keep Agent version/ }));
    await waitFor(() => expect(useFileStore.getState().rootPath).toBe('/tmp/cdf-project-2'));
  });

  it('follows the CDF theme and language', async () => {
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');

    expect(excalidrawProps.current).toMatchObject({
      theme: 'light',
      langCode: 'zh-CN',
    });

    act(() => useThemeStore.setState({ theme: 'dark' }));
    await waitFor(() => expect(excalidrawProps.current?.theme).toBe('dark'));
  });

  it('autosaves diagram changes even when text editor autosave is disabled', async () => {
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');
    const drawButton = screen.getByRole('button', { name: 'Draw in diagram' });
    vi.useFakeTimers();

    fireEvent.click(drawButton);

    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      PROJECT_PATH,
      DIAGRAM_PATH,
      expect.any(String),
      DIAGRAM_CONTENT,
    );
    const savedDocument = JSON.parse(writeFile.mock.calls[0][2]);
    expect(useFileStore.getState().previewFile?.content).toBe(writeFile.mock.calls[0][2]);
    expect(savedDocument).toMatchObject({
      type: 'excalidraw',
      elements: [
        {
          id: 'rectangle-1',
          boundElements: [
            { id: 'label-1', type: 'text' },
            { id: 'arrow-1', type: 'arrow' },
          ],
        },
        { id: 'label-1', containerId: 'rectangle-1' },
        { id: 'arrow-1', startBinding: { elementId: 'rectangle-1' } },
        { id: 'image-1', fileId: 'image-file-1' },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { 'image-file-1': { mimeType: 'image/png' } },
    });
    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(false);
  });

  it('serializes overlapping saves so an older write cannot replace the latest edit', async () => {
    let resolveFirstWrite: ((value: { ok: true; data: undefined }) => void) | undefined;
    writeFile.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstWrite = resolve;
    }));
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');
    const drawButton = screen.getByRole('button', { name: 'Draw in diagram' });
    vi.useFakeTimers();

    fireEvent.click(drawButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    fireEvent.click(drawButton);
    fireEvent.click(screen.getByRole('button', { name: /Save diagram|保存流程图/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstWrite?.({ ok: true, data: undefined });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writeFile.mock.calls[0][2]).elements[0].id).toBe('rectangle-1');
    expect(JSON.parse(writeFile.mock.calls[1][2]).elements[0].id).toBe('rectangle-2');
  });

  it('flushes pending diagram changes on explicit save and tab close', async () => {
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');
    const drawButton = screen.getByRole('button', { name: 'Draw in diagram' });
    vi.useFakeTimers();

    fireEvent.click(drawButton);
    fireEvent.click(screen.getByRole('button', { name: /Save diagram|保存流程图/ }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeFile.mock.calls[0][2]).elements[0].id).toBe('rectangle-1');

    fireEvent.click(drawButton);
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writeFile.mock.calls[1][2]).elements[0].id).toBe('rectangle-2');

    fireEvent.click(drawButton);
    fireEvent.click(screen.getByRole('button', { name: /Close release\.excalidraw|关闭 release\.excalidraw/ }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(JSON.parse(writeFile.mock.calls[2][2]).elements[0].id).toBe('rectangle-3');
    expect(useFileStore.getState().openTabs).toHaveLength(0);
  });

  it('waits for edits made while close-time flush is still in progress', async () => {
    let resolveFirstWrite: ((value: { ok: true; data: undefined }) => void) | undefined;
    let resolveSecondWrite: ((value: { ok: true; data: undefined }) => void) | undefined;
    writeFile
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstWrite = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondWrite = resolve;
      }));
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');
    const drawButton = screen.getByRole('button', { name: 'Draw in diagram' });

    fireEvent.click(drawButton);
    fireEvent.click(screen.getByRole('button', { name: /Close release\.excalidraw|关闭 release\.excalidraw/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().openTabs).toHaveLength(1);

    fireEvent.click(drawButton);
    await act(async () => {
      resolveFirstWrite?.({ ok: true, data: undefined });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(useFileStore.getState().openTabs).toHaveLength(1);

    await act(async () => {
      resolveSecondWrite?.({ ok: true, data: undefined });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(writeFile.mock.calls[1][2]).elements[0].id).toBe('rectangle-2');
    expect(useFileStore.getState().openTabs).toHaveLength(0);
  });

  it('keeps the tab open with a retry action when close-time flush fails', async () => {
    writeFile.mockResolvedValue({
      ok: false,
      error: { code: 'WRITE_FAILED', message: 'disk full' },
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<main><FilePanel /></main>);
    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));
    await screen.findByTestId('official-excalidraw');

    fireEvent.click(screen.getByRole('button', { name: 'Draw in diagram' }));
    fireEvent.click(screen.getByRole('button', { name: /Close release\.excalidraw|关闭 release\.excalidraw/ }));

    await screen.findByRole('button', { name: /Save failed\. Retry diagram save|保存失败，请重试保存流程图/ });
    expect(useFileStore.getState().openTabs).toHaveLength(1);
    expect(useFileStore.getState().dirtyTabs[DIAGRAM_PATH]).toBe(true);
    consoleSpy.mockRestore();
  });

  it('shows a read-only error without overwriting invalid or unreadable diagrams', async () => {
    loadFromBlob.mockRejectedValueOnce(new Error('invalid document'));
    readFile.mockResolvedValueOnce({ ok: true, data: { content: '{not-json' } });
    const { unmount } = render(<main><FilePanel /></main>);

    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));

    await screen.findByRole('heading', { name: /Unable to open diagram|无法打开流程图/ });
    expect(screen.queryByTestId('official-excalidraw')).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Retry diagram|重试打开流程图/ }));
    await screen.findByTestId('official-excalidraw');
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(writeFile).not.toHaveBeenCalled();
    unmount();
    expect(writeFile).not.toHaveBeenCalled();

    act(() => {
      useFileStore.getState().setRootPath(PROJECT_PATH);
      useFileStore.setState({
        filePanelOpen: true,
        dirContents: {
          [PROJECT_PATH]: [{
            name: 'release.excalidraw',
            path: DIAGRAM_PATH,
            isDirectory: false,
          }],
        },
      });
    });
    readFile.mockResolvedValueOnce({
      ok: false,
      error: { code: 'READ_FAILED', message: 'permission denied' },
    });
    render(<main><FilePanel /></main>);

    fireEvent.click(screen.getByRole('button', { name: 'release.excalidraw' }));

    await screen.findByRole('heading', { name: /Unable to open diagram|无法打开流程图/ });
    expect(screen.queryByTestId('official-excalidraw')).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileStore } from '../../stores/fileStore';
import { FlowDiagramArtifactCard } from './FlowDiagramArtifactCard';

const { openProjectFileMock, renderThumbnailMock } = vi.hoisted(() => ({
  openProjectFileMock: vi.fn(async () => ({ ok: true, reused: false })),
  renderThumbnailMock: vi.fn(async () => 'data:image/svg+xml,thumbnail'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.flowDiagramArtifact': 'Editable Flow Diagram',
      'chat.flowDiagramLoading': 'Rendering current diagram…',
      'chat.flowDiagramOpen': 'Open in Files',
      'chat.flowDiagramMissing': 'The source diagram is missing.',
      'chat.flowDiagramInvalid': 'The source diagram is invalid.',
      'chat.flowDiagramOpenFailed': 'Could not open the source diagram.',
    }[key] ?? key),
  }),
}));

vi.mock('../../lib/openProjectFile', () => ({
  openProjectFile: openProjectFileMock,
}));

vi.mock('../FilePanel/excalidrawAdapter', () => ({
  renderFlowDiagramThumbnail: renderThumbnailMock,
}));

describe('FlowDiagramArtifactCard', () => {
  let directoryChange: ((event: unknown, data: { type: string; path: string }) => void) | undefined;
  const readFile = vi.fn(async () => ({
    ok: true,
    data: { content: '{"type":"excalidraw"}', encoding: 'utf-8', size: 22, mtimeMs: 1 },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    directoryChange = undefined;
    useFileStore.setState({
      rootPath: '/project',
      filePanelOpen: false,
      openTabs: [],
      activeTabIndex: -1,
      previewFile: null,
    });
    window.electronAPI = {
      fs: {
        readFile,
        onDirectoryChange: vi.fn((callback) => {
          directoryChange = callback;
          return vi.fn();
        }),
      },
    } as any;
  });

  it('renders a current-source SVG thumbnail and opens the shared FilePanel entry', async () => {
    render(
      <FlowDiagramArtifactCard
        href="/project/diagrams/release.excalidraw"
        label="Release flow"
      />,
    );

    expect(screen.getByText('Rendering current diagram…')).toBeTruthy();
    const thumbnail = await screen.findByRole('img', { name: 'Release flow' });
    expect(thumbnail.getAttribute('src')).toBe('data:image/svg+xml,thumbnail');
    expect(screen.getByText('/project/diagrams/release.excalidraw')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Open in Files/ }));
    await waitFor(() => {
      expect(openProjectFileMock).toHaveBeenCalledWith(
        '/project',
        '/project/diagrams/release.excalidraw',
      );
    });
  });

  it('refreshes from the source after a matching file notification', async () => {
    render(
      <FlowDiagramArtifactCard
        href="/project/diagrams/release.excalidraw"
        label="Release flow"
      />,
    );
    await screen.findByRole('img', { name: 'Release flow' });
    expect(renderThumbnailMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      directoryChange?.({}, {
        type: 'change',
        path: '/project/diagrams/release.excalidraw',
      });
    });

    await waitFor(() => expect(renderThumbnailMock).toHaveBeenCalledTimes(2));
  });

  it('shows clear missing and invalid source states', async () => {
    readFile.mockResolvedValueOnce({
      ok: false,
      error: { code: 'ENOENT', message: 'missing' },
    } as any);
    const { rerender } = render(
      <FlowDiagramArtifactCard href="/project/missing.excalidraw" label="Missing flow" />,
    );
    expect(await screen.findByText('The source diagram is missing.')).toBeTruthy();

    readFile.mockResolvedValueOnce({
      ok: true,
      data: { content: 'invalid', encoding: 'utf-8', size: 7, mtimeMs: 2 },
    });
    renderThumbnailMock.mockRejectedValueOnce(new Error('invalid'));
    rerender(<FlowDiagramArtifactCard href="/project/invalid.excalidraw" label="Invalid flow" />);
    expect(await screen.findByText('The source diagram is invalid.')).toBeTruthy();
  });
});

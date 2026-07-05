import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, browserWindowMock, loadUrlMock, dbPrepareMock, listMock, searchMock, createMock, readMock, updateMock, deleteMock } = vi.hoisted(() => {
  const loadUrlMock = vi.fn();
  return {
    ipcHandleMock: vi.fn(),
    browserWindowMock: vi.fn(function BrowserWindowMock() {
      return { loadURL: loadUrlMock };
    }),
    loadUrlMock,
    dbPrepareMock: vi.fn(),
    listMock: vi.fn(),
    searchMock: vi.fn(),
    createMock: vi.fn(),
    readMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
  BrowserWindow: browserWindowMock,
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('./knowledge-base', () => ({
  getKnowledgeBaseRoot: (projectPath: string) => `${projectPath}/.cdf/knowledge`,
  listKnowledgeEntries: listMock,
  searchKnowledgeEntries: searchMock,
  createKnowledgeEntry: createMock,
  readKnowledgeEntry: readMock,
  updateKnowledgeEntry: updateMock,
  deleteKnowledgeEntry: deleteMock,
}));

import { registerKnowledgeBaseHandlers } from './knowledge-base-ipc';

describe('Knowledge Base IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes list/search through project-scoped IPC handlers', async () => {
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => ({ path: '/tmp/project' })),
    });
    listMock.mockReturnValue([{ relativePath: 'notes/rag.md' }]);
    searchMock.mockReturnValue([{ relativePath: 'notes/rag.md' }]);

    registerKnowledgeBaseHandlers();

    const listHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:list')?.[1];
    const searchHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:search')?.[1];

    expect(await listHandler({}, 'project-1', { tags: ['rag'] })).toEqual([{ relativePath: 'notes/rag.md' }]);
    expect(await searchHandler({}, 'project-1', { keyword: 'rag' })).toEqual([{ relativePath: 'notes/rag.md' }]);
    expect(listMock).toHaveBeenCalledWith('/tmp/project', { tags: ['rag'] });
    expect(searchMock).toHaveBeenCalledWith('/tmp/project', { keyword: 'rag' });
  });

  it('exposes create/read/update/delete through project-scoped IPC handlers', async () => {
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => ({ path: '/tmp/project' })),
    });
    createMock.mockReturnValue({ relativePath: 'notes/rag.md' });
    readMock.mockReturnValue({ relativePath: 'notes/rag.md' });
    updateMock.mockReturnValue({ relativePath: 'notes/rag.md', title: 'Updated' });
    deleteMock.mockReturnValue({ deleted: true });

    registerKnowledgeBaseHandlers();

    const createHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:create')?.[1];
    const readHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:read')?.[1];
    const updateHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:update')?.[1];
    const deleteHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'knowledge:delete')?.[1];

    expect(await createHandler({}, 'project-1', { title: 'RAG' })).toEqual({ relativePath: 'notes/rag.md' });
    expect(await readHandler({}, 'project-1', 'notes/rag.md')).toEqual({ relativePath: 'notes/rag.md' });
    expect(await updateHandler({}, 'project-1', 'notes/rag.md', { title: 'Updated' })).toEqual({ relativePath: 'notes/rag.md', title: 'Updated' });
    expect(await deleteHandler({}, 'project-1', 'notes/rag.md')).toEqual({ deleted: true });
    expect(createMock).toHaveBeenCalledWith('/tmp/project', { title: 'RAG' });
    expect(readMock).toHaveBeenCalledWith('/tmp/project', 'notes/rag.md');
    expect(updateMock).toHaveBeenCalledWith('/tmp/project', 'notes/rag.md', { title: 'Updated' });
    expect(deleteMock).toHaveBeenCalledWith('/tmp/project', 'notes/rag.md');
  });

  it('opens Paper PDF resources inside the project Knowledge Base only', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-paper-ipc-'));
    const pdfPath = path.join(projectPath, '.cdf', 'knowledge', 'papers', 'local.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, 'pdf');
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => ({ path: projectPath })),
    });

    registerKnowledgeBaseHandlers();

    const openHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'paper-library:openPdf')?.[1];

    await expect(openHandler({}, 'project-1', 'papers/local.pdf')).resolves.toEqual({ success: true });
    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
      }),
    }));
    expect(loadUrlMock).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\//));

    await expect(openHandler({}, 'project-1', '../outside.pdf')).rejects.toThrow(/inside the Knowledge Base/);
  });
});

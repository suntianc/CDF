import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, dbPrepareMock, listMock, searchMock, createMock, readMock, updateMock, deleteMock } = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  listMock: vi.fn(),
  searchMock: vi.fn(),
  createMock: vi.fn(),
  readMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('./knowledge-base', () => ({
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
});

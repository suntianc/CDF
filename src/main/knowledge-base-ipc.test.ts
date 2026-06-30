import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, dbPrepareMock, listMock, searchMock } = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  listMock: vi.fn(),
  searchMock: vi.fn(),
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
});

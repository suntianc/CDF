import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, dbPrepareMock, listCandidatesMock } = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  listCandidatesMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

vi.mock('../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('./candidate-lister', () => ({
  listCandidates: listCandidatesMock,
}));

// Import after mocks are set up
import { registerAtMentionHandlers } from './at-mention-handler';

describe('at-mention-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the project:listAtMentionCandidates channel', () => {
    registerAtMentionHandlers();
    expect(ipcHandleMock).toHaveBeenCalledWith(
      'project:listAtMentionCandidates',
      expect.any(Function),
    );
  });

  it('returns empty result when project is not found in DB', async () => {
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => undefined),
    });
    registerAtMentionHandlers();
    const handler = ipcHandleMock.mock.calls.find(
      ([ch]) => ch === 'project:listAtMentionCandidates',
    )?.[1];
    expect(handler).toBeTypeOf('function');

    const result = await handler!({}, 'unknown-id');
    expect(result).toEqual({ candidates: [], truncated: false });
  });

  it('returns listCandidates output when project exists', async () => {
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => ({ path: '/tmp/some-root' })),
    });
    listCandidatesMock.mockReturnValue({
      candidates: ['src/a.ts', 'src/'],
      truncated: false,
    });
    registerAtMentionHandlers();
    const handler = ipcHandleMock.mock.calls.find(
      ([ch]) => ch === 'project:listAtMentionCandidates',
    )?.[1];

    const result = await handler!({}, 'known-id');
    expect(result).toEqual({ candidates: ['src/a.ts', 'src/'], truncated: false });
    expect(listCandidatesMock).toHaveBeenCalledWith('/tmp/some-root');
  });

  it('catches thrown errors and returns empty result', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => {
        throw new Error('db locked');
      }),
    });
    registerAtMentionHandlers();
    const handler = ipcHandleMock.mock.calls.find(
      ([ch]) => ch === 'project:listAtMentionCandidates',
    )?.[1];

    const result = await handler!({}, 'any-id');
    expect(result).toEqual({ candidates: [], truncated: false });
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('project:listAtMentionCandidates');
  });
});

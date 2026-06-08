import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ipcHandleMock,
  runLLMChatMock,
  fetchOllamaModelsMock,
  stopLLMChatMock,
  resolveLLMApprovalMock,
  dbPrepareMock,
} = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
  runLLMChatMock: vi.fn(),
  fetchOllamaModelsMock: vi.fn(),
  stopLLMChatMock: vi.fn(),
  resolveLLMApprovalMock: vi.fn(),
  dbPrepareMock: vi.fn(() => ({
    all: vi.fn(() => []),
    get: vi.fn(),
    run: vi.fn(),
  })),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/cdf-ipc-test'),
  },
}));

vi.mock('./store', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
    transaction: vi.fn((fn) => fn),
  },
}));

vi.mock('./security', () => ({
  encryptApiKey: vi.fn((value: string) => value),
  decryptApiKey: vi.fn((value: string) => value),
}));

vi.mock('./llm', () => ({
  runLLMChat: runLLMChatMock,
  fetchOllamaModels: fetchOllamaModelsMock,
  stopLLMChat: stopLLMChatMock,
  resolveLLMApproval: resolveLLMApprovalMock,
}));

vi.mock('../shared/provider-url', () => ({
  buildAnthropicModelsUrl: vi.fn((url?: string) => url || ''),
  buildOpenAIModelsUrl: vi.fn((url?: string) => url || ''),
  normalizeProviderApiUrl: vi.fn((url?: string) => url || ''),
  shouldUseAnthropicAuthToken: vi.fn(() => false),
}));

vi.mock('./deepagent/skill-manager', () => ({
  listPhysicalSkills: vi.fn(() => []),
  savePhysicalSkill: vi.fn(),
  deletePhysicalSkill: vi.fn(),
}));

vi.mock('./deepagent/mcp-connector', () => ({
  createMcpClient: vi.fn(),
}));

import { registerIpcHandlers } from './ipc-handlers';

describe('IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should acknowledge llm:chat immediately and stream asynchronously', () => {
    const neverSettles = new Promise<void>(() => {});
    runLLMChatMock.mockReturnValue(neverSettles);

    registerIpcHandlers();
    const chatHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'llm:chat')?.[1];
    expect(chatHandler).toBeTypeOf('function');

    const result = chatHandler({ sender: 'web-contents' }, 'request-1', { sessionId: 'session-1' });

    expect(result).toEqual({ ok: true });
    expect(runLLMChatMock).toHaveBeenCalledWith('web-contents', 'request-1', { sessionId: 'session-1' });
  });

  it('should throw an error in db:saveAgent if agent name contains non-English characters', async () => {
    registerIpcHandlers();
    const saveAgentHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveAgent')?.[1];
    expect(saveAgentHandler).toBeTypeOf('function');

    // Invalid names
    expect(() => saveAgentHandler({}, { name: '智能代理', id: 'agent-1' })).toThrow(
      'Agent name must contain only English characters, numbers, spaces, hyphens, or underscores.'
    );
    expect(() => saveAgentHandler({}, { name: 'Agent 代理', id: 'agent-1' })).toThrow(
      'Agent name must contain only English characters, numbers, spaces, hyphens, or underscores.'
    );

    // Valid names should not throw name validation error
    dbPrepareMock.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(() => null),
      run: vi.fn(),
    });
    const result = saveAgentHandler({}, { 
      id: 'agent-1', 
      project_id: 'proj-1', 
      name: 'Smart Agent 123-_', 
      is_default: false 
    });
    expect(result.name).toBe('Smart Agent 123-_');
  });
});

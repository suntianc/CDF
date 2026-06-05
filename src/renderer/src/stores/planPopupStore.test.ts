import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanPopupStore } from './planPopupStore';

// Cross-store + IPC mocks (mirrors dispatcher.test.ts:5-23 pattern)
const mockSendMessage = vi.fn();
const mockStopChat = vi.fn();
const mockGetProjectState = vi.fn();
const mockGetSessionState = vi.fn();

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mockGetProjectState() },
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));

declare global {
  // eslint-disable-next-line no-var
  var electronAPI: any;
}

function resetStore() {
  usePlanPopupStore.setState({
    isOpen: false,
    status: 'closed',
    planContent: '',
    iterationCount: 0,
    modifyHistory: [],
    currentRequestId: null,
    description: '',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockReset();
  mockStopChat.mockReset();
  mockGetProjectState.mockReset();
  mockGetSessionState.mockReset();
  // Default session state — individual tests override specific fields.
  mockGetSessionState.mockReturnValue({
    sendMessage: mockSendMessage,
    streamingMessageId: null,
  });
  globalThis.electronAPI = {
    llm: { stopChat: mockStopChat },
  };
  resetStore();
});

describe('usePlanPopupStore', () => {
  it("open() transitions closed → generating + resets iterationCount/planContent/history", () => {
    usePlanPopupStore.getState().open('  重构 ChatArea  ');

    const s = usePlanPopupStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.status).toBe('generating');
    expect(s.description).toBe('重构 ChatArea');
    expect(s.planContent).toBe('');
    expect(s.iterationCount).toBe(0);
    expect(s.modifyHistory).toEqual([]);
  });

  it("appendChunk() transitions generating → reviewing on first non-empty chunk", () => {
    usePlanPopupStore.getState().open('demo');
    expect(usePlanPopupStore.getState().status).toBe('generating');

    usePlanPopupStore.getState().appendChunk('步骤 1：');
    usePlanPopupStore.getState().appendChunk('读源码');

    const s = usePlanPopupStore.getState();
    expect(s.status).toBe('reviewing');
    expect(s.planContent).toBe('步骤 1：读源码');
  });

  it('startModify() increments iterationCount, calls cancelCurrent then sendMessage with planOnly=true, status → modifying', async () => {
    usePlanPopupStore.getState().open('demo');
    usePlanPopupStore.getState().appendChunk('initial plan');
    usePlanPopupStore.setState({ currentRequestId: 'req-1' });

    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      sendMessage: mockSendMessage,
      streamingMessageId: 'req-2',
    });
    mockSendMessage.mockResolvedValue(undefined);

    await usePlanPopupStore.getState().startModify('先列影响范围');

    expect(mockStopChat).toHaveBeenCalledWith('req-1'); // cancelCurrent was invoked
    expect(mockSendMessage).toHaveBeenCalledWith('project-1', '修改意见：先列影响范围', {
      planOnly: true,
    });
    const s = usePlanPopupStore.getState();
    expect(s.status).toBe('modifying');
    expect(s.iterationCount).toBe(1);
    expect(s.modifyHistory).toHaveLength(1);
    expect(s.modifyHistory[0].opinion).toBe('先列影响范围');
    expect(s.currentRequestId).toBe('req-2');
  });

  it('startModify() at iterationCount === 20: rejects (no sendMessage call), sets status to cap-reached', async () => {
    usePlanPopupStore.getState().open('demo');
    usePlanPopupStore.setState({ iterationCount: 20 });

    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      sendMessage: mockSendMessage,
      streamingMessageId: null,
    });

    await usePlanPopupStore.getState().startModify('再想想');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(usePlanPopupStore.getState().status).toBe('cap-reached');
  });

  it("execute() calls sendMessage('立即执行', undefined) without planOnly, status → executing, then close() reached", async () => {
    usePlanPopupStore.getState().open('demo');
    usePlanPopupStore.getState().appendChunk('final plan');

    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      sendMessage: mockSendMessage,
      streamingMessageId: null,
    });
    mockSendMessage.mockResolvedValue(undefined);

    await usePlanPopupStore.getState().execute();

    expect(mockSendMessage).toHaveBeenCalledWith('project-1', '立即执行', undefined);
    // C3-03: the third arg must be undefined (no planOnly flag)
    expect(mockSendMessage.mock.calls[0][2]).toBeUndefined();
    // After execute() completes, the popup should be back to closed
    const s = usePlanPopupStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.status).toBe('closed');
    expect(s.planContent).toBe('');
  });

  it('cancelCurrent() calls window.electronAPI.llm.stopChat with currentRequestId; null id is no-op', async () => {
    usePlanPopupStore.getState().open('demo');
    // currentRequestId is null after open() — no-op
    await usePlanPopupStore.getState().cancelCurrent();
    expect(mockStopChat).not.toHaveBeenCalled();

    usePlanPopupStore.setState({ currentRequestId: 'req-99' });
    mockStopChat.mockResolvedValue(undefined);
    await usePlanPopupStore.getState().cancelCurrent();

    expect(mockStopChat).toHaveBeenCalledWith('req-99');
    expect(usePlanPopupStore.getState().currentRequestId).toBeNull();
  });
});

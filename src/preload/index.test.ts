import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exposeMock, invokeMock, onMock, removeListenerMock, sendMock } = vi.hoisted(() => ({
  exposeMock: vi.fn(),
  invokeMock: vi.fn(async () => undefined),
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: exposeMock },
  ipcRenderer: {
    invoke: invokeMock,
    on: onMock,
    removeListener: removeListenerMock,
    send: sendMock,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadApi(): Promise<any> {
  await import('./index');
  const call = exposeMock.mock.calls.find(([name]) => name === 'electronAPI');
  return call?.[1];
}

describe('preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeMock.mockClear();
    invokeMock.mockClear();
    onMock.mockClear();
    removeListenerMock.mockClear();
    sendMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('exposes electronAPI through contextBridge', async () => {
    const api = await loadApi();
    expect(api).toBeTypeOf('object');
    expect(api.store.get).toBeTypeOf('function');
  });

  it('routes typed invokes to ipcRenderer.invoke with the contract channel', async () => {
    const api = await loadApi();
    await api.store.get('theme');
    expect(invokeMock).toHaveBeenCalledWith('store:get', 'theme');
  });

  it('subscribes llm.onChunk on the dynamic per-request channel and unsubscribes the same listener', async () => {
    const api = await loadApi();
    const cb = vi.fn();
    const unsubscribe = api.llm.onChunk('req-1', cb);

    expect(onMock).toHaveBeenCalledTimes(1);
    const [channel, listener] = onMock.mock.calls[0];
    expect(channel).toBe('llm:chunk-req-1');

    // The listener forwards (event, data) to the caller's callback.
    listener({ sender: {} }, { type: 'chunk' });
    expect(cb).toHaveBeenCalledWith({ sender: {} }, { type: 'chunk' });

    unsubscribe();
    expect(removeListenerMock).toHaveBeenCalledWith('llm:chunk-req-1', listener);
  });

  it('subscribes deepagents.onParallelTaskStep on the dynamic per-session channel', async () => {
    const api = await loadApi();
    const unsubscribe = api.deepagents.onParallelTaskStep('sess-9', vi.fn());
    const [channel, listener] = onMock.mock.calls[0];
    expect(channel).toBe('agent:parallel-task-step-sess-9');
    unsubscribe();
    expect(removeListenerMock).toHaveBeenCalledWith('agent:parallel-task-step-sess-9', listener);
  });

  it('binds static event listeners to their contract channel and forwards only the payload (#230)', async () => {
    const api = await loadApi();
    const cases: Array<[() => (cb: (data: unknown) => void) => () => void, string]> = [
      [() => api.conversation.onRunEvent, 'conversation:run-event'],
      [() => api.conversation.onMessagesChanged, 'conversation:messages-changed'],
      [() => api.capabilityJobs.onChanged, 'capability-jobs:changed'],
      [() => api.workflowRun.onProjectionEvent, 'workflow-run:projection-event'],
      [() => api.fs.onDirectoryChange, 'fs:directoryChange'],
      [() => api.commands.onChanged, 'commands:changed'],
      [() => api.commands.onFallback, 'commands:fallback'],
    ];

    for (const [getter, channel] of cases) {
      onMock.mockClear();
      removeListenerMock.mockClear();
      const cb = vi.fn();
      const unsubscribe = getter()(cb);

      const call = onMock.mock.calls.find(([c]) => c === channel);
      expect(call, `expected a listener on ${channel}`).toBeDefined();
      const listener = call![1];

      // The wrapped listener drops the raw IpcRendererEvent and passes only the payload.
      listener({ sender: {} }, { hello: channel });
      expect(cb).toHaveBeenCalledWith({ hello: channel });

      unsubscribe();
      expect(removeListenerMock).toHaveBeenCalledWith(channel, listener);
    }
  });

  it('forwards the optional stageId to workflow-run:get-tasks (#230)', async () => {
    const api = await loadApi();
    await api.workflowRun.getTasks('run-1', 'stage-2');
    expect(invokeMock).toHaveBeenCalledWith('workflow-run:get-tasks', 'run-1', 'stage-2');
  });

  it('sends flow-diagram export responses through ipcRenderer.send', async () => {
    const api = await loadApi();
    const response = { requestId: 'x', ok: true } as unknown;
    api.flowDiagram.resolveExport(response);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toBe(response);
  });
});

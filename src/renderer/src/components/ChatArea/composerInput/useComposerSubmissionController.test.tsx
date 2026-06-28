import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommandDispatchAction, SlashCommand } from '@shared/types';
import { useComposerInputController } from './useComposerInputController';
import { useComposerSubmissionController } from './useComposerSubmissionController';

const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set a session goal',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

describe('useComposerSubmissionController', () => {
  it('submits Session Composer Input as a Conversation message', async () => {
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn();
    const selectSession = vi.fn();
    const fetchSessions = vi.fn();

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'session',
        activeSessionId: 'session-1',
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [],
        resolveCommand: () => null,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    act(() => {
      result.current.composerInput.handleTextChange('Fix the failing tests', 'Fix the failing tests'.length);
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.submit();
    });

    expect(submissionResult).toEqual({ type: 'submittedConversation' });
    expect(sendMessage).toHaveBeenCalledWith(
      'project-1',
      'Fix the failing tests',
      { providerId: 'provider-1', model: 'model-a' },
      undefined,
      { imageBase64: undefined }
    );
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(result.current.composerInput.text).toBe('');
  });

  it('creates a Conversation before submitting Welcome Composer Input', async () => {
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn(async () => ({ id: 'session-2' }));
    const selectSession = vi.fn(async () => {});
    const fetchSessions = vi.fn(async () => {});
    const setSessionModelOverride = vi.fn();

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'welcome',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'welcome',
        activeSessionId: null,
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [],
        resolveCommand: () => null,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => ({ providerId: 'provider-1', model: 'model-a' }),
        setSessionModelOverride,
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    act(() => {
      result.current.composerInput.handleTextChange('Fix the failing tests', 'Fix the failing tests'.length);
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.submit();
    });

    expect(submissionResult).toEqual({ type: 'submittedConversation' });
    expect(createSession).toHaveBeenCalledWith('project-1', 'Fix the failing');
    expect(setSessionModelOverride).toHaveBeenNthCalledWith(1, 'session-2', 'provider-1', 'model-a');
    expect(setSessionModelOverride).toHaveBeenNthCalledWith(2, '', '', '');
    expect(selectSession).toHaveBeenCalledWith('session-2');
    expect(fetchSessions).toHaveBeenCalledWith('project-1');
    expect(sendMessage).toHaveBeenCalledWith(
      'project-1',
      'Fix the failing tests',
      { providerId: 'provider-1', model: 'model-a' },
      undefined,
      { imageBase64: undefined }
    );
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]
    );
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(result.current.composerInput.text).toBe('');
  });

  it('dispatches a selected Command Entry in a Session Conversation', async () => {
    const plan: CommandDispatchAction = {
      kind: 'SystemLocal',
      command: goalCommand,
      args: '',
    };
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn();
    const selectSession = vi.fn();
    const fetchSessions = vi.fn();

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand: (input) => (input === '/goal' ? plan : null),
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'session',
        activeSessionId: 'session-1',
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [goalCommand],
        resolveCommand: (input) => (input === '/goal' ? plan : null),
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.selectCommandEntry>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.selectCommandEntry('/goal');
    });

    expect(submissionResult).toEqual({ type: 'dispatchedCommand' });
    expect(dispatchCommand).toHaveBeenCalledWith(plan);
    expect(result.current.composerInput.text).toBe('');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    expect(fetchSessions).not.toHaveBeenCalled();
  });

  it('creates a Conversation before dispatching a submitted Welcome Command Entry', async () => {
    const plan: CommandDispatchAction = {
      kind: 'SystemLocal',
      command: goalCommand,
      args: 'fix tests',
    };
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn(async () => ({ id: 'session-2' }));
    const selectSession = vi.fn(async () => {});
    const fetchSessions = vi.fn(async () => {});

    const resolveCommand = (input: string) => (input.startsWith('/goal') ? plan : null);

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'welcome',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'welcome',
        activeSessionId: null,
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [goalCommand],
        resolveCommand,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    let selectResult: Awaited<ReturnType<typeof result.current.submission.selectCommandEntry>> | undefined;
    await act(async () => {
      selectResult = await result.current.submission.selectCommandEntry('/goal');
    });

    expect(selectResult).toEqual({ type: 'noop' });
    expect(result.current.composerInput.text).toBe('/goal ');
    expect(dispatchCommand).not.toHaveBeenCalled();

    act(() => {
      result.current.composerInput.setText('/goal fix tests');
    });

    let submitResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submitResult = await result.current.submission.submit();
    });

    expect(submitResult).toEqual({ type: 'dispatchedCommand' });
    expect(createSession).toHaveBeenCalledWith('project-1', '/goal fix tests');
    expect(selectSession).toHaveBeenCalledWith('session-2');
    expect(fetchSessions).toHaveBeenCalledWith('project-1');
    expect(dispatchCommand).toHaveBeenCalledWith(plan);
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchCommand.mock.invocationCallOrder[0]
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.composerInput.text).toBe('');
  });

  it('submits attachment-only Welcome Composer Input with an image Conversation Draft Name', async () => {
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn(async () => ({ id: 'session-2' }));
    const selectSession = vi.fn(async () => {});
    const fetchSessions = vi.fn(async () => {});

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'welcome',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'welcome',
        activeSessionId: null,
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [],
        resolveCommand: () => null,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    act(() => {
      result.current.composerInput.addAttachment({
        dataUrl: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        sizeBytes: 1024,
      });
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.submit();
    });

    expect(submissionResult).toEqual({ type: 'submittedConversation' });
    expect(createSession).toHaveBeenCalledWith('project-1', '图片对话');
    expect(sendMessage).toHaveBeenCalledWith(
      'project-1',
      '请描述这张图片',
      { providerId: 'provider-1', model: 'model-a' },
      undefined,
      { imageBase64: ['data:image/png;base64,abc'] }
    );
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it('returns a createConversation failure result when Welcome Conversation creation fails', async () => {
    const error = new Error('create failed');
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn(async () => {
      throw error;
    });
    const selectSession = vi.fn(async () => {});
    const fetchSessions = vi.fn(async () => {});

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'welcome',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'welcome',
        activeSessionId: null,
        currentProjectId: 'project-1',
        isStreaming: false,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [],
        resolveCommand: () => null,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    act(() => {
      result.current.composerInput.handleTextChange('Fix the failing tests', 'Fix the failing tests'.length);
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.submit();
    });

    expect(submissionResult).toEqual({
      type: 'failed',
      phase: 'createConversation',
      error,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    expect(fetchSessions).not.toHaveBeenCalled();
  });

  it('does not submit while a Conversation is streaming', async () => {
    const sendMessage = vi.fn(async () => {});
    const dispatchCommand = vi.fn(async () => {});
    const createSession = vi.fn();
    const selectSession = vi.fn();
    const fetchSessions = vi.fn();

    const { result } = renderHook(() => {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      const submission = useComposerSubmissionController({
        composerInput,
        mode: 'session',
        activeSessionId: 'session-1',
        currentProjectId: 'project-1',
        isStreaming: true,
        selectedProviderId: 'provider-1',
        selectedModel: 'model-a',
        commands: [],
        resolveCommand: () => null,
        dispatchCommand,
        createSession,
        selectSession,
        fetchSessions,
        sendMessage,
        getWelcomeModelOverride: () => null,
        setSessionModelOverride: () => {},
        t: (key) => key,
      });

      return { composerInput, submission };
    });

    act(() => {
      result.current.composerInput.handleTextChange('Fix the failing tests', 'Fix the failing tests'.length);
    });

    let submissionResult: Awaited<ReturnType<typeof result.current.submission.submit>> | undefined;
    await act(async () => {
      submissionResult = await result.current.submission.submit();
    });

    expect(submissionResult).toEqual({ type: 'noop' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

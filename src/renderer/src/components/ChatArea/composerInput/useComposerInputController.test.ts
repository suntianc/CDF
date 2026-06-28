import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerInputController } from './useComposerInputController';

const OriginalFileReader = globalThis.FileReader;

afterEach(() => {
  globalThis.FileReader = OriginalFileReader;
});

describe('useComposerInputController', () => {
  it('loads and releases Path Mention candidates through the controller seam', async () => {
    const listPathMentionCandidates = vi.fn(async () => ({
      candidates: ['src/foo.ts'],
      truncated: true,
    }));

    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates,
      })
    );

    act(() => {
      result.current.handleTextChange('@sr', 3);
    });

    expect(listPathMentionCandidates).toHaveBeenCalledWith('project-1');
    expect(result.current.pathMention).toMatchObject({
      isOpen: true,
      query: 'sr',
      loading: true,
      candidates: [],
    });

    await waitFor(() => {
      expect(result.current.pathMention).toMatchObject({
        isOpen: true,
        query: 'sr',
        loading: false,
        candidates: ['src/foo.ts'],
        truncated: true,
      });
    });

    act(() => {
      result.current.closePathMention();
    });

    expect(result.current.pathMention).toMatchObject({
      isOpen: false,
      loading: false,
      candidates: [],
      truncated: false,
    });
  });

  it('does not let a closed Path Mention request resurrect candidates', async () => {
    let resolveCandidates: (
      result: { candidates: string[]; truncated: boolean }
    ) => void = () => {};
    const listPathMentionCandidates = vi.fn(
      () =>
        new Promise<{ candidates: string[]; truncated: boolean }>((resolve) => {
          resolveCandidates = resolve;
        })
    );

    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates,
      })
    );

    act(() => {
      result.current.handleTextChange('@sr', 3);
    });
    act(() => {
      result.current.closePathMention();
    });
    await act(async () => {
      resolveCandidates({ candidates: ['src/stale.ts'], truncated: false });
      await Promise.resolve();
    });

    expect(result.current.pathMention).toMatchObject({
      isOpen: false,
      loading: false,
      candidates: [],
      truncated: false,
    });
  });

  it('selects a Path Mention candidate as literal Composer Input text', async () => {
    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      })
    );

    act(() => {
      result.current.handleTextChange('inspect @sr', 'inspect @sr'.length);
    });
    act(() => {
      result.current.selectPathMention('src/foo.ts');
    });

    expect(result.current.text).toBe('inspect @src/foo.ts ');
    expect(result.current.pathMention.isOpen).toBe(false);
  });

  it('submits prepared Conversation input as an intent and clears controller state', () => {
    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      })
    );

    act(() => {
      result.current.handleTextChange('Fix the failing tests', 'Fix the failing tests'.length);
    });

    let intent: ReturnType<typeof result.current.submit> | undefined;
    act(() => {
      intent = result.current.submit();
    });

    expect(intent).toEqual({
      type: 'sendConversation',
      mode: 'session',
      content: 'Fix the failing tests',
      attachments: [],
    });
    expect(result.current.text).toBe('');
  });

  it('swallows submit immediately after IME composition finishes through the controller', () => {
    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      })
    );

    act(() => {
      result.current.handleTextChange('修复测试', '修复测试'.length);
      result.current.startComposition();
      result.current.finishComposition();
    });

    let intent: ReturnType<typeof result.current.submit> | undefined;
    act(() => {
      intent = result.current.submit();
    });

    expect(intent).toEqual({ type: 'noop' });
    expect(result.current.text).toBe('修复测试');

    act(() => {
      intent = result.current.submit();
    });

    expect(intent).toEqual({
      type: 'sendConversation',
      mode: 'session',
      content: '修复测试',
      attachments: [],
    });
  });

  it('turns pasted image clipboard data into a Composer Attachment', () => {
    class ImmediateFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;

      readAsDataURL() {
        this.onload?.({ target: { result: 'data:image/png;base64,abc' } });
      }
    }
    globalThis.FileReader = ImmediateFileReader as unknown as typeof FileReader;

    const { result } = renderHook(() =>
      useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      })
    );
    const preventDefault = vi.fn();

    act(() => {
      result.current.handlePaste({
        preventDefault,
        clipboardData: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => new File(['image'], 'image.png', { type: 'image/png' }),
            },
          ],
        },
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.attachments).toEqual(['data:image/png;base64,abc']);
  });
});

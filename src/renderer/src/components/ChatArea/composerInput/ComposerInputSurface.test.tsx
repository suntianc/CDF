import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ComposerInputSurface } from './ComposerInputSurface';
import { useComposerInputController } from './useComposerInputController';
import type { SlashCommand } from '@shared/types';

const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set a session goal',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = globalThis.ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ComposerInputSurface', () => {
  it('lets a user prepare and submit a Welcome Composer Input instruction', () => {
    const onSubmit = vi.fn();

    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'welcome',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="welcome"
          inputLabel="Welcome Composer Input"
          placeholder="Ask CDF"
          commands={[]}
          commandWarnings={[]}
          commandLoading="idle"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={onSubmit}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);

    const input = screen.getByLabelText('Welcome Composer Input');
    act(() => {
      fireEvent.change(input, { target: { value: 'Fix the failing tests' } });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Send'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('reconstructs full Composer Input text when editing after a leading Command Entry', () => {
    let latestText = '';

    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });
      latestText = composerInput.text;
      (window as unknown as { surfaceHarness: { setText: typeof composerInput.setText } }).surfaceHarness = {
        setText: composerInput.setText,
      };

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[goalCommand]}
          commandWarnings={[]}
          commandLoading="idle"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {}}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);

    act(() => {
      (window as unknown as { surfaceHarness: { setText: (text: string) => void } }).surfaceHarness.setText('/goal fix it');
    });

    const input = screen.getByLabelText('Session Composer Input') as HTMLTextAreaElement;
    expect(input.value).toBe('fix it');

    act(() => {
      fireEvent.change(input, { target: { value: 'fix it now' } });
    });

    expect(latestText).toBe('/goal fix it now');
  });

  it('renders Composer Attachment previews and removes them from controller state', () => {
    let latestAttachments: string[] = [];

    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });
      latestAttachments = composerInput.attachments;
      (window as unknown as { attachmentHarness: { addAttachment: typeof composerInput.addAttachment } }).attachmentHarness = {
        addAttachment: composerInput.addAttachment,
      };

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[]}
          commandWarnings={[]}
          commandLoading="idle"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {}}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);

    act(() => {
      (window as unknown as {
        attachmentHarness: {
          addAttachment: (attachment: { dataUrl: string; mimeType: string; sizeBytes: number }) => void;
        };
      }).attachmentHarness.addAttachment({
        dataUrl: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        sizeBytes: 1024,
      });
    });

    expect(screen.getByAltText('image_1')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByLabelText('Remove image 1'));
    });

    expect(latestAttachments).toEqual([]);
  });

  it('opens Command Entry candidates when the user types a leading slash', () => {
    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[goalCommand]}
          commandWarnings={[]}
          commandLoading="ready"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {}}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);

    act(() => {
      fireEvent.change(screen.getByLabelText('Session Composer Input'), {
        target: { value: '/' },
      });
    });

    expect(screen.getByText('/goal')).toBeTruthy();
  });

  it('opens Command Entry candidates only on the active Composer Input Surface', () => {
    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      return (
        <>
          <ComposerInputSurface
            controller={composerInput}
            variant="welcome"
            inputLabel="Welcome Composer Input"
            placeholder="Ask CDF"
            commands={[goalCommand]}
            commandWarnings={[]}
            commandLoading="ready"
            onCommandSelect={() => {}}
            onCommandInsert={() => {}}
            onSubmit={() => {}}
            canSubmit={composerInput.text.trim().length > 0}
            sendLabel="Send"
            popoverEnabled={false}
          />
          <ComposerInputSurface
            controller={composerInput}
            variant="session"
            inputLabel="Session Composer Input"
            placeholder="Ask CDF"
            commands={[goalCommand]}
            commandWarnings={[]}
            commandLoading="ready"
            onCommandSelect={() => {}}
            onCommandInsert={() => {}}
            onSubmit={() => {}}
            canSubmit={composerInput.text.trim().length > 0}
            sendLabel="Send"
            popoverEnabled
          />
        </>
      );
    }

    render(<Harness />);

    act(() => {
      fireEvent.change(screen.getByLabelText('Session Composer Input'), {
        target: { value: '/' },
      });
    });

    expect(screen.getAllByText('/goal')).toHaveLength(1);
  });

  it('shows Path Mention candidates and inserts the selected candidate', async () => {
    let latestText = '';

    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({
          candidates: ['src/foo.ts'],
          truncated: false,
        }),
      });
      latestText = composerInput.text;

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[]}
          commandWarnings={[]}
          commandLoading="idle"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {}}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);

    act(() => {
      fireEvent.change(screen.getByLabelText('Session Composer Input'), {
        target: { value: '@sr' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('src/foo.ts')).toBeTruthy();
    });

    act(() => {
      fireEvent.click(screen.getByText('src/foo.ts'));
    });

    expect(latestText).toBe('@src/foo.ts ');
  });

  it('does not send on the Enter key that immediately follows IME composition', () => {
    const sendConversation = vi.fn();

    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[]}
          commandWarnings={[]}
          commandLoading="idle"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {
            const intent = composerInput.submit();
            if (intent.type === 'sendConversation') {
              sendConversation(intent.content);
            }
          }}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('Session Composer Input');

    act(() => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: '修复测试' } });
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(sendConversation).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(sendConversation).toHaveBeenCalledWith('修复测试');
  });

  it.each([
    ['welcome', 'click', 'Welcome Composer Input'] as const,
    ['welcome', 'enter', 'Welcome Composer Input'] as const,
    ['session', 'click', 'Session Composer Input'] as const,
    ['session', 'enter', 'Session Composer Input'] as const,
  ])(
    'sends %s Composer Input on the first %s after the IME guard expires',
    (variant, submitMethod, inputLabel) => {
      vi.useFakeTimers();
      const sendConversation = vi.fn();

      function Harness() {
        const composerInput = useComposerInputController({
          mode: variant,
          isStreaming: false,
          projectId: 'project-1',
          hasPathMentionProject: true,
          commands: [],
          resolveCommand: () => null,
          listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
        });

        return (
          <ComposerInputSurface
            controller={composerInput}
            variant={variant}
            inputLabel={inputLabel}
            placeholder="Ask CDF"
            commands={[]}
            commandWarnings={[]}
            commandLoading="idle"
            onCommandSelect={() => {}}
            onCommandInsert={() => {}}
            onSubmit={() => {
              const intent = composerInput.submit();
              if (intent.type === 'sendConversation') {
                sendConversation(intent.content);
              }
            }}
            canSubmit={composerInput.text.trim().length > 0}
            sendLabel="Send"
          />
        );
      }

      render(<Harness />);
      const input = screen.getByLabelText(inputLabel);

      act(() => {
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: '修复测试' } });
        fireEvent.compositionEnd(input);
        vi.advanceTimersByTime(250);
      });

      act(() => {
        if (submitMethod === 'click') {
          fireEvent.click(screen.getByLabelText('Send'));
        } else {
          fireEvent.keyDown(input, { key: 'Enter' });
        }
      });

      expect(sendConversation).toHaveBeenCalledTimes(1);
      expect(sendConversation).toHaveBeenCalledWith('修复测试');
    }
  );

  it('keeps Command Entry closed while IME composition changes include a slash', () => {
    function Harness() {
      const composerInput = useComposerInputController({
        mode: 'session',
        isStreaming: false,
        projectId: 'project-1',
        hasPathMentionProject: true,
        commands: [goalCommand],
        resolveCommand: () => null,
        listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
      });

      return (
        <ComposerInputSurface
          controller={composerInput}
          variant="session"
          inputLabel="Session Composer Input"
          placeholder="Ask CDF"
          commands={[goalCommand]}
          commandWarnings={[]}
          commandLoading="ready"
          onCommandSelect={() => {}}
          onCommandInsert={() => {}}
          onSubmit={() => {}}
          canSubmit={composerInput.text.trim().length > 0}
          sendLabel="Send"
        />
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('Session Composer Input');

    act(() => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: '/' } });
    });

    expect(screen.queryByText('/goal')).toBeNull();
  });
});

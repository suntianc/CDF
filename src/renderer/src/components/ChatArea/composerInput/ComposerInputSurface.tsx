import { ArrowUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { SlashCommand } from '@shared/types';
import type { RegistryLoadingState, RegistryWarning } from '@/hooks/useCommandRegistry';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  SlashCommandPopup,
  type SlashCommandPopupHandle,
} from '@/components/SlashCommand/SlashCommandPopup';
import {
  AtMentionPopup,
  type AtMentionPopupHandle,
} from '@/components/AtMention/AtMentionPopup';
import type { ComposerInputController } from './useComposerInputController';
import type { ComposerInputLeadingItem } from './composerInput';

function getTokenColorClass(token: ComposerInputLeadingItem): string {
  if (token.type === 'pathMention') {
    return 'text-[var(--color-info)]';
  }
  switch (token.source) {
    case 'mcp':
      return 'text-[var(--color-success)]';
    case 'skill:project':
    case 'skill:global':
      return 'text-[var(--color-warning)]';
    case 'workflow':
      return 'text-[var(--color-danger)]';
    case 'system':
    case 'cmd:project':
    case 'cmd:system':
    default:
      return 'text-[var(--color-accent)]';
  }
}

export interface ComposerInputSurfaceProps {
  controller: ComposerInputController;
  variant: 'welcome' | 'session';
  inputLabel: string;
  placeholder: string;
  commands: ReadonlyArray<SlashCommand>;
  commandWarnings: ReadonlyArray<RegistryWarning>;
  commandLoading: RegistryLoadingState;
  onCommandSelect: (commandText: string) => void;
  onCommandInsert: (commandText: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  sendLabel: string;
  leftToolbarSlot?: ReactNode;
  modelSelectorSlot?: ReactNode;
  submitSlot?: ReactNode;
  popoverEnabled?: boolean;
}

export function ComposerInputSurface({
  controller,
  variant,
  inputLabel,
  placeholder,
  commands,
  commandWarnings,
  commandLoading,
  onCommandSelect,
  onCommandInsert,
  onSubmit,
  canSubmit,
  sendLabel,
  leftToolbarSlot,
  modelSelectorSlot,
  submitSlot,
  popoverEnabled = true,
}: ComposerInputSurfaceProps) {
  const slashRef = useRef<SlashCommandPopupHandle>(null);
  const pathMentionRef = useRef<AtMentionPopupHandle>(null);
  const isComposingRef = useRef(false);
  const compositionGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokenOverlayRef = useRef<HTMLDivElement>(null);
  const [indentWidth, setIndentWidth] = useState(0);
  const leadingTokens = controller.renderModel.leadingItems;
  const pathContext = leadingTokens
    .filter((token) => token.type === 'pathMention')
    .map((token) => token.name);
  const visibleTail = controller.renderModel.visibleTail;
  const inputClassName =
    variant === 'welcome'
      ? 'dialog-input animate-fade-in caret-[var(--color-text-primary)] py-1.5 w-full'
      : 'w-full bg-transparent caret-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none resize-none text-sm max-h-40 overflow-y-auto py-1';
  const rootClassName =
    variant === 'welcome'
      ? 'dialog-box'
      : 'chat-composer relative z-10 flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-[background-color,border-color,box-shadow] duration-150';

  const applyTailChange = (tail: string, cursor: number) => {
    const prefix = leadingTokens.map((token) => token.raw).join(' ');
    const normalizedTail = tail.startsWith(' ') ? tail.slice(1) : tail;
    const value = `${prefix}${leadingTokens.length > 0 ? ' ' : ''}${normalizedTail}`;
    const fullCursor = cursor + (prefix ? prefix.length + 1 : 0);
    if (isComposingRef.current || controller.state.isComposing) {
      controller.setText(value, fullCursor);
      return;
    }
    controller.handleTextChange(value, fullCursor);
  };

  const clearCompositionGuardTimer = () => {
    if (!compositionGuardTimerRef.current) return;
    clearTimeout(compositionGuardTimerRef.current);
    compositionGuardTimerRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearCompositionGuardTimer();
    };
  }, []);

  useLayoutEffect(() => {
    const element = tokenOverlayRef.current;
    if (!element) {
      setIndentWidth(0);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setIndentWidth(width > 0 ? width + 6 : 0);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [leadingTokens]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [visibleTail]);

  const isComposingKeyEvent = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent['nativeEvent'] & {
      isComposing?: boolean;
      keyCode?: number;
      which?: number;
    };
    return (
      isComposingRef.current ||
      (event as unknown as { isComposing?: boolean }).isComposing ||
      nativeEvent.isComposing ||
      nativeEvent.keyCode === 229 ||
      nativeEvent.which === 229
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKeyEvent(event)) return;

    if (controller.commandEntry.isOpen) {
      if (event.key === 'Backspace' && controller.text === '/') {
        event.preventDefault();
        controller.closeCommandEntry();
        return;
      }
      const handled = slashRef.current?.handleKeyDown(event.nativeEvent) ?? false;
      if (handled) return;
    }

    if (controller.pathMention.isOpen) {
      const handled = pathMentionRef.current?.handleKeyDown(event.nativeEvent) ?? false;
      if (handled) return;
    }

    if (event.key === 'Backspace') {
      if (event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
        if (leadingTokens.length > 0) {
          event.preventDefault();
          controller.deletePreviousLeading(event.currentTarget.value);
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (!canSubmit) return;
      event.preventDefault();
      onSubmit();
    }
  };

  const input = (
    <textarea
      ref={textareaRef}
      aria-label={inputLabel}
      className={inputClassName}
      style={{ paddingLeft: indentWidth ? `${indentWidth}px` : undefined }}
      placeholder={leadingTokens.length > 0 ? '' : placeholder}
      rows={1}
      value={visibleTail}
      onChange={(event) => {
        applyTailChange(event.target.value, event.target.selectionStart);
      }}
      onCompositionStart={() => {
        clearCompositionGuardTimer();
        isComposingRef.current = true;
        controller.startComposition();
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        controller.finishComposition();
        clearCompositionGuardTimer();
        compositionGuardTimerRef.current = setTimeout(() => {
          controller.clearFinishedComposition();
          compositionGuardTimerRef.current = null;
        }, 200);
      }}
      onPaste={controller.handlePaste}
      onKeyDown={handleKeyDown}
    />
  );

  const leadingTokenOverlay = leadingTokens.length > 0 && (
    <div
      ref={tokenOverlayRef}
      className="absolute left-0 top-0 flex items-center gap-1.5 pointer-events-none select-none"
      style={{ height: variant === 'welcome' ? '36px' : '28px' }}
    >
      {leadingTokens.map((token, index) => (
        <span
          key={`${token.raw}:${index}`}
          className={`shrink-0 font-semibold select-none leading-none ${getTokenColorClass(token)}`}
        >
          {token.type === 'pathMention' ? '@' : ''}{token.name}
        </span>
      ))}
      <span className="shrink-0 text-[var(--color-text-muted)] select-none leading-none">·</span>
    </div>
  );

  const body = (
    <>
      {controller.attachments.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 pt-0.5 w-full" style={{ height: '88px' }}>
          {controller.attachments.map((dataUrl, index) => (
            <div key={`${dataUrl}:${index}`} className="relative shrink-0 group">
              <img
                src={dataUrl}
                alt={`image_${index + 1}`}
                className="w-[72px] h-[72px] object-cover rounded"
              />
              <button
                type="button"
                onClick={() => controller.removeAttachment(index)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove image ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {variant === 'welcome' ? (
        <div className="w-full">
          <div className="flex items-start gap-1.5 w-full relative z-0" style={{ fontSize: '15px' }}>
            <div className="relative overflow-hidden flex-1 min-w-0">
              {leadingTokenOverlay}
              {input}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-1.5 w-full relative z-0" style={{ fontSize: '14px' }}>
          <div className="relative overflow-hidden flex-1 min-w-0">
            {leadingTokenOverlay}
            {input}
          </div>
        </div>
      )}

      <div className={variant === 'welcome' ? 'dialog-bottom' : 'flex justify-between items-center border-t border-[var(--color-border)]/30 pt-2.5 mt-1'}>
        <div className={variant === 'welcome' ? 'dialog-bottom-left' : 'flex items-center gap-1.5'}>
          {leftToolbarSlot}
        </div>
        <div className={variant === 'welcome' ? 'dialog-bottom-right' : 'flex items-center gap-1.5'}>
          {modelSelectorSlot}
          {submitSlot ?? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="dialog-btn send"
              aria-label={sendLabel}
              title={sendLabel}
            >
              <ArrowUp className={variant === 'welcome' ? 'w-4.5 h-4.5' : 'w-4 h-4'} />
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Popover
      open={popoverEnabled && (controller.commandEntry.isOpen || controller.pathMention.isOpen)}
      onOpenChange={(open) => {
        if (!open) {
          controller.closeCommandEntry();
          controller.closePathMention();
        }
      }}
      modal={false}
    >
      <PopoverAnchor asChild>
        <div className={rootClassName}>{body}</div>
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        align="start"
        side="top"
        sideOffset={8}
        className="w-[var(--radix-popover-anchor-width)]"
      >
        {controller.commandEntry.isOpen ? (
          <SlashCommandPopup
            ref={slashRef}
            query={controller.text.startsWith('/') ? controller.text.slice(1) : ''}
            onSelect={onCommandSelect}
            onInsert={onCommandInsert}
            onClose={controller.closeCommandEntry}
            commands={commands as SlashCommand[]}
            pathContext={pathContext}
            hasMcpWarning={commandWarnings.some((warning) => warning.type === 'mcp_health_warning')}
            mcpWarningMessage={commandWarnings.find((warning) => warning.type === 'mcp_health_warning')?.message}
            loading={commandLoading}
          />
        ) : (
          <AtMentionPopup
            ref={pathMentionRef}
            query={controller.pathMention.query}
            candidates={controller.pathMention.candidates}
            truncated={controller.pathMention.truncated}
            loading={controller.pathMention.loading}
            onSelect={controller.selectPathMention}
            onClose={controller.closePathMention}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

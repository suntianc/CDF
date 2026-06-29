import type { ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import type { SlashCommand, TodoItem } from '@shared/types';
import type { RegistryLoadingState, RegistryWarning } from '@/hooks/useCommandRegistry';
import { ComposerInputSurface } from './composerInput/ComposerInputSurface';
import type { ComposerInputController } from './composerInput/useComposerInputController';
import { TodoList } from './TodoList';

export interface ConversationComposerDockProps {
  hidden: boolean;
  showTodos: boolean;
  todos: TodoItem[];
  todoExpanded: boolean;
  onToggleTodoExpanded: () => void;
  composerController: ComposerInputController;
  isStreaming: boolean;
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
  stopGeneratingLabel: string;
  onStopGenerating: () => void;
  leftToolbarSlot?: ReactNode;
  modelSelectorSlot?: ReactNode;
}

export function ConversationComposerDock({
  hidden,
  showTodos,
  todos,
  todoExpanded,
  onToggleTodoExpanded,
  composerController,
  isStreaming,
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
  stopGeneratingLabel,
  onStopGenerating,
  leftToolbarSlot,
  modelSelectorSlot,
}: ConversationComposerDockProps) {
  return (
    <div className={`absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 z-10 pointer-events-none ${hidden ? 'hidden' : ''}`}>
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[var(--color-bg-app)] via-[var(--color-bg-app)]/85 to-transparent z-0 pointer-events-none" />
      <div className="relative z-10 w-full max-w-[760px] mx-auto flex flex-col gap-3 pointer-events-auto">
        {showTodos && (
          <TodoList
            todos={todos}
            isExpanded={todoExpanded}
            onToggleExpanded={onToggleTodoExpanded}
          />
        )}
        <ComposerInputSurface
          controller={composerController}
          variant="session"
          inputLabel={inputLabel}
          placeholder={placeholder}
          commands={commands}
          commandWarnings={commandWarnings}
          commandLoading={commandLoading}
          onCommandSelect={onCommandSelect}
          onCommandInsert={onCommandInsert}
          onSubmit={onSubmit}
          canSubmit={canSubmit}
          sendLabel={sendLabel}
          popoverEnabled
          leftToolbarSlot={leftToolbarSlot}
          modelSelectorSlot={modelSelectorSlot}
          submitSlot={
            isStreaming ? (
              <button
                type="button"
                onClick={onStopGenerating}
                className="p-2 rounded-lg bg-[var(--color-danger-dim)] hover:bg-[var(--color-danger)] hover:text-white text-[var(--color-danger)] transition-all flex items-center justify-center cursor-pointer"
                title={stopGeneratingLabel}
                aria-label={stopGeneratingLabel}
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="dialog-btn send"
                aria-label={sendLabel}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

import { Send, Square } from 'lucide-react';

export function ChatArea() {
  return (
    <div className="flex flex-col h-full">
      {/* Messages area - placeholder for Phase 1 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
            Agent 开发工作站
          </h2>
          <p className="text-[var(--color-text-secondary)]">
            基于自然语言驱动的自动化开发工作流
          </p>
        </div>
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-bg-surface)] rounded-lg px-4 py-3">
          <input
            type="text"
            placeholder="描述您的需求..."
            className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
          />
          <button
            type="button"
            className="p-2 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-2 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

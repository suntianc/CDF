import { useState, useRef, useEffect } from 'react'

interface InputAreaProps {
  onSend: (content: string) => void
  onStop?: () => void
  disabled?: boolean
  placeholder?: string
}

export function InputArea({ onSend, onStop, disabled = false, placeholder = '向 CDF 提问……' }: InputAreaProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 36), 200)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [value])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col gap-1 px-2 pb-4">
      <div
        className={`
          flex items-end gap-2 rounded-[10px] border bg-transparent
          px-3 py-2
          ${disabled
            ? 'border-[var(--border)] opacity-50'
            : 'border-[var(--border-strong)] focus-within:ring-1 focus-within:ring-[var(--accent)]'
          }
          transition-all
        `}
        style={{ minHeight: '36px', maxHeight: '200px' }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="
            flex-1 bg-transparent text-[14px] leading-relaxed
            text-[var(--text-primary)] placeholder-[var(--text-muted)]
            resize-none outline-none no-scrollbar
            font-['Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif]
          "
          style={{ minHeight: '36px', maxHeight: '200px' }}
        />
        <button
          onClick={disabled ? onStop : handleSend}
          disabled={disabled ? false : !value.trim()}
          className={`
            shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center
            font-medium text-[14px] transition-all
            ${disabled
              ? 'bg-[var(--danger)] text-white hover:opacity-90 cursor-pointer'
              : value.trim()
                ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] cursor-pointer'
                : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed'
            }
          `}
          aria-label={disabled ? '停止' : '发送消息'}
        >
          {disabled ? '■' : '↑'}
        </button>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] px-1 font-['Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif]">
        按下 Enter 发送 · Shift + Enter 换行
      </p>
    </div>
  )
}

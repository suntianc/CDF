import { useState, useRef, useCallback, useEffect } from 'react'

interface InputAreaProps {
  onSend: (content: string, images?: Array<{ data: string; mimeType: string }>) => void
  onStop: () => void
  isGenerating: boolean
  disabled: boolean
}

export function InputArea({ onSend, onStop, isGenerating, disabled }: InputAreaProps) {
  const [input, setInput] = useState('')
  const [showSentToast, setShowSentToast] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea (1 → 6-8 lines max)
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }, [input])

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return

    onSend(trimmed)
    setInput('')
    setShowSentToast(true)
    setTimeout(() => setShowSentToast(false), 2000)
  }, [input, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends (without Shift), Shift+Enter adds newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isGenerating) {
        // During generation, empty input = stop, has content = queue (handled later)
        if (input.trim() === '') {
          onStop()
        }
      } else {
        handleSend()
      }
    }
  }

  const canSend = input.trim().length > 0 && !disabled

  return (
    <div className="border-t border-[#ebebeb] dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] px-4 py-2">
      {/* Sent toast */}
      {showSentToast && (
        <div className="text-xs text-[#16a34a] mb-1 transition-opacity duration-200">
          已发送
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，或 /gsd-* 执行命令"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm leading-5 text-[#171717] dark:text-white placeholder:text-[#888888] outline-none py-2 min-h-[40px] max-h-[200px]"
        />

        {/* Send/Stop button */}
        {isGenerating && input.trim() === '' ? (
          <button
            onClick={onStop}
            className="shrink-0 px-3 py-1.5 bg-[#ee0000] text-white text-sm font-medium leading-5 rounded-[100px] hover:opacity-90 transition-opacity"
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`shrink-0 px-3 py-1.5 text-sm font-medium leading-5 rounded-[100px] transition-all ${
              canSend
                ? 'bg-[#171717] text-white dark:bg-white dark:text-[#171717] hover:opacity-90'
                : 'bg-[#ebebeb] text-[#888888] dark:bg-[#2a2a2a] dark:text-[#666] cursor-not-allowed'
            }`}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
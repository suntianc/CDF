import { useState, useRef, useCallback, useEffect } from 'react'
import { CommandPalette } from './CommandPalette'

interface GSDCommand {
  id: string
  name: string
  description: string
  args: string
  icon: string
}

interface InputAreaProps {
  onSend: (content: string, images?: Array<{ data: string; mimeType: string }>) => void
  onStop: () => void
  isGenerating: boolean
  disabled: boolean
  onGSDCommand?: (command: string, args: string) => void
  gsdCommands?: GSDCommand[]
  onQueueAdd?: (content: string) => void
}

export function InputArea({ onSend, onStop, isGenerating, disabled, onGSDCommand, gsdCommands, onQueueAdd }: InputAreaProps) {
  const [input, setInput] = useState('')
  const [showSentToast, setShowSentToast] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [gsdFilter, setGSDfilter] = useState('')
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

  // Detect /gsd- input for command palette
  useEffect(() => {
    const gsdMatch = input.match(/^\/gsd-(\w*)$/)
    if (gsdMatch) {
      setGSDfilter(gsdMatch[1])
      setShowCommandPalette(true)
    } else if (input.startsWith('/gsd-') && input.includes(' ')) {
      // User already selected a command and is typing args
      setShowCommandPalette(false)
    } else {
      setShowCommandPalette(false)
    }
  }, [input])

  const handleGSDSelect = useCallback((command: string, args: string) => {
    setInput(`/gsd-${command} ${args}`)
    textareaRef.current?.focus()
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return

    // Check if this is a GSD command
    const gsdCmdMatch = trimmed.match(/^\/gsd-(\S+)\s*(.*)$/)
    if (gsdCmdMatch) {
      const cmd = gsdCmdMatch[1]
      const cmdArgs = gsdCmdMatch[2].split(/\s+/).filter(Boolean)
      onGSDCommand?.(cmd, cmdArgs.join(' '))
      setInput('')
      return
    }

    if (isGenerating) {
      // Queue the message instead of sending during AI reply
      onQueueAdd?.(trimmed)
      setInput('')
      return
    }

    // Normal send
    onSend(trimmed)
    setInput('')
    setShowSentToast(true)
    setTimeout(() => setShowSentToast(false), 2000)
  }, [input, onSend, onGSDCommand, isGenerating, onQueueAdd])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isGenerating) {
        if (input.trim() === '') {
          onStop()
        } else {
          // Queue message during AI reply
          onQueueAdd?.(input.trim())
          setInput('')
        }
      } else {
        handleSend()
      }
    }
  }

  const canSend = input.trim().length > 0 && !disabled

  return (
    <>
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        onSelect={handleGSDSelect}
        commands={gsdCommands}
        filter={gsdFilter}
      />
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
              {isGenerating ? '排队' : '发送'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
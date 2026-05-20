import { useState, useRef, useCallback, useEffect } from 'react'
import { CommandPalette } from './CommandPalette'
import { ImagePlus } from 'lucide-react'

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
  const [pendingImages, setPendingImages] = useState<Array<{ data: string; mimeType: string }>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      setShowCommandPalette(false)
    } else {
      setShowCommandPalette(false)
    }
  }, [input])

  const handleGSDSelect = useCallback((command: string, args: string) => {
    setInput(`/gsd-${command} ${args}`)
    textareaRef.current?.focus()
  }, [])

  // ── Image handling ──

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()
    imageItems.forEach(item => {
      const file = item.getAsFile()
      if (file) {
        const reader = new FileReader()
        reader.onload = () => {
          setPendingImages(prev => [...prev, {
            data: reader.result as string,
            mimeType: file.type
          }])
        }
        reader.readAsDataURL(file)
      }
    })
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          setPendingImages(prev => [...prev, {
            data: reader.result as string,
            mimeType: file.type
          }])
        }
        reader.readAsDataURL(file)
      }
    })
    // Reset so the same file can be selected again
    e.target.value = ''
  }, [])

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  // ── Send logic ──

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed && pendingImages.length === 0) return

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
      onQueueAdd?.(trimmed)
      setInput('')
      return
    }

    // Normal send with pending images
    onSend(trimmed, pendingImages.length > 0 ? pendingImages : undefined)
    setInput('')
    setPendingImages([])
    setShowSentToast(true)
    setTimeout(() => setShowSentToast(false), 2000)
  }, [input, pendingImages, onSend, onGSDCommand, isGenerating, onQueueAdd])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isGenerating) {
        if (input.trim() === '') {
          onStop()
        } else {
          onQueueAdd?.(input.trim())
          setInput('')
        }
      } else {
        handleSend()
      }
    }
  }

  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && !disabled

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

        {/* Image thumbnails */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 pb-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img.data}
                  alt="Upload preview"
                  className="w-16 h-16 object-cover rounded-md border border-[#ebebeb] dark:border-[#2a2a2a]"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[#ee0000] text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入消息，或 /gsd-* 执行命令"
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none bg-transparent text-sm leading-5 text-[#171717] dark:text-white placeholder:text-[#888888] outline-none py-2 min-h-[40px] max-h-[200px]"
          />

          {/* Image upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[#888] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] transition-colors"
            title="上传图片"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
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
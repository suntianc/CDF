import { useState, useRef, useCallback, useEffect } from 'react'
import { CommandPalette } from './CommandPalette'
import { ImagePlus, ArrowUp, Square } from 'lucide-react'

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
  availableModels?: Array<{ provider: string; id: string; name: string }>
  selectedModel?: string
  onModelChange?: (modelId: string) => void
}

export function InputArea({ onSend, onStop, isGenerating, disabled, onGSDCommand, gsdCommands, onQueueAdd, availableModels, selectedModel, onModelChange }: InputAreaProps) {
  const [input, setInput] = useState('')
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [gsdFilter, setGSDfilter] = useState('')
  const [pendingImages, setPendingImages] = useState<Array<{ data: string; mimeType: string }>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }, [input])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const gsdMatch = input.match(/^\/gsd-(\w*)$/)
    if (gsdMatch) {
      setGSDfilter(gsdMatch[1])
      setShowCommandPalette(true)
    } else {
      setShowCommandPalette(false)
    }
  }, [input])

  const handleGSDSelect = useCallback((command: string, args: string) => {
    setInput(`/gsd-${command} ${args}`)
    textareaRef.current?.focus()
  }, [])

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
          setPendingImages(prev => [...prev, { data: reader.result as string, mimeType: file.type }])
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
          setPendingImages(prev => [...prev, { data: reader.result as string, mimeType: file.type }])
        }
        reader.readAsDataURL(file)
      }
    })
    e.target.value = ''
  }, [])

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed && pendingImages.length === 0) return

    const gsdCmdMatch = trimmed.match(/^\/gsd-(\S+)\s*(.*)$/)
    if (gsdCmdMatch) {
      onGSDCommand?.(gsdCmdMatch[1], gsdCmdMatch[2])
      setInput('')
      return
    }

    if (isGenerating) {
      onQueueAdd?.(trimmed)
      setInput('')
      return
    }

    onSend(trimmed, pendingImages.length > 0 ? pendingImages : undefined)
    setInput('')
    setPendingImages([])
  }, [input, pendingImages, onSend, onGSDCommand, isGenerating, onQueueAdd])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && !disabled

  return (
    <>
      <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} onSelect={handleGSDSelect} commands={gsdCommands} filter={gsdFilter} />

      <div className="bg-white dark:bg-[#121216] p-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-800/80 shadow-elevated focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:ring-1 focus-within:ring-neutral-400/20 transition-all w-full min-w-0">
        
        {/* 图片资产预览流式环绕 */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2 border-b border-neutral-100 dark:border-neutral-800/50 mb-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-800 shrink-0">
                <img src={img.data} className="w-10 h-10 object-cover" alt="" />
                <button onClick={() => removeImage(i)} className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="有什么我可以帮你的？键入 /gsd-..."
          rows={1}
          disabled={disabled}
          className="w-full bg-transparent text-[13px] sm:text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 resize-none outline-none no-scrollbar min-h-[32px]"
        />

        {/* 底部控制：引入 flex-wrap 并增加最小宽度间距 */}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-neutral-100/70 dark:border-neutral-800/40 gap-2 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
              title="附带图像资产"
            >
              <ImagePlus className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />

            {/* ✨ 嵌入式模型选择标签 */}
            {availableModels && availableModels.length > 0 && selectedModel !== undefined && (
              <div className="relative flex items-center bg-neutral-100/60 dark:bg-neutral-800/50 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/80 px-2 py-0.5 rounded-md transition-all border border-neutral-200/20 max-w-[140px] sm:max-w-[200px]">
                <select
                  value={selectedModel}
                  onChange={(e) => onModelChange?.(e.target.value)}
                  className="appearance-none bg-transparent pr-3.5 text-[10px] font-mono font-medium text-neutral-500 dark:text-neutral-400 focus:outline-none cursor-pointer truncate w-full"
                >
                  {availableModels.map((m) => {
                    const val = `${m.provider}:${m.id}`
                    return (
                      <option key={val} value={val} className="bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200">
                        {m.name}
                      </option>
                    )
                  })}
                </select>
                <span className="absolute right-1.5 pointer-events-none text-neutral-400 text-[8px] scale-75">
                  ▼
                </span>
              </div>
            )}
            
            {/* 在超小窗口下自动隐藏提示语，防止挤压布局 */}
            <span className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500 px-1 truncate hidden sm:inline">
              Shift+Enter 换行
            </span>
          </div>

          <div className="shrink-0">
            {isGenerating && input.trim() === '' ? (
              <button onClick={onStop} className="p-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg shadow-sm transition-colors">
                <Square className="w-3.5 h-3.5 fill-white" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`p-1.5 rounded-lg transition-all ${
                  canSend
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 shadow-sm'
                    : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600 cursor-not-allowed opacity-40'
                }`}
              >
                <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
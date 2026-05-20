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
}

export function InputArea({ onSend, onStop, isGenerating, disabled, onGSDCommand, gsdCommands, onQueueAdd }: InputAreaProps) {
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

      {/* 外围渐变融合卡片 */}
      <div className="bg-white dark:bg-[#111115] p-3 rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 shadow-sm focus-within:border-neutral-400 dark:focus-within:border-neutral-600 transition-all">
        {/* 图片预览浮层 */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800/50 mb-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-800">
                <img src={img.data} className="w-12 h-12 object-cover" alt="" />
                <button onClick={() => removeImage(i)} className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
              </div>
            ))}
          </div>
        )}

        {/* 核心文本框 */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="有什么我可以帮你的？键入 /gsd- 唤醒工程工具..."
          rows={1}
          disabled={disabled}
          className="w-full bg-transparent text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 resize-none outline-none no-scrollbar min-h-[32px]"
        />

        {/* 底部控制工具栏区域：极致紧凑 */}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-neutral-100/70 dark:border-neutral-800/40">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              title="附带图像资产"
            >
              <ImagePlus className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            <span className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500 px-2">Shift+Enter 换行</span>
          </div>

          {/* 类似 ChatGPT 新版极简小圆形发送按钮 */}
          <div>
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
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 shadow-sm scale-100'
                    : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600 scale-95 cursor-not-allowed'
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
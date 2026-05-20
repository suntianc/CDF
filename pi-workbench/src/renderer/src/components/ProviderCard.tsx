import { Key, Trash2, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

interface ProviderCardProps {
  icon: ReactNode
  name: string
  type: string
  configured: boolean
  defaultModel?: string
  onConfigure: () => void
  onDelete?: () => void
}

export function ProviderCard({ icon, name, type, configured, defaultModel, onConfigure, onDelete }: ProviderCardProps) {
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full bg-transparent">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{name}</h3>
            {configured && (
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            )}
          </div>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{type}</span>
          {configured && defaultModel && (
            <div className="mt-0.5 text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
              {defaultModel}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onConfigure}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium rounded-full hover:opacity-90 transition-all"
        >
          <Key className="w-3 h-3" />
          {configured ? '编辑' : '配置'}
        </button>
        {configured && onDelete && (
          <button
            onClick={() => setDeleting(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-full transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Delete overlay */}
      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 dark:bg-black/40 rounded-xl z-10 backdrop-blur-sm">
          <div className="bg-white dark:bg-neutral-900 rounded-xl p-4 shadow-xl max-w-sm mx-4 space-y-3">
            <p className="text-xs text-neutral-700 dark:text-neutral-300">
              删除 <strong>{name}</strong>？此操作不可撤销。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { onDelete?.(); setDeleting(false) }} className="px-4 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-full hover:bg-rose-700 transition-colors">
                确定删除
              </button>
              <button onClick={() => setDeleting(false)} className="px-4 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

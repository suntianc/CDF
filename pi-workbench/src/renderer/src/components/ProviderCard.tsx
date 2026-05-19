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
    <div className="bg-white dark:bg-[#1a1a1a] rounded-[8px] p-6 shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#f5f5f5] dark:bg-[#252525]">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-medium text-[#171717] dark:text-white">{name}</h3>
            <span className="text-xs text-[#888]">{type}</span>
          </div>
        </div>
        {configured && (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#0070f3]" />
            <span className="text-xs text-[#0070f3]">已配置</span>
          </div>
        )}
      </div>

      {configured && defaultModel && (
        <p className="text-xs text-[#4d4d4d] dark:text-[#888]">
          默认模型：{defaultModel}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onConfigure}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171717] text-white text-xs font-medium rounded-[100px] hover:opacity-90 transition-opacity"
        >
          <Key className="w-3 h-3" />
          {configured ? '编辑' : '配置'}
        </button>
        {configured && onDelete && (
          <button
            onClick={() => setDeleting(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#ee0000] hover:bg-[#f7d4d6] rounded-[6px] transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            删除
          </button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleting && (
        <div className="bg-[#f7d4d6] dark:bg-[#3a1a1a] rounded-[6px] p-3 space-y-2">
          <p className="text-xs text-[#c50000]">
            删除提供商：{name} — 此操作不可撤销。确定要删除吗？
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { onDelete?.(); setDeleting(false) }}
              className="px-3 py-1 bg-[#ee0000] text-white text-xs rounded-[100px]"
            >
              确定删除
            </button>
            <button
              onClick={() => setDeleting(false)}
              className="px-3 py-1 text-xs text-[#4d4d4d] hover:bg-white rounded-[6px]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
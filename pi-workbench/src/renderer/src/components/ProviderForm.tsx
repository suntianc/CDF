import { useState } from 'react'
import { X } from 'lucide-react'

interface ProviderFormData {
  apiKey: string
  defaultModel: string
  providerName?: string
  baseUrl?: string
}

interface ProviderFormProps {
  type: string
  name: string
  initialApiKey?: string
  initialModel?: string
  initialProviderName?: string
  initialBaseUrl?: string
  onSave: (data: ProviderFormData) => void
  onCancel: () => void
}

export function ProviderForm({
  type,
  name,
  initialApiKey,
  initialModel,
  initialProviderName,
  initialBaseUrl,
  onSave,
  onCancel
}: ProviderFormProps) {
  const [apiKey, setApiKey] = useState(initialApiKey || '')
  const [defaultModel, setDefaultModel] = useState(initialModel || '')
  const [providerName, setProviderName] = useState(initialProviderName || '')
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      apiKey,
      defaultModel,
      ...(type === 'custom' ? { providerName, baseUrl } : {})
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-[#1a1a1a] rounded-[8px] p-6 shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#171717] dark:text-white">
          {type === 'custom' ? '配置自定义提供商' : `配置 ${name}`}
        </h3>
        <button type="button" onClick={onCancel} className="text-[#888] hover:text-[#171717]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {type === 'custom' && (
        <>
          <div>
            <label className="block text-xs text-[#4d4d4d] dark:text-[#888] mb-1">提供商名称</label>
            <input
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="例如：DeepSeek, Ollama, Groq..."
              className="w-full h-10 px-3 text-sm bg-white dark:bg-[#1a1a1a] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-[6px] text-[#171717] dark:text-white placeholder:text-[#888] focus:outline-none focus:ring-2 focus:ring-[#171717] dark:focus:ring-white"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-[#4d4d4d] dark:text-[#888] mb-1">API 端点 URL</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full h-10 px-3 text-sm bg-white dark:bg-[#1a1a1a] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-[6px] text-[#171717] dark:text-white placeholder:text-[#888] focus:outline-none focus:ring-2 focus:ring-[#171717] dark:focus:ring-white"
              required
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-xs text-[#4d4d4d] dark:text-[#888] mb-1">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full h-10 px-3 text-sm bg-white dark:bg-[#1a1a1a] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-[6px] text-[#171717] dark:text-white placeholder:text-[#888] focus:outline-none focus:ring-2 focus:ring-[#171717] dark:focus:ring-white"
          required
        />
      </div>

      <div>
        <label className="block text-xs text-[#4d4d4d] dark:text-[#888] mb-1">默认模型</label>
        <input
          type="text"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder={type === 'anthropic' ? 'claude-sonnet-4-20250514' : type === 'openai' ? 'gpt-4o' : type === 'google' ? 'gemini-2.0-flash' : 'deepseek-chat'}
          className="w-full h-10 px-3 text-sm bg-white dark:bg-[#1a1a1a] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-[6px] text-[#171717] dark:text-white placeholder:text-[#888] focus:outline-none focus:ring-2 focus:ring-[#171717] dark:focus:ring-white"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="px-4 py-1.5 bg-[#171717] text-white text-sm font-medium rounded-[100px] hover:opacity-90 transition-opacity"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 text-sm text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] rounded-[6px] transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  )
}
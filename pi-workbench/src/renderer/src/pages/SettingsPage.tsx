import { useState } from 'react'
import { Globe, Bot, Sparkles, Plus, Sun, Moon, Monitor, ShieldCheck } from 'lucide-react'
import { ProviderCard } from '../components/ProviderCard'
import { ProviderForm } from '../components/ProviderForm'
import { useProviders } from '../hooks/useProviders'
import { useTheme } from '../hooks/useTheme'

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  anthropic: <Sparkles className="w-4 h-4 text-orange-500" />,
  openai: <Bot className="w-4 h-4 text-emerald-500" />,
  google: <Globe className="w-4 h-4 text-blue-500" />,
  custom: <Globe className="w-4 h-4 text-indigo-500" />
}

const PROVIDER_DISPLAY_TYPES: Record<string, string> = {
  anthropic: 'Anthropic Core Claude Engine',
  openai: 'OpenAI Developer Platform',
  google: 'Google Gemini Pro Cloud',
  custom: 'OpenAI Compatible Endpoint'
}

export function SettingsPage() {
  const { providers, presets, saveProvider, deleteProvider } = useProviders()
  const { theme, setTheme } = useTheme()
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [showCustomForm, setShowCustomForm] = useState(false)

  function isConfigured(type: string): boolean {
    return providers.some(p => p.type === type)
  }
  function getProvider(type: string) {
    return providers.find(p => p.type === type)
  }

  function handleProviderSave(type: string, data: { apiKey: string; defaultModel: string; providerName?: string }) {
    const existing = getProvider(type)
    saveProvider({
      id: existing?.id,
      type: type as 'anthropic' | 'openai' | 'google' | 'custom',
      name: data.providerName || (type === 'custom' ? 'Custom Gateway' : (presets.find(p => p.type === type)?.name || type)),
      apiKey: data.apiKey,
      models: data.defaultModel ? [data.defaultModel] : [],
      defaultModel: data.defaultModel || undefined
    })
    setEditingProvider(null)
    setShowCustomForm(false)
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white dark:bg-[#0a0a0c] transition-colors duration-300 min-w-0">
      {/* 将 max-w-xl 升级为在平板/大屏下支持更大舒展度的 max-w-2xl，且内边距改用响应式 px-4 sm:px-8 */}
      <div className="max-w-2xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-10 min-w-0">

        {/* Header 页头 */}
        <div className="space-y-1">
          <h1 className="text-base font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
            控制台偏好设置
          </h1>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            全局 AI 核心引擎权重分发、密钥本地加密分发链及系统主题。
          </p>
        </div>

        {/* 提供商网格列表 */}
        <section className="space-y-3 min-w-0">
          <div className="flex items-center justify-between px-1 gap-2 flex-wrap">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              密钥网关提供商
            </h2>
            <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-md">
              <ShieldCheck className="w-3 h-3" /> 硬件级密钥隔离
            </div>
          </div>

          {/* 统一的一体化容器，去除外露套娃多层背景 */}
          <div className="rounded-xl border border-neutral-200/60 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-[#121215]/50 overflow-hidden divide-y divide-neutral-200/40 dark:divide-neutral-800/40 min-w-0">
            {presets.map((preset) => {
              const configured = isConfigured(preset.type)
              const provider = getProvider(preset.type)

              if (editingProvider === preset.type) {
                return (
                  <div key={preset.type} className="p-4 bg-white dark:bg-[#141418]">
                    <ProviderForm
                      type={preset.type}
                      name={preset.name}
                      initialApiKey={provider?.apiKey}
                      initialModel={provider?.defaultModel}
                      onSave={(data) => handleProviderSave(preset.type, data)}
                      onCancel={() => setEditingProvider(null)}
                    />
                  </div>
                )
              }

              return (
                <div key={preset.type} className="p-3.5 hover:bg-neutral-100/50 dark:hover:bg-[#16161c]/30 transition-colors">
                  <ProviderCard
                    icon={PROVIDER_ICONS[preset.type]}
                    name={preset.name}
                    type={PROVIDER_DISPLAY_TYPES[preset.type]}
                    configured={configured}
                    defaultModel={provider?.defaultModel}
                    onConfigure={() => setEditingProvider(preset.type)}
                    onDelete={configured ? () => deleteProvider(provider!.id) : undefined}
                  />
                </div>
              )
            })}

            {/* 自定义 OpenAI 提供商 */}
            {showCustomForm && (
              <div className="p-4 bg-white dark:bg-[#141418]">
                <ProviderForm
                  type="custom"
                  name="Custom OpenAI"
                  initialProviderName=""
                  onSave={(data) => handleProviderSave('custom', data)}
                  onCancel={() => setShowCustomForm(false)}
                />
              </div>
            )}

            {editingProvider === 'custom' && isConfigured('custom') && (() => {
              const cp = getProvider('custom')!
              return (
                <div key="custom-edit" className="p-4 bg-white dark:bg-[#141418]">
                  <ProviderForm
                    type="custom"
                    name={cp.name || 'Custom OpenAI'}
                    initialApiKey={cp.apiKey}
                    initialModel={cp.defaultModel}
                    initialProviderName={cp.name}
                    onSave={(data) => handleProviderSave('custom', data)}
                    onCancel={() => setEditingProvider(null)}
                  />
                </div>
              )
            })()}

            {!showCustomForm && editingProvider !== 'custom' && (
              isConfigured('custom') ? (
                (() => {
                  const cp = getProvider('custom')!
                  return (
                    <div className="p-3.5 hover:bg-neutral-100/50 dark:hover:bg-[#16161c]/30 transition-colors">
                      <ProviderCard
                        icon={PROVIDER_ICONS.custom}
                        name={cp.name || 'Custom OpenAI'}
                        type="OpenAI Compatible"
                        configured
                        defaultModel={cp.defaultModel}
                        onConfigure={() => setEditingProvider('custom')}
                        onDelete={() => deleteProvider(cp.id)}
                      />
                    </div>
                  )
                })()
              ) : (
                <div className="p-2.5 text-center bg-neutral-50/20 dark:bg-transparent">
                  <button
                    onClick={() => setShowCustomForm(true)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> 添加自定义兼容基准端点
                  </button>
                </div>
              )
            )}
          </div>
        </section>

        {/* 视觉外观控制区 */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 px-1">
            系统外观主题
          </h2>
          <div className="p-1 rounded-xl border border-neutral-200/60 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-[#121215]/50 flex gap-1">
            {[
              { value: 'light' as const, icon: <Sun className="w-3.5 h-3.5" />, label: '明亮模式' },
              { value: 'dark' as const, icon: <Moon className="w-3.5 h-3.5" />, label: '暗黑暗调' },
              { value: 'system' as const, icon: <Monitor className="w-3.5 h-3.5" />, label: '跟随系统' }
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  theme === opt.value
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
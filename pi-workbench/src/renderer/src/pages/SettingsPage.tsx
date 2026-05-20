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
  anthropic: 'Anthropic LLM Engine',
  openai: 'OpenAI Core Platform',
  google: 'Google Gemini Pro Cloud',
  custom: 'Standard OpenAI Compatible'
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

  function handleConfigure(type: string) {
    setEditingProvider(type)
  }

  function handleProviderSave(type: string, data: { apiKey: string; defaultModel: string; providerName?: string }) {
    const existing = getProvider(type)
    saveProvider({
      id: existing?.id,
      type: type as 'anthropic' | 'openai' | 'google' | 'custom',
      name: data.providerName || (type === 'custom' ? 'Custom OpenAI' : (presets.find(p => p.type === type)?.name || type)),
      apiKey: data.apiKey,
      models: data.defaultModel ? [data.defaultModel] : [],
      defaultModel: data.defaultModel || undefined
    })
    setEditingProvider(null)
    setShowCustomForm(false)
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-neutral-50 dark:bg-[#0b0b0b] transition-colors duration-300">
      <div className="max-w-xl mx-auto px-6 py-12 space-y-10">
        
        {/* 顶部标题区 */}
        <div className="border-b border-neutral-200/60 dark:border-neutral-800/60 pb-5">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            控制台设置
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            全局工作区引擎、API 密钥加密分发及视觉外观偏好配置。
          </p>
        </div>

        {/* 模型引擎分发控制区 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              模型核心提供商
            </h2>
            <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full">
              <ShieldCheck className="w-3 h-3" /> AES-256 加密存储
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#121212] overflow-hidden divide-y divide-neutral-100 dark:divide-neutral-800/60 shadow-sm">
            {presets.map((preset) => {
              const configured = isConfigured(preset.type)
              const provider = getProvider(preset.type)

              if (editingProvider === preset.type) {
                return (
                  <div key={preset.type} className="p-4 bg-neutral-50/50 dark:bg-[#161616]/30">
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
                <div key={preset.type} className="p-4 hover:bg-neutral-50/40 dark:hover:bg-[#161616]/20 transition-colors">
                  <ProviderCard
                    icon={PROVIDER_ICONS[preset.type]}
                    name={preset.name}
                    type={PROVIDER_DISPLAY_TYPES[preset.type]}
                    configured={configured}
                    defaultModel={provider?.defaultModel}
                    onConfigure={() => handleConfigure(preset.type)}
                    onDelete={configured ? () => deleteProvider(provider!.id) : undefined}
                  />
                </div>
              )
            })}

            {/* 自定义 OpenAI 提供商处理 */}
            {showCustomForm && (
              <div className="p-4 bg-neutral-50/50 dark:bg-[#161616]/30">
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
                <div key="custom-edit" className="p-4 bg-neutral-50/50 dark:bg-[#161616]/30">
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
                    <div className="p-4">
                      <ProviderCard
                        icon={PROVIDER_ICONS.custom}
                        name={cp.name || 'Custom OpenAI'}
                        type="OpenAI Compatible"
                        configured
                        defaultModel={cp.defaultModel}
                        onConfigure={() => handleConfigure('custom')}
                        onDelete={() => deleteProvider(cp.id)}
                      />
                    </div>
                  )
                })()
              ) : (
                <div className="p-3 bg-neutral-50/30 dark:bg-transparent text-center">
                  <button
                    onClick={() => setShowCustomForm(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加自定义 OpenAI 兼容网关
                  </button>
                </div>
              )
            )}
          </div>
        </section>

        {/* 外观设置控制区 */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            视觉外观
          </h2>
          <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#121212] p-1.5 shadow-sm flex gap-1">
            {[
              { value: 'light' as const, icon: <Sun className="w-3.5 h-3.5" />, label: 'Light' },
              { value: 'dark' as const, icon: <Moon className="w-3.5 h-3.5" />, label: 'Dark' },
              { value: 'system' as const, icon: <Monitor className="w-3.5 h-3.5" />, label: 'System' }
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                  theme === opt.value
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50'
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
import { useState } from 'react'
import { Globe, Bot, Sparkles, Plus, Sun, Moon, Monitor } from 'lucide-react'
import { ProviderCard } from '../components/ProviderCard'
import { ProviderForm } from '../components/ProviderForm'
import { useProviders } from '../hooks/useProviders'
import { useTheme } from '../hooks/useTheme'

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  anthropic: <Sparkles className="w-4 h-4 text-[#171717] dark:text-white" />,
  openai: <Bot className="w-4 h-4 text-[#171717] dark:text-white" />,
  google: <Globe className="w-4 h-4 text-[#171717] dark:text-white" />,
  custom: <Globe className="w-4 h-4 text-[#171717] dark:text-white" />
}

const PROVIDER_DISPLAY_TYPES: Record<string, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  google: 'Google AI',
  custom: 'OpenAI Compatible'
}

export function SettingsPage() {
  const { providers, presets, saveProvider, deleteProvider } = useProviders()
  const { theme, setTheme } = useTheme()
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [showCustomForm, setShowCustomForm] = useState(false)

  // Find if preset is configured
  function isConfigured(type: string): boolean {
    return providers.some(p => p.type === type)
  }

  function getProvider(type: string) {
    return providers.find(p => p.type === type)
  }

  function handleConfigure(type: string) {
    setEditingProvider(type)
  }

  function handleProviderSave(type: string, data: { apiKey: string; defaultModel: string }) {
    const existing = getProvider(type)
    saveProvider({
      id: existing?.id,
      type: type as 'anthropic' | 'openai' | 'google' | 'custom',
      name: presets.find(p => p.type === type)?.name || type,
      apiKey: data.apiKey,
      models: data.defaultModel ? [data.defaultModel] : [],
      defaultModel: data.defaultModel || undefined
    })
    setEditingProvider(null)
    setShowCustomForm(false)
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#fafafa] dark:bg-[#171717]">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">
        {/* Page Title */}
        <div>
          <h1 className="text-[20px] font-semibold leading-[28px] tracking-[-0.6px] text-[#171717] dark:text-white">
            设置
          </h1>
          <p className="text-sm text-[#4d4d4d] dark:text-[#888] mt-1">
            配置模型提供商和应用偏好
          </p>
        </div>

        {/* Model Providers Section */}
        <section>
          <h2 className="text-xs font-medium text-[#888] uppercase tracking-wide mb-3">
            模型提供商
          </h2>

          {/* Empty state */}
          {providers.length === 0 && !editingProvider && !showCustomForm && (
            <div className="bg-white dark:bg-[#1a1a1a] rounded-[8px] p-8 text-center shadow-card">
              <p className="text-sm text-[#4d4d4d] dark:text-[#888] mb-1">
                暂无模型提供商
              </p>
              <p className="text-xs text-[#888] mb-4">
                点击下方按钮添加你的第一个提供商
              </p>
            </div>
          )}

          {/* Preset provider cards */}
          <div className="space-y-3">
            {presets.map((preset) => {
              const configured = isConfigured(preset.type)
              const provider = getProvider(preset.type)

              // Show config form if editing this provider
              if (editingProvider === preset.type) {
                return (
                  <ProviderForm
                    key={preset.type}
                    type={preset.type}
                    name={preset.name}
                    initialApiKey={provider?.apiKey}
                    initialModel={provider?.defaultModel}
                    onSave={(data) => handleProviderSave(preset.type, data)}
                    onCancel={() => setEditingProvider(null)}
                  />
                )
              }

              return (
                <ProviderCard
                  key={preset.type}
                  icon={PROVIDER_ICONS[preset.type]}
                  name={preset.name}
                  type={PROVIDER_DISPLAY_TYPES[preset.type]}
                  configured={configured}
                  defaultModel={provider?.defaultModel}
                  onConfigure={() => handleConfigure(preset.type)}
                  onDelete={configured ? () => deleteProvider(provider!.id) : undefined}
                />
              )
            })}

            {/* Custom provider form or add button */}
            {showCustomForm && (
              <ProviderForm
                type="custom"
                name="Custom OpenAI"
                onSave={(data) => handleProviderSave('custom', data)}
                onCancel={() => setShowCustomForm(false)}
              />
            )}

            {!showCustomForm && !editingProvider && (
              isConfigured('custom') ? (
                (() => {
                  const cp = getProvider('custom')!
                  return (
                    <ProviderCard
                      key="custom"
                      icon={PROVIDER_ICONS.custom}
                      name={cp.name || 'Custom OpenAI'}
                      type="OpenAI Compatible"
                      configured
                      defaultModel={cp.defaultModel}
                      onConfigure={() => handleConfigure('custom')}
                      onDelete={() => deleteProvider(cp.id)}
                    />
                  )
                })()
              ) : (
                <button
                  onClick={() => setShowCustomForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[#ebebeb] dark:border-[#2a2a2a] rounded-[8px] text-sm text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加自定义 OpenAI 兼容提供商
                </button>
              )
            )}
          </div>
        </section>

        {/* Theme Section */}
        <section>
          <h2 className="text-xs font-medium text-[#888] uppercase tracking-wide mb-3">
            主题
          </h2>
          <div className="bg-white dark:bg-[#1a1a1a] rounded-[8px] p-4 shadow-card">
            <div className="flex gap-2">
              {[
                { value: 'light' as const, icon: <Sun className="w-4 h-4" />, label: '亮色' },
                { value: 'dark' as const, icon: <Moon className="w-4 h-4" />, label: '暗色' },
                { value: 'system' as const, icon: <Monitor className="w-4 h-4" />, label: '跟随系统' }
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-[6px] transition-colors ${
                    theme === opt.value
                      ? 'bg-[#f5f5f5] text-[#171717] font-medium dark:bg-[#252525] dark:text-white'
                      : 'text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525]'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
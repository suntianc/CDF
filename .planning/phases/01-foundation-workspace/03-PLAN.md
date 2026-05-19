---
plan: 03
wave: 2
depends_on: [01]
files_modified:
  - src/renderer/src/App.tsx
  - src/renderer/src/pages/SettingsPage.tsx
  - src/renderer/src/components/ProviderCard.tsx
  - src/renderer/src/components/ProviderForm.tsx
  - src/renderer/src/components/CustomProviderForm.tsx
  - src/renderer/src/hooks/useProviders.ts
  - src/renderer/src/hooks/useWorkspace.ts
autonomous: false
requirements_addressed: [WS-01, WS-02, WS-03, WS-04, PROV-01, PROV-02, PROV-03, PROV-04, PROV-05]
---

# Plan 03: Settings Page & Workspace Management

## Objective

Build the full settings page with model provider configuration (preset templates for Anthropic/OpenAI/Google + custom OpenAI-compatible) and complete the workspace lifecycle (add, switch, auto-restore).

---

## Tasks

### Task 3.1: Create workspace management hook

<read_first>
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-06, D-07, D-08, D-09 — workspace decisions)
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Section 2 — store schema)
- `src/preload/index.d.ts` (electronAPI types)
</read_first>

<action>
Create the workspace management hook that handles the full workspace lifecycle:

Create `src/renderer/src/hooks/useWorkspace.ts`:
```typescript
import { useState, useEffect, useCallback } from 'react'

interface Workspace {
  path: string
  name: string
  lastOpened: string
}

export function useWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load on mount
  useEffect(() => {
    Promise.all([
      window.electronAPI.workspaceList(),
      window.electronAPI.storeGet('lastWorkspace')
    ]).then(([list, lastWs]) => {
      setWorkspaces(list)
      if (lastWs) setActiveWorkspace(lastWs as string)
      setLoading(false)
    })
  }, [])

  const addWorkspace = useCallback(async (): Promise<boolean> => {
    const folderPath = await window.electronAPI.selectFolder()
    if (!folderPath) return false
    const updated = await window.electronAPI.workspaceAdd(folderPath)
    setWorkspaces(updated)
    setActiveWorkspace(folderPath)
    return true
  }, [])

  const switchWorkspace = useCallback(async (path: string) => {
    await window.electronAPI.workspaceSwitch(path)
    setActiveWorkspace(path)
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    const list = await window.electronAPI.workspaceList()
    setWorkspaces(list)
  }, [])

  return {
    workspaces,
    activeWorkspace,
    loading,
    addWorkspace,
    switchWorkspace,
    refreshWorkspaces
  }
}
```
</action>

<acceptance_criteria>
- `src/renderer/src/hooks/useWorkspace.ts` exports `useWorkspace`
- Returns `workspaces`, `activeWorkspace`, `loading`, `addWorkspace`, `switchWorkspace`, `refreshWorkspaces`
- `addWorkspace` opens folder dialog via `electronAPI.selectFolder()`, adds to store, updates state
- `switchWorkspace` calls `electronAPI.workspaceSwitch()` and updates state
- Loads workspaces and `lastWorkspace` from store on mount
</acceptance_criteria>

---

### Task 3.2: Create provider management hook

<read_first>
- `src/preload/index.d.ts` (electronAPI types)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-14, D-15, D-16, D-17, D-18, D-19 — provider decisions)
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Section 2 — store schema for providers)
</read_first>

<action>
Create the provider management hook:

Create `src/renderer/src/hooks/useProviders.ts`:
```typescript
import { useState, useEffect, useCallback } from 'react'

interface Provider {
  id: string
  type: 'anthropic' | 'openai' | 'google' | 'custom'
  name: string
  apiKey: string
  baseUrl?: string
  models: string[]
  defaultModel?: string
}

// Preset provider templates
const PRESET_PROVIDERS: Array<Omit<Provider, 'id' | 'apiKey' | 'models' | 'defaultModel'>> = [
  { type: 'anthropic', name: 'Anthropic' },
  { type: 'openai', name: 'OpenAI' },
  { type: 'google', name: 'Google' }
]

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI.providersList().then((list) => {
      setProviders(list)
      setLoading(false)
    })
  }, [])

  const saveProvider = useCallback(async (provider: Omit<Provider, 'id'> & { id?: string }) => {
    const p: Provider = {
      ...provider,
      id: provider.id || `${provider.type}-${Date.now()}`
    }
    await window.electronAPI.providersSave(p)
    const updated = await window.electronAPI.providersList()
    setProviders(updated)
    return p.id
  }, [])

  const deleteProvider = useCallback(async (id: string) => {
    await window.electronAPI.providersDelete(id)
    const updated = await window.electronAPI.providersList()
    setProviders(updated)
  }, [])

  const testConnection = useCallback(async (provider: Omit<Provider, 'id'>) => {
    return await window.electronAPI.providersTest(provider)
  }, [])

  return {
    providers,
    loading,
    presets: PRESET_PROVIDERS,
    saveProvider,
    deleteProvider,
    testConnection
  }
}
```
</action>

<acceptance_criteria>
- `src/renderer/src/hooks/useProviders.ts` exports `useProviders`
- Returns `providers`, `loading`, `presets`, `saveProvider`, `deleteProvider`, `testConnection`
- `presets` contains Anthropic, OpenAI, Google
- `saveProvider` calls `electronAPI.providersSave()` and refreshes list
- `deleteProvider` calls `electronAPI.providersDelete()` and refreshes list
</acceptance_criteria>

---

### Task 3.3: Build SettingsPage with provider configuration

<read_first>
- `src/renderer/src/App.tsx` (will be modified — add Settings routing)
- `.planning/phases/01-foundation-workspace/01-UI-SPEC.md` (Settings Page ASCII layout, Component Definitions — Settings Page, Form Input)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-14~D-19 — provider config decisions; D-20~D-23 — theme toggle)
- `src/renderer/src/hooks/useProviders.ts` (created in Task 3.2)
- `src/renderer/src/hooks/useTheme.tsx` (for theme toggle)
- `src/renderer/src/hooks/useWorkspace.ts` (for workspace management)
</read_first>

<action>
Build the full settings page with provider cards, API Key input, model selection, and theme toggle:

1. Create `src/renderer/src/components/ProviderCard.tsx`:
   ```tsx
   import { Key, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
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
   ```

2. Create `src/renderer/src/pages/SettingsPage.tsx`:
   ```tsx
   import { useState } from 'react'
   import { Globe, Bot, Sparkles, Plus, Sun, Moon, Monitor } from 'lucide-react'
   import { ProviderCard } from '../components/ProviderCard'
   import { useProviders } from '../hooks/useProviders'
   import { useTheme } from '../hooks/useTheme'

   const PROVIDER_ICONS: Record<string, JSX.Element> = {
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
       // In Phase 1, configuration is handled by the ProviderForm inline
       // Actual provider config form is rendered inline below
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

               {/* Custom OpenAI-compatible entry */}
               {!showCustomForm && !isConfigured('custom') && !editingProvider && (
                 <button
                   onClick={() => setShowCustomForm(true)}
                   className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[#ebebeb] dark:border-[#2a2a2a] rounded-[8px] text-sm text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] transition-colors"
                 >
                   <Plus className="w-4 h-4" />
                   添加自定义 OpenAI 兼容提供商
                 </button>
               )}

               {/* Custom provider card when configured */}
               {isConfigured('custom') && (() => {
                 const cp = getProvider('custom')!
                 return (
                   <ProviderCard
                     icon={PROVIDER_ICONS.custom}
                     name={cp.name || 'Custom OpenAI'}
                     type="OpenAI Compatible"
                     configured
                     defaultModel={cp.defaultModel}
                     onConfigure={() => handleConfigure('custom')}
                     onDelete={() => deleteProvider(cp.id)}
                   />
                 )
               })()}
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
   ```

3. Update `src/renderer/src/App.tsx` to use the useWorkspace hook and route to SettingsPage:
   ```tsx
   import { useState, useCallback } from 'react'
   import { Sidebar } from './components/Sidebar'
   import { WelcomeDialog } from './components/WelcomeDialog'
   import { SettingsPage } from './pages/SettingsPage'
   import { useWorkspace } from './hooks/useWorkspace'

   function App(): JSX.Element {
     const [activeNav, setActiveNav] = useState('welcome')
     const { workspaces, addWorkspace, switchWorkspace } = useWorkspace()

     const handleNavigate = useCallback((page: string) => {
       setActiveNav(page)
     }, [])

     return (
       <div className="flex h-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white">
         <Sidebar
           activeNav={activeNav}
           onNavigate={handleNavigate}
           workspaces={workspaces}
           onAddWorkspace={addWorkspace}
           onSwitchWorkspace={switchWorkspace}
         />

         <main className="flex-1 flex">
           {activeNav === 'welcome' && (
             <div className="flex-1 flex items-center justify-center">
               <WelcomeDialog />
             </div>
           )}
           {activeNav === 'settings' && <SettingsPage />}
         </main>
       </div>
     )
   }

   export default App
   ```

4. Create initial placeholder for provider config form (inline editing within SettingsPage):
   `src/renderer/src/components/ProviderForm.tsx`:
   ```tsx
   import { useState } from 'react'
   import { X } from 'lucide-react'

   interface ProviderFormProps {
     type: string
     name: string
     initialApiKey?: string
     initialModel?: string
     onSave: (data: { apiKey: string; defaultModel: string }) => void
     onCancel: () => void
   }

   export function ProviderForm({ type, name, initialApiKey, initialModel, onSave, onCancel }: ProviderFormProps) {
     const [apiKey, setApiKey] = useState(initialApiKey || '')
     const [defaultModel, setDefaultModel] = useState(initialModel || '')

     const handleSubmit = (e: React.FormEvent) => {
       e.preventDefault()
       onSave({ apiKey, defaultModel })
     }

     return (
       <form onSubmit={handleSubmit} className="bg-white dark:bg-[#1a1a1a] rounded-[8px] p-6 shadow-card space-y-4">
         <div className="flex items-center justify-between">
           <h3 className="text-sm font-medium text-[#171717] dark:text-white">配置 {name}</h3>
           <button type="button" onClick={onCancel} className="text-[#888] hover:text-[#171717]">
             <X className="w-4 h-4" />
           </button>
         </div>

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
             placeholder={type === 'anthropic' ? 'claude-sonnet-4-20250514' : type === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash'}
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
   ```
</action>

<acceptance_criteria>
- `src/renderer/src/pages/SettingsPage.tsx` exports `SettingsPage` component
- Settings page shows "设置" heading with subtitle
- Three preset provider cards render (Anthropic, OpenAI, Google) with "配置" button
- Each provider card shows "已配置" status when configured
- "添加自定义 OpenAI 兼容提供商" dashed button appears when no custom provider exists
- ProviderForm accepts API key (password input) and default model text input
- Save button calls `electronAPI.providersSave()` with correct data
- Delete shows confirmation dialog with "此操作不可撤销" text
- Theme section shows three toggle buttons (亮色/暗色/跟随系统)
- Active theme button has highlighted background
- Empty state renders when no providers exist: "暂无模型提供商"
</acceptance_criteria>

---

### Task 3.4: First-launch workspace detection and auto-restore

<read_first>
- `src/main/index.ts` (will be modified)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-06, D-07 — startup flow)
- `src/main/store.ts` (store schema)
</read_first>

<action>
Implement the startup flow: first launch uses CWD as default workspace, subsequent launches restore last workspace:

Update `src/main/index.ts` — add workspace auto-initialization in `app.whenReady()`:
```typescript
// Add after registerIpcHandlers() and before createWindow() in app.whenReady()
// Auto-initialize workspace
const workspaces = store.get('workspaces', [])
const lastWorkspace = store.get('lastWorkspace') as string | undefined

// First launch: use cwd as default workspace
if (workspaces.length === 0) {
  const cwd = process.cwd()
  workspaces.push({
    path: cwd,
    name: cwd.split('/').pop() || cwd,
    lastOpened: new Date().toISOString()
  })
  store.set('workspaces', workspaces)
  store.set('lastWorkspace', cwd)
}
```

Also add startup workspace logging in the renderer's useWorkspace hook to handle the auto-restore:
- On mount, check if `lastWorkspace` exists
- If workspaces list is empty (first launch), the main process already set the CWD as workspace
- The hook already loads from store in useEffect, so no additional change needed
</action>

<acceptance_criteria>
- `src/main/index.ts` auto-initializes first workspace from `process.cwd()` on first launch
- `store.get('lastWorkspace')` returns the CWD path after first launch
- On subsequent launches, `lastWorkspace` is restored from persisted store
- Workspace list always has at least one entry after first launch
</acceptance_criteria>

---

### Task 3.5: Error handling for provider connection failures

<read_first>
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-19 — error handling)
- `.planning/phases/01-foundation-workspace/01-UI-SPEC.md` (Copywriting Contract — error state copy)
- `src/renderer/src/pages/SettingsPage.tsx` (will be modified)
</read_first>

<action>
Add connection error display to the settings page. The IPC handler already exists as a stub in `src/main/ipc.ts` — enhance the UI to show error states:

1. Create `src/renderer/src/components/ConnectionError.tsx`:
   ```tsx
   import { AlertCircle } from 'lucide-react'

   interface ConnectionErrorProps {
     message: string
     onRetry?: () => void
   }

   export function ConnectionError({ message, onRetry }: ConnectionErrorProps) {
     return (
       <div className="bg-[#f7d4d6] dark:bg-[#3a1a1a] rounded-[6px] p-3 flex items-start gap-2">
         <AlertCircle className="w-4 h-4 text-[#ee0000] mt-0.5 shrink-0" />
         <div className="flex-1">
           <p className="text-xs text-[#c50000]">{message}</p>
           {onRetry && (
             <button
               onClick={onRetry}
               className="text-xs text-[#c50000] underline mt-1 hover:no-underline"
             >
               请检查 API Key 是否正确，或稍后重试
             </button>
           )}
         </div>
       </div>
     )
   }
   ```

2. The SettingsPage will use ConnectionError when a provider test fails. The ProviderForm already captures API key input — error display is triggered by the provider test response. This is wired for Phase 2 when actual API calls are made; in Phase 1, the stub handler returns `{ success: true }`.
</action>

<acceptance_criteria>
- `src/renderer/src/components/ConnectionError.tsx` exports `ConnectionError` component
- Component shows error message in red-tinted background with AlertCircle icon
- "请检查 API Key 是否正确，或稍后重试" text appears as retry action
- Component accepts `message` string and optional `onRetry` callback
</acceptance_criteria>

---

## Verification Criteria

- [ ] Settings page accessible from sidebar navigation
- [ ] Three preset provider cards (Anthropic, OpenAI, Google) shown
- [ ] Custom OpenAI-compatible entry available
- [ ] Provider API key can be entered and saved
- [ ] Provider configuration persists in electron-store
- [ ] Provider card shows "已配置" status after save
- [ ] Delete shows confirmation dialog with Chinese warning text
- [ ] Theme toggle switches light/dark/system correctly
- [ ] First launch auto-creates CWD as default workspace
- [ ] Subsequent launches restore last workspace
- [ ] Empty state "暂无模型提供商" shown before any provider added
- [ ] ConnectionError component renders correctly with error styling

## must_haves

- Provider configuration works (PROV-01, PROV-02)
- Provider config persists (PROV-04)
- Workspace selection via folder dialog works (WS-01)
- Recent workspace list persists (WS-02)
- First launch auto-creates default workspace (WS-04)
- Theme toggle works from settings (UI-04)
- Empty states show correct copywriting (Copywriting Contract)
</acceptance_criteria>
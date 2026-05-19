import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { WelcomeDialog } from './components/WelcomeDialog'

function App(): JSX.Element {
  const [activeNav, setActiveNav] = useState('welcome')
  const [workspaces, setWorkspaces] = useState<Array<{ path: string; name: string }>>([])

  // Load workspaces on mount
  useEffect(() => {
    window.electronAPI.workspaceList().then(setWorkspaces)
  }, [])

  const handleNavigate = useCallback((page: string) => {
    setActiveNav(page)
  }, [])

  const handleAddWorkspace = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder()
    if (folderPath) {
      const updated = await window.electronAPI.workspaceAdd(folderPath)
      setWorkspaces(updated)
    }
  }, [])

  const handleSwitchWorkspace = useCallback(async (path: string) => {
    await window.electronAPI.workspaceSwitch(path)
  }, [])

  return (
    <div className="flex h-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white">
      <Sidebar
        activeNav={activeNav}
        onNavigate={handleNavigate}
        workspaces={workspaces}
        onAddWorkspace={handleAddWorkspace}
        onSwitchWorkspace={handleSwitchWorkspace}
      />

      <main className="flex-1 flex items-center justify-center">
        {activeNav === 'welcome' && <WelcomeDialog />}
        {activeNav === 'settings' && (
          <div className="p-8 text-[#888]">设置页面（由 Plan 03 实现）</div>
        )}
      </main>
    </div>
  )
}

export default App
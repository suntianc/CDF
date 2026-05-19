import { useState, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { WelcomeDialog } from './components/WelcomeDialog'
import { SettingsPage } from './pages/SettingsPage'
import { useWorkspace } from './hooks/useWorkspace'

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState('welcome')
  const { workspaces, addWorkspace, switchWorkspace } = useWorkspace()

  const handleNavigate = useCallback((page: string) => {
    setActiveNav(page)
  }, [])

  return (
    <div className="flex h-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white">
      {/* macOS window drag region */}
      <div className="fixed top-0 left-0 right-0 h-[10px] z-50" style={{ WebkitAppRegion: 'drag' } as any} />
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
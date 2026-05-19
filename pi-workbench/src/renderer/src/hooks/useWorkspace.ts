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
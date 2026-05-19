import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const initialized = useRef(false)

  // Load saved theme on mount
  useEffect(() => {
    window.electronAPI.themeGet().then((saved) => {
      const t = (saved as Theme) || 'system'
      setThemeState(t)
      initialized.current = true
    })
  }, [])

  // Resolve effective theme
  useEffect(() => {
    const effective = theme === 'system' ? getSystemTheme() : theme
    setResolvedTheme(effective)

    // Apply class to html element for Tailwind v4 dark mode
    document.documentElement.classList.toggle('dark', effective === 'dark')

    // Persist theme preference (only after initial load to avoid overwrite)
    if (initialized.current) {
      window.electronAPI.themeSet(theme)
    }
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        const sys = getSystemTheme()
        setResolvedTheme(sys)
        document.documentElement.classList.toggle('dark', sys === 'dark')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
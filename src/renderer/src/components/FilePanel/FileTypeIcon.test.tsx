import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { FileTypeIcon } from './FileTypeIcon'

describe('FileTypeIcon', () => {
  it('renders material icon for .ts files', () => {
    const { container } = render(<FileTypeIcon filename="app.ts" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('class')).toContain('shrink-0')
  })

  it('renders material icon for .js files', () => {
    const { container } = render(<FileTypeIcon filename="index.js" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#ffca28')
  })

  it('renders material icon for .md files', () => {
    const { container } = render(<FileTypeIcon filename="README.md" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#42a5f5')
  })

  it('renders material icon for .json files', () => {
    const { container } = render(<FileTypeIcon filename="package.json" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#f9a825')
  })

  it('renders react-ts icon for .tsx files', () => {
    const { container } = render(<FileTypeIcon filename="App.tsx" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#0288d1')
  })

  it('renders git icon for .gitignore', () => {
    const { container } = render(<FileTypeIcon filename=".gitignore" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#e64a19')
  })

  it('renders license icon for LICENSE (case-insensitive)', () => {
    const { container } = render(<FileTypeIcon filename="LICENSE" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const fill = svg?.querySelector('path')?.getAttribute('fill')
    expect(fill).toBe('#ff5722')
  })

  it('renders a dedicated icon for Excalidraw files', () => {
    const { container } = render(<FileTypeIcon filename="release.excalidraw" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('class')).toContain('lucide-shapes')
  })

  it('renders lucide fallback for unknown extensions', () => {
    const { container } = render(<FileTypeIcon filename="data.xyz" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('class')).toContain('text-[var(--color-text-muted)]')
  })

  it('renders fallback icon for files without extension', () => {
    const { container } = render(<FileTypeIcon filename="Makefile" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('applies custom className', () => {
    const { container } = render(<FileTypeIcon filename="app.ts" className="w-4 h-4" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('w-4 h-4')
  })
})

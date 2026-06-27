import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FileTypeIcon } from './FileTypeIcon';

describe('FileTypeIcon', () => {
  it('renders blue icon for .ts files', () => {
    const { container } = render(<FileTypeIcon filename="app.ts" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-blue-500');
  });

  it('renders yellow icon for .js files', () => {
    const { container } = render(<FileTypeIcon filename="index.js" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-yellow-500');
  });

  it('renders purple icon for .md files', () => {
    const { container } = render(<FileTypeIcon filename="README.md" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-purple-400');
  });

  it('renders amber icon for .json files', () => {
    const { container } = render(<FileTypeIcon filename="package.json" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-amber-500');
  });

  it('renders fallback muted icon for unknown extensions', () => {
    const { container } = render(<FileTypeIcon filename="data.xyz" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-[var(--color-text-muted)]');
  });

  it('renders fallback icon for files without extension', () => {
    const { container } = render(<FileTypeIcon filename="Makefile" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(<FileTypeIcon filename="app.ts" className="w-4 h-4" />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('w-4 h-4');
  });
});

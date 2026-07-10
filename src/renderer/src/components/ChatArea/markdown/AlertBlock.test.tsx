import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBlock, ALERT_TYPES } from './AlertBlock';

describe('AlertBlock', () => {
  it.each(ALERT_TYPES)('renders the %s alert with its expected accent classes and title', (type) => {
    const { container } = render(
      <AlertBlock type={type}>
        <p>body for {type}</p>
      </AlertBlock>
    );

    // 单字母大写文本作为 alert 标题，出现在视觉显著区。
    expect(screen.getByText(type)).toBeTruthy();

    const root = container.firstElementChild!;
    const titleRow = root.firstElementChild!;

    // 6 种 alert 共用同一个 layout 类集（layout/typography 必须一致）。
    expect(root.className).toContain('pl-4 pr-3 py-2.5 rounded-r-lg my-3 text-sm');
    expect(titleRow.className).toContain('flex items-center gap-1.5 font-bold text-xs select-none tracking-wider uppercase mb-1.5');

    // 每种 alert 有其专属的 accent 颜色（左 border + 标题文字色），用于区分严重度。
    const expectations: Record<string, { borderClass: string; titleClass: string }> = {
      NOTE:       { borderClass: 'border-l-sky-500',     titleClass: 'text-sky-600' },
      TIP:        { borderClass: 'border-l-emerald-500', titleClass: 'text-emerald-600' },
      IMPORTANT:  { borderClass: 'border-l-indigo-500',  titleClass: 'text-indigo-600' },
      WARNING:    { borderClass: 'border-l-amber-500',   titleClass: 'text-amber-600' },
      CAUTION:    { borderClass: 'border-l-rose-500',    titleClass: 'text-rose-600' },
      DANGER:     { borderClass: 'border-l-rose-500',    titleClass: 'text-rose-600' },
    };
    const { borderClass, titleClass } = expectations[type];
    expect(root.className).toContain(borderClass);
    expect(titleRow.className).toContain(titleClass);
  });

  it('renders CAUTION and DANGER with identical accent (shared bucket) but distinct title text', () => {
    const caution = render(<AlertBlock type="CAUTION">x</AlertBlock>);
    const danger = render(<AlertBlock type="DANGER">x</AlertBlock>);
    expect(caution.container.firstElementChild!.className).toBe(
      danger.container.firstElementChild!.className,
    );
    expect(screen.getAllByText('CAUTION').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DANGER').length).toBeGreaterThan(0);
  });

  it('renders an icon sized 14px in the title row', () => {
    const { container } = render(<AlertBlock type="NOTE">x</AlertBlock>);
    const titleRow = container.firstElementChild!.firstElementChild!;
    // lucide-react 图标的 svg 元素固定 w-3.5 h-3.5 (= 14px)；不应被 style override。
    const icon = titleRow.querySelector('svg')!;
    expect(icon.classList.contains('w-3.5')).toBe(true);
    expect(icon.classList.contains('h-3.5')).toBe(true);
  });

  it('passes children through verbatim', () => {
    render(
      <AlertBlock type="NOTE">
        <span data-testid="alert-body">hello</span>
      </AlertBlock>
    );
    expect(screen.getByTestId('alert-body')).toBeTruthy();
  });
});
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomSelect } from './CustomSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

describe('CustomSelect', () => {
  it('selects an adjacent option with the keyboard', () => {
    const onChange = vi.fn();
    render(<CustomSelect ariaLabel="Theme" value="system" onChange={onChange} options={options} />);

    const trigger = screen.getByRole('button', { name: 'Theme' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('dark');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes listbox semantics and closes with Escape', () => {
    render(<CustomSelect ariaLabel="Theme" value="light" onChange={vi.fn()} options={options} />);

    const trigger = screen.getByRole('button', { name: 'Theme' });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Light' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

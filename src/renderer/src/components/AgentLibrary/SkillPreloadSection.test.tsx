import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@shared/types';
import i18n from '../../i18n';
import { SkillPreloadSection } from './SkillPreloadSection';

const skills = [
  {
    id: 'global:review',
    name: 'review',
    description: 'Review workflow',
    scope: 'global',
    sourceKind: 'user',
    sourceLabel: 'Global Skill',
    resourceFiles: [],
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'global:writer',
    name: 'writer',
    description: 'Writing workflow',
    scope: 'global',
    sourceKind: 'managed',
    sourceLabel: 'Managed Skill',
    resourceFiles: [],
    created_at: 0,
    updated_at: 0,
  },
] as Skill[];

function SkillPreloadHarness({ onToggle = vi.fn() }: { onToggle?: (skillId: string) => void }) {
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const handleToggle = (skillId: string) => {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    ));
    onToggle(skillId);
  };

  return (
    <div>
      <button type="button">Outside target</button>
      <SkillPreloadSection
        skills={skills}
        selectedSkillIds={selectedSkillIds}
        onToggleSkill={handleToggle}
      />
    </div>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US');
});

describe('SkillPreloadSection', () => {
  it('opens from the keyboard and moves focus into the search field', async () => {
    const user = userEvent.setup();
    render(<SkillPreloadHarness />);
    const trigger = screen.getByRole('button', { name: 'Manage Skill preload' });
    trigger.focus();

    await user.keyboard('{Enter}');

    expect(screen.getByPlaceholderText('Search skills...')).toBe(document.activeElement);
  });

  it('selects and clears a Skill with Enter and Space while exposing checked state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SkillPreloadHarness onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: 'Manage Skill preload' }));
    const candidate = screen.getByRole('checkbox', { name: 'Preload review' });
    candidate.focus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('checkbox', { name: 'Preload review' }).getAttribute('aria-checked')).toBe('true');

    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Preload review' }).getAttribute('aria-checked')).toBe('false');
    expect(onToggle).toHaveBeenNthCalledWith(1, 'global:review');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'global:review');
  });

  it('closes with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<SkillPreloadHarness />);
    const trigger = screen.getByRole('button', { name: 'Manage Skill preload' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText('Search skills...')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on outside click and clears the search before reopening', async () => {
    const user = userEvent.setup();
    render(<SkillPreloadHarness />);
    const trigger = screen.getByRole('button', { name: 'Manage Skill preload' });
    await user.click(trigger);
    await user.type(screen.getByPlaceholderText('Search skills...'), 'review');

    await user.click(screen.getByRole('button', { name: 'Outside target' }));
    expect(screen.queryByPlaceholderText('Search skills...')).toBeNull();

    await user.click(trigger);
    expect((screen.getByPlaceholderText('Search skills...') as HTMLInputElement).value).toBe('');
  });

  it('filters candidates and reports an empty result', async () => {
    const user = userEvent.setup();
    render(<SkillPreloadHarness />);
    await user.click(screen.getByRole('button', { name: 'Manage Skill preload' }));
    const search = screen.getByPlaceholderText('Search skills...');

    await user.type(search, 'writer');
    expect(screen.getByRole('checkbox', { name: 'Preload writer' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Preload review' })).toBeNull();

    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.getByText('No matching skills found')).toBeTruthy();
  });
});

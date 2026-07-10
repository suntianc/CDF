import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReasoningEffortSelector } from './ReasoningEffortSelector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => ({
      'chat.reasoningEffort.depthLabel': 'Reasoning depth',
      'chat.reasoningEffort.agentCountLabel': 'Collaboration scale',
      'chat.reasoningEffort.default': 'Default',
      'chat.reasoningEffort.defaultWithEffort': `Default (${params?.effort})`,
      'chat.reasoningEffort.efforts.none': 'Off',
      'chat.reasoningEffort.efforts.low': 'Fast',
      'chat.reasoningEffort.efforts.medium': 'Balanced',
      'chat.reasoningEffort.efforts.high': 'Deep',
      'chat.reasoningEffort.efforts.xhigh': 'Very deep',
      'chat.reasoningEffort.efforts.max': 'Maximum',
      'chat.reasoningEffort.efforts.ultra': 'Autonomous',
    }[key] ?? key),
  }),
}));

describe('ReasoningEffortSelector', () => {
  it('offers the selected model efforts with provider default first', () => {
    const onSelect = vi.fn();

    render(
      <ReasoningEffortSelector
        variant="composer"
        profile={{
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'high',
          control: 'depth',
        }}
        selectedEffort="medium"
        onSelect={onSelect}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Reasoning depth: Balanced' });
    fireEvent.click(trigger);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Default (Deep)',
      'Fast',
      'Balanced',
      'Deep',
    ]);

    fireEvent.click(screen.getByRole('option', { name: 'Default (Deep)' }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it('labels multi-agent effort as collaboration scale rather than reasoning depth', () => {
    render(
      <ReasoningEffortSelector
        variant="composer"
        profile={{
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          control: 'agent_count',
        }}
        selectedEffort="high"
        onSelect={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Collaboration scale: Deep' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reasoning depth/ })).toBeNull();
  });
});

import { render } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { formatHMSTime, MessageContentRenderer } from './MessageItem';

describe('formatHMSTime', () => {
  it('should format seconds into s format', () => {
    expect(formatHMSTime(5)).toBe('5s');
    expect(formatHMSTime(0)).toBe('0s');
  });

  it('should format minutes and seconds into m s format', () => {
    expect(formatHMSTime(60)).toBe('1m 0s');
    expect(formatHMSTime(75)).toBe('1m 15s');
  });

  it('should format hours, minutes, and seconds into h m s format', () => {
    expect(formatHMSTime(3600)).toBe('1h 0m 0s');
    expect(formatHMSTime(3665)).toBe('1h 1m 5s');
    expect(formatHMSTime(7322)).toBe('2h 2m 2s');
  });
});

describe('MessageContentRenderer', () => {
  it('does not duplicate text before inline code when rendering at-token-aware markdown segments', () => {
    const { container } = render(
      React.createElement(MessageContentRenderer, {
        content: 'Before `code` after',
        isLast: false,
        isStreaming: false,
      })
    );

    expect(container.textContent).toBe('Before code after');
  });
});

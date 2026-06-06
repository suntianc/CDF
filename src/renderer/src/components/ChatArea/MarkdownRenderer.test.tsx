import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('should render normal text paragraph', () => {
    const { getByText } = render(<MarkdownRenderer text="hello world" />);
    const paragraph = getByText('hello world');
    expect(paragraph.tagName).toBe('P');
    expect(paragraph.className).toContain('text-[var(--color-text-primary)]');
  });

  it('should render headers', () => {
    const { getByText } = render(
      <MarkdownRenderer text={'# Header 1\n## Header 2\n### Header 3'} />
    );
    expect(getByText('Header 1').tagName).toBe('H1');
    expect(getByText('Header 2').tagName).toBe('H2');
    expect(getByText('Header 3').tagName).toBe('H3');
  });

  it('should render blockquotes with custom styling', () => {
    const markdown = '> 💡 小提示：这是一个提示';
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const blockquote = container.querySelector('blockquote');
    expect(blockquote).toBeTruthy();
    expect(blockquote?.className).toContain('border-l-4');
    expect(blockquote?.className).toContain('border-[var(--color-accent)]/60');
    expect(blockquote?.textContent).toContain('💡 小提示：这是一个提示');
  });

  it('should render blockquotes with inline formatting inside', () => {
    const markdown = '> This contains **bold** and `code` inside';
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const blockquote = container.querySelector('blockquote');
    expect(blockquote).toBeTruthy();
    
    const strong = blockquote?.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('bold');

    const code = blockquote?.querySelector('code');
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe('code');
  });

  it('should render multiple blockquote lines as a single blockquote element', () => {
    const markdown = '> Line 1\n> Line 2\n\nSome paragraph';
    const { container, getByText } = render(<MarkdownRenderer text={markdown} />);
    const blockquotes = container.querySelectorAll('blockquote');
    expect(blockquotes.length).toBe(1);
    expect(blockquotes[0].textContent).toContain('Line 1');
    expect(blockquotes[0].textContent).toContain('Line 2');
    expect(getByText('Some paragraph').tagName).toBe('P');
  });
});

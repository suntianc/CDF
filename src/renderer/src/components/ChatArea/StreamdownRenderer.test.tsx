import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StreamdownRenderer } from './StreamdownRenderer';

describe('StreamdownRenderer', () => {
  it('should render inline math formulas using KaTeX', () => {
    const { container } = render(<StreamdownRenderer text="The formula is $E = mc^2$." />);
    const katexElement = container.querySelector('.katex');
    expect(katexElement).toBeTruthy();
  });

  it('should render block math formulas using KaTeX', () => {
    const markdown = '$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$';
    const { container } = render(<StreamdownRenderer text={markdown} />);
    const katexBlock = container.querySelector('.katex');
    expect(katexBlock).toBeTruthy();
  });

  it('should render GitHub-style alerts', () => {
    const markdown = '> [!NOTE]\n> Directly write content here!';
    const { container } = render(<StreamdownRenderer text={markdown} />);
    const alertDiv = container.querySelector('.border-l-sky-500');
    expect(alertDiv).toBeTruthy();
  });

  it('keeps nested Markdown inside GitHub-style alerts in the streamdown renderer namespace', () => {
    const markdown = '> [!NOTE]\n> See [docs](https://example.com) and `code`.';
    const { container } = render(<StreamdownRenderer text={markdown} />);

    const alertDiv = container.querySelector('.border-l-sky-500');
    const nestedRenderer = alertDiv?.querySelector('.streamdown-renderer');
    const link = nestedRenderer?.querySelector('a');
    const inlineCode = nestedRenderer?.querySelector('code');

    expect(nestedRenderer).toBeTruthy();
    expect(link?.getAttribute('href')).toMatch(/^https:\/\/example\.com\/?$/);
    expect(inlineCode).toBeTruthy();
  });

  it('renders Markdown headings with CDF typography instead of browser defaults', () => {
    const { container } = render(<StreamdownRenderer text={'# Main\n\n## Section\n\n### Detail'} />);

    expect(container.querySelector('h1')?.className).toContain('text-lg');
    expect(container.querySelector('h2')?.className).toContain('text-base');
    expect(container.querySelector('h3')?.className).toContain('text-sm');
  });

  it('renders Markdown inside details blocks', () => {
    const markdown = `<details>\n<summary>More</summary>\n\n**Bold detail**\n\n- First item\n</details>`;
    const { container } = render(<StreamdownRenderer text={markdown} isTypewriting={false} />);

    const details = container.querySelector('details');
    expect(details?.querySelector('[data-streamdown="strong"]')?.textContent).toBe('Bold detail');
    expect(details?.querySelector('li')?.textContent).toContain('First item');
  });

  it('should render the exact screenshot markdown text correctly', () => {
    const markdown = `好的！Suntc君来验收一下～
行内公式： $E = mc^2$
块级公式：
$$
\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$`;
    const { container } = render(<StreamdownRenderer text={markdown} />);
    const katexElements = container.querySelectorAll('.katex');
    expect(katexElements.length).toBe(3); // 1 inline + 2 block math formulas
  });

  it('should render details and summary tags in streamdown', () => {
    const markdown = `<details>\n<summary>Click me</summary>\nInside details\n</details>`;
    const { container } = render(<StreamdownRenderer text={markdown} isTypewriting={false} />);
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
  });
});

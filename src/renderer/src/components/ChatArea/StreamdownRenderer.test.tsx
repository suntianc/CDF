import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StreamdownRenderer } from './StreamdownRenderer';

describe('StreamdownRenderer', () => {
  it('should render inline math formulas using KaTeX', () => {
    const { container } = render(<StreamdownRenderer text="The formula is $E = mc^2$." />);
    console.log('HTML for inline math:', container.innerHTML);
    const katexElement = container.querySelector('.katex');
    expect(katexElement).toBeTruthy();
  });

  it('should render block math formulas using KaTeX', () => {
    const markdown = '$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$';
    const { container } = render(<StreamdownRenderer text={markdown} />);
    console.log('HTML for block math:', container.innerHTML);
    const katexBlock = container.querySelector('.katex');
    expect(katexBlock).toBeTruthy();
  });

  it('should render GitHub-style alerts', () => {
    const markdown = '> [!NOTE]\n> Directly write content here!';
    const { container } = render(<StreamdownRenderer text={markdown} />);
    console.log('HTML for alert:', container.innerHTML);
    const alertDiv = container.querySelector('.border-l-sky-500');
    expect(alertDiv).toBeTruthy();
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
    console.log('HTML for exact screenshot text:', container.innerHTML);
    const katexElements = container.querySelectorAll('.katex');
    expect(katexElements.length).toBe(3); // 1 inline + 2 block math formulas
  });

  it('should render details and summary tags in streamdown', () => {
    const markdown = `<details>\n<summary>Click me</summary>\nInside details\n</details>`;
    const { container } = render(<StreamdownRenderer text={markdown} isAnimating={false} />);
    console.log('HTML for details/summary:', container.innerHTML);
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
  });
});

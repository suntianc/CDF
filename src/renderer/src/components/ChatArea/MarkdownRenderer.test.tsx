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
    expect(blockquote?.className).toContain('border');
    expect(blockquote?.className).toContain('border-[var(--color-border)]/60');
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

  it('should render GitHub-style alerts', () => {
    const markdown = '> [!NOTE]\n> Directly write content here!';
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const alertDiv = container.querySelector('.border-l-sky-500');
    expect(alertDiv).toBeTruthy();
    expect(alertDiv?.textContent).toContain('NOTE');
    expect(alertDiv?.textContent).toContain('Directly write content here!');
  });

  it('should render inline math formulas using KaTeX', () => {
    const { container } = render(<MarkdownRenderer text="The formula is $E = mc^2$." />);
    const katexElement = container.querySelector('.katex');
    expect(katexElement).toBeTruthy();
    expect(katexElement?.textContent).toContain('E=mc');
  });

  it('should render single-line block math formulas using KaTeX', () => {
    const { container } = render(<MarkdownRenderer text="$$f(x) = \int x^2 dx$$" />);
    const katexBlock = container.querySelector('.overflow-x-auto .katex');
    expect(katexBlock).toBeTruthy();
    expect(katexBlock?.textContent).toContain('f(x)');
  });

  it('should render multi-line block math formulas using KaTeX', () => {
    const markdown = '$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$';
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const katexBlock = container.querySelector('.overflow-x-auto .katex');
    expect(katexBlock).toBeTruthy();
    expect(katexBlock?.textContent).toContain('i=1');
  });

  it('should not render ordinary dollar signs as math', () => {
    const { container } = render(<MarkdownRenderer text="I have $10 and you have $20." />);
    const katexElement = container.querySelector('.katex');
    expect(katexElement).toBeFalsy();
  });

  it('should render inline math wrapped in backticks', () => {
    const { container } = render(<MarkdownRenderer text="The formula is `$E = mc^2$`." />);
    const katexElement = container.querySelector('.katex');
    expect(katexElement).toBeTruthy();
    expect(katexElement?.textContent).toContain('E=mc');
    expect(container.querySelector('code')).toBeFalsy();
  });

  it('should render strikethroughs (~~) using del tags', () => {
    const { container } = render(<MarkdownRenderer text="This is ~~strikethrough~~ text." />);
    const delElement = container.querySelector('del');
    expect(delElement).toBeTruthy();
    expect(delElement?.textContent).toBe('strikethrough');
    expect(delElement?.className).toContain('line-through');
  });

  it('should render links [text](url) using a tags', () => {
    const { container } = render(<MarkdownRenderer text="Check [rem home](./rem) link." />);
    const aElement = container.querySelector('a');
    expect(aElement).toBeTruthy();
    expect(aElement?.textContent).toBe('rem home');
    expect(aElement?.getAttribute('href')).toBe('./rem');
  });

  it('should render images ![alt](url) using img tags', () => {
    const { container } = render(<MarkdownRenderer text="Image: ![rem pic](https://example.com/rem.png)" />);
    const imgElement = container.querySelector('img');
    expect(imgElement).toBeTruthy();
    expect(imgElement?.getAttribute('alt')).toBe('rem pic');
    expect(imgElement?.getAttribute('src')).toBe('https://example.com/rem.png');
  });

  it('should render details and summary collapsible blocks', () => {
    const markdown = `<details>
<summary>展开查看详情</summary>
这是详情内容
</details>`;
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const details = container.querySelector('details');
    const summary = container.querySelector('summary');
    expect(details).toBeTruthy();
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toBe('展开查看详情');
    expect(details?.textContent).toContain('这是详情内容');
  });

  it('should render nested blockquotes correctly', () => {
    const markdown = `> 引用一
> > 嵌套引用二`;
    const { container } = render(<MarkdownRenderer text={markdown} />);
    const outerBlockquote = container.querySelector('blockquote');
    expect(outerBlockquote).toBeTruthy();
    expect(outerBlockquote?.textContent).toContain('引用一');
    
    const innerBlockquote = outerBlockquote?.querySelector('blockquote');
    expect(innerBlockquote).toBeTruthy();
    expect(innerBlockquote?.textContent).toContain('嵌套引用二');
  });
});

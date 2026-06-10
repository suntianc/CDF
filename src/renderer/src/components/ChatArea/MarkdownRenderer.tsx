import React, { useState, useMemo } from 'react';
import { Check, Copy, AlertCircle, AlertTriangle, Info, Lightbulb, AlertOctagon } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface CodeBlockProps {
  lang: string;
  code: string;
}

export function CodeBlock({ lang, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="border border-[var(--color-border)]/50 rounded-lg overflow-hidden font-mono text-xs bg-[var(--color-bg-sidebar)]">
      <div className="flex justify-between items-center px-4 py-1.5 bg-black/20 text-[var(--color-text-secondary)] border-b border-[var(--color-border)] select-none">
        <span className="uppercase text-xs font-bold text-[var(--color-text-secondary)] tracking-wider">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`transition-all duration-200 text-[11px] font-medium px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 active:scale-90 ${
            copied 
              ? 'text-[var(--color-success)] bg-[var(--color-success-dim)]/20' 
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[var(--color-success)] animate-pop-in" />
              <span className="animate-pop-in">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[var(--color-text-primary)] select-text" style={{ background: 'transparent', margin: 0 }}>
        <code style={{ background: 'transparent', padding: 0, borderRadius: 0 }}>{code}</code>
      </pre>
    </div>
  );
}

interface MathRendererProps {
  math: string;
  block?: boolean;
}

export function MathRenderer({ math, block = false }: MathRendererProps) {
  const cleanMath = useMemo(() => {
    let content = math.trim();
    if (block) {
      if (content.startsWith('$$') && content.endsWith('$$')) {
        content = content.slice(2, -2);
      }
    } else {
      if (content.startsWith('$') && content.endsWith('$')) {
        content = content.slice(1, -1);
      }
    }
    return content.trim();
  }, [math, block]);

  const { html, ok, errorMessage } = useMemo(() => {
    try {
      const rendered = katex.renderToString(cleanMath, {
        displayMode: block,
        throwOnError: true,
      });
      return { html: rendered, ok: true, errorMessage: null as string | null };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('KaTeX error:', msg);
      return { html: '', ok: false, errorMessage: msg };
    }
  }, [cleanMath, block]);

  if (!ok) {
    return <MathFallback math={cleanMath} block={block} errorMessage={errorMessage!} />;
  }

  if (block) {
    return (
      <div
        className="w-full overflow-x-auto my-3 select-text py-1 scrollbar-thin"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      className="inline-block select-text align-middle mx-1"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Tailwind JIT cannot statically detect class names that are built by
// string interpolation (`text-${align}`). The map below ensures the
// four alignment utilities are emitted by the build.
const ALIGN_CLASS: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

function MathFallback({ math, block, errorMessage }: { math: string; block: boolean; errorMessage: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(math);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy formula source:', err);
    }
  };

  const Wrapper = block ? 'div' : 'span';
  const wrapperProps = block
    ? { className: 'block my-3' }
    : { className: 'inline-block align-middle mx-1' };

  return (
    <Wrapper
      {...wrapperProps}
      role="img"
      aria-label={`公式解析失败: ${math}`}
      data-testid="math-fallback"
    >
      <div className="border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.06] rounded-md px-3 py-2 font-mono text-xs select-text">
        <div className="flex items-center gap-1.5 text-[var(--color-danger)] font-semibold mb-1.5">
          <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
          <span>公式无法解析</span>
        </div>
        <pre className="whitespace-pre-wrap break-words text-[var(--color-text-primary)] mb-2 leading-relaxed">
          {math}
        </pre>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--color-text-muted)] truncate" title={errorMessage}>
            {errorMessage}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="复制公式源码"
            className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
              copied
                ? 'text-[var(--color-success)] bg-[var(--color-success)]/10'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>复制源码</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Wrapper>
  );
}

export const renderInlineMarkdown = (text: string) => {
  if (!text) return null;
  const inlineRegex = /(\*\*.*?\*\*|\*.*?\*|~~.*?~~|`.*?`|!?\[.*?\]\(.*?\)|\$[^\s$](?:[^$]*?[^\s$])?\$)/g;
  const parts = text.split(inlineRegex);
  
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-[var(--color-text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} className="italic text-[var(--color-text-primary)]/90">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return (
        <del key={i} className="line-through text-[var(--color-text-secondary)]">
          {renderInlineMarkdown(part.slice(2, -2))}
        </del>
      );
    }
    if (part.startsWith('![') && part.endsWith(')')) {
      const match = part.match(/!\[(.*?)\]\((.*?)\)/);
      if (match) {
        return (
          <img
            key={i}
            src={match[2]}
            alt={match[1]}
            className="max-w-full h-auto rounded-lg border border-[var(--color-border)]/30 my-2 inline-block"
          />
        );
      }
    }
    if (part.startsWith('[') && part.endsWith(')')) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        return (
          <a
            key={i}
            href={match[2]}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline underline-offset-2 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInlineMarkdown(match[1])}
          </a>
        );
      }
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1);
      if (inner.startsWith('$$') && inner.endsWith('$$')) {
        return <MathRenderer key={i} math={inner} block={true} />;
      }
      if (inner.startsWith('$') && inner.endsWith('$')) {
        return <MathRenderer key={i} math={inner} block={false} />;
      }
      return (
        <code 
          key={i} 
          className="px-1.5 py-0.5 mx-0.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 rounded text-xs font-mono text-[var(--color-text-primary)]"
        >
          {inner}
        </code>
      );
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return <MathRenderer key={i} math={part} block={false} />;
    }
    return part;
  });
};

export const renderMarkdownText = (text: string) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  
  let currentParagraphLines: string[] = [];
  let currentListType: 'ul' | 'ol' | null = null;
  let currentListItems: { key: number; content: string; num?: number }[] = [];

  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];
  let tableAlignments: ('left' | 'center' | 'right')[] = [];

  let currentBlockquoteLines: string[] = [];
  
  let inMathBlock = false;
  let currentMathLines: string[] = [];

  let inDetailsBlock = false;
  let currentDetailsLines: string[] = [];
  let detailsSummary = '';

  const flushMathBlock = (key: string | number) => {
    if (currentMathLines.length > 0) {
      const mathText = currentMathLines.join('\n');
      elements.push(
        <MathRenderer key={`math-${key}`} math={mathText} block={true} />
      );
      currentMathLines = [];
    }
  };

  const flushDetailsBlock = (key: string | number) => {
    if (currentDetailsLines.length > 0 || detailsSummary) {
      const detailsContent = currentDetailsLines.join('\n');
      elements.push(
        <details key={`details-${key}`} className="border border-[var(--color-border)]/50 bg-[var(--color-bg-sidebar)]/20 px-4 py-2.5 rounded-lg my-3 transition-all">
          {detailsSummary && (
            <summary className="font-semibold cursor-pointer select-none text-sm hover:text-[var(--color-text-primary)] transition-colors py-0.5">
              {detailsSummary}
            </summary>
          )}
          <div className="mt-2.5 text-[var(--color-text-secondary)] text-sm">
            {renderMarkdownText(detailsContent)}
          </div>
        </details>
      );
      currentDetailsLines = [];
      detailsSummary = '';
    }
  };
  
  const flushParagraph = (key: string | number) => {
    if (currentParagraphLines.length > 0) {
      const pText = currentParagraphLines.join('\n');
      elements.push(
        <p key={`p-${key}`} className="whitespace-pre-wrap leading-relaxed select-text text-sm my-1 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(pText)}
        </p>
      );
      currentParagraphLines = [];
    }
  };

  const flushList = (key: string | number) => {
    if (currentListType && currentListItems.length > 0) {
      if (currentListType === 'ul') {
        elements.push(
          <ul key={`ul-${key}`} className="list-disc pl-5 my-1 flex flex-col gap-1">
            {currentListItems.map((item) => (
              <li key={`li-${item.key}`} className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {renderInlineMarkdown(item.content)}
              </li>
            ))}
          </ul>
        );
      } else if (currentListType === 'ol') {
        const startNum = currentListItems[0].num ?? 1;
        elements.push(
          <ol key={`ol-${key}`} start={startNum} className="list-decimal pl-5 my-1 flex flex-col gap-1">
            {currentListItems.map((item) => (
              <li key={`li-${item.key}`} className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {renderInlineMarkdown(item.content)}
              </li>
            ))}
          </ol>
        );
      }
      currentListItems = [];
      currentListType = null;
    }
  };

  const flushBlockquote = (key: string | number) => {
    if (currentBlockquoteLines.length > 0) {
      const quoteText = currentBlockquoteLines.join('\n');
      
      const firstLineTrimmed = currentBlockquoteLines[0].trim();
      const alertMatch = firstLineTrimmed.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]$/i);
      
      if (alertMatch) {
        const type = alertMatch[1].toUpperCase();
        const contentLines = currentBlockquoteLines.slice(1);
        const contentText = contentLines.join('\n');
        
        let styleClass = '';
        let titleClass = '';
        let titleText = '';
        let icon: React.ReactNode = null;
        
        switch (type) {
          case 'NOTE':
            styleClass = 'border-l-2 border-l-sky-500 bg-sky-500/[0.03] dark:bg-sky-400/[0.02]';
            titleClass = 'text-sky-600 dark:text-sky-400';
            titleText = 'NOTE';
            icon = <Info className="w-3.5 h-3.5 shrink-0" />;
            break;
          case 'TIP':
            styleClass = 'border-l-2 border-l-emerald-500 bg-emerald-500/[0.03] dark:bg-emerald-400/[0.02]';
            titleClass = 'text-emerald-600 dark:text-emerald-400';
            titleText = 'TIP';
            icon = <Lightbulb className="w-3.5 h-3.5 shrink-0" />;
            break;
          case 'IMPORTANT':
            styleClass = 'border-l-2 border-l-indigo-500 bg-indigo-500/[0.03] dark:bg-indigo-400/[0.02]';
            titleClass = 'text-indigo-600 dark:text-indigo-400';
            titleText = 'IMPORTANT';
            icon = <AlertCircle className="w-3.5 h-3.5 shrink-0" />;
            break;
          case 'WARNING':
            styleClass = 'border-l-2 border-l-amber-500 bg-amber-500/[0.03] dark:bg-amber-400/[0.02]';
            titleClass = 'text-amber-600 dark:text-amber-400';
            titleText = 'WARNING';
            icon = <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
            break;
          case 'CAUTION':
          case 'DANGER':
            styleClass = 'border-l-2 border-l-rose-500 bg-rose-500/[0.03] dark:bg-rose-400/[0.02]';
            titleClass = 'text-rose-600 dark:text-rose-400';
            titleText = type;
            icon = <AlertOctagon className="w-3.5 h-3.5 shrink-0" />;
            break;
        }

        elements.push(
          <div 
            key={`alert-${key}`} 
            className={`pl-4 pr-3 py-2.5 rounded-r-lg my-3 text-sm select-text leading-relaxed ${styleClass}`}
          >
            <div className={`flex items-center gap-1.5 font-bold text-xs select-none tracking-wider uppercase mb-1.5 ${titleClass}`}>
              {icon}
              <span>{titleText}</span>
            </div>
            <div className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed font-normal">
              {renderMarkdownText(contentText)}
            </div>
          </div>
        );
      } else {
        elements.push(
          <blockquote key={`quote-${key}`} className="border border-[var(--color-border)]/60 bg-[var(--color-bg-sidebar)]/30 px-4 py-2 rounded-lg my-2 text-[var(--color-text-secondary)] text-sm select-text leading-relaxed">
            {renderMarkdownText(quoteText)}
          </blockquote>
        );
      }
      currentBlockquoteLines = [];
    }
  };

  const flushTable = (key: string | number) => {
    if (inTable && tableHeaders.length > 0) {
      elements.push(
        <div key={`table-wrapper-${key}`} className="overflow-x-auto my-3 border border-[var(--color-border)]/40 rounded-lg max-w-full shadow-sm">
          <table className="min-w-full divide-y divide-[var(--color-border)]/40 text-xs font-sans select-text border-collapse">
            <thead className="bg-[var(--color-bg-active)]/20 text-[var(--color-text-secondary)] font-semibold border-b border-[var(--color-border)]/30">
              <tr>
                {tableHeaders.map((header, i) => {
                  const align = tableAlignments[i] || 'left';
                  return (
                     <th
                       key={`th-${i}`}
                       className={`px-4 py-2.5 ${ALIGN_CLASS[align] ?? ALIGN_CLASS.left} border-r border-[var(--color-border)]/15 last:border-r-0 font-bold uppercase tracking-wider`}
                     >
                       {renderInlineMarkdown(header)}
                     </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/15 bg-transparent text-[var(--color-text-primary)]">
              {tableRows.map((row, rIndex) => (
                <tr 
                  key={`tr-${rIndex}`} 
                  className="hover:bg-[var(--color-bg-hover)]/20 transition-colors odd:bg-[var(--color-bg-sidebar)]/10"
                >
                  {row.map((cell, cIndex) => {
                    const align = tableAlignments[cIndex] || 'left';
                    return (
                      <td
                        key={`td-${cIndex}`}
                        className={`px-4 py-2 ${ALIGN_CLASS[align] ?? ALIGN_CLASS.left} border-r border-[var(--color-border)]/15 last:border-r-0 whitespace-pre-wrap leading-relaxed`}
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableHeaders = [];
      tableRows = [];
      tableAlignments = [];
      inTable = false;
    }
  };

  const flushAll = (key: string | number) => {
    flushParagraph(key);
    flushList(key);
    flushTable(key);
    flushBlockquote(key);
    flushMathBlock(key);
    flushDetailsBlock(key);
  };
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Check if we are inside a details block
    if (inDetailsBlock) {
      if (trimmedLine.startsWith('</details>')) {
        flushDetailsBlock(index);
        inDetailsBlock = false;
      } else {
        const summaryMatch = trimmedLine.match(/<summary>([\s\S]*?)<\/summary>/i);
        if (summaryMatch) {
          detailsSummary = summaryMatch[1].trim();
        } else {
          currentDetailsLines.push(line);
        }
      }
      return;
    }

    // Check details block start
    if (trimmedLine.startsWith('<details>')) {
      flushAll(index);
      inDetailsBlock = true;
      currentDetailsLines = [];
      detailsSummary = '';
      return;
    }
    
    // Check if we are inside a math block
    if (inMathBlock) {
      if (trimmedLine.includes('$$')) {
        const parts = line.split('$$');
        const mathPart = parts[0].trim();
        if (mathPart) {
          currentMathLines.push(mathPart);
        }
        flushMathBlock(index);
        inMathBlock = false;
        
        const remaining = parts.slice(1).join('$$').trim();
        if (remaining) {
          currentParagraphLines.push(remaining);
        }
      } else {
        currentMathLines.push(line);
      }
      return;
    }

    // Check single line block math
    if (trimmedLine.startsWith('$$') && trimmedLine.endsWith('$$') && trimmedLine.length >= 4) {
      flushAll(index);
      const mathContent = trimmedLine.slice(2, -2).trim();
      elements.push(
        <MathRenderer key={`math-${index}`} math={mathContent} block={true} />
      );
      return;
    }

    // Check multi-line block math start
    if (trimmedLine.startsWith('$$')) {
      flushAll(index);
      inMathBlock = true;
      const mathContent = line.slice(line.indexOf('$$') + 2).trim();
      if (mathContent) {
        currentMathLines.push(mathContent);
      }
      return;
    }
    
    // Check if it's a table row
    const isTableRow = trimmedLine.startsWith('|') && trimmedLine.endsWith('|') && trimmedLine.length > 2;
    
    if (isTableRow) {
      const cells = trimmedLine.slice(1, -1).split('|').map(c => c.trim());
      const isDivider = cells.every(cell => /^[:\s-]*$/.test(cell) && cell.includes('-'));
      
      if (isDivider) {
        if (inTable) {
          tableAlignments = cells.map(cell => {
            const clean = cell.trim();
            if (clean.startsWith(':') && clean.endsWith(':')) return 'center';
            if (clean.endsWith(':')) return 'right';
            return 'left';
          });
        }
        return;
      }
      
      if (!inTable) {
        flushAll(index);
        inTable = true;
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      return;
    }
    
    // If not in table row, but we were parsing a table, flush it
    if (inTable) {
      flushTable(index);
    }
    
    // Check if it's a blockquote row
    if (trimmedLine.startsWith('>')) {
      flushParagraph(index);
      flushList(index);
      flushTable(index);
      let content = line.slice(line.indexOf('>') + 1);
      if (content.startsWith(' ')) {
        content = content.slice(1);
      }
      currentBlockquoteLines.push(content);
      return;
    }

    // 1. 匹配标题
    if (trimmedLine.startsWith('# ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h1 key={`h1-${index}`} className={`text-xl font-bold ${isFirst ? 'mt-1' : 'mt-4'} mb-2 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(2))}
        </h1>
      );
    } else if (trimmedLine.startsWith('## ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h2 key={`h2-${index}`} className={`text-lg font-semibold ${isFirst ? 'mt-1' : 'mt-3.5'} mb-2 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(3))}
        </h2>
      );
    } else if (trimmedLine.startsWith('### ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h3 key={`h3-${index}`} className={`text-base font-semibold ${isFirst ? 'mt-1' : 'mt-3'} mb-1.5 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(4))}
        </h3>
      );
    } else if (trimmedLine.startsWith('#### ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h4 key={`h4-${index}`} className={`text-sm font-semibold ${isFirst ? 'mt-1' : 'mt-2.5'} mb-1 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(5))}
        </h4>
      );
    }
    // 2. 匹配无序列表项
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      if (currentListType !== 'ul') {
        flushAll(index);
        currentListType = 'ul';
      }
      currentListItems.push({
        key: index,
        content: trimmedLine.slice(2)
      });
    }
    // 3. 匹配有序列表项
    else if (/^\d+\.\s/.test(trimmedLine)) {
      const match = trimmedLine.match(/^(\d+)\.\s(.*)/);
      const num = match ? parseInt(match[1]) : 1;
      const content = match ? match[2] : trimmedLine.slice(trimmedLine.indexOf('.') + 1).trim();
      
      if (currentListType !== 'ol') {
        flushAll(index);
        currentListType = 'ol';
      }
      currentListItems.push({
        key: index,
        content,
        num
      });
    }
    // 4. 匹配水平分割线
    else if (/^[-\*_]{3,}$/.test(trimmedLine)) {
      flushAll(index);
      elements.push(
        <hr key={`hr-${index}`} className="my-4 border-t border-[var(--color-border)]/60" />
      );
    }
    // 5. 普通行
    else {
      if (trimmedLine === '') {
        flushAll(index);
      } else {
        if (currentListType) {
          flushList(index);
        }
        flushBlockquote(index);
        currentParagraphLines.push(line);
      }
    }
  });
  
  flushAll('final');
  
  return <div className="flex flex-col gap-1">{elements}</div>;
};

interface MarkdownRendererProps {
  text: string;
}

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  return <>{renderMarkdownText(text)}</>;
}

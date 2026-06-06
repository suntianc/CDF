import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

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
        <span className="uppercase text-xs font-bold text-[var(--color-accent)] tracking-wider">
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

export const renderInlineMarkdown = (text: string) => {
  if (!text) return null;
  const inlineRegex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
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
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code 
          key={i} 
          className="px-1.5 py-0.5 mx-0.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 rounded text-xs font-mono text-[var(--color-accent)]"
        >
          {part.slice(1, -1)}
        </code>
      );
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
      elements.push(
        <blockquote key={`quote-${key}`} className="border-l-4 border-[var(--color-accent)]/60 bg-[var(--color-bg-sidebar)]/30 pl-4 pr-3 py-2 rounded-r-lg my-2 text-[var(--color-text-secondary)] text-sm select-text leading-relaxed">
          {renderMarkdownText(quoteText)}
        </blockquote>
      );
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
                       className={`px-4 py-2.5 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 font-bold uppercase tracking-wider`}
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
                        className={`px-4 py-2 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 whitespace-pre-wrap leading-relaxed`}
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
  };
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
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

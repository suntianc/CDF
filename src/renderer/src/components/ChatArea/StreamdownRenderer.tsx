import React, { memo } from 'react';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { Info, Lightbulb, AlertCircle, AlertTriangle, AlertOctagon } from 'lucide-react';
import { CodeBlock } from './MarkdownRenderer';
import 'katex/dist/katex.min.css';

interface StreamdownRendererProps {
  text: string;
  isTypewriting?: boolean;
}

const mathPlugin = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: 'var(--color-danger, #dc2626)'
});

// Define customComponents reference at top to allow safe recursive rendering
const customComponents: any = {};

// Helper to extract plain text from React children tree
const getReactTextContent = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) {
    return children.map(getReactTextContent).join('');
  }
  if (typeof children === 'object' && children !== null && 'props' in children) {
    return getReactTextContent((children as any).props.children);
  }
  return '';
};

// Custom blockquote renderer supporting [!NOTE], [!TIP], etc.
const BlockquoteRenderer = ({ children }: { children: React.ReactNode }) => {
  const text = getReactTextContent(children).trim();
  const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\](?:\s*\n)?([\s\S]*)/i);

  if (alertMatch) {
    const type = alertMatch[1].toUpperCase();
    const contentText = alertMatch[2];

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

    return (
      <div className={`pl-4 pr-3 py-2.5 rounded-r-lg my-3 text-sm select-text leading-relaxed ${styleClass}`}>
        <div className={`flex items-center gap-1.5 font-bold text-xs select-none tracking-wider uppercase mb-1.5 ${titleClass}`}>
          {icon}
          <span>{titleText}</span>
        </div>
        <div className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed font-normal">
          <Streamdown mode="static" controls={false} lineNumbers={false} components={customComponents}>
            {contentText}
          </Streamdown>
        </div>
      </div>
    );
  }

  return (
    <blockquote className="border border-[var(--color-border)]/60 bg-[var(--color-bg-sidebar)]/30 px-4 py-2 rounded-lg my-2 text-[var(--color-text-secondary)] text-sm select-text leading-relaxed">
      {children}
    </blockquote>
  );
};

// Custom code block / inline code renderer
const CodeComponent = ({ inline, className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const code = String(children).replace(/\n$/, '');

  if (!inline && (className || code.includes('\n'))) {
    return <CodeBlock lang={lang} code={code} />;
  }

  return (
    <code
      className="px-1.5 py-0.5 mx-0.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 rounded text-xs font-mono text-[var(--color-text-primary)]"
      {...props}
    >
      {children}
    </code>
  );
};

// Custom tables components
const TableComponent = ({ children }: any) => (
  <div className="overflow-x-auto my-3 border border-[var(--color-border)]/40 rounded-lg max-w-full shadow-sm">
    <table className="min-w-full divide-y divide-[var(--color-border)]/40 text-xs font-sans select-text border-collapse">
      {children}
    </table>
  </div>
);

const TheadComponent = ({ children }: any) => (
  <thead className="bg-[var(--color-bg-active)]/20 text-[var(--color-text-secondary)] font-semibold border-b border-[var(--color-border)]/30">
    {children}
  </thead>
);

const TbodyComponent = ({ children }: any) => (
  <tbody className="divide-y divide-[var(--color-border)]/15 bg-transparent text-[var(--color-text-primary)]">
    {children}
  </tbody>
);

const TrComponent = ({ children }: any) => (
  <tr className="hover:bg-[var(--color-bg-hover)]/20 transition-colors odd:bg-[var(--color-bg-sidebar)]/10">
    {children}
  </tr>
);

const ThComponent = ({ children, style, ...props }: any) => {
  const align = style?.textAlign || 'left';
  return (
    <th
      className={`px-4 py-2.5 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 font-bold uppercase tracking-wider`}
      {...props}
    >
      {children}
    </th>
  );
};

const TdComponent = ({ children, style, ...props }: any) => {
  const align = style?.textAlign || 'left';
  return (
    <td
      className={`px-4 py-2 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 whitespace-pre-wrap leading-relaxed`}
      {...props}
    >
      {children}
    </td>
  );
};

// Custom list components
const UlComponent = ({ children }: any) => (
  <ul className="list-disc pl-5 my-1 flex flex-col gap-1">
    {children}
  </ul>
);

const OlComponent = ({ children, start }: any) => (
  <ol start={start} className="list-decimal pl-5 my-1 flex flex-col gap-1">
    {children}
  </ol>
);

const LiComponent = ({ children }: any) => (
  <li className="text-sm leading-relaxed text-[var(--color-text-primary)]">
    {children}
  </li>
);

const AComponent = ({ children, href }: any) => (
  <a
    href={href}
    className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline underline-offset-2 transition-colors"
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
  </a>
);

// Map custom component bindings
customComponents.code = CodeComponent;
customComponents.blockquote = BlockquoteRenderer;
customComponents.table = TableComponent;
customComponents.thead = TheadComponent;
customComponents.tbody = TbodyComponent;
customComponents.tr = TrComponent;
customComponents.th = ThComponent;
customComponents.td = TdComponent;
customComponents.ul = UlComponent;
customComponents.ol = OlComponent;
customComponents.li = LiComponent;
customComponents.a = AComponent;

export const StreamdownRenderer = memo(({ text, isTypewriting = false }: StreamdownRendererProps) => {
  if (!text) return null;

  return (
    <Streamdown
      className="streamdown-renderer w-full text-sm leading-relaxed text-[var(--color-text-primary)]"
      mode="static"
      parseIncompleteMarkdown={isTypewriting}
      controls={false}
      lineNumbers={false}
      components={customComponents}
      plugins={{ math: mathPlugin }}
    >
      {text}
    </Streamdown>
  );
});

StreamdownRenderer.displayName = 'StreamdownRenderer';

import React, { memo, useContext } from 'react';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { CodeBlock } from './markdown/CodeBlock';
import { AlertBlock, type AlertType } from './markdown/AlertBlock';
import { textAlignClass } from './markdown/textAlign';
import { ImageZoomContext } from './MessageItem';
import 'katex/dist/katex.min.css';

interface StreamdownRendererProps {
  text: string;
  isTypewriting?: boolean;
  density?: 'default' | 'compact';
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

    const alertContent = stripAlertMarker(children);
    return (
      <AlertBlock type={type as AlertType}>
        <div className="streamdown-renderer w-full text-sm leading-relaxed text-[var(--color-text-primary)]">
          {alertContent}
        </div>
      </AlertBlock>
    );
  }

  return (
    <blockquote className="border border-[var(--color-border)]/60 bg-[var(--color-bg-sidebar)]/30 px-4 py-2 rounded-lg my-2 text-[var(--color-text-secondary)] text-sm select-text leading-relaxed">
      {children}
    </blockquote>
  );
};

function stripAlertMarker(children: React.ReactNode): React.ReactNode {
  let stripped = false;
  const markerPattern = /^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]\s*\n?/i;

  const visit = (node: React.ReactNode): React.ReactNode => {
    if (stripped) return node;
    if (typeof node === 'string') {
      const next = node.replace(markerPattern, '');
      stripped = next !== node;
      return next;
    }
    if (typeof node === 'number' || !node) return node;
    if (Array.isArray(node)) return node.map(visit);
    if (React.isValidElement(node)) {
      const props = node.props as { children?: React.ReactNode };
      return React.cloneElement(node, undefined, visit(props.children));
    }
    return node;
  };

  return visit(children);
}

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
      className={`px-4 py-2.5 ${textAlignClass(align)} border-r border-[var(--color-border)]/15 last:border-r-0 font-bold uppercase tracking-wider`}
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
      className={`px-4 py-2 ${textAlignClass(align)} border-r border-[var(--color-border)]/15 last:border-r-0 whitespace-pre-wrap leading-relaxed`}
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

function getSafeImageSrc(src: string): string {
  if (!src) return '';
  if (src.startsWith('data:')) {
    return src;
  }
  if (src.startsWith('file://')) {
    return src.replace('file://', 'cdf-file://');
  }
  if (src.startsWith('/')) {
    return `cdf-file://${src}`;
  }
  return src;
}

const AComponent = ({ children, href }: any) => {
  if (!href) return null;

  // Check if it's an audio or video path
  const isAudio = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(href);
  const isVideo = /\.(mp4|webm|mov|ogg|mkv|avi)$/i.test(href);

  // Convert local path to cdf-file protocol
  const safeSrc = getSafeImageSrc(href);

  if (isAudio) {
    return (
      <span className="inline-block my-1.5 w-full max-w-[360px] block">
        <audio
          src={safeSrc}
          controls
          preload="metadata"
          className="w-full h-8 outline-none"
        />
      </span>
    );
  }

  if (isVideo) {
    return (
      <span className="inline-block my-2 w-full max-w-[480px] block">
        <video
          src={safeSrc}
          controls
          preload="metadata"
          className="w-full rounded-lg border border-[var(--color-border)]/55 bg-black/95 shadow-sm block focus-visible:outline-none"
          style={{ maxHeight: '320px', objectFit: 'contain' }}
        />
      </span>
    );
  }

  return (
    <a
      href={href}
      className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline underline-offset-2 transition-colors"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
};

const HeadingComponent = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
  const classNameByLevel = {
    1: 'text-lg font-semibold mt-3 mb-2 leading-snug text-[var(--color-text-primary)]',
    2: 'text-base font-semibold mt-3 mb-1.5 leading-snug text-[var(--color-text-primary)]',
    3: 'text-sm font-semibold mt-2.5 mb-1.5 leading-snug text-[var(--color-text-primary)]',
    4: 'text-sm font-semibold mt-2 mb-1 leading-snug text-[var(--color-text-primary)]',
    5: 'text-xs font-semibold mt-2 mb-1 leading-snug uppercase tracking-wide text-[var(--color-text-secondary)]',
    6: 'text-xs font-semibold mt-2 mb-1 leading-snug uppercase tracking-wide text-[var(--color-text-muted)]',
  }[level];

  return ({ children }: { children: React.ReactNode }) => (
    <Tag className={classNameByLevel}>{children}</Tag>
  );
};

const SummaryComponent = ({ children }: { children: React.ReactNode }) => (
  <summary className="font-semibold cursor-pointer select-none text-sm hover:text-[var(--color-text-primary)] transition-colors py-0.5">
    {children}
  </summary>
);

const DetailsComponent = ({ children }: { children: React.ReactNode }) => {
  const childArray = React.Children.toArray(children);
  const summary = childArray.find((child) => (
    React.isValidElement(child) && (child.type === 'summary' || child.type === SummaryComponent)
  ));
  const bodyText = childArray
    .filter((child) => child !== summary)
    .map(getReactTextContent)
    .join('')
    .trim();

  return (
    <details className="border border-[var(--color-border)]/50 bg-[var(--color-bg-sidebar)]/20 px-4 py-2.5 rounded-lg my-3 transition-[background-color,border-color] duration-150">
      {summary ?? <summary className="font-semibold cursor-pointer select-none text-sm py-0.5">Details</summary>}
      {bodyText && (
        <Streamdown
          className="streamdown-renderer w-full text-sm leading-relaxed text-[var(--color-text-primary)]"
          mode="static"
          controls={false}
          lineNumbers={false}
          components={customComponents}
          plugins={{ math: mathPlugin }}
        >
          {bodyText}
        </Streamdown>
      )}
    </details>
  );
};

type MarkdownSegment =
  | { type: 'markdown'; text: string }
  | { type: 'details'; summary: string; body: string };

function splitDetailsBlocks(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const detailsPattern = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = detailsPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'markdown', text: text.slice(cursor, match.index) });
    }
    segments.push({
      type: 'details',
      summary: match[1].trim(),
      body: match[2].trim(),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: 'markdown', text: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', text }];
}

function containsDetailsBlock(text: string): boolean {
  return /<details>\s*<summary>[\s\S]*?<\/summary>[\s\S]*?<\/details>/i.test(text);
}

function renderStreamdown(text: string, isTypewriting: boolean, densityClass: string) {
  return (
    <Streamdown
      className={`streamdown-renderer w-full ${densityClass} leading-relaxed text-[var(--color-text-primary)]`}
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
}


const ImgComponent = ({ src, alt }: { src?: string; alt?: string }) => {
  const zoomImage = useContext(ImageZoomContext);
  const safeSrc = getSafeImageSrc(src || '');

  if (!safeSrc) return null;

  // Use a random salt to isolate DOM keys for identical image URLs in the same bubble
  const uniqueKey = React.useMemo(() => {
    return `img-wrapper-${safeSrc}-${Math.floor(Math.random() * 1000000)}`;
  }, [safeSrc]);

  return (
    <span key={uniqueKey} className="inline-block my-1.5">
      <img
        src={safeSrc}
        alt={alt || 'image'}
        className="max-w-[480px] w-full max-h-[360px] object-contain rounded-lg border border-[var(--color-border)]/55 bg-[var(--color-bg-surface)] cursor-zoom-in shadow-sm hover:opacity-95 hover:scale-[1.005] active:scale-[0.995] transition-all duration-150"
        onClick={() => zoomImage(safeSrc)}
      />
    </span>
  );
};

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
customComponents.h1 = HeadingComponent(1);
customComponents.h2 = HeadingComponent(2);
customComponents.h3 = HeadingComponent(3);
customComponents.h4 = HeadingComponent(4);
customComponents.h5 = HeadingComponent(5);
customComponents.h6 = HeadingComponent(6);
customComponents.details = DetailsComponent;
customComponents.summary = SummaryComponent;
customComponents.img = ImgComponent;

function preprocessMarkdownMediaAndImages(text: string): string {
  if (!text || typeof text !== 'string') return '';
  
  // Regex to match ![alt](url) or [text](url) syntax
  return text.replace(/(!?)\[([^\]]*?)\]\(([^)]+)\)/g, (match, isImage, alt, url) => {
    const trimmedUrl = url.trim();
    
    // Check if the URL string ends with a quoted title (e.g. "title" or 'title')
    const titleRegex = /\s+["'](.*?)["']$/;
    const hasTitle = titleRegex.test(trimmedUrl);
    
    let pathPart = trimmedUrl;
    let titlePart = '';
    
    if (hasTitle) {
      const matchTitle = trimmedUrl.match(titleRegex);
      if (matchTitle) {
        titlePart = matchTitle[1];
        pathPart = trimmedUrl.replace(titleRegex, '');
      }
    }
    
    // If it is a local absolute path or file protocol, and contains spaces
    if ((pathPart.startsWith('/') || pathPart.startsWith('file://')) && pathPart.includes(' ')) {
      pathPart = pathPart
        .split('/')
        .map((seg: string) => encodeURIComponent(decodeURIComponent(seg)))
        .join('/');
    }
    
    const titleString = titlePart ? ` "${titlePart}"` : '';
    return `${isImage}[${alt}](${pathPart}${titleString})`;
  });
}

export const StreamdownRenderer = memo(({ text, isTypewriting = false, density = 'default' }: StreamdownRendererProps) => {
  if (!text) return null;

  const processedText = preprocessMarkdownMediaAndImages(text);
  const densityClass = density === 'compact' ? 'text-xs' : 'text-sm';
  
  if (containsDetailsBlock(processedText)) {
    const segments = splitDetailsBlocks(processedText);
    return (
      <>
        {segments.map((segment, index) => {
          if (segment.type === 'markdown') {
            return segment.text.trim()
              ? <React.Fragment key={`markdown-${index}`}>{renderStreamdown(segment.text, isTypewriting, densityClass)}</React.Fragment>
              : null;
          }

          return (
            <details key={`details-${index}`} className="border border-[var(--color-border)]/50 bg-[var(--color-bg-sidebar)]/20 px-4 py-2.5 rounded-lg my-3 transition-[background-color,border-color] duration-150">
              <SummaryComponent>{segment.summary}</SummaryComponent>
              <StreamdownRenderer text={segment.body} isTypewriting={isTypewriting} density={density} />
            </details>
          );
        })}
      </>
    );
  }

  return renderStreamdown(processedText, isTypewriting, densityClass);
});

StreamdownRenderer.displayName = 'StreamdownRenderer';

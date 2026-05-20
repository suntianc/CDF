import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { createHighlighter, type Highlighter } from 'shiki'
import { Check, Copy } from 'lucide-react'

let highlighterPromise: Promise<Highlighter> | null = null
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [
        'typescript', 'javascript', 'python', 'css', 'html', 'json',
        'bash', 'shell', 'sql', 'yaml', 'markdown', 'xml', 'rust', 'go',
        'java', 'cpp', 'c', 'ruby', 'php', 'swift', 'kotlin'
      ]
    })
  }
  return highlighterPromise
}

function useCopyCode() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = useCallback(async (code: string, blockId: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedId(blockId)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])
  return { copiedId, copy }
}

function getCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children.replace(/\n$/, '')
  if (Array.isArray(children)) {
    return children.map(c => (typeof c === 'string' ? c : '')).join('').replace(/\n$/, '')
  }
  return String(children || '').replace(/\n$/, '')
}

interface CodeBlockProps {
  className?: string
  children?: React.ReactNode
  blockId?: string
}

function CodeBlock({ className, children, blockId }: CodeBlockProps) {
  const [html, setHtml] = useState<string>('')
  const [useFallback, setUseFallback] = useState(true)
  const { copiedId, copy } = useCopyCode()

  const lang = className?.replace('language-', '') || 'text'
  const codeText = getCodeText(children)

  useEffect(() => {
    getHighlighter()
      .then(highlighter => {
        const isDark = document.documentElement.classList.contains('dark')
        const theme = isDark ? 'github-dark' : 'github-light'
        const highlighted = highlighter.codeToHtml(codeText, { lang, theme })
        setHtml(highlighted)
        setUseFallback(false)
      })
      .catch(() => {})
  }, [codeText, lang])

  return (
    // 🚀 精致的单像素阴影边缘，采用磨砂感微弱底面
    <div className="relative group my-4 rounded-xl border border-neutral-200/60 dark:border-neutral-800/80 shadow-card overflow-hidden animate-in fade-in duration-200">
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-50/80 dark:bg-[#141418] border-b border-neutral-200/50 dark:border-neutral-800/60 select-none">
        <span className="text-[10px] font-mono font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">{lang}</span>
        <button
          onClick={() => copy(codeText, blockId || '')}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-neutral-200/50 dark:hover:bg-neutral-800/80 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
        >
          {copiedId === blockId
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <Copy className="w-3.5 h-3.5" />
          }
        </button>
      </div>
      {useFallback ? (
        <pre className="text-[13px] leading-6 overflow-x-auto p-4 m-0 font-mono text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#0c0c0e] no-scrollbar">
          <code>{codeText}</code>
        </pre>
      ) : (
        <div
          className="text-[13px] leading-6 overflow-x-auto p-4 bg-white dark:bg-[#0c0c0e] [&>pre]:m-0 [&>pre]:bg-transparent no-scrollbar"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const blockCounter = { current: 0 }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          pre({ children }) { return <>{children}</> },
          code({ className, children, ...props }) {
            if (className) {
              blockCounter.current++
              return (
                <CodeBlock className={className} blockId={`cb-${blockCounter.current}`}>
                  {children}
                </CodeBlock>
              )
            }
            return (
              <code className="bg-neutral-100/80 dark:bg-neutral-800/50 px-1.5 py-0.5 rounded-md text-[12px] font-mono font-medium text-neutral-800 dark:text-neutral-300" {...props}>
                {children}
              </code>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-xl border border-neutral-200/60 dark:border-neutral-800/80 shadow-card">
                <table className="min-w-full text-sm border-collapse bg-white dark:bg-[#121215]/30">
                  {children}
                </table>
              </div>
            )
          },
          th({ children }) {
            return <th className="px-4 py-2.5 bg-neutral-50 dark:bg-[#141418] text-left font-medium text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 border-b border-neutral-200/60 dark:border-neutral-800/80">{children}</th>
          },
          td({ children }) {
            return <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800/40 last:border-b-0 font-sans text-xs">{children}</td>
          },
          a({ children, href }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-500 dark:text-indigo-400 font-medium hover:underline underline-offset-2 transition-all">
                {children}
              </a>
            )
          },
          ul({ children }) { return <ul className="list-disc pl-5 space-y-1.5 my-3">{children}</ul> },
          ol({ children }) { return <ol className="list-decimal pl-5 space-y-1.5 my-3">{children}</ol> },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-[3px] border-neutral-200 dark:border-neutral-800 pl-4 italic text-neutral-400 dark:text-neutral-500 my-4 font-sans">
                {children}
              </blockquote>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { createHighlighter, type Highlighter } from 'shiki'
import { Check, Copy } from 'lucide-react'

// Singleton highlighter — initialized once
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
  const [useFallback, setUseFallback] = useState(true) // Start with fallback, upgrade to shiki
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
      .catch(() => {
        // shiki unavailable (browser dev mode) — stay with fallback
      })
  }, [codeText, lang])

  return (
    <div className="relative group my-3 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-50 dark:bg-[#181818] border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-500 uppercase tracking-wider">{lang}</span>
        <button
          onClick={() => copy(codeText, blockId || '')}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
          title="复制"
        >
          {copiedId === blockId
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <Copy className="w-3.5 h-3.5 text-neutral-500" />
          }
        </button>
      </div>
      {useFallback ? (
        <pre className="text-[13px] leading-5 overflow-x-auto p-4 m-0 font-mono text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#0d0d0d]">
          <code>{codeText}</code>
        </pre>
      ) : (
        <div
          className="text-[13px] leading-5 overflow-x-auto p-4 bg-white dark:bg-[#0d0d0d] [&>pre]:m-0 [&>pre]:bg-transparent"
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
    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:text-[14px] [&>p]:leading-6 [&>p]:mb-2 [&>p]:text-neutral-800 dark:[&>p]:text-neutral-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          pre({ children }) {
            return <>{children}</>
          },
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
              <code className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-neutral-800 dark:text-neutral-200" {...props}>
                {children}
              </code>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
                <table className="min-w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            )
          },
          th({ children }) {
            return <th className="px-4 py-2 bg-neutral-50 dark:bg-[#181818] text-left font-medium text-xs uppercase tracking-wider text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">{children}</th>
          },
          td({ children }) {
            return <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800/60 last:border-b-0">{children}</td>
          },
          a({ children, href }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline underline-offset-2">
                {children}
              </a>
            )
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1 my-2 text-neutral-800 dark:text-neutral-200">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1 my-2 text-neutral-800 dark:text-neutral-200">{children}</ol>
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-4 italic text-neutral-600 dark:text-neutral-400 my-3">
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
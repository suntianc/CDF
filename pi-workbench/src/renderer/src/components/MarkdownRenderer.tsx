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
    <div className="relative group my-2 rounded-md border border-[#ebebeb] dark:border-[#2a2a2a] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#f5f5f5] dark:bg-[#252525] border-b border-[#ebebeb] dark:border-[#2a2a2a]">
        <span className="text-[11px] font-mono text-[#888] uppercase">{lang}</span>
        <button
          onClick={() => copy(codeText, blockId || '')}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ebebeb] dark:hover:bg-[#333]"
          title="复制"
        >
          {copiedId === blockId
            ? <Check className="w-3.5 h-3.5 text-[#16a34a]" />
            : <Copy className="w-3.5 h-3.5 text-[#888]" />
          }
        </button>
      </div>
      {useFallback ? (
        <pre className="text-[13px] leading-5 overflow-x-auto p-3 m-0 font-mono text-[#4d4d4d] dark:text-[#ebebeb]">
          <code>{codeText}</code>
        </pre>
      ) : (
        <div
          className="text-[13px] leading-5 overflow-x-auto p-3 [&>pre]:m-0 [&>pre]:bg-transparent"
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
    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:text-[14px] [&>p]:leading-5 [&>p]:mb-2">
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
              <code className="bg-[#f5f5f5] dark:bg-[#252525] px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
                {children}
              </code>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="min-w-full text-sm border-collapse border border-[#ebebeb] dark:border-[#2a2a2a]">
                  {children}
                </table>
              </div>
            )
          },
          th({ children }) {
            return <th className="border border-[#ebebeb] dark:border-[#2a2a2a] px-3 py-1.5 bg-[#f5f5f5] dark:bg-[#252525] text-left font-medium">{children}</th>
          },
          td({ children }) {
            return <td className="border border-[#ebebeb] dark:border-[#2a2a2a] px-3 py-1.5">{children}</td>
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
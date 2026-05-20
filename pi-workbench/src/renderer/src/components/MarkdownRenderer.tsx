import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { createHighlighter, type Highlighter } from 'shiki'
import { Card } from '@/components/ui/card'
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

interface CodeBlockProps {
  className?: string
  children?: React.ReactNode
  /** Unique id for the block, passed from renderer */
  blockId?: string
}

function CodeBlock({ className, children, blockId }: CodeBlockProps) {
  const [html, setHtml] = useState<string>('')
  const { copiedId, copy } = useCopyCode()

  // Extract language from className (format: "language-xxx")
  const lang = className?.replace('language-', '') || 'text'
  const code = String(children || '').replace(/\n$/, '')

  useEffect(() => {
    let cancelled = false
    getHighlighter().then(highlighter => {
      if (cancelled) return
      const isDark = document.documentElement.classList.contains('dark')
      const theme = isDark ? 'github-dark' : 'github-light'
      const highlighted = highlighter.codeToHtml(code, { lang, theme })
      setHtml(highlighted)
    })
    return () => { cancelled = true }
  }, [code, lang])

  return (
    <Card className="relative group my-2 overflow-hidden">
      {/* Language badge + copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#f5f5f5] dark:bg-[#252525] border-b border-[#ebebeb] dark:border-[#2a2a2a]">
        <span className="text-[11px] font-mono text-[#888] uppercase">{lang}</span>
        <button
          onClick={() => copy(code, blockId || '')}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ebebeb] dark:hover:bg-[#333]"
          title="复制"
        >
          {copiedId === blockId
            ? <Check className="w-3.5 h-3.5 text-[#16a34a]" />
            : <Copy className="w-3.5 h-3.5 text-[#888]" />
          }
        </button>
      </div>
      {/* Highlighted code */}
      <div
        className="text-[13px] leading-5 overflow-x-auto p-3 [&>pre]:m-0 [&>pre]:bg-transparent"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Card>
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
          code({ className, children, ...props }) {
            // Determine if it's a code block (has language class) or inline code
            if (className) {
              blockCounter.current++
              return (
                <CodeBlock className={className} blockId={`cb-${blockCounter.current}`}>
                  {children}
                </CodeBlock>
              )
            }
            // Inline code
            return (
              <code className="bg-[#f5f5f5] dark:bg-[#252525] px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
                {children}
              </code>
            )
          },
          // Override other markdown elements with proper styling
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
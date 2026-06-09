import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { ToolMessageCard } from './ToolMessageCard';
import { CodeBlock, MarkdownRenderer, MathRenderer } from './MarkdownRenderer';
import { AtToken } from '@/components/AtMention/AtToken';
import { parseAtTokens } from '@/lib/commands/pathUtils';

const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
};

export const formatHMSTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
};

const checkThinkingFinished = (content: string): boolean => {
  if (!content) return true;
  const lastThink = content.lastIndexOf('<think>');
  if (lastThink === -1) return true;
  const lastThinkEnd = content.lastIndexOf('</think>');
  return lastThinkEnd > lastThink;
};

interface MessageItemProps {
  message: any;
  isLast: boolean;
  isStreaming: boolean;
}

export const MessageItem = memo(({ message, isLast, isStreaming }: MessageItemProps) => {
  const isFinished = useMemo(() => checkThinkingFinished(message.content), [message.content]);
  
  // 刚刚生成的消息（2分钟以内创建），在流式或刚结束时默认保持展开，防止意外重装折叠
  const isRecent = useMemo(() => {
    return (Date.now() - message.created_at) < 120 * 1000;
  }, [message.created_at]);

  const [thinkExpanded, setThinkExpanded] = useState(() => {
    if (isRecent) return true;
    return !isFinished;
  });

  // 计时的 React 状态
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFinished && isLast && isStreaming) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      const interval = setInterval(() => {
        const delta = Math.round((Date.now() - startTimeRef.current!) / 1000);
        setElapsedSeconds(delta);
      }, 500);
      return () => clearInterval(interval);
    } else {
      startTimeRef.current = null;
    }
    return undefined;
  }, [isFinished, isLast, isStreaming]);

  useEffect(() => {
    if (isFinished && elapsedSeconds > 0 && finalDuration === null) {
      setFinalDuration(elapsedSeconds);
    }
  }, [isFinished, elapsedSeconds, finalDuration]);

  // === 平滑吐字缓冲队列 ===
  const [displayedContent, setDisplayedContent] = useState(message.content);
  const targetContentRef = useRef(message.content);
  const displayedContentRef = useRef(message.content);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 当内容发生改变或者流式状态改变时更新
  useEffect(() => {
    targetContentRef.current = message.content;

    if (!isStreaming || !isLast) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDisplayedContent(message.content);
      displayedContentRef.current = message.content;
      return;
    }

    // 正在流式中，如果当前显示内容落后于目标内容，并且定时器没在跑，启动它
    const startQueue = () => {
      if (timerRef.current) return;

      const tick = () => {
        const target = targetContentRef.current;
        const current = displayedContentRef.current;

        if (current.length < target.length) {
          const diff = target.length - current.length;
          // 按比例追赶：落后越多，步长越大，但最少 1 个字符，最多一次追赶 diff/5 字符以保持平滑
          const step = Math.max(1, Math.min(diff, Math.ceil(diff / 5)));
          const nextContent = target.slice(0, current.length + step);
          
          setDisplayedContent(nextContent);
          displayedContentRef.current = nextContent;

          timerRef.current = setTimeout(tick, 20); // 20ms 的间隔，大约 50fps，非常丝滑
        } else {
          // 已经赶上，挂起定时器
          timerRef.current = null;
        }
      };

      tick();
    };

    if (displayedContentRef.current.length < message.content.length) {
      startQueue();
    }
  }, [message.content, isStreaming, isLast]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Helper to parse tool JSON
  const toolInfo = useMemo(() => {
    if (message.role !== 'system') return null;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && parsed.type === 'tool') {
        return parsed;
      }
    } catch (e) {
      // Not a JSON tool message, treat as regular system message
    }
    return null;
  }, [message.content, message.role]);

  const renderMessageContent = (content: string) => {
    if (!content) return null;

    const renderMain = (text: string) => {
      if (!text) return null;
      const parts = text.split(/(```[\s\S]*?```)/g);
      return parts.map((part, index) => {
        if (part.startsWith('```')) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1].toLowerCase() : '';
          const code = match ? match[2] : part.slice(3, -3);
          if (lang === 'math' || lang === 'latex' || lang === 'katex') {
            return <MathRenderer math={code} block={true} key={index} />;
          }
          return <CodeBlock lang={lang} code={code} key={index} />;
        }
        if (!part.trim()) return null;
        return (
          <div key={index} className="w-full">
            <MarkdownRenderer text={part} />
          </div>
        );
      });
    };

    // 清洗多余的 </think> 标签（例如由于主进程补发与大模型输出重叠产生的冗余闭合标签）
    let cleanContent = content;
    const thinkCount = (cleanContent.match(/<think>/g) || []).length;
    const thinkEndCount = (cleanContent.match(/<\/think>/g) || []).length;
    if (thinkEndCount > thinkCount) {
      if (thinkCount === 0) {
        cleanContent = cleanContent.replace(/<\/think>/g, '');
      } else {
        const lastIdx = cleanContent.lastIndexOf('</think>');
        if (lastIdx !== -1) {
          cleanContent = cleanContent.substring(0, lastIdx) + cleanContent.substring(lastIdx + 8);
        }
      }
    }

    // Phase 08.3 C-03: scan cleanContent for @relative/path substrings and render
    // each match as an <AtToken> pill. Code blocks (triple-backticks + single
    // backticks) are NOT scanned — markdown code should render literally.
    // Mirrors the at-trigger regex in pathUtils.parseAtTokens (lookbehind for ^ or \s).
    const renderAtSegment = (segment: string, baseKey: number): React.ReactNode[] => {
      const atTokens = parseAtTokens(segment);
      if (atTokens.length === 0) {
        const rendered = renderMain(segment);
        return rendered ? [<span key={`seg-${baseKey}`}>{rendered}</span>] : [];
      }
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      for (const t of atTokens) {
        if (t.start > cursor) {
          const pre = segment.slice(cursor, t.start);
          const preRender = renderMain(pre);
          if (preRender) parts.push(<span key={`pre-${baseKey}-${cursor}`}>{preRender}</span>);
        }
        parts.push(
          <AtToken
            key={`at-${baseKey}-${t.start}`}
            path={t.path}
            kind={t.kind}
            data-testid="history-at-token"
          />
        );
        cursor = t.end;
      }
      if (cursor < segment.length) {
        const post = segment.slice(cursor);
        const postRender = renderMain(post);
        if (postRender) parts.push(<span key={`post-${baseKey}-${cursor}`}>{postRender}</span>);
      }
      return parts;
    };

    function renderContentWithAtTokens(text: string): React.ReactNode {
      if (!text.includes('@')) return renderMain(text);
      // Split text on code blocks first; only non-code segments get at-tokenized.
      const codeBlockRegex = /(```[\s\S]*?```|`[^`]+`)/g;
      const segments: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;
      while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          segments.push(...renderAtSegment(text.slice(lastIndex, match.index), key++));
        }
        // Code block — render via renderMain (which will treat it as code/markdown)
        const codeRender = renderMain(match[0]);
        if (codeRender) segments.push(<span key={`code-${key++}`}>{codeRender}</span>);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        segments.push(...renderAtSegment(text.slice(lastIndex), key++));
      }
      return <>{segments}</>;
    }

    const isOutputting = isStreaming && isLast;

    if (isOutputting) {
      let thinkParts: string[] = [];
      let mainContent = '';
      let remaining = cleanContent;
      let isThinkingFinished = true;

      while (true) {
        const startIdx = remaining.indexOf('<think>');
        if (startIdx === -1) {
          mainContent += remaining;
          break;
        }
        mainContent += remaining.substring(0, startIdx);
        
        const endIdx = remaining.indexOf('</think>', startIdx);
        if (endIdx !== -1) {
          thinkParts.push(remaining.substring(startIdx + 7, endIdx));
          remaining = remaining.substring(endIdx + 8);
        } else {
          thinkParts.push(remaining.substring(startIdx + 7));
          isThinkingFinished = false;
          remaining = '';
          break;
        }
      }

      const thinkContent = thinkParts.map(p => p.trim()).filter(Boolean).join('\n');
      mainContent = mainContent.trim();

      const renderThink = () => {
        if (!thinkContent) return null;
        const finished = isThinkingFinished;

        const getThinkingTime = () => {
          if (!finished) {
            return elapsedSeconds;
          }
          if (finalDuration !== null) {
            return finalDuration;
          }
          // 历史消息估算（每个字符大概 18-20 毫秒生成速度）
          return Math.max(1, Math.round(thinkContent.length / 18));
        };

        const currentSeconds = getThinkingTime();
        const headerText = finished 
          ? `已思考 (用时 ${formatDuration(currentSeconds)})` 
          : `思考中 (已用时 ${formatDuration(elapsedSeconds)})...`;

        return (
          <div className="mb-2.5 flex flex-col transition-all duration-200">
            {/* Thinking Header (Flat Text style) */}
            <div 
              onClick={() => setThinkExpanded(!thinkExpanded)}
              className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
            >
              <span>{thinkExpanded ? '▼' : '▶'}</span>
              <span>{headerText}</span>
            </div>
            
            {/* Thinking Body (Flat sidebar line style) */}
            {thinkExpanded && (
              <div className="mt-1 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 text-[12.5px] text-[var(--color-text-secondary)] select-text whitespace-pre-wrap leading-relaxed font-normal animate-slide-down">
                {thinkContent}
                {!finished && (
                  <span className="inline-block w-1 h-3 ml-0.5 bg-[var(--color-text-muted)]/70 animate-pulse vertical-middle" />
                )}
              </div>
            )}
          </div>
        );
      };

      return (
        <div className="flex flex-col gap-3">
          {renderThink()}
          {renderContentWithAtTokens(mainContent)}
        </div>
      );
    } else {
      const firstThink = cleanContent.indexOf('<think>');
      if (firstThink === -1) {
        return (
          <div className="flex flex-col gap-3">
            {renderContentWithAtTokens(cleanContent)}
          </div>
        );
      }

      const lastThinkEnd = cleanContent.lastIndexOf('</think>');
      let foldedRaw = '';
      let preContent = '';
      let postContent = '';

      preContent = cleanContent.substring(0, firstThink);
      if (lastThinkEnd !== -1 && lastThinkEnd > firstThink) {
        foldedRaw = cleanContent.substring(firstThink + 7, lastThinkEnd);
        postContent = cleanContent.substring(lastThinkEnd + 8);
      } else {
        foldedRaw = cleanContent.substring(firstThink + 7);
        postContent = '';
      }

      const foldedContent = foldedRaw.replace(/<\/?think>/g, '').trim();
      const preContentTrimmed = preContent.trim();
      const postContentTrimmed = postContent.trim();

      const getThinkingTime = () => {
        if (finalDuration !== null) {
          return finalDuration;
        }
        return Math.max(1, Math.round(foldedContent.length / 18));
      };

      const currentSeconds = getThinkingTime();
      const headerText = `已处理（用时 ${formatHMSTime(currentSeconds)}）`;

      const renderFoldedBlock = () => {
        if (!foldedContent) return null;
        return (
          <div className="mb-2.5 flex flex-col transition-all duration-200">
            {/* Thinking Header (Flat Text style) */}
            <div 
              onClick={() => setThinkExpanded(!thinkExpanded)}
              className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
            >
              <span>{thinkExpanded ? '▼' : '▶'}</span>
              <span>{headerText}</span>
            </div>
            
            {/* Thinking Body (Flat sidebar line style) */}
            {thinkExpanded && (
              <div className="mt-1 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 text-[12.5px] text-[var(--color-text-secondary)] select-text whitespace-pre-wrap leading-relaxed font-normal animate-slide-down">
                {foldedContent}
              </div>
            )}
          </div>
        );
      };

      return (
        <div className="flex flex-col gap-3">
          {preContentTrimmed && renderMain(preContentTrimmed)}
          {renderFoldedBlock()}
          {postContentTrimmed && renderMain(postContentTrimmed)}
        </div>
      );
    }
  };

  if (toolInfo) {
    return <ToolMessageCard toolInfo={toolInfo} createdAt={message.created_at} />;
  }

  return (
    <div className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className="message-bubble animate-pop-in">
        {renderMessageContent(displayedContent)}
        <div className="message-time">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.tokens && message.tokens > 0 ? ` · ${message.tokens} tokens` : ''}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.message.content === nextProps.message.content &&
         prevProps.message.tokens === nextProps.message.tokens &&
         prevProps.isLast === nextProps.isLast &&
         prevProps.isStreaming === nextProps.isStreaming;
});

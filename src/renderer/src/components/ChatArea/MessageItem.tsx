import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { ToolMessageCard } from './ToolMessageCard';
import { StreamdownRenderer } from './StreamdownRenderer';
import { AtToken } from '@/components/AtMention/AtToken';
import { parseAtTokens } from '@/lib/commands/pathUtils';
import { useTypewriter } from '@/hooks/useTypewriter';
import { useSessionStore, estimateTokens } from '../../stores/sessionStore';

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return '< 1 秒';
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

interface ThinkBlockProps {
  expanded: boolean;
  onToggle: () => void;
  bodyId: string;
  headerText: string;
  body: string;
  showCaret?: boolean;
}

function ThinkBlock({ expanded, onToggle, bodyId, headerText, body, showCaret = false }: ThinkBlockProps) {
  return (
    <div className="mb-2.5 flex flex-col transition-all duration-200">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        data-testid="think-toggle"
        className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
      >
        <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
        <span>{headerText}</span>
      </button>
      {expanded && (
        <div
          id={bodyId}
          className={`mt-1 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 text-[12.5px] text-[var(--color-text-secondary)] select-text whitespace-pre-wrap leading-relaxed font-normal${showCaret ? '' : ' animate-slide-down'}`}
        >
          {body}
          {showCaret && (
            <span
              aria-hidden="true"
              className="inline-block w-1 h-3 ml-0.5 bg-[var(--color-text-muted)]/70 animate-pulse vertical-middle"
            />
          )}
        </div>
      )}
    </div>
  );
}


const checkThinkingFinished = (content: string): boolean => {
  if (!content) return true;
  const lastThink = content.lastIndexOf('<think>');
  if (lastThink === -1) return true;
  const lastThinkEnd = content.lastIndexOf('</think>');
  return lastThinkEnd > lastThink;
};

interface ThinkBlocks {
  thinkParts: string[];
  mainContent: string;
  isThinkingFinished: boolean;
}

/**
 * Walk a message body once, splitting it into the in-progress think
 * trace and the main content. Used by both the streaming branch (which
 * keeps multiple in-flight think blocks) and the folded branch (which
 * concatenates the trace into a single folded body).
 *
 *   `isThinkingFinished` is false when the last segment is an unclosed
 *   `<think>` (the LLM is still emitting the trace).
 */
const parseThinkBlocks = (content: string): ThinkBlocks => {
  const thinkParts: string[] = [];
  let mainContent = '';
  let remaining = content;
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

  return { thinkParts, mainContent: mainContent.trim(), isThinkingFinished };
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
      // Persist real think duration so historical reloads show accurate timing
      if (message.id && !message.think_duration_seconds) {
        useSessionStore.getState().updateMessageThinkDuration(message.id, elapsedSeconds);
      }
    }
  }, [isFinished, elapsedSeconds, finalDuration, message.id, message.think_duration_seconds]);

  // === 平滑打字机调度（rAF 驱动，自适应步长） ===
  const { displayedContent, isTypewriting } = useTypewriter(
    message.content,
    isStreaming && isLast
  );

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

  // Render a non-code markdown segment with at-token substitution.
  // Caller is responsible for splitting on code blocks so that `@` inside
  // backticks is never tokenized — markdown code renders literally.
  const renderAtSegment = (segment: string, baseKey: number): React.ReactNode[] => {
    if (!segment) return [];
    const atTokens = parseAtTokens(segment);
    if (atTokens.length === 0) {
      return [<StreamdownRenderer key={`seg-${baseKey}`} text={segment} isTypewriting={isTypewriting} />];
    }
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const t of atTokens) {
      if (t.start > cursor) {
        const pre = segment.slice(cursor, t.start);
        parts.push(
          <StreamdownRenderer key={`pre-${baseKey}-${cursor}`} text={pre} isTypewriting={isTypewriting} />
        );
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
      parts.push(
        <StreamdownRenderer key={`post-${baseKey}-${cursor}`} text={post} isTypewriting={isTypewriting} />
      );
    }
    return parts;
  };

  // Render markdown content with at-token substitution. Walks the string once
  // with a tiny state machine so:
  //   1. `@` inside fenced ``` or inline `…` code is never tokenized.
  //   2. Unbalanced backticks (LLM streamed a stray ` mid-response) do not
  //      swallow the rest of the message.
  //   3. Unreasonably large payloads skip the scan and fall through to a
  //      single StreamdownRenderer to avoid freezing the main thread.
  const AT_TOKEN_SCAN_LIMIT = 50_000;

  const renderContentWithAtTokens = (text: string): React.ReactNode => {
    if (!text || typeof text !== 'string') return null;
    if (!text.includes('@') || text.length > AT_TOKEN_SCAN_LIMIT) {
      return <StreamdownRenderer text={text} isTypewriting={isTypewriting} />;
    }

    const segments: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    const len = text.length;

    while (cursor < len) {
      const fenceOpen = text.startsWith('```', cursor);
      const tick = text.indexOf('`', cursor);

      if (!fenceOpen && tick === -1) {
        // No more code spans — rest is plain prose, scan for at-tokens.
        segments.push(...renderAtSegment(text.slice(cursor), key++));
        break;
      }

      if (fenceOpen && (tick === -1 || cursor === tick)) {
        // Fenced code block: advance until the matching closing ``` (or EOS).
        const close = text.indexOf('```', cursor + 3);
        const end = close === -1 ? len : close + 3;
        segments.push(
          <StreamdownRenderer key={`code-${key++}`} text={text.slice(cursor, end)} isTypewriting={isTypewriting} />
        );
        cursor = end;
        continue;
      }

      if (!fenceOpen && tick !== -1) {
        // Prose gap before the inline backtick: scan for at-tokens.
        if (tick > cursor) {
          segments.push(...renderAtSegment(text.slice(cursor, tick), key++));
        }
        // Inline code: advance to the matching closing ` (same length) or EOS.
        const tickLen = countBackticks(text, tick);
        const closer = findInlineCodeClose(text, tick, tickLen);
        const end = closer === -1 ? len : closer + tickLen;
        segments.push(
          <StreamdownRenderer key={`code-${key++}`} text={text.slice(cursor, end)} isTypewriting={isTypewriting} />
        );
        cursor = end;
        continue;
      }
    }

    return <>{segments}</>;
  };

  function countBackticks(text: string, start: number): number {
    let n = 0;
    while (text[start + n] === '`') n++;
    return n;
  }

  function findInlineCodeClose(text: string, start: number, run: number): number {
    const len = text.length;
    let i = start + run;
    while (i < len) {
      if (text[i] === '`') {
        const closing = countBackticks(text, i);
        if (closing === run) return i;
        i += closing;
      } else {
        i++;
      }
    }
    return -1;
  }

  const renderMessageContent = (content: string) => {
    if (!content) return null;

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

    if (isTypewriting) {
      const { thinkParts, mainContent, isThinkingFinished } = parseThinkBlocks(cleanContent);
      const thinkContent = thinkParts.map(p => p.trim()).filter(Boolean).join('\n');

      const renderThink = () => {
        if (!thinkContent) return null;
        const finished = isThinkingFinished;

        const getThinkingTime = () => {
          if (!finished) return elapsedSeconds;
          if (finalDuration !== null) return finalDuration;
          if (message.think_duration_seconds) return message.think_duration_seconds;
          return null;
        };

        const resolvedSeconds = getThinkingTime();
        const headerText = finished
          ? resolvedSeconds !== null
            ? `已思考 (用时 ${formatDuration(resolvedSeconds)})`
            : `已思考 (约 ${estimateTokens(thinkContent)} tokens)`
          : `思考中 (已用时 ${formatDuration(elapsedSeconds)})...`;

        return (
          <ThinkBlock
            expanded={thinkExpanded}
            onToggle={() => setThinkExpanded(!thinkExpanded)}
            bodyId="think-body-streaming"
            headerText={headerText}
            body={thinkContent}
            showCaret={!finished}
          />
        );
      };

      return (
        <div className="flex flex-col gap-3">
          {renderThink()}
          {mainContent && (
            <StreamdownRenderer text={mainContent} isTypewriting={true} />
          )}
        </div>
      );
    }

    // Finished path: folded think block + main, both routed through StreamdownRenderer.
    const firstThink = cleanContent.indexOf('<think>');
    if (firstThink === -1) {
      return (
        <div className="flex flex-col gap-3">
          {renderContentWithAtTokens(cleanContent)}
        </div>
      );
    }

    // Delegate to the shared parser, then split its pre/post/main
    // segments into the three pieces the folded block needs:
    //   - preContentTrimmed  → main rendered above the fold
    //   - postContentTrimmed → main rendered below the fold
    //   - foldedContent      → the think trace, concatenated
    const { thinkParts, mainContent, isThinkingFinished } = parseThinkBlocks(cleanContent);
    const foldedContent = thinkParts.map(p => p.trim()).filter(Boolean).join('\n');

    // Locate the segments around the first <think> fence so the folded
    // block sits between pre-content and post-content.
    const firstClose = cleanContent.indexOf('</think>', firstThink);
    const preContentTrimmed = cleanContent.substring(0, firstThink).trim();
    const postContentTrimmed = (firstClose === -1
      ? ''
      : cleanContent.substring(firstClose + 8)
    ).trim();
    void mainContent; // pre/post already slice the right segments

    const resolvedSeconds = finalDuration ?? message.think_duration_seconds ?? null;
    // Honest header: if the LLM is still emitting the trace (the
    // unclosed-`<think>` case), do not claim "思考完成". The folded
    // block appears for any message with a non-empty think trace, so
    // it can render while the stream is still in progress.
    const headerText = isThinkingFinished
      ? resolvedSeconds !== null
        ? `思考完成 (用时 ${formatDuration(resolvedSeconds)})`
        : `思考完成 (约 ${estimateTokens(foldedContent)} tokens)`
      : `思考中 (已用时 ${formatDuration(elapsedSeconds)})...`;

    const renderFoldedBlock = () => {
      if (!foldedContent) return null;
      return (
        <ThinkBlock
          expanded={thinkExpanded}
          onToggle={() => setThinkExpanded(!thinkExpanded)}
          bodyId="think-body-folded"
          headerText={headerText}
          body={foldedContent}
        />
      );
    };

    return (
      <div className="flex flex-col gap-3">
        {preContentTrimmed && renderContentWithAtTokens(preContentTrimmed)}
        {renderFoldedBlock()}
        {postContentTrimmed && renderContentWithAtTokens(postContentTrimmed)}
      </div>
    );
  };

  if (toolInfo) {
    return <ToolMessageCard toolInfo={toolInfo} createdAt={message.created_at} />;
  }

  return (
    <div className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className="message-row">
        {renderMessageContent(displayedContent)}
        <div className="message-time">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.tokens && message.tokens > 0 ? ` · ${message.tokens} tokens` : ''}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // During active streaming of the last message, content changes on every
  // chunk. We MUST re-render when the message object changes (each chunk
  // produces a new object via .map() in sessionStore). For non-streaming
  // historical messages, content is stable so identity comparison is fine.
  if (nextProps.isLast && nextProps.isStreaming) {
    // Always re-render the actively-streaming message — content is updating
    return false;
  }
  return prevProps.message === nextProps.message &&
         prevProps.isLast === nextProps.isLast &&
         prevProps.isStreaming === nextProps.isStreaming;
});

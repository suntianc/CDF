import React, { useState, useEffect, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import {
  CapabilityJobTimelineEventSchema,
  type CapabilityJobTimelineEvent,
} from '@shared/capability-jobs';

import { ImageZoomContext } from './ImageZoomContext';
export { ImageZoomContext };
import { createPortal } from 'react-dom';
import { ToolMessageCard } from './ToolMessageCard';
import { StreamdownRenderer } from './StreamdownRenderer';
import { AtToken } from '@/components/AtMention/AtToken';
import { parseAtTokens } from '@/lib/commands/pathUtils';
import { useTypewriter } from '@/hooks/useTypewriter';
import { estimateTokens } from '../../stores/sessionStore';
import {
  checkThinkingFinished,
  containsRenderableAtTokens,
  joinThinkParts,
  parseFoldedThinkView,
  parseThinkBlocks,
  segmentMarkdownForAtTokens,
  stripOrphanThinkClosers,
} from './messageContentParsing';
import { useThinkingTimer } from './useThinkingTimer';
import type { SkillAttribution } from '@shared/types';

const CapabilityJobTimelineSchema = CapabilityJobTimelineEventSchema;
type CapabilityJobTimelineInfo = CapabilityJobTimelineEvent;

function CapabilityJobTimelineCard({ info }: { info: CapabilityJobTimelineInfo }) {
  const { t } = useTranslation();

  const statusConfig = {
    completed: {
      icon: <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0" style={{ color: 'var(--color-success)' }} />,
      labelKey: 'conversation.capabilityJob.completed'
    },
    failed: {
      icon: <XCircle className="w-4 h-4 text-[var(--color-danger)] shrink-0" style={{ color: 'var(--color-danger)' }} />,
      labelKey: 'conversation.capabilityJob.failed'
    },
    canceled: {
      icon: <AlertCircle className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" style={{ color: 'var(--color-text-muted)' }} />,
      labelKey: 'conversation.capabilityJob.canceled'
    }
  };

  const status = info.status === 'completed' || info.status === 'failed' || info.status === 'canceled'
    ? info.status
    : 'completed';
  const config = statusConfig[status];

  return (
    <div
      className="message assistant animate-fade-in"
      style={{
        maxWidth: '80%',
        alignSelf: 'flex-start',
        textAlign: 'left',
        marginRight: 'auto',
        padding: '6px 0 12px 0',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div className="message-row" style={{ width: '100%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          {config.icon}
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
            {t(config.labelKey)}
          </span>
          {info.provider && info.mode && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t(`taskPanel.jobRoute.${info.provider}`)} · {t(`taskPanel.videoModeValue.${info.mode}`)}
            </span>
          )}
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', opacity: 0.6, flexShrink: 0, marginLeft: '4px' }}>
            #{info.jobId.slice(0, 8)}
          </span>
        </div>
      </div>
    </div>
  );
}

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

interface SkillAttributionInfo {
  type: 'skill_attribution';
  attributions: SkillAttribution[];
}


function SkillAttributionCard({ info }: { info: SkillAttributionInfo }) {
  const { t } = useTranslation();
  const attributions = Array.isArray(info.attributions) ? info.attributions : [];
  if (attributions.length === 0) return null;

  return (
    <div className="my-1 w-fit rounded-[var(--radius-sm)] border border-[var(--color-border)]/40 bg-[var(--color-bg-sunken)]/20 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
      <span className="font-medium">{t('chat.skillAttribution.title')}</span>
      {attributions.map((item, idx) => (
        <span
          key={`${item.phase}:${item.qualifiedName}:${item.skillPath}`}
          className="font-mono font-semibold text-[var(--color-text-primary)]"
          title={item.skillPath}
        >
          {idx > 0 && ', '}
          {item.qualifiedName}
        </span>
      ))}
    </div>
  );
}

function ThinkBlock({ expanded, onToggle, bodyId, headerText, body, showCaret = false }: ThinkBlockProps) {
  return (
    <div className="mb-2.5 flex flex-col">
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

function PreviewLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'var(--color-overlay-scrim)' }}
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={url}
          alt="preview"
          className="max-w-[90vw] max-h-[90vh] object-contain shadow-2xl"
          style={{ borderRadius: 'var(--radius-lg)' }}
        />
        <button
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-lg transition-colors cursor-pointer"
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}
          onClick={onClose}
          aria-label="Close preview"
        >
          &times;
        </button>
      </div>
    </div>,
    document.body
  );
}

export interface MessageItemProps {
  message: any;
  isLast: boolean;
  isStreaming: boolean;
}

export interface MessageContentRendererProps {
  content: string;
  isLast: boolean;
  isStreaming: boolean;
  messageId?: string;
  thinkDurationSeconds?: number;
  thinkRecent?: boolean;
}

export const MessageContentRenderer = memo(({
  content,
  isLast,
  isStreaming,
  messageId,
  thinkDurationSeconds,
  thinkRecent = false,
}: MessageContentRendererProps) => {
  const { t } = useTranslation();
  const isFinished = useMemo(() => checkThinkingFinished(content), [content]);

  const [thinkExpanded, setThinkExpanded] = useState(() => {
    if (thinkRecent) return true;
    return !isFinished;
  });

  const { elapsedSeconds, finalDuration } = useThinkingTimer({
    isFinished,
    isActive: isLast && isStreaming,
    messageId,
    thinkDurationSeconds,
  });

  const { displayedContent, isTypewriting } = useTypewriter(
    content,
    isStreaming && isLast
  );

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

  const renderContentWithAtTokens = (text: string): React.ReactNode => {
    if (!text || typeof text !== 'string') return null;
    if (!containsRenderableAtTokens(text)) {
      return <StreamdownRenderer text={text} isTypewriting={isTypewriting} />;
    }

    const nodes: React.ReactNode[] = [];
    let key = 0;
    for (const segment of segmentMarkdownForAtTokens(text)) {
      if (segment.kind === 'code') {
        nodes.push(
          <StreamdownRenderer key={`code-${key++}`} text={segment.value} isTypewriting={isTypewriting} />
        );
      } else {
        nodes.push(...renderAtSegment(segment.value, key++));
      }
    }

    return <>{nodes}</>;
  };

  const renderThinkHeader = (
    finished: boolean,
    body: string,
    resolvedSeconds: number | null,
    keys: { withTime: string; withTokens: string },
  ) => {
    if (!finished) return t('chat.thinking.inProgress', { duration: formatDuration(elapsedSeconds) });
    return resolvedSeconds !== null
      ? t(keys.withTime, { duration: formatDuration(resolvedSeconds) })
      : t(keys.withTokens, { tokens: estimateTokens(body) });
  };

  const renderMessageContent = (contentString: string) => {
    if (!contentString) return null;

    const cleanContent = stripOrphanThinkClosers(contentString);

    if (isTypewriting) {
      const { thinkParts, mainContent, isThinkingFinished } = parseThinkBlocks(cleanContent);
      const thinkContent = joinThinkParts(thinkParts);

      return (
        <div className="flex flex-col gap-3">
          {thinkContent && (
            <ThinkBlock
              expanded={thinkExpanded}
              onToggle={() => setThinkExpanded(!thinkExpanded)}
              bodyId="think-body-streaming"
              headerText={renderThinkHeader(
                isThinkingFinished,
                thinkContent,
                finalDuration ?? (thinkDurationSeconds || null),
                {
                  withTime: 'chat.thinking.finishedWithTime',
                  withTokens: 'chat.thinking.finishedWithTokens',
                },
              )}
              body={thinkContent}
              showCaret={!isThinkingFinished}
            />
          )}
          {mainContent && (
            <StreamdownRenderer text={mainContent} isTypewriting={true} />
          )}
        </div>
      );
    }

    const foldedView = parseFoldedThinkView(cleanContent);
    if (!foldedView) {
      return (
        <div className="flex flex-col gap-3">
          {renderContentWithAtTokens(cleanContent)}
        </div>
      );
    }

    const { preContent, foldedContent, postContent, isThinkingFinished } = foldedView;

    return (
      <div className="flex flex-col gap-3">
        {preContent && renderContentWithAtTokens(preContent)}
        {foldedContent && (
          <ThinkBlock
            expanded={thinkExpanded}
            onToggle={() => setThinkExpanded(!thinkExpanded)}
            bodyId="think-body-folded"
            headerText={renderThinkHeader(
              isThinkingFinished,
              foldedContent,
              finalDuration ?? thinkDurationSeconds ?? null,
              {
                withTime: 'chat.thinking.completeWithTime',
                withTokens: 'chat.thinking.completeWithTokens',
              },
            )}
            body={foldedContent}
          />
        )}
        {postContent && renderContentWithAtTokens(postContent)}
      </div>
    );
  };

  return <>{renderMessageContent(displayedContent)}</>;
}, (prevProps, nextProps) => {
  if (nextProps.isLast && nextProps.isStreaming) {
    return false;
  }
  return prevProps.content === nextProps.content &&
         prevProps.isLast === nextProps.isLast &&
         prevProps.isStreaming === nextProps.isStreaming &&
         prevProps.messageId === nextProps.messageId &&
         prevProps.thinkDurationSeconds === nextProps.thinkDurationSeconds &&
         prevProps.thinkRecent === nextProps.thinkRecent;
});

export const MessageItem = memo(({ message, isLast, isStreaming }: MessageItemProps) => {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);
  const isRecent = useMemo(() => {
    return (Date.now() - message.created_at) < 120 * 1000;
  }, [message.created_at]);

  const toolInfo = useMemo(() => {
    if (message.role !== 'system') return null;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && parsed.type === 'tool') {
        return parsed;
      }
    } catch {
      // Not JSON — fall through to the regular renderer.
    }
    return null;
  }, [message.content, message.role]);

  const skillAttributionInfo = useMemo<SkillAttributionInfo | null>(() => {
    if (message.role !== 'system') return null;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && parsed.type === 'skill_attribution' && Array.isArray(parsed.attributions)) {
        return parsed as SkillAttributionInfo;
      }
    } catch {
      // Not JSON — fall through to the regular renderer.
    }
    return null;
  }, [message.content, message.role]);

  const capabilityJobInfo = useMemo<CapabilityJobTimelineInfo | null>(() => {
    if (message.role !== 'assistant') return null;
    try {
      const parsed: unknown = JSON.parse(message.content);
      const result = CapabilityJobTimelineSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }, [message.content, message.role]);

  if (toolInfo) {
    return <ToolMessageCard toolInfo={toolInfo} createdAt={message.created_at} />;
  }

  if (skillAttributionInfo) {
    return <SkillAttributionCard info={skillAttributionInfo} />;
  }

  if (capabilityJobInfo) {
    return <CapabilityJobTimelineCard info={capabilityJobInfo} />;
  }

  if (message.role === 'user') {
    return (
      <div
        className="message user animate-fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '6px',
          width: '100%',
          maxWidth: '80%',
          alignSelf: 'flex-end',
          padding: '8px 0'
        }}
      >
        {/* 缩略图区域（在气泡上方） */}
        {message.imageBase64 && message.imageBase64.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end mb-1">
            {message.imageBase64.map((dataUrl: string, idx: number) => (
              <div
                key={idx}
                onClick={() => setLightboxUrl(dataUrl)}
                className="group relative cursor-zoom-in overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] shadow-sm hover:border-[var(--color-border-strong)] transition-all bg-[var(--color-bg-surface)]"
                style={{
                  width: '80px',
                  height: '80px',
                  boxSizing: 'border-box'
                }}
              >
                <img
                  src={dataUrl}
                  alt={`uploaded_image_${idx + 1}`}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              </div>
            ))}
          </div>
        )}

        {/* 用户气泡本体 */}
        <div
          className="message-row"
          style={{
            wordBreak: 'break-word'
          }}
        >
          <ImageZoomContext.Provider value={setLightboxUrl}>
            <MessageContentRenderer
              content={message.content}
              isLast={isLast}
              isStreaming={isStreaming}
              messageId={message.id}
              thinkDurationSeconds={message.think_duration_seconds}
              thinkRecent={isRecent}
            />
          </ImageZoomContext.Provider>
        </div>

        {/* 辅助信息与时间（在气泡下方，靠右） */}
        <div
          style={{
            fontSize: '11px',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            marginRight: '4px',
            marginTop: '2px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none'
          }}
        >
          <span>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {message.tokens && message.tokens > 0 && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{message.tokens} tokens</span>
            </>
          )}
        </div>

        {lightboxUrl && <PreviewLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      </div>
    );
  }

  return (
    <div className={`message assistant`}>
      <div className="message-row">
        <ImageZoomContext.Provider value={setLightboxUrl}>
          <MessageContentRenderer
            content={message.content}
            isLast={isLast}
            isStreaming={isStreaming}
            messageId={message.id}
            thinkDurationSeconds={message.think_duration_seconds}
            thinkRecent={isRecent}
          />
        </ImageZoomContext.Provider>
        <div className="message-time">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.tokens && message.tokens > 0 ? ` · ${message.tokens} tokens` : ''}
        </div>
      </div>

      {lightboxUrl && <PreviewLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}, (prevProps, nextProps) => {
  if (nextProps.isLast && nextProps.isStreaming) {
    return false;
  }
  return prevProps.message === nextProps.message &&
         prevProps.isLast === nextProps.isLast &&
         prevProps.isStreaming === nextProps.isStreaming;
});

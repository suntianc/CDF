// Pure text-parsing helpers behind MessageItem (#237). No React here: these
// functions split a raw message body into think traces, main content and
// markdown code segments so the component only renders.
import { parseAtTokens } from '@/lib/commands/pathUtils';

export const checkThinkingFinished = (content: string): boolean => {
  if (!content) return true;
  const lastThink = content.lastIndexOf('<think>');
  if (lastThink === -1) return true;
  const lastThinkEnd = content.lastIndexOf('</think>');
  return lastThinkEnd > lastThink;
};

export interface ThinkBlocks {
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
export const parseThinkBlocks = (content: string): ThinkBlocks => {
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

/** Join trimmed think parts into the single body shown inside a ThinkBlock. */
export const joinThinkParts = (thinkParts: string[]): string =>
  thinkParts.map((part) => part.trim()).filter(Boolean).join('\n');

/**
 * Some providers emit more `</think>` closers than openers. Drop the orphan:
 * all of them when there is no opener at all, otherwise the last one.
 */
export const stripOrphanThinkClosers = (content: string): string => {
  const thinkCount = (content.match(/<think>/g) || []).length;
  const thinkEndCount = (content.match(/<\/think>/g) || []).length;
  if (thinkEndCount <= thinkCount) return content;
  if (thinkCount === 0) {
    return content.replace(/<\/think>/g, '');
  }
  const lastIdx = content.lastIndexOf('</think>');
  if (lastIdx === -1) return content;
  return content.substring(0, lastIdx) + content.substring(lastIdx + 8);
};

export interface FoldedThinkView {
  /** Trimmed content before the first `<think>`. */
  preContent: string;
  /** All think parts joined into one folded body. */
  foldedContent: string;
  /** Trimmed content after the first `</think>` ('' when it never closed). */
  postContent: string;
  isThinkingFinished: boolean;
}

/**
 * Static (non-typewriting) view of a message containing think markup:
 * pre-content, one folded trace, post-content. Returns null when the message
 * has no `<think>` at all.
 */
export const parseFoldedThinkView = (content: string): FoldedThinkView | null => {
  const firstThink = content.indexOf('<think>');
  if (firstThink === -1) return null;

  const { thinkParts, isThinkingFinished } = parseThinkBlocks(content);
  const firstClose = content.indexOf('</think>', firstThink);

  return {
    preContent: content.substring(0, firstThink).trim(),
    foldedContent: joinThinkParts(thinkParts),
    postContent: (firstClose === -1 ? '' : content.substring(firstClose + 8)).trim(),
    isThinkingFinished,
  };
};

/** Beyond this length the at-token scan is skipped and content renders as-is. */
export const AT_TOKEN_SCAN_LIMIT = 50_000;

/** Whether a message body is worth splitting for @-token pills at all. */
export const containsRenderableAtTokens = (text: string): boolean =>
  text.includes('@') && text.length <= AT_TOKEN_SCAN_LIMIT && parseAtTokens(text).length > 0;

export interface MarkdownSegment {
  /** 'code' segments (fenced or inline) must never be scanned for @-tokens. */
  kind: 'code' | 'text';
  value: string;
}

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

/**
 * Split a markdown body into code and plain-text segments so @-token pills are
 * only rendered inside plain text (Pitfall #7: parser coexistence — code spans
 * and fences must render literally).
 */
export const segmentMarkdownForAtTokens = (text: string): MarkdownSegment[] => {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  const len = text.length;

  while (cursor < len) {
    const fenceOpen = text.startsWith('```', cursor);
    const tick = text.indexOf('`', cursor);

    if (!fenceOpen && tick === -1) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }

    if (fenceOpen) {
      const close = text.indexOf('```', cursor + 3);
      const end = close === -1 ? len : close + 3;
      segments.push({ kind: 'code', value: text.slice(cursor, end) });
      cursor = end;
      continue;
    }

    if (tick > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, tick) });
    }
    const tickLen = countBackticks(text, tick);
    const closer = findInlineCodeClose(text, tick, tickLen);
    const end = closer === -1 ? len : closer + tickLen;
    segments.push({ kind: 'code', value: text.slice(tick, end) });
    cursor = end;
  }

  return segments;
};

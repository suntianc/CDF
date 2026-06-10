import { useState, useEffect, useRef } from 'react';

/**
 * Adjusts slice position to avoid cutting inside HTML tags.
 * If pos falls inside a `<...>` tag (e.g. `<think>`, `</think>`),
 * extends to include the complete tag so partial tags never render.
 */
function adjustSlicePosition(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  if (pos <= 0) return 0;

  // Search backward from pos for an unclosed '<'
  let lastOpen = -1;
  for (let i = Math.min(pos, text.length - 1); i >= 0; i--) {
    if (text[i] === '<') {
      lastOpen = i;
      break;
    }
    if (text[i] === '>') break; // Found '>' before '<' — not inside a tag
  }

  if (lastOpen === -1) return pos;

  const closePos = text.indexOf('>', lastOpen);
  if (closePos === -1) return pos; // No closing bracket found

  // If pos is strictly between '<' and '>', extend to include the full tag
  if (pos > lastOpen && pos <= closePos) {
    return closePos + 1;
  }

  return pos;
}

/**
 * rAF-driven typewriter hook with adaptive speed control.
 *
 * Smoothly reveals `targetContent` character-by-character, decoupling the
 * display rate from the LLM token arrival rate.
 *
 * Speed modes:
 * - **Normal** (backlog ≤ 40): 1 char/frame (~60 chars/sec at 60 fps)
 * - **Burst** (backlog > 40): `ceil(diff / 10)` chars/frame — fast catch-up
 * - **Ease-out** (stream ended, buffer remaining): `max(3, ceil(diff / 3))`
 *   chars/frame — proportional deceleration for a smooth finish
 *
 * The hook is "tag-aware": it never slices inside `<think>` / `</think>` or
 * other HTML tags, preventing partial tags from briefly flashing on screen.
 *
 * @param targetContent - Latest full content from the LLM stream
 * @param isStreamActive - Whether the stream is currently producing tokens
 * @returns `displayedContent` (the visible substring) and `isTypewriting`
 */
export function useTypewriter(
  targetContent: string,
  isStreamActive: boolean
): { displayedContent: string; isTypewriting: boolean } {
  const [displayedContent, setDisplayedContent] = useState(targetContent);
  const [isTypewriting, setIsTypewriting] = useState(false);

  // Refs for rAF callback (avoids stale closures)
  const targetRef = useRef(targetContent);
  const displayedLenRef = useRef(targetContent.length);
  const rafRef = useRef<number | null>(null);
  const streamActiveRef = useRef(isStreamActive);

  // Keep refs in sync on every render (cheap, no side effects)
  targetRef.current = targetContent;
  streamActiveRef.current = isStreamActive;

  // ── Start the animation loop when stream activates ───────────────────
  useEffect(() => {
    // Cancel any rAF chain left over from a previous activation before
    // deciding what to do for this one. Without this, a rapid
    // isStreamActive true → false → true flip can leave the second
    // activation short-circuited at the `rafRef.current !== null`
    // guard below, swallowing the new chain entirely.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!isStreamActive) return;

    // Honor `prefers-reduced-motion: reduce` by short-circuiting the rAF
    // loop. The user has asked for no motion; the typewriter must not
    // pretend otherwise. We still set isTypewriting so the thinking
    // caret + folded-reveal signal "this is the live stream", but
    // displayedContent is synced each render instead of being stepped.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayedContent(targetRef.current);
      displayedLenRef.current = targetRef.current.length;
      setIsTypewriting(true);
      return;
    }

    setIsTypewriting(true);

    // Don't start a second loop if one is already running
    if (rafRef.current !== null) return;

    const tick = () => {
      const target = targetRef.current;
      const currentLen = displayedLenRef.current;
      const diff = target.length - currentLen;

      // ── Caught up: decide whether to stop or keep polling ──
      if (diff <= 0) {
        if (!streamActiveRef.current) {
          // Stream ended + fully caught up → hard sync & stop
          setDisplayedContent(target);
          displayedLenRef.current = target.length;
          setIsTypewriting(false);
          rafRef.current = null;
          return;
        }
        // Still streaming but no new content yet — keep polling
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── Adaptive step size ─────────────────────────────────
      let step: number;
      if (!streamActiveRef.current) {
        // Ease-out: stream ended, proportional acceleration to finish.
        // Tiny backlogs are finalized in one frame so a 1-2k token response
        // does not pay a 1-2s "catch-up" animation after the LLM has
        // already stopped producing tokens.
        if (diff <= 200) {
          step = diff;
        } else {
          step = Math.max(3, Math.ceil(diff / 3));
        }
      } else if (diff > 40) {
        // Burst: large backlog, catch up quickly
        step = Math.ceil(diff / 10);
      } else {
        // Normal: smooth 1 char per frame
        step = 1;
      }

      let newLen = Math.min(currentLen + step, target.length);
      // Tag-aware: don't slice inside <think> or </think>
      newLen = adjustSlicePosition(target, newLen);

      displayedLenRef.current = newLen;
      setDisplayedContent(target.slice(0, newLen));

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    // Intentionally no cleanup here — let ease-out phase finish naturally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreamActive]);

  // ── Immediate sync for non-streaming content updates ─────────────────
  useEffect(() => {
    if (!isStreamActive && rafRef.current === null) {
      setDisplayedContent(targetContent);
      displayedLenRef.current = targetContent.length;
    }
  }, [targetContent, isStreamActive]);

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { displayedContent, isTypewriting };
}

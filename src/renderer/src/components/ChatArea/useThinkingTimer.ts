import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

interface UseThinkingTimerOptions {
  /** True once the think trace has a matching closer (or there is none). */
  isFinished: boolean;
  /** True while this message is the live streaming target (isLast && isStreaming). */
  isActive: boolean;
  messageId?: string;
  /** Duration already persisted with the message; when set, nothing is re-persisted. */
  thinkDurationSeconds?: number;
}

/**
 * Thinking stopwatch for MessageContentRenderer (#237): ticks elapsed seconds
 * every 500ms while an unfinished trace is streaming, freezes the total once the
 * trace closes, and persists it through the session store the first time.
 */
export function useThinkingTimer({
  isFinished,
  isActive,
  messageId,
  thinkDurationSeconds,
}: UseThinkingTimerOptions): { elapsedSeconds: number; finalDuration: number | null } {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFinished && isActive) {
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
  }, [isFinished, isActive]);

  useEffect(() => {
    if (isFinished && elapsedSeconds > 0 && finalDuration === null) {
      setFinalDuration(elapsedSeconds);
      if (messageId && !thinkDurationSeconds) {
        useSessionStore.getState().updateMessageThinkDuration(messageId, elapsedSeconds);
      }
    }
  }, [isFinished, elapsedSeconds, finalDuration, messageId, thinkDurationSeconds]);

  return { elapsedSeconds, finalDuration };
}

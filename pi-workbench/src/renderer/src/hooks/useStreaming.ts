import { useState, useCallback, useEffect, useRef } from 'react'
import { useMessageStore } from '../stores/messageStore'

export interface UseStreamingOptions {
  sessionPath: string
  messageId: string
  onToken?: (token: string) => void
  onEnd?: () => void
  onError?: (error: string) => void
}

export interface UseStreamingReturn {
  streamId: string | null
  isStreaming: boolean
  start: () => void
  stop: () => void
}

export function useStreaming(options: UseStreamingOptions): UseStreamingReturn {
  const { sessionPath, messageId, onToken, onEnd, onError } = options
  const [streamId, setStreamId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const start = useCallback(() => {
    if (isStreaming) return
    const id = window.api.session.startStream(sessionPath)
    setStreamId(id)
    setIsStreaming(true)

    unsubscribeRef.current = window.api.session.onStreamToken(id, (data) => {
      if (data.type === 'token' && data.delta) {
        onToken?.(data.delta)
        useMessageStore.getState().appendContent(messageId, data.delta)
      } else if (data.type === 'end') {
        useMessageStore.getState().finalizeMessage(messageId)
        onEnd?.()
        setIsStreaming(false)
      } else if (data.type === 'error') {
        useMessageStore.getState().updateMessageStatus(messageId, 'error')
        onError?.(data.message || 'Stream error')
        setIsStreaming(false)
      }
    })
  }, [sessionPath, messageId, isStreaming, onToken, onEnd, onError])

  const stop = useCallback(() => {
    if (streamId) {
      window.api.session.stopStream(streamId)
    }
    unsubscribeRef.current?.()
    setIsStreaming(false)
  }, [streamId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.()
      if (isStreaming && streamId) {
        window.api.session.stopStream(streamId)
      }
    }
  }, [isStreaming, streamId])

  return { streamId, isStreaming, start, stop }
}

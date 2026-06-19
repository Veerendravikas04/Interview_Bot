import { useEffect, useRef, useCallback } from 'react'
import { getToken } from '@/lib/services/api'

const WS_BASE = 'ws://localhost:8000/api/ws/threads'

// One WebSocket per open thread. Streams token/status/message_complete/error,
// heartbeat-aware, capped auto-reconnect on unclean close.
export function useThreadSocket(threadId, handlers = {}) {
  const wsRef = useRef(null)
  const attempts = useRef(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!threadId) return
    let closedByUs = false

    const connect = () => {
      const token = getToken()
      if (!token) return
      const ws = new WebSocket(`${WS_BASE}/${threadId}?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        attempts.current = 0
        handlersRef.current.onOpen?.()
      }
      ws.onmessage = (e) => {
        let frame
        try {
          frame = JSON.parse(e.data)
        } catch {
          return
        }
        const { event_type, data } = frame
        const h = handlersRef.current
        switch (event_type) {
          case 'token':
            h.onToken?.(data?.delta ?? '')
            break
          case 'status':
            h.onStatus?.(data)
            break
          case 'tool_call':
            h.onToolCall?.(data)
            break
          case 'tool_result':
            h.onToolResult?.(data)
            break
          case 'source_found':
            h.onSource?.(data)
            break
          case 'message_complete':
            h.onComplete?.(data)
            break
          case 'title_update':
            h.onTitle?.(data)
            break
          case 'penalty':
            h.onPenalty?.(data)
            break
          case 'report_ready':
            h.onReport?.(data)
            break
          case 'error':
            h.onError?.(data)
            break
          case 'ping':
          default:
            break
        }
      }
      ws.onerror = () => {
        // Transport-level error: don't surface a toast here — onclose drives the
        // reconnect flow. Only server `error` event frames are user-facing errors.
      }
      ws.onclose = (ev) => {
        if (!closedByUs && !ev.wasClean && attempts.current < 3) {
          attempts.current += 1
          handlersRef.current.onReconnecting?.(attempts.current)
          setTimeout(connect, 1000 * attempts.current)
        } else if (!closedByUs) {
          handlersRef.current.onClosed?.(ev)
        }
      }
    }

    connect()
    return () => {
      closedByUs = true
      wsRef.current?.close(1000)
      wsRef.current = null
    }
  }, [threadId])

  const send = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }, [])

  return { send }
}

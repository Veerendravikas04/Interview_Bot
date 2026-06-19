import { useEffect, useRef, useState } from 'react'
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { Gauge, FileSearch, Sparkles, MessagesSquare, PenLine } from 'lucide-react'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import ResumePreview from './ResumePreview'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatStore } from '@/store/chatStore'
import { useThreadSocket } from '@/lib/hooks/useThreadSocket'
import * as api from '@/lib/services/api'

const SUGGESTIONS = [
  { icon: FileSearch, label: 'ATS score & fixes', sub: 'Review my resume out of 100', text: 'Review my resume and give me an ATS score out of 100 with concrete fixes.' },
  { icon: Sparkles, label: 'Highlight my skills', sub: 'What to lead with in interviews', text: 'Based on my resume, which skills should I highlight for interviews?' },
  { icon: MessagesSquare, label: 'Mock interview', sub: 'One question at a time', text: 'Interview me based on my resume. Ask one question to start.' },
  { icon: PenLine, label: 'Improve a bullet', sub: 'Rewrite one line stronger', text: 'Pick one bullet from my resume and rewrite it to be stronger and quantified.' },
]

export default function ChatPanel({ ensureThread }) {
  const {
    activeThreadId, messages, isStreaming, status,
    addMessage, setMessages, startAssistant, appendToken, setStatus, finishAssistant, failAssistant, patchThread,
    addTool, patchTool, addSource,
  } = useChatStore()
  const viewportRef = useRef(null)
  const reconnectedRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState(null) // {resume_id, filename}
  const [previewResume, setPreviewResume] = useState(null) // {resume_id, filename}

  // drop the pending attachment when switching threads
  useEffect(() => {
    setPendingAttachment(null)
  }, [activeThreadId])

  const { send } = useThreadSocket(activeThreadId, {
    onOpen: async () => {
      setStatus(null)
      if (reconnectedRef.current && activeThreadId) {
        reconnectedRef.current = false
        notifySuccess('Reconnected')
        try {
          const msgs = await api.getThreadMessages(activeThreadId)
          setMessages(
            (msgs || []).map((m, i) => ({
              id: m.id || `m-${i}`,
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content || '',
              attachment: m.metadata?.attachment,
            }))
          )
        } catch (_) {
          /* keep current view */
        }
      }
    },
    onToken: (delta) => appendToken(delta),
    onStatus: (d) => setStatus(d?.message || null),
    onToolCall: (d) => addTool(d),
    onToolResult: (d) => patchTool(d),
    onSource: (d) => addSource(d),
    onComplete: (d) => finishAssistant(d),
    onTitle: (d) => {
      if (activeThreadId && d?.title) patchThread(activeThreadId, { title: d.title })
    },
    onReconnecting: (n) => {
      reconnectedRef.current = true
      setStatus(`Reconnecting (${n}/3)…`)
      if (n === 1) notifyWarning('Connection lost — reconnecting…')
    },
    onClosed: () => setStatus(null),
    onError: (d) => {
      failAssistant()
      notifyError({ message: d?.message, traceId: d?.trace_id }, 'Something went wrong')
    },
  })

  useEffect(() => {
    const v = viewportRef.current
    if (v) v.scrollTop = v.scrollHeight
  }, [messages, status])

  const trySend = (payload, tries = 0) => {
    if (send(payload)) return true
    if (tries < 15) {
      setTimeout(() => trySend(payload, tries + 1), 200)
      return true
    }
    failAssistant()
    notifyError({ message: 'Not connected. Please try again.' })
    return false
  }

  const sendText = async (text) => {
    let tid = activeThreadId
    if (!tid) {
      tid = await ensureThread()
      if (!tid) return
    }
    const attachment = pendingAttachment ? { ...pendingAttachment } : undefined
    addMessage({ id: `u-${Date.now()}`, role: 'user', content: text, attachment })
    if (attachment) setPendingAttachment(null)
    if (!useChatStore.getState().threads.find((t) => t.id === tid)?.title) {
      patchThread(tid, { title: text.slice(0, 40) })
    }
    startAssistant()
    trySend({ action: 'answer', text, resume_id: attachment?.resume_id })
  }

  // Upload = attach + show a pending chip, then WAIT for the user (ReBuddy pattern).
  const handleUpload = async (file) => {
    setUploading(true)
    try {
      const res = await api.uploadResume(file) // {resume_id, filename, extracted_text}
      let tid = activeThreadId
      if (!tid) {
        tid = await ensureThread(res.resume_id)
      } else {
        await api.attachResume(tid, res.resume_id)
      }
      if (!tid) return
      setPendingAttachment({ resume_id: res.resume_id, filename: res.filename })
      notifySuccess('Resume attached', 'Ask anything or pick an action below.')
    } catch (e) {
      notifyError(e, 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/10">
              <Gauge className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">What can I help you with?</h1>
            <p className="mt-2.5 max-w-md text-center text-[15px] text-muted-foreground">
              Upload your resume for an ATS review, sharpen your skills, or start a mock interview.
            </p>
            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendText(s.text)}
                  className="group flex items-start gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-all duration-300 hover:border-primary/30 hover:bg-gradient-to-br hover:from-card hover:to-primary/5 hover:shadow-soft hover:-translate-y-0.5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground shadow-sm">
                    <s.icon className="h-[20px] w-[20px]" />
                  </span>
                  <span className="min-w-0 mt-0.5">
                    <span className="block text-[15px] font-semibold text-foreground tracking-tight">{s.label}</span>
                    <span className="block truncate text-[13px] text-muted-foreground mt-0.5">{s.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1" viewportRef={viewportRef}>
            <div className="mx-auto w-full max-w-3xl py-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} onPreview={setPreviewResume} />
              ))}
              {status && !isStreaming && (
                <div className="px-4 py-1 pl-14 text-xs text-muted-foreground">
                  <span className="animate-pulse">{status}</span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <Composer
          onSend={sendText}
          onUpload={handleUpload}
          disabled={isStreaming}
          uploading={uploading}
          pendingAttachment={pendingAttachment}
          onRemoveAttachment={() => setPendingAttachment(null)}
          onPreviewAttachment={setPreviewResume}
        />
      </div>

      {previewResume && (
        <ResumePreview
          resumeId={previewResume.resume_id}
          filename={previewResume.filename}
          onClose={() => setPreviewResume(null)}
        />
      )}
    </div>
  )
}

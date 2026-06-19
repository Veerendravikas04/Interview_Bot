import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Gauge, User, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chatStore'
import ReasoningCard from './ReasoningCard'
import CopyButton from './CopyButton'

// Fenced code blocks render with a hover copy button in the corner.
function PreBlock({ children }) {
  const codeEl = Array.isArray(children) ? children[0] : children
  const raw = codeEl?.props?.children
  const text = (Array.isArray(raw) ? raw.join('') : String(raw ?? '')).replace(/\n$/, '')
  return (
    <div className="group/code relative my-2">
      <CopyButton
        text={text}
        className="absolute right-2 top-2 z-10 border border-border/60 bg-card/90 opacity-0 transition-opacity group-hover/code:opacity-100"
      />
      <pre className="overflow-x-auto rounded-lg border border-border bg-[#0d1117] p-3 text-[13px] leading-relaxed text-[#e6edf3]">
        {children}
      </pre>
    </div>
  )
}

const MD_COMPONENTS = { pre: PreBlock }

function AttachmentChip({ attachment, onPreview, onLight }) {
  return (
    <button
      type="button"
      onClick={() => onPreview?.(attachment)}
      title="Preview resume"
      className={cn(
        'mb-2 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
        onLight ? 'bg-background/25 hover:bg-background/40' : 'bg-muted hover:bg-accent'
      )}
    >
      <FileText className="h-3.5 w-3.5" />
      <span className="max-w-[200px] truncate">{attachment.filename}</span>
    </button>
  )
}

export default function MessageBubble({ message, onPreview }) {
  const isUser = message.role === 'user'

  // ── USER: compact right-aligned bubble, hover copy ──────────────────────
  if (isUser) {
    const u = useChatStore.getState().currentUser
    const initial = (u?.name || u?.email || '').trim().charAt(0).toUpperCase()
    return (
      <div className="group flex animate-fade-in justify-end gap-3 px-4 py-2.5">
        <div className="flex min-w-0 max-w-[80%] flex-col items-end">
          <div className="rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
            {message.attachment && <AttachmentChip attachment={message.attachment} onPreview={onPreview} />}
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          {message.content && (
            <CopyButton text={message.content} className="mt-1 self-end opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary ring-1 ring-primary/10"
          title={u?.name || u?.email || 'You'}
        >
          {initial || <User className="h-4 w-4" />}
        </div>
      </div>
    )
  }

  // ── ASSISTANT: avatar + name + borderless markdown + hover copy ─────────
  const isStreaming = message.id === '__streaming__'
  const isStreamingEmpty = isStreaming && !message.content
  const act = message.activity
  const showReasoning =
    act &&
    ((act.tools?.length ?? 0) > 0 || (act.sources?.length ?? 0) > 0 || (isStreaming && !message.content))

  return (
    <div className="group flex animate-fade-in gap-3 px-4 py-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/10">
        <Gauge className="h-[18px] w-[18px]" />
      </div>

      <div className="flex min-w-0 max-w-[760px] flex-1 flex-col">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Caliber</span>

        {showReasoning && <ReasoningCard activity={message.activity} streaming={isStreaming} />}

        {message.attachment && <AttachmentChip attachment={message.attachment} onPreview={onPreview} />}

        {isStreamingEmpty ? (
          !showReasoning && <span className="inline-block h-4 w-2 animate-blink rounded-sm bg-primary align-middle" />
        ) : message.content ? (
          <div className="prose-chat text-[15px] leading-[1.7] text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{message.content || ''}</ReactMarkdown>
          </div>
        ) : null}

        {!isStreaming && message.content && (
          <CopyButton text={message.content} className="mt-1.5 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </div>
  )
}

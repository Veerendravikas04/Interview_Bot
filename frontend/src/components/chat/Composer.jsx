import { useRef, useState } from 'react'
import { Paperclip, ArrowUp, Loader2, FileText, X, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SpeechRecognition =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export default function Composer({ onSend, onUpload, disabled, uploading, pendingAttachment, onRemoveAttachment, onPreviewAttachment }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef(null)
  const taRef = useRef(null)
  const recognitionRef = useRef(null)
  const baseRef = useRef('') // text present when dictation started

  const toggleMic = () => {
    if (!SpeechRecognition) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = true
    // Anchor to the current text; we REPLACE from this base each event (never append
    // the cumulative results, which is what caused "Hello Hello Hello…" duplication).
    baseRef.current = text ? text.trim() + ' ' : ''
    rec.onresult = (e) => {
      let finalText = ''
      let interimText = ''
      for (let i = 0; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += chunk + ' '
        else interimText += chunk
      }
      setText(baseRef.current + finalText + interimText)
      requestAnimationFrame(() => resize(taRef.current))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  const resize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (f) onUpload(f)
    e.target.value = ''
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto max-w-3xl">
        {pendingAttachment && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <button
              type="button"
              onClick={() => onPreviewAttachment?.(pendingAttachment)}
              className="max-w-[220px] truncate hover:underline"
              title="Preview resume"
            >
              {pendingAttachment.filename}
            </button>
            <span className="text-muted-foreground">attached</span>
            <button
              type="button"
              onClick={onRemoveAttachment}
              className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-[24px] border border-border/60 bg-card p-2.5 shadow-floating transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={onFile} />
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Upload resume (PDF, DOCX, TXT, MD)"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-[22px] w-[22px]" />}
          </Button>

          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              resize(e.target)
            }}
            onKeyDown={onKeyDown}
            placeholder="Message Caliber…"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />

          {SpeechRecognition && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground',
                listening && 'animate-pulse bg-destructive/15 text-destructive hover:bg-destructive/15 hover:text-destructive'
              )}
              onClick={toggleMic}
              title={listening ? 'Stop' : 'Voice input'}
            >
              <Mic className="h-5 w-5" />
            </Button>
          )}

          <Button
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 shadow-soft hover:opacity-90"
            onClick={submit}
            disabled={disabled || !text.trim()}
          >
            <ArrowUp className="h-[22px] w-[22px]" />
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Caliber can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Globe, Sparkles, Loader2, ChevronRight } from 'lucide-react'
import SourceRow, { dedupeByHostname } from './SourceRow'

// Per-turn agent-activity indicator — the "Reasoning" card. Adapted from
// Project Sophia's ToolProgress.
//   • LIVE  (streaming / a tool in flight): spinner + "Searching the web…" +
//     the query, with the source chips filling in beneath as results arrive.
//   • DONE  (turn finished): collapses to "Searched the web · N sources · Xs"
//     with a chevron that expands the step timeline. Source chips stay visible.

const LABELS = {
  web_search: { running: 'Searching the web', done: 'Searched the web' },
}

function labelFor(name, done) {
  const e = LABELS[name]
  if (e) return done ? e.done : e.running
  if (!name || name === 'thinking') return done ? 'Thought' : 'Reasoning'
  return name.replace(/_/g, ' ')
}

function iconFor(name) {
  if (name === 'web_search') return Globe
  return Sparkles
}

function formatMs(ms) {
  if (!ms || ms < 0) return '0s'
  if (ms < 950) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`
}

export default function ReasoningCard({ activity, streaming }) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())

  const tools = activity?.tools ?? []
  const sources = activity?.sources ?? []
  const anyRunning = tools.some((t) => t.status === 'running')

  // Live = the turn is still streaming AND either a tool is in flight or no tool
  // has fired yet (pure reasoning). Once tools finish and text streams, collapse.
  const live = streaming && (anyRunning || tools.length === 0)
  const hasWork = tools.length > 0 || sources.length > 0

  // Tick the live timer while live.
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [live])

  // Nothing to show: a finished turn that never reasoned with a tool.
  if (!live && !hasWork) return null

  const startedAt = activity?.startedAt ?? now
  const totalMs = (activity?.endedAt ?? now) - startedAt

  // ── LIVE ──────────────────────────────────────────────────────────────
  if (live) {
    const current = [...tools].reverse().find((t) => t.status === 'running')
    const name = current?.name
    const Icon = iconFor(name)
    const detail = current?.query
      ? current.query.length > 60
        ? `${current.query.slice(0, 59)}…`
        : current.query
      : null
    return (
      <div className="mb-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{labelFor(name, false)}…</span>
          {detail && <span className="italic text-muted-foreground/70">{detail}</span>}
          <span className="font-mono text-[11px] text-muted-foreground/60">{formatMs(totalMs)}</span>
        </div>
        {sources.length > 0 && <SourceRow sources={sources} maxVisible={8} />}
      </div>
    )
  }

  // ── DONE (collapsed summary + expandable steps) ─────────────────────────
  const uniqueCount = dedupeByHostname(sources).length
  const primary = tools.find((t) => t.name === 'web_search') ?? tools[tools.length - 1]
  const PrimaryIcon = iconFor(primary?.name)
  const parts = [labelFor(primary?.name, true)]
  if (uniqueCount) parts.push(`${uniqueCount} ${uniqueCount === 1 ? 'source' : 'sources'}`)
  parts.push(formatMs(totalMs))
  const summary = parts.join(' · ')

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <PrimaryIcon className="h-3.5 w-3.5 text-primary" />
        <span>{summary}</span>
      </button>

      {sources.length > 0 && <SourceRow sources={sources} maxVisible={8} />}

      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          {tools.map((t) => {
            const StepIcon = iconFor(t.name)
            return (
              <div key={t.callId} className="flex items-center gap-1.5">
                <StepIcon className="h-3.5 w-3.5 text-primary" />
                <span>{labelFor(t.name, true)}</span>
                {t.query && <span className="italic text-muted-foreground/70">— {t.query}</span>}
                {typeof t.ms === 'number' && (
                  <span className="font-mono text-[11px] text-muted-foreground/60">· {formatMs(t.ms)}</span>
                )}
                {t.status === 'error' && <span className="text-destructive">· failed</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

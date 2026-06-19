import { useMemo, useState } from 'react'

// Perplexity-style row of clickable source chips that fills in as web_search
// surfaces results. Dedupes by hostname (first-seen wins), caps at `maxVisible`
// with a "+N more" toggle. Favicons come from Google's s2 service. Adapted from
// Project Sophia's SourceFaviconRow.

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return (url || '').slice(0, 32)
  }
}

function favicon(url) {
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domainOf(url))}`
}

export function dedupeByHostname(sources) {
  const seen = new Set()
  const out = []
  for (const s of sources || []) {
    const host = domainOf(s.url)
    if (seen.has(host)) continue
    seen.add(host)
    out.push(s)
  }
  return out
}

export default function SourceRow({ sources, maxVisible = 8 }) {
  const [expanded, setExpanded] = useState(false)
  const unique = useMemo(() => dedupeByHostname(sources), [sources])
  if (!unique.length) return null

  const visible = expanded ? unique : unique.slice(0, maxVisible)
  const overflow = unique.length - Math.min(maxVisible, unique.length)

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {visible.map((s, i) => (
        <a
          key={`${s.url}-${i}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title || s.url}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-1 text-xs text-foreground/90 transition-colors hover:border-primary/40 hover:bg-accent"
        >
          <img
            src={favicon(s.url)}
            alt=""
            width={14}
            height={14}
            className="rounded-sm"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <span className="max-w-[160px] truncate">{domainOf(s.url)}</span>
        </a>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center rounded-full border border-border/70 bg-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          {expanded ? 'Show less' : `+${overflow} more`}
        </button>
      )}
    </div>
  )
}

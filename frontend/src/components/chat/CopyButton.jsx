import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Small, subtle copy control — ChatGPT/Sophia/RealGenie style. Copies `text`,
// flips to a check for ~1.5s. Used under assistant messages and on code blocks.
export default function CopyButton({ text, className = '', label }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async (e) => {
    e?.stopPropagation?.()
    try {
      await navigator.clipboard.writeText(text || '')
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement('textarea')
      ta.value = text || ''
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy'}
      className={cn(
        // self-start: in a flex-col the button would otherwise stretch full-width
        // and the hover bg would paint the whole row. Keep it content-sized + subtle.
        'inline-flex w-fit shrink-0 items-center gap-1 self-start rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span className="text-xs">{copied ? 'Copied' : label}</span>}
    </button>
  )
}

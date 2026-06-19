import { useState } from 'react'
import { motion } from 'framer-motion'
import { Download, CheckCircle, AlertTriangle, Lightbulb, FileText, X, Loader2, GitBranch, Star, RefreshCw } from 'lucide-react'
import html2pdf from 'html2pdf.js'
import { cn } from '@/lib/utils'
import { notifyError } from '@/lib/notify'

// ── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const r = 42
  const c = 2 * Math.PI * r
  const offset = c - (v / 100) * c
  const tone = v >= 80 ? '#10b981' : v <= 60 ? '#ef4444' : '#f59e0b'
  const label = v >= 80 ? 'Strong' : v <= 60 ? 'Needs work' : 'Average'
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-background p-6 shadow-sm">
      <div className="pointer-events-none absolute -top-10 h-36 w-36 rounded-full blur-3xl" style={{ background: `${tone}40` }} />
      <div className="relative h-28 w-28">
        <svg width="112" height="112" className="-rotate-90">
          <circle cx="56" cy="56" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
          <circle cx="56" cy="56" r={r} fill="none" stroke={tone} strokeWidth="8"
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease', filter: `drop-shadow(0 0 6px ${tone}80)` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold leading-none text-foreground">{v}</span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="mt-3 text-xs font-medium text-muted-foreground">Overall ATS Score</div>
      <span className="mt-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: tone, background: `${tone}1a` }}>{label}</span>
    </div>
  )
}

function Card({ title, icon, children, className }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-5 shadow-sm', className)}>
      {title && (
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</h3>
      )}
      {children}
    </div>
  )
}

function StatChip({ label, value }) {
  if (value === null || value === undefined) return null
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-1.5 text-center">
      <div className="text-sm font-bold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function ReviewList({ title, tone, items }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: tone }}>{title}</div>
      <ul className="ml-4 list-disc space-y-1 text-[13px] leading-relaxed text-muted-foreground">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}

export default function AtsReport({ reportData, resumeId, onRegenerate }) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [overleafLoading, setOverleafLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  if (!reportData) return null

  const handleRegenerate = async () => {
    if (!onRegenerate) return
    setRegenerating(true)
    try { await onRegenerate() } finally { setRegenerating(false) }
  }

  const {
    atsScore = 0,
    missingKeywords = [],
    resumeWeaknesses = [],
    improvedBullets = [],
    recommendations = [],
    role = null,
    developerProfile = null,
  } = reportData
  const gh = developerProfile?.github
  const ghReview = developerProfile?.review

  const handleDownload = () => {
    setIsDownloading(true)
    const element = document.getElementById('ats-report-content')
    const btns = document.getElementById('ats-report-actions')
    if (btns) btns.style.visibility = 'hidden'
    const opt = {
      margin: 0.4,
      filename: 'ATS_Analysis_Report.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#0b0f17' },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    }
    html2pdf().set(opt).from(element).save()
      .then(() => { if (btns) btns.style.visibility = 'visible'; setIsDownloading(false) })
      .catch((err) => {
        console.error('ats_pdf_export_failed', err)
        if (btns) btns.style.visibility = 'visible'
        setIsDownloading(false)
        notifyError({ message: 'Could not generate the PDF. Please try again.' })
      })
  }

  const handleOverleaf = async () => {
    setOverleafLoading(true)
    try {
      const { getLatexResume } = await import('@/lib/services/api')
      const response = await getLatexResume(resumeId)
      const latex = response?.latex
      if (!latex || !latex.includes('\\documentclass')) {
        notifyError({ message: 'The generated LaTeX looks incomplete. Please try again.' })
        return
      }
      const form = document.createElement('form')
      form.action = 'https://www.overleaf.com/docs'
      form.method = 'POST'
      form.target = '_blank'
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'snip'
      input.value = latex
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
      document.body.removeChild(form)
    } catch (err) {
      console.error('latex_generation_failed', err)
      notifyError({ message: 'Failed to generate LaTeX resume.' })
    } finally {
      setOverleafLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div id="ats-report-content" className="mx-auto w-full max-w-3xl p-5 sm:p-6">

        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <FileText className="h-5 w-5 text-primary" /> ATS Analysis Report
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              AI resume optimization{role ? <> · <span className="text-foreground/80">{role}</span></> : ''}
            </p>
          </div>
          <div id="ats-report-actions" className="flex gap-2">
            {onRegenerate && (
              <button onClick={handleRegenerate} disabled={regenerating} title="Re-run a fresh analysis"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60">
                <RefreshCw className={cn('h-4 w-4', regenerating && 'animate-spin')} />
                <span className="hidden sm:inline">{regenerating ? 'Refreshing…' : 'Regenerate'}</span>
              </button>
            )}
            <button onClick={handleDownload} disabled={isDownloading}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? 'Saving…' : 'Save PDF'}
            </button>
            <button onClick={handleOverleaf} disabled={overleafLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
              {overleafLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {overleafLoading ? 'Generating…' : 'Generate Resume'}
            </button>
          </div>
        </div>

        {/* Score + Missing keywords */}
        <div className="mb-4 grid gap-4 md:grid-cols-[180px_1fr]">
          <ScoreRing value={atsScore} />
          <Card title="Missing Critical Keywords" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
            {missingKeywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {missingKeywords.map((kw, i) => (
                  <span key={i} className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive">{kw}</span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Your resume matches the critical keywords for this role.</p>
            )}
          </Card>
        </div>

        {/* Weaknesses + Recommendations */}
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <Card title="Resume Weaknesses" icon={<X className="h-4 w-4 text-red-500" />} className="border-l-2 border-l-red-500/50">
            <ul className="ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {resumeWeaknesses.map((w, i) => <li key={i}>{w}</li>)}
              {resumeWeaknesses.length === 0 && <li className="list-none text-muted-foreground/70">None flagged.</li>}
            </ul>
          </Card>
          <Card title="Actionable Recommendations" icon={<Lightbulb className="h-4 w-4 text-emerald-500" />} className="border-l-2 border-l-emerald-500/50">
            <ul className="ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {recommendations.map((r, i) => <li key={i}>{r}</li>)}
              {recommendations.length === 0 && <li className="list-none text-muted-foreground/70">None.</li>}
            </ul>
          </Card>
        </div>

        {/* Improved bullets */}
        <Card title="AI-Improved Bullet Points" icon={<CheckCircle className="h-4 w-4 text-primary" />} className="mb-4">
          <div className="flex flex-col gap-4">
            {improvedBullets.map((b, i) => (
              <div key={i} className={cn('flex flex-col gap-2', i !== improvedBullets.length - 1 && 'border-b border-border/60 pb-4')}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border-l-2 border-red-500 bg-background/60 p-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-red-500">Original</div>
                    <div className="text-[13px] leading-relaxed text-muted-foreground">{b.original}</div>
                  </div>
                  <div className="rounded-lg border-l-2 border-emerald-500 bg-emerald-500/5 p-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-500">Improved</div>
                    <div className="text-[13px] leading-relaxed text-foreground/90">{b.improved}</div>
                  </div>
                </div>
                {b.reason && (
                  <div className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
                    <span className="font-semibold">Why: </span>{b.reason}
                  </div>
                )}
              </div>
            ))}
            {improvedBullets.length === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">No bullet improvements generated.</p>
            )}
          </div>
        </Card>

        {/* Developer Profile Review (GitHub) */}
        {gh && (
          <Card className="mb-2">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch className="h-4 w-4 text-violet-400" /> Developer Profile Review
              {gh.profile_url && (
                <a href={gh.profile_url} target="_blank" rel="noopener noreferrer"
                  className="ml-auto text-xs text-primary hover:underline">@{gh.username}</a>
              )}
            </h3>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatChip label="Repos" value={gh.owned_repos} />
              <StatChip label="Stars" value={gh.total_stars} />
              {typeof gh.current_streak === 'number' && <StatChip label="Streak" value={`${gh.current_streak}d`} />}
              {typeof gh.total_contributions_last_year === 'number' && <StatChip label="Contribs/yr" value={gh.total_contributions_last_year} />}
              <StatChip label="Followers" value={gh.followers} />
              <span className={cn('rounded-full px-3 py-1 text-xs font-bold',
                gh.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>
                {gh.active ? 'Active' : 'Inactive'}{typeof gh.days_since_active === 'number' ? ` · ${gh.days_since_active}d since push` : ''}
              </span>
            </div>

            {ghReview?.summary && <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{ghReview.summary}</p>}

            {gh.top_repos?.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Top Repositories</div>
                <div className="flex flex-col gap-1.5">
                  {gh.top_repos.map((r, i) => (
                    <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-md bg-background/60 px-3 py-2 transition-colors hover:bg-accent">
                      <span className="text-[13px] text-foreground/90">{r.name}{r.language && <span className="text-muted-foreground"> · {r.language}</span>}</span>
                      <span className="flex items-center gap-1 text-xs text-amber-400"><Star className="h-3 w-3" /> {r.stars}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewList title="Strengths" tone="#10b981" items={ghReview?.strengths} />
              <ReviewList title="Concerns" tone="#ef4444" items={ghReview?.concerns} />
            </div>
            {ghReview?.focusAreas?.length > 0 && (
              <div className="mt-4">
                <ReviewList title="Focus Areas (what recruiters want to see)" tone="#60a5fa" items={ghReview.focusAreas} />
              </div>
            )}
          </Card>
        )}

      </div>
    </motion.div>
  )
}

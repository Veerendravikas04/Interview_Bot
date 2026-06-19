import { useEffect, useState } from 'react'
import { X, FileText, Loader2, BarChart2, FileCode2, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as api from '@/lib/services/api'
import AtsReport from './AtsReport'
import LatexResume from './LatexResume'

export default function ResumePreview({ resumeId, filename, onClose }) {
  const isPdf = (filename || '').toLowerCase().endsWith('.pdf')
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('resume') // 'resume' | 'ats' | 'latex'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [text, setText] = useState('')
  const [atsData, setAtsData] = useState(null)
  const [atsLoading, setAtsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl
    setLoading(true)
    setError(null)
    setPdfUrl(null)
    setText('')

    const loadText = async () => {
      const r = await api.getResume(resumeId)
      if (!cancelled) setText(r.extracted_text || '')
    }

    const load = async () => {
      try {
        if (isPdf) {
          try {
            const blob = await api.getResumeFile(resumeId)
            objectUrl = URL.createObjectURL(blob)
            if (!cancelled) setPdfUrl(objectUrl)
          } catch (_) {
            await loadText()
          }
        } else {
          await loadText()
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load resume')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resumeId, isPdf])

  useEffect(() => {
    if (activeTab === 'ats' && !atsData) {
      let cancelled = false;
      const loadAts = async () => {
        setAtsLoading(true);
        try {
          const report = await api.getAtsReport(resumeId);
          if (!cancelled) setAtsData(report);
        } catch (e) {
          console.error("Failed to load ATS report", e);
          if (!cancelled) setError(e.message || 'Failed to generate ATS report');
        } finally {
          if (!cancelled) setAtsLoading(false);
        }
      };
      loadAts();
      return () => {
        cancelled = true;
        setAtsLoading(false);
      };
    }
  }, [activeTab, atsData, resumeId]);

  // Force a fresh ATS analysis (bypasses the server-side cache).
  const regenerateAts = async () => {
    setAtsLoading(true)
    setError(null)
    try {
      const report = await api.getAtsReport(resumeId, null, true)
      setAtsData(report)
    } catch (e) {
      setError(e.message || 'Failed to regenerate ATS report')
    } finally {
      setAtsLoading(false)
    }
  }

  return (
    <aside className={`flex h-full flex-col border-l border-border bg-card animate-fade-in z-50 shadow-2xl transition-all duration-200 ${expanded ? 'absolute right-0 top-0 w-[min(1100px,92vw)]' : 'relative w-[600px] shrink-0'}`}>
      <div className="flex flex-col border-b border-border bg-card/60 px-4 py-3 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">{filename || 'Resume'}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Shrink panel' : 'Expand panel'}>
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-4 border-b border-transparent">
          <button
            onClick={() => setActiveTab('resume')}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'resume' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-2"><FileText size={16} /> Raw Document</span>
          </button>
          <button
            onClick={() => setActiveTab('ats')}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'ats' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-2"><BarChart2 size={16} /> ATS Analysis & Optimization</span>
          </button>
        </div>
      </div>

      {activeTab === 'resume' ? (
        loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive">{error}</div>
        ) : isPdf && pdfUrl ? (
          <iframe title="Resume preview" src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`} className="h-full w-full flex-1 border-0 bg-white" />
        ) : (
          <ScrollArea className="flex-1">
            <pre className="whitespace-pre-wrap break-words p-4 font-sans text-[13px] leading-relaxed text-foreground/90">
              {text}
            </pre>
          </ScrollArea>
        )
      ) : (
        /* ATS Report Tab */
        atsLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-primary">
            <Loader2 className="h-6 w-6 animate-spin" /> Generating Analysis & Optimized Resume... (This takes about 15-30 seconds)
          </div>
        ) : atsData ? (
          <AtsReport reportData={atsData} resumeId={resumeId} onRegenerate={regenerateAts} />
        ) : error === "NO_ROLE" ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-sm flex-col gap-4">
            <p className="text-muted-foreground">What role are you targeting?</p>
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const role = e.target.elements.role.value;
                if (!role.trim()) return;
                setAtsLoading(true);
                setError(null);
                api.getAtsReport(resumeId, role.trim()).then(report => {
                  setAtsData(report);
                  setAtsLoading(false);
                }).catch(err => {
                  setError(err.message || 'Failed to generate ATS report');
                  setAtsLoading(false);
                });
              }}
              className="flex gap-2 w-full max-w-sm"
            >
              <input 
                name="role"
                type="text" 
                placeholder="e.g. Frontend Developer" 
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                required
              />
              <Button type="submit" size="sm">Generate</Button>
            </form>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive">
            {error}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive">
            Failed to generate ATS Report.
          </div>
        )
      )}
    </aside>
  )
}


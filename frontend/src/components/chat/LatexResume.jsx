import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, FileCode2, Loader2, Copy, Check } from 'lucide-react';
import * as api from '@/lib/services/api';

export default function LatexResume({ resumeId }) {
  const [latexCode, setLatexCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadLatex = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getLatexResume(resumeId);
        if (!cancelled) setLatexCode(response.latex || '');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to generate LaTeX resume');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadLatex();
    return () => { cancelled = true; };
  }, [resumeId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(latexCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([latexCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Improved_Resume.tex';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-4 text-primary bg-[#111827] h-full">
        <Loader2 className="h-8 w-8 animate-spin" /> 
        <div className="text-sm font-medium">Generating your improved LaTeX Resume...</div>
        <div className="text-xs text-muted-foreground">This may take up to 30 seconds as the AI completely rewrites your resume.</div>
      </div>
    );
  }

  if (error === "NO_ROLE") {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-4 text-center text-sm bg-[#111827] h-full p-4">
        <p className="text-muted-foreground">What role are you targeting?</p>
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            const role = e.target.elements.role.value;
            if (!role.trim()) return;
            setLoading(true);
            setError(null);
            api.getLatexResume(resumeId, role.trim()).then(response => {
              setLatexCode(response.latex || '');
              setLoading(false);
            }).catch(err => {
              setError(err.message || 'Failed to generate LaTeX resume');
              setLoading(false);
            });
          }}
          className="flex gap-2 w-full max-w-sm"
        >
          <input 
            name="role"
            type="text" 
            placeholder="e.g. Frontend Developer" 
            className="flex h-9 w-full rounded-md border border-[#2a303c] bg-black/50 text-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#47a141]"
            required
          />
          <button 
            type="submit" 
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-[#47a141] text-white rounded-md hover:bg-[#3d8b38] transition-colors"
          >
            Generate
          </button>
        </form>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive bg-[#111827] h-full">
        {error}
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col flex-1 w-full h-full overflow-hidden"
      style={{ backgroundColor: '#111827' }}
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/40">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileCode2 className="text-primary" /> Improved LaTeX Resume
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Instantly compile and edit your resume using Overleaf.
          </p>
        </div>
        
        <div className="flex gap-2">
          <form action="https://www.overleaf.com/docs" method="post" target="_blank" className="m-0 p-0 flex">
            <input type="hidden" name="snip" value={latexCode} />
            <button 
              type="submit"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-[#47a141] text-white rounded-md hover:bg-[#3d8b38] transition-colors"
            >
              Open in Overleaf
            </button>
          </form>
          
          <button 
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          <button 
            onClick={handleDownload}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Download size={16} /> Download .tex
          </button>
        </div>
      </div>
      
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
        <pre className="font-mono text-xs text-green-400 bg-black/50 p-4 rounded-lg w-full min-h-full whitespace-pre-wrap break-words border border-[#2a303c]">
          {latexCode}
        </pre>
      </div>
    </motion.div>
  );
}

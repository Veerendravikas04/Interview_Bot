import { useState } from 'react'
import { Sun, Moon, LogOut, Sparkles, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useChatStore } from '@/store/chatStore'
import { getTheme, applyTheme } from '@/lib/theme'

export default function TopBar({ onLogout, user }) {
  const { threads, activeThreadId, messages } = useChatStore()
  const active = threads.find((t) => t.id === activeThreadId)
  const [theme, setTheme] = useState(getTheme())
  const [copiedChat, setCopiedChat] = useState(false)
  const name = user?.name || 'Account'
  const email = user?.email || ''
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase()

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  // Copy the whole conversation as a clean transcript (Sophia/RealGenie style).
  const copyChat = async () => {
    const transcript = (messages || [])
      .filter((m) => m.content)
      .map((m) => `${m.role === 'user' ? 'You' : 'Caliber'}: ${m.content}`)
      .join('\n\n')
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(transcript)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = transcript
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopiedChat(true)
    setTimeout(() => setCopiedChat(false), 1500)
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur">
      {/* Left: context */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
            {active?.title || 'New chat'}
          </h2>
          <p className="text-[11px] leading-tight text-muted-foreground">AI interview & resume coach</p>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
          onClick={copyChat}
          disabled={!messages?.length}
          title="Copy entire chat"
        >
          {copiedChat ? <Check className="h-[18px] w-[18px] text-emerald-500" /> : <Copy className="h-[18px] w-[18px]" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </Button>

        <Separator orientation="vertical" className="mx-1.5 h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary ring-1 ring-primary/10 transition-opacity hover:opacity-80"
              title={name}
            >
              {initial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{name}</span>
              {email && <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="h-4 w-4" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

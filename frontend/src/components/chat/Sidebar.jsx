import { useState, useRef, useEffect } from 'react'
import { Plus, MessageSquare, LogOut, Gauge, MoreHorizontal, Pencil, Trash2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chatStore'

function groupThreads(threads) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] }
  for (const t of threads) {
    const d = t.date ? new Date(t.date) : new Date()
    d.setHours(0, 0, 0, 0)
    const diff = Math.round((today - d) / 86400000)
    if (diff <= 0) buckets.Today.push(t)
    else if (diff === 1) buckets.Yesterday.push(t)
    else if (diff <= 7) buckets['Previous 7 days'].push(t)
    else buckets.Older.push(t)
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length)
    .map(([label, items]) => ({ label, items }))
}

function ThreadItem({ t, active, onSelect, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(t.title || '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== t.title) onRename(t.id, v)
    else setDraft(t.title || '')
  }

  if (editing) {
    return (
      <div className="mb-0.5 px-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(t.title || '')
              setEditing(false)
            }
          }}
          className="w-full rounded-md border border-primary/50 bg-background px-2.5 py-2 text-sm outline-none ring-2 ring-primary/20"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative mb-0.5 flex items-center rounded-lg border-l-2 transition-colors',
        active ? 'border-primary bg-accent' : 'border-transparent hover:bg-accent/60'
      )}
    >
      <button
        onClick={() => onSelect(t.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 pr-1 text-left"
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={cn('truncate text-sm', active ? 'text-foreground' : 'text-foreground/90')}>
          {t.title || 'New chat'}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-background/60 hover:text-foreground',
              // Always visible on touch (no hover); hover-reveal on desktop.
              active ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            onClick={() => {
              setDraft(t.title || '')
              setEditing(true)
            }}
          >
            <Pencil className="h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(t.id)}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default function Sidebar({ open = true, onClose, onNewChat, onSelect, onLogout, onRename, onDelete }) {
  const { threads, activeThreadId } = useChatStore()
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? threads.filter((t) => (t.title || 'New chat').toLowerCase().includes(query.trim().toLowerCase()))
    : threads
  const groups = groupThreads(filtered)

  // On mobile the sidebar is an overlay drawer — close it after an action so the
  // chat is visible again. On desktop (md+) it stays put.
  const closeIfMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose?.()
  }
  const handleNewChat = () => { onNewChat?.(); closeIfMobile() }
  const handleSelect = (id) => { onSelect?.(id); closeIfMobile() }

  return (
    <>
      {/* Backdrop: mobile only, when the drawer is open */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'z-50 flex h-full w-72 shrink-0 flex-col border-r border-border bg-card',
          // Mobile: fixed off-canvas drawer that slides in/out.
          'fixed inset-y-0 left-0 transition-transform duration-200 ease-in-out',
          // Desktop: in-flow; collapses to zero width (ChatGPT-style).
          'md:static md:z-auto md:bg-card/30 md:transition-[width] md:duration-200',
          open
            ? 'translate-x-0 md:w-72'
            : '-translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0'
        )}
      >
      <div className="flex items-center justify-between pr-2">
        <button
          onClick={handleNewChat}
          className="flex items-center gap-3 px-5 py-5 text-left transition-opacity hover:opacity-80"
          title="New chat"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-soft">
            <Gauge className="h-5 w-5" />
          </div>
          <span className="text-2xl font-bold font-heading tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Caliber
          </span>
        </button>
        {/* Close button: mobile drawer only */}
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-4 pb-3">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start gap-2 shadow-soft bg-gradient-to-r from-primary/90 to-accent/90 hover:from-primary hover:to-accent border-0 text-primary-foreground font-medium rounded-xl h-10"
        >
          <Plus className="h-4 w-4" /> New Chat
        </Button>
      </div>

      <div className="px-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="h-9 border-border bg-card/60 pl-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="mt-1 flex-1 px-2">
        {threads.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">No conversations yet</p>
        )}
        {threads.length > 0 && groups.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">No matches for “{query}”</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </p>
            {g.items.map((t) => (
              <ThreadItem
                key={t.id}
                t={t}
                active={activeThreadId === t.id}
                onSelect={handleSelect}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        ))}
      </ScrollArea>

      <div className="border-t border-border p-3">
        <Button
          variant="ghost"
          onClick={onLogout}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Logout
        </Button>
      </div>
      </aside>
    </>
  )
}

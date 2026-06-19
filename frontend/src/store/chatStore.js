import { create } from 'zustand'

// Chat UI state. Threads list for the sidebar; messages for the active thread;
// streaming state for the in-progress assistant reply.
export const useChatStore = create((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: [],
  isStreaming: false,
  status: null, // e.g. "Reading your resume…"
  currentUser: null, // {name, email} — drives the user message avatar initial

  setCurrentUser: (currentUser) => set({ currentUser }),
  setThreads: (threads) => set({ threads }),
  addThread: (thread) => set((s) => ({ threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)] })),
  patchThread: (id, patch) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeThread: (id) =>
    set((s) => ({
      threads: s.threads.filter((t) => t.id !== id),
      ...(s.activeThreadId === id ? { activeThreadId: null, messages: [], isStreaming: false, status: null } : {}),
    })),

  setActiveThread: (id) => set({ activeThreadId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

  // streaming lifecycle for the assistant reply.
  // `activity` is the per-turn "Reasoning" record: a start time + the tool steps
  // (web_search, …) and the sources each one surfaced. It rides ON the message so
  // it stays attached to the bubble after the turn finishes (session-only).
  startAssistant: () =>
    set((s) => ({
      isStreaming: true,
      status: null,
      messages: [
        ...s.messages,
        {
          id: '__streaming__',
          role: 'assistant',
          content: '',
          activity: { startedAt: Date.now(), endedAt: null, tools: [], sources: [] },
        },
      ],
    })),
  appendToken: (delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === '__streaming__' ? { ...m, content: m.content + delta } : m
      ),
    })),
  setStatus: (status) => set({ status }),

  // A tool step opened (e.g. web_search) — append it to the streaming bubble.
  addTool: ({ call_id, tool, query }) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== '__streaming__') return m
        const tools = m.activity?.tools ?? []
        if (tools.some((t) => t.callId === call_id)) return m // idempotent
        return {
          ...m,
          activity: {
            ...m.activity,
            tools: [...tools, { callId: call_id, name: tool, query: query || '', status: 'running', ms: null }],
          },
        }
      }),
    })),
  // A tool step finished — patch its status + elapsed ms.
  patchTool: ({ call_id, status, ms }) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== '__streaming__' || !m.activity) return m
        return {
          ...m,
          activity: {
            ...m.activity,
            tools: (m.activity.tools ?? []).map((t) =>
              t.callId === call_id ? { ...t, status: status || 'ok', ms: ms ?? t.ms } : t
            ),
          },
        }
      }),
    })),
  // A searched source surfaced — append (dedupe by url) to the streaming bubble.
  addSource: ({ call_id, url, title }) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== '__streaming__' || !m.activity || !url) return m
        const sources = m.activity.sources ?? []
        if (sources.some((x) => x.url === url)) return m
        return {
          ...m,
          activity: { ...m.activity, sources: [...sources, { callId: call_id, url, title: title || null }] },
        }
      }),
    })),

  finishAssistant: (final) =>
    set((s) => ({
      isStreaming: false,
      status: null,
      messages: s.messages.map((m) =>
        m.id === '__streaming__'
          ? {
              id: final?.message_id || `a-${Date.now()}`,
              role: 'assistant',
              content: final?.content ?? m.content,
              // Carry the activity onto the final bubble + freeze the timer and any
              // still-"running" step (defensive — tool_result should have closed them).
              activity: m.activity
                ? {
                    ...m.activity,
                    endedAt: Date.now(),
                    tools: (m.activity.tools ?? []).map((t) =>
                      t.status === 'running' ? { ...t, status: 'ok' } : t
                    ),
                  }
                : undefined,
            }
          : m
      ),
    })),
  failAssistant: () =>
    set((s) => ({
      isStreaming: false,
      status: null,
      messages: s.messages.filter((m) => m.id !== '__streaming__'),
    })),

  resetActive: () => set({ activeThreadId: null, messages: [], isStreaming: false, status: null }),
}))

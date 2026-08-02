// Public runtime configuration. Vite substitutes VITE_* values at build time,
// so secrets must never be stored here.
const apiOrigin = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const wsOrigin = (import.meta.env.VITE_WS_URL || apiOrigin.replace(/^http/, 'ws')).replace(/\/$/, '')

export const API_ORIGIN_URL = apiOrigin
export const API_BASE = `${apiOrigin}/api`
export const WS_THREADS = `${wsOrigin}/api/ws/threads`

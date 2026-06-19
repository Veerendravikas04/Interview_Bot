// Single API layer: attaches the JWT and surfaces the {error,...} envelope.
// No silent fallbacks — every failure throws so the UI can show it.

const BASE = 'http://localhost:8000/api'
const TOKEN_KEY = 'careerForgeToken'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function authHeaders() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function request(path, { method = 'GET', body, isForm } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...authHeaders(),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    let traceId
    let code
    try {
      const err = await res.json()
      message = err.message || err.detail || message
      traceId = err.trace_id
      code = err.code
    } catch (_) {
      /* non-JSON error */
    }
    // Expired/invalid session on an authenticated request → clear + bounce to login.
    if (res.status === 401 && getToken()) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('careerForgeUserId')
      window.dispatchEvent(new Event('caliber:unauthorized'))
    }
    const e = new Error(message)
    e.traceId = traceId
    e.code = code
    e.status = res.status
    throw e
  }
  if (res.status === 204) return null
  return res.json()
}

// ---- Auth ----
export const me = () => request('/auth/me')
export const forgotPassword = (email) => request('/auth/forgot-password', { method: 'POST', body: { email } })
export const resetPassword = (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } })

// ---- Threads ----
export const listThreads = () => request('/threads/')
export const createThread = (payload = {}) =>
  request('/threads/', { method: 'POST', body: payload })
export const getThreadMessages = (threadId) => request(`/threads/${threadId}/messages`)
export const renameThread = (threadId, title) =>
  request(`/threads/${threadId}`, { method: 'PATCH', body: { title } })
export const deleteThread = (threadId) => request(`/threads/${threadId}`, { method: 'DELETE' })
export const attachResume = (threadId, resumeId) =>
  request(`/threads/${threadId}/attach-resume`, { method: 'POST', body: { resume_id: resumeId } })

// ---- Resumes ----
export const getResume = (resumeId) => request(`/resumes/${resumeId}`)
export const getAtsReport = (resumeId, role, refresh) => {
  const p = new URLSearchParams()
  if (role) p.set('role', role)
  if (refresh) p.set('refresh', 'true')
  const qs = p.toString()
  return request(`/resumes/${resumeId}/ats-report${qs ? `?${qs}` : ''}`)
}
export const getLatexResume = (resumeId, role) => request(`/resumes/${resumeId}/latex${role ? `?role=${encodeURIComponent(role)}` : ''}`)
export async function getResumeFile(resumeId) {
  const res = await fetch(`${BASE}/resumes/${resumeId}/file`, { headers: authHeaders() })
  if (!res.ok) throw new Error('Could not load the original file')
  return res.blob()
}
export const uploadResume = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request('/resumes/', { method: 'POST', body: fd, isForm: true })
}

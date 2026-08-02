# Caliber — Frontend & Platform Roadmap

Planned work after the initial production deploy, in priority order. Each item
ships as its own PR to `ThanuGit123/Interview_Bot` `main`. Nothing here changes
the deploy topology (Vercel frontend → Render backend → MongoDB Atlas).

---

## 0. Responsiveness (in progress — PR #5)

Make every view usable on phone / tablet / desktop.

**Done**
- Chat shell: sidebar is an off-canvas drawer on mobile (backdrop, close button,
  auto-close on select/new-chat) and collapses to zero width on desktop
  (toggle in the TopBar; state persisted).
- `ResumePreview`: full-screen overlay on mobile, 600px side panel on desktop.
- Auth: tighter padding on small screens.
- Landing page and Auth were already responsive (CSS media queries / centered card).

**Remaining**
- Visual verification on the Vercel preview across mobile / tablet / desktop
  before calling it complete. Spot-check heavy views: ATS report, interview
  report, configure-session, message bubbles.

---

## 1. Settings page (replaces the "My Profile" modal)

**Goal:** rename the top-right avatar menu item **"My Profile" → "Settings"** and
open a **proper, dedicated Settings page** — its own route/view, not a modal, not
a rushed layout. Clean and clear.

**Reference layout** (a modern tabbed settings page): a page header with a short
subtitle, in-page section tabs, and content grouped into cards. Adapt to Caliber:

| Section | Contents |
|---------|----------|
| **Profile** | Avatar, editable name, email (read-only), "member since" |
| **App** | Theme (light/dark), notification toggles (nice-to-have) |
| **Security** | Email (read-only), "Send password reset link" (see item 4), password change |
| **API Keys** | Bring-your-own-key management (see item 2) |
| **Data & privacy** | What Caliber remembers about you — view / clear |
| **Account** | Sign out |

Build the page shell + navigation first; wire each section's logic in later items.

---

## 2. Bring-your-own API keys (BYOK) — largest item

**Why:** the app runs on free-tier LLM keys. If those hit a rate limit or fail,
everything stalls. Letting each user supply their own key makes it resilient.

**UI:** an "API Keys" section in Settings where a user pastes one or more provider
keys (Groq / Mistral / Cerebras / Tavily). Stored per-user on the backend, never
exposed in the frontend bundle.

**Runtime resolution order (per request):**
1. If the user has configured a key → try it first.
2. Retry that key **once** on transient failure.
3. On continued failure → fall through to the next key in the pool
   (user's other keys, then the app's shared keys).
4. If everything fails **and the user has no key configured** → surface a toast:
   *"Please configure an API key in Settings."*
5. If the user's key is present but invalid → toast asking them to fix it.

**Notes / open questions**
- Should extend the existing backend LLM fallback chain rather than replace it.
- Validate a pasted key with a cheap probe before saving.
- Decide storage: encrypted at rest in Mongo, per-user document.
- Provider auto-detection vs. explicit provider dropdown — TBD.

---

## 3. Dynamic greeting + cleaner top bar

**Replace** the hardcoded "Welcome back, vikas!" with a context-aware greeting:
- Time of day: "Good morning / afternoon / evening, {name}".
- Special days: e.g. a themed line on national holidays (Independence Day, etc.).
- Falls back to a plain "Hi, {name}" when nothing special applies.

**Also:** reconsider the header's copy button — relocate or hide it so the top bar
reads cleanly (it currently sits next to the greeting).

---

## 4. Forgot / reset password

Currently non-functional in production: Render's free tier blocks outbound SMTP
(port 587), so the reset email never sends.

**Options**
- Switch to an HTTPS email API (e.g. Resend / SendGrid) — works on free Render.
- Or move the backend to a paid plan that allows SMTP.

Wire the "Send password reset link" action in the Settings → Security section once
the email transport is chosen.

---

## 5. Data retention (30-day cleanup)

**Why:** Atlas free tier is capped at 512 MB. Unbounded chat/message growth will
eventually hit the cap.

**Plan:** keep essentials indefinitely — user credentials and any important
long-term facts/memory. Everything else (old threads, messages, transient caches)
is cleared on a rolling **30-day** window.

**Notes / open questions**
- MongoDB TTL index vs. a scheduled cleanup job (Render free has no cron; could
  run cleanup opportunistically at startup or via an external scheduler).
- Define precisely which collections/fields are "essential" vs. "expirable".
- Warn users that old conversations are pruned after 30 days.

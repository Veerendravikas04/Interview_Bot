# Caliber — Deployment Guide (Free Tier)

Deploy the full stack on free hosting: **MongoDB Atlas** (database) +
**Render** (backend) + **Vercel** (frontend). Tailored to this repo's actual
structure and verified env vars.

> **Estimated time:** ~60–90 min the first time (mostly account signups + the
> first Render build). ~30 min once you've done it.

---

## 1. Architecture — what goes where

This is a **monorepo** (`backend/` + `frontend/` in one repo). It splits into
three deployable pieces, each on a different free platform:

| Piece | Tech | Platform | Why |
|------|------|----------|-----|
| **Database** | MongoDB | **MongoDB Atlas** (free M0, 512 MB) | Render/Vercel don't host databases |
| **Backend** | FastAPI + uvicorn + **WebSockets** + LangGraph | **Render** (free Web Service) | Needs a long-running server + WebSockets — Vercel's serverless **can't** do this |
| **Frontend** | Vite + React 19 (static `dist/`) | **Vercel** (free Hobby) | Pure static files — Vercel's sweet spot |

```
                 ┌─────────────────────────┐
   Browser  ───► │  Vercel (frontend)      │  https://caliber.vercel.app
                 │  Vite/React static SPA  │
                 └───────────┬─────────────┘
                             │  HTTPS + WSS  (VITE_API_URL / VITE_WS_URL)
                             ▼
                 ┌─────────────────────────┐
                 │  Render (backend)       │  https://caliber-api.onrender.com
                 │  FastAPI + WebSocket    │
                 └───────────┬─────────────┘
                             │  MONGODB_URI
                             ▼
                 ┌─────────────────────────┐
                 │  MongoDB Atlas (M0)     │
                 └─────────────────────────┘
```

**Deploy order matters** (dependency chain):
`Database → Backend → Frontend → CORS` (CORS last because the backend needs the
frontend's URL, but the frontend needs the backend's URL — see §8).

---

## 2. Accounts you need

| Account | Used for | Cost |
|---------|----------|------|
| GitHub | source repo (already have) | free |
| [MongoDB Atlas](https://www.mongodb.com/atlas) | database | free M0 |
| [Render](https://render.com) | backend hosting | free |
| [Vercel](https://vercel.com) | frontend hosting | free |

Sign in to Render and Vercel **with GitHub** — it makes connecting the repo
one click.

---

## 3. GitHub / repo setup (who owns what)

- **Upstream (deploy source):** `ThanuGit123/Interview_Bot` — **Public**, default
  branch `main`.
- **Fork (workbench):** `Veerendravikas04/Interview_Bot` — where you branch + PR from.
- Your merged PRs already land in upstream `main` and **count** on your
  contribution graph (verified: 8 commits on `ThanuGit123/Interview_Bot`).

### Deploying from the upstream repo requires one owner action
Render and Vercel install a **GitHub App** on the repo for auto-deploy +
webhooks. Only the **repo owner (Thanusha)** can authorize that. Two models:

| | Model A — owner sets up | Model B — you set up |
|---|---|---|
| Render/Vercel accounts owned by | Thanusha | You |
| Owner action needed | she does the whole setup | she **approves** the GitHub App when you import the repo |
| Secrets live in | her dashboards | your dashboards |

**Recommended:** the repository owner should add the deployer as a collaborator
using GitHub's normal invitation flow. Do not share account passwords or reuse
another person's browser session; Render, Vercel, and Atlas access should stay
with the account that owns each service.

### Decide together
1. Who owns the **Render + Vercel + Atlas** accounts (one shared owner is simplest).
2. Who holds the **secret env vars** (Mongo URI, JWT secret, API keys).

---

## 4. Deployment configuration included

The required frontend URL configuration has been added. It reads the backend
origin from `VITE_API_URL`, derives secure WebSocket URLs automatically, and keeps
`http://localhost:8000` only as the local-development fallback.

**Files to change:**

| File | Current | Becomes |
|------|---------|---------|
| `frontend/src/lib/services/api.js` | `const BASE = 'http://localhost:8000/api'` | from `@/lib/config` → `API_BASE` |
| `frontend/src/services/aiService.js` | `const API_URL = 'http://localhost:8000/api'` | from `@/lib/config` → `API_BASE` |
| `frontend/src/components/Auth.jsx` | `fetch(\`http://localhost:8000${endpoint}\`)` | `API_ORIGIN_URL` |
| `frontend/src/lib/hooks/useThreadSocket.js` | `const WS_BASE = 'ws://localhost:8000/api/ws/threads'` | `WS_THREADS` |
| `frontend/src/components/ChatWindow.jsx` | `ws://localhost:8000/api/ws/threads/...` | `WS_THREADS` |
| `frontend/src/components/CoachChat.jsx` | `ws://localhost:8000/api/ws/threads/...` | `WS_THREADS` |

**Approach:** add one central config module so there's a single source of truth:

```js
// frontend/src/lib/config.js  (new file)
const API_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:8000'
// Derive WS origin from API origin unless overridden: http→ws, https→wss
const WS_ORIGIN = import.meta.env.VITE_WS_URL || API_ORIGIN.replace(/^http/, 'ws')

export const API_ORIGIN_URL = API_ORIGIN                  // http://localhost:8000
export const API_BASE       = `${API_ORIGIN}/api`         // http://localhost:8000/api
export const WS_THREADS     = `${WS_ORIGIN}/api/ws/threads`
```

Each of the 6 files imports what it needs from `@/lib/config` (the `@` alias →
`src/`, defined in `vite.config.js`).

**Why this design:**
- **Local dev keeps working with no `.env`** — the `|| 'http://localhost:8000'`
  fallback means `npm run dev` is unchanged.
- **`wss://` is automatic in production** — deriving WS from the API origin turns
  `https://…onrender.com` into `wss://…onrender.com`, avoiding the browser's
  mixed-content block. You only set **one** env var (`VITE_API_URL`).

The repository also includes `render.yaml`, a free Render Blueprint with the
backend runtime, build/start commands, health check, and secret placeholders.
Commit these files before creating the Render Blueprint.

Mongo migrations now run idempotently during backend startup. This is required
because Render's free tier does not provide a separate pre-deploy job.

---

## 5. Environment variables — complete reference

### Backend → set in the **Render** dashboard

| Variable | Required? | Value / note |
|----------|-----------|--------------|
| `MONGODB_URI` | ✅ **required** | Atlas connection string (`mongodb+srv://…`) |
| `MONGODB_DB` | ✅ **required** | `interview_bot` (code reads `os.environ["MONGODB_DB"]` — crashes if missing) |
| `JWT_SECRET` | ✅ **required** | strong random string (app refuses to start without it) |
| `GROQ_API_KEY` | ✅ **required** (≥1 LLM) | primary LLM; fallback chain below |
| `CORS_ORIGINS` | ✅ for prod | your Vercel URL, e.g. `https://caliber.vercel.app` (comma-separated for multiple) |
| `PYTHON_VERSION` | ✅ set on Render | `3.12` (deps need it; repo has no pin) |
| `MISTRAL_API` | optional | fallback LLM |
| `CEREBRAS_API` | optional | fallback LLM |
| `TAVILY_API_KEY` | optional | enables the `web_search` tool |
| `GITHUB_TOKEN` | optional | enables `github_profile` tool (higher rate limit) |
| `FRONTEND_URL` | optional | Vercel URL — used in password-reset links |
| `SMTP_HOST/PORT/USER/PASS`, `FROM_EMAIL` | local/paid backend only | password-reset email (Gmail → App Password) |
| `JWT_EXPIRE_DAYS`, `RESET_TOKEN_TTL_MIN` | optional | tuning (defaults fine) |
| `GROQ_MODEL`, `MISTRAL_MODEL`, `CEREBRAS_MODEL` | optional | model overrides |

### Frontend → set in the **Vercel** dashboard

| Variable | Required? | Value / note |
|----------|-----------|--------------|
| `VITE_API_URL` | ✅ **required** | backend **origin, no `/api`** — e.g. `https://caliber-api.onrender.com` |
| `VITE_WS_URL` | optional | only to override; otherwise derived from `VITE_API_URL` (→ `wss://`) |

> ⚠️ **Never put secret keys in `VITE_` vars** — anything `VITE_`-prefixed is
> compiled into the public browser bundle. All API keys live on the backend
> (Render) only. ✅ This stack already routes LLM calls through the backend.

> ⚠️ **Vite env vars are baked in at build time.** Changing `VITE_API_URL` in
> Vercel later requires a **redeploy** to take effect.

> ⚠️ **Free Render limitation:** free web services cannot send outbound traffic
> on SMTP ports, including `587`. Leave the SMTP variables unset for this free
> deployment. Login and signup work; password-reset emails require a future move
> to an HTTPS email API or a paid backend service.

---

## 6. Step-by-step deployment

### Step 0 — Commit the deployment configuration
Commit `frontend/src/lib/config.js`, `frontend/.env.example`, `render.yaml`, and
the URL call-site updates, then merge them into the branch Render and Vercel use.

### Step 1 — MongoDB Atlas
1. Create a free **M0** cluster.
2. **Database Access** → add a user + password (save them).
3. **Network Access** → allow `0.0.0.0/0` (Render free tier has no fixed outbound IP).
4. **Connect → Drivers** → copy the connection string. Insert the password, and
   set the db name → this is your `MONGODB_URI`.

### Step 2 — Render (backend)
Use the **Blueprint** flow — `render.yaml` at the repo root already declares the
runtime, root directory, build/start commands, health check, and env vars. Do
**not** use "New → Web Service"; that is the manual path and ignores `render.yaml`.

1. **New → Blueprint** → connect `ThanuGit123/Interview_Bot`
   (authorize the GitHub App — owner action, see §3).
2. Render reads `render.yaml` and proposes the `caliber-api` service. Everything
   below comes from that file — nothing to type:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free · **Health Check:** `/health`
3. It prompts for the three `sync: false` values. Supply `MONGODB_URI` and
   `GROQ_API_KEY` now; leave `CORS_ORIGINS` blank until the Vercel URL exists
   (Step 4). `JWT_SECRET` is generated automatically. Add optional
   provider/tool keys in the dashboard afterwards.
4. **Apply** → first build takes ~5–10 min (heavy deps).
5. Copy the URL → `https://<name>.onrender.com`.

> If you ever edit `render.yaml`, the Blueprint re-syncs on the next push to
> `main`. Values set by hand in the dashboard that also appear in `render.yaml`
> get overwritten — keep secrets as `sync: false` and set them in the dashboard only.

### Step 3 — Vercel (frontend)
1. **Add New → Project** → import `ThanuGit123/Interview_Bot`.
2. **Root Directory:** `frontend` (Vercel auto-detects Vite: build `vite build`,
   output `dist`).
3. **Environment Variables:** `VITE_API_URL = https://<name>.onrender.com`
   (the Render URL from Step 2 — origin, no `/api`).
4. **Deploy** → copy the URL → `https://<name>.vercel.app`.

### Step 4 — Wire CORS (back on Render)
1. Render → your service → **Environment** → set
   `CORS_ORIGINS = https://<name>.vercel.app` (and optionally `FRONTEND_URL` to
   the same).
2. Save → Render auto-redeploys.

### Step 5 — Verify (§9).

---

## 7. Post-deploy dev workflow (auto-deploy)

Both platforms **watch `main`** — every merge to `main` auto-rebuilds and
redeploys. You never click "deploy" again.

```
git checkout -b feature/x      # work in isolation on your fork
... commit, push ...
open PR → fork → ThanuGit123/Interview_Bot main
   → Vercel auto-builds a PREVIEW URL to test before going live
merge PR → Render + Vercel auto-redeploy production 🚀
```

- Frequent commits go on the **feature branch** (no deploy). Only the **merge to
  `main`** triggers a production build.
- Every push to `main` = a full Render rebuild (~5–10 min free tier) — so batch
  changes, don't push tiny commits to `main`.
- **Monorepo note:** by default both platforms rebuild on any push to `main`.
  Optional later: Render **Build Filters** (`backend/**`) and Vercel **Ignored
  Build Step** to skip cross-folder rebuilds.

---

## 8. Gotchas

- **Cold starts (free tier):** Render's backend sleeps after 15 min idle and
  takes ~1 min to wake on the next request. Fine for demos; open it a minute
  before showing anyone. (WebSocket traffic keeps it awake while connected.)
- **`wss://` not `ws://`:** production must use secure sockets or browsers block
  them. The §4 config derives this automatically.
- **CORS is last + credentialed:** the backend sends an explicit allow-list (no
  `*` wildcard, because it uses `allow_credentials`). `CORS_ORIGINS` must exactly
  match the Vercel origin (scheme + host, no trailing slash).
- **Python version:** set `PYTHON_VERSION=3.12` on Render — the repo has no pin
  and Render's default may break the LangChain deps.
- **Atlas IP allowlist:** must include `0.0.0.0/0` or Render can't connect.
- **Secrets hygiene:** never commit real keys. `backend/.env` should stay
  gitignored; set all secrets in the Render dashboard.

---

## 9. Verify it works

1. **Backend health:** open `https://<render>.onrender.com/health` → it returns
   `{ "status": "ok" }`; `/docs` should also load.
2. **Render logs:** look for `mongodb_connected` and `cors_configured` with your
   Vercel origin in the allow-list. No `MONGODB_URI`/`JWT_SECRET` errors.
3. **Frontend:** open the Vercel URL → sign up / log in (hits
   `/api/auth/...` on Render).
4. **WebSocket:** start a chat/interview → tokens stream in. In DevTools →
   Network → WS, confirm the connection is `wss://<render>.onrender.com/api/ws/...`
   and **open** (not failing on mixed content).
5. **Cross-check (truth-first):** if login fails, check the browser console for a
   CORS error (→ fix `CORS_ORIGINS`) or a `localhost:8000` request (→ Step 0 not
   merged / `VITE_API_URL` not set / frontend not redeployed).

---

## 10. Free-tier limits verified July 2026

- Render Free web services spin down after 15 minutes without inbound HTTP or
  WebSocket traffic and can take about one minute to wake. They share 750
  instance-hours per workspace per calendar month.
- Vercel Hobby is for personal, non-commercial projects; it is unsuitable for a
  commercial production product.
- Atlas Free clusters are intended for learning/proof-of-concept use, and each
  Atlas project can have one Free cluster.

## 11. Quick reference

```
Backend (Render)
  Root dir:   backend
  Build:      pip install -r requirements.txt
  Start:      uvicorn app.main:app --host 0.0.0.0 --port $PORT
  Required:   MONGODB_URI, MONGODB_DB=interview_bot, JWT_SECRET, GROQ_API_KEY,
              CORS_ORIGINS=<vercel-url>, PYTHON_VERSION=3.12

Frontend (Vercel)
  Root dir:   frontend
  Build:      vite build   (auto)    Output: dist
  Required:   VITE_API_URL=https://<render>.onrender.com

Database (Atlas)
  Free M0, user+pass, Network Access 0.0.0.0/0, copy MONGODB_URI

Deploy source: ThanuGit123/Interview_Bot  (branch: main)
```

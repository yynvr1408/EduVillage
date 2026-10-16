# EduVillage scalability architecture

Audit date: **2026-10-16**. Source of truth for behaviour is the repository (`main`); pricing comes from official provider pages (see [INFRASTRUCTURE_COST_MODEL.md](INFRASTRUCTURE_COST_MODEL.md)). Every statement is tagged with one of: **Implemented and verified** (a test that was run exercises it), **Implemented, not verified in production**, **Partially implemented**, **Configured, not deployed**, **Planned**, **Missing**, **Unknown**.

Related: [README](../README.md) · [cost model](INFRASTRUCTURE_COST_MODEL.md) · [upgrade roadmap](DEPLOYMENT_UPGRADE_ROADMAP.md) · [evaluation answers](SCALABILITY_EVALUATION_ANSWERS.md) · [capacity test plan](CAPACITY_TEST_PLAN.md)

Contents: [1. Current architecture](#1-current-architecture) · [2. Service inventory](#2-service-inventory) · [3. Audit answers](#3-answers-to-the-audit-questions) · [4. Bottlenecks](#4-scaling-bottlenecks) · [5. Target architecture per stage](#5-target-architecture-per-stage) · [6. Verified vs assumed](#6-verified-facts-versus-assumptions)

## 1. Current architecture

```mermaid<br/>flowchart LR<br/>  subgraph Browser["Browser (React 19 PWA)"]<br/>    UI["Student / Teacher / Admin UI"]<br/>    IDB[("IndexedDB (Dexie)\ndrafts, sync queue, downloads")]<br/>    SW["Service worker (Workbox)"]<br/>    LKC["LiveKit client SDK"]<br/>  end<br/>  subgraph Vercel["Vercel - static hosting"]<br/>    STATIC["Vite build (dist)\nSPA rewrite /(.*) -> /index.html"]<br/>  end<br/>  subgraph Render["Render - Docker web service (render.yaml)"]<br/>    API["FastAPI modular monolith\nuvicorn, 1 worker\nBackgroundTasks + ffmpeg"]<br/>  end<br/>  NEON[("Neon PostgreSQL 18")]<br/>  LK["LiveKit Cloud\nSFU + Egress"]<br/>  R2[("Cloudflare R2\nrecordings, uploads")]<br/>  GROQ["Groq API\nLLM + Whisper"]<br/>  EJS["EmailJS REST API"]<br/><br/>  UI -->|static assets| STATIC<br/>  UI -->|"HTTPS, cookie session\nVITE_API_BASE_URL"| API<br/>  UI <--> IDB<br/>  SW --- UI<br/>  API -->|SQLAlchemy / psycopg2| NEON<br/>  API -->|"join token (JWT, room-scoped)"| UI<br/>  LKC <-->|WebRTC media| LK<br/>  API -->|"room / egress control"| LK<br/>  LK -->|"recording MP4 (S3 API)"| R2<br/>  LK -->|"signed webhook\nPOST /api/v1/webhooks/livekit"| API<br/>  UI -->|"presigned GET / PUT"| R2<br/>  API -->|"presigned URLs, HEAD"| R2<br/>  API -->|"transcribe + summarise"| GROQ<br/>  API -->|"OTP email (server-side)"| EJS<br/>```

The browser downloads static files from Vercel and then talks to the API **directly** (cross-origin, `SameSite=None; Secure` cookie, a single allowed CORS origin from `FRONTEND_ORIGIN`). Media never passes through the API: LiveKit carries live media, R2 serves recordings and uploads through presigned URLs.

### Main data flows

```mermaid<br/>sequenceDiagram<br/>  participant S as Student browser<br/>  participant A as FastAPI (Render)<br/>  participant L as LiveKit Cloud<br/>  participant R as R2<br/>  participant G as Groq<br/>  Note over S,A: Join a live class<br/>  S->>A: POST /classes/{id}/join-token (cookie)<br/>  A->>A: enrolled? branch/section audience? class live?<br/>  A-->>S: short-lived room-scoped JWT<br/>  S->>L: WebRTC (subscribe only)<br/>  Note over A,G: Recording to summary<br/>  A->>L: start room-composite egress (MP4 -> R2)<br/>  L->>R: upload file<br/>  L->>A: signed webhook (egress ended)<br/>  A->>R: HEAD object (finalize)<br/>  A->>G: Whisper (chunks) then LLM summary<br/>  A-->>S: teacher-reviewed summary / signed playback URL<br/>```

## 2. Service inventory

| Component | Provider | Actual implementation | Deployment location | Current plan | Verified free allowance | Paid alternatives | Usage metric | Limitations | Evidence | Recommended action |
|---|---|---|---|---|---|---|---|---|---|---|
| Frontend | **Vercel** | Static React 19 / Vite 8 PWA; no server functions, no edge functions, no Next.js | Vercel | UNKNOWN (account not accessible) | Hobby: 100 GB transfer, 1M requests (non-commercial) | Pro $20/month | Bandwidth, requests | Hobby is non-commercial; one CORS origin means Vercel **preview** URLs cannot call the API | `frontend/vercel.json`, `frontend/package.json`, `backend/app/main.py` (CORS) | Move to Pro before a college pilot; add preview origins only if previews are used |
| Backend API | **Render** (Docker) | FastAPI 0.143 modular monolith, `uvicorn` 1 worker, migrations in the container start command | Render | `free` (per `render.yaml`) | 750 h/month, spins down after 15 min, ephemeral disk, 1 instance | Starter $7 / Standard $25 / Pro $85 | Instance-hours, CPU, memory, bandwidth | Cold start ~1 min; one instance only; CPU/memory too small for ffmpeg + API together | `render.yaml`, `backend/Dockerfile`, deploy logs supplied by the owner | First upgrade: Standard instance (see roadmap) |
| Database | **Neon** PostgreSQL 18.6 | SQLAlchemy 2 + Alembic, 33 tables | Neon (AWS; region UNKNOWN) | UNKNOWN (assumed Free) | 1 GB, 100 CU-hours, 6 h restore | Launch / Scale pay-as-you-go | Storage, CU-hours, connections | Suspends after 5 min idle; only 6 h of restore history; pool settings are SQLAlchemy defaults | `backend/app/db/session.py`; read-only inspection: 9.6 MB | Add `pool_pre_ping`, paid plan with 7-day restore at pilot |
| Live classes | **LiveKit Cloud** | Token issuance, room-composite Egress to R2, signed webhook | LiveKit Cloud (domain `livekit.cloud`) | UNKNOWN (assumed Build) | 5,000 min, 100 concurrent, 60 egress min | Ship $50, Scale $500 | Participant-minutes, concurrent connections, egress minutes, GB | 60 recorded minutes/month on free; **video** egress | `backend/app/integrations/livekit.py`, `frontend/e2e-live` | Ship before recording regularly |
| Recording / uploads | **Cloudflare R2** | S3-compatible via boto3, presigned PUT/GET | Cloudflare | UNKNOWN (assumed free) | 10 GB, 1M Class A, 10M Class B, free egress | $0.015/GB-month | GB stored, operations | Not verified against real R2 in tests (moto emulator) except the owner's real-service runs | `backend/app/integrations/object_storage.py`, `docs/RECORDING_VERIFICATION.md` | Add a retention policy |
| OTP email | **EmailJS** (REST, server-side via httpx) | OTP for password reset and second-device sign-in | EmailJS | UNKNOWN; **not configured locally** | 200 requests/month, 1 request/s | Personal $9 .. Business $40 | Requests/month | Quota and rate far below a college's login volume at scale | `backend/app/integrations/email.py`, `backend/app/config.py` | Confirm free-plan server-side policy; budget Personal at pilot |
| AI | **Groq** (OpenAI-compatible API) in `render.yaml`; local FreeLLMAPI proxy in the developer's `.env` | `openai` SDK with `base_url`, summaries + Whisper chunks | Render (Groq); FreeLLMAPI: local only | Free tier per Groq console | See cost model (limits ambiguous) | Pay-per-token | Tokens, audio hours | Free limits are small per day; no fallback provider coded | `backend/app/integrations/llm_provider.py`, `speech_to_text.py`, `render.yaml` | Keep AI optional; quotas per teacher |
| Source control | **GitHub** | `yynvr1408/EduVillage`, `main` branch | GitHub | Free | - | - | - | **No CI workflows** (no `.github/`) | repository root | Add a test workflow |
| Monitoring | Provider dashboards + stdout logs | JSON-less text logs with request id; `/health`, `/ready` | - | - | - | - | - | No error tracking, no alerts configured | `backend/app/core/logging.py`, `backend/app/main.py` | Provider alerts first |

## 3. Answers to the audit questions

| # | Question | Answer (evidence) |
|---|---|---|
| 1 | Frontend framework / build | React 19 + TypeScript, Vite 8, Tailwind v4, TanStack Query, Dexie, `vite-plugin-pwa`; `npm run build` = `tsc -b && vite build`. Built output is about 1.4 MB (`frontend/dist`). |
| 2 | Vercel architecture | **Static SPA only.** `vercel.json` has one rewrite (`/(.*)` -> `/index.html`). No serverless/edge functions, no image optimisation, no SSR. Registered-user growth therefore does not create function costs; only bandwidth and requests count. |
| 3 | Backend framework | FastAPI (one modular monolith; 124 API operations under `/api/v1`, plus `/health`, `/ready`; see [API_CONTRACTS.md](API_CONTRACTS.md)). |
| 4 | Backend host | **Render**, Docker web service (`render.yaml`; owner-supplied deploy logs show Render building the image and running Alembic). Plan assumed `free`. |
| 5 | PostgreSQL provider | **Neon** (host `*.neon.tech`; PostgreSQL 18.6). |
| 6 | Connection / pooling | `create_engine` with defaults (SQLAlchemy QueuePool: 5 + 10 overflow), no `pool_pre_ping`, no explicit pooler setting. Whether the Neon pooled endpoint is used is UNKNOWN. |
| 7 | Sessions | Server-side sessions in the database (`user_sessions`, hashed token, httpOnly cookie, 72 h absolute TTL; admin 120 min, separate cookie). Safe for several instances. |
| 8 | LiveKit authorisation | `POST /classes/{id}/join-token` checks enrolment, section / **branch audience**, class status; room-scoped JWT; students subscribe-only; webhook is signature-verified. Implemented and tested (including `frontend/e2e-live` against real LiveKit Cloud: signalling-level presence only, not audio/video content). |
| 9 | EmailJS | Server-side REST call (`api.emailjs.com`) with the private key as `accessToken`; **not** the browser SDK. Implemented. Not configured locally; production delivery not verified by this audit. |
| 10 | OTP implementation | Implemented in the backend (`auth_service`): 6-digit code, HMAC-hashed, 5-minute TTL, 5 attempts, resend cooldown, atomic claims, generic errors, separate reset authorisation token (10 min), sessions revoked after reset. Also used for second-device sign-in approval. about 50 backend tests. Email delivery is the unverified part. |
| 11 | AI provider | Any OpenAI-compatible endpoint via `LLM_BASE_URL`; `render.yaml` selects Groq `openai/gpt-oss-120b` and `whisper-large-v3-turbo`. A labelled stub is used when no key is set. |
| 12 | Recording / storage | LiveKit Egress writes MP4 straight to R2; the API finalises by `HEAD`; playback and downloads use presigned URLs. Local-disk storage exists for development only. |
| 13 | Ephemeral local storage | **Yes on Render free** (filesystem is ephemeral), which is why `STORAGE_BACKEND=s3` is required in production. SQLite files exist only for development (`*.db` is git-ignored). |
| 14 | Background work in request handlers | **Yes.** Transcription / summary jobs start through FastAPI `BackgroundTasks` inside the API process, including ffmpeg chunking. A standalone worker (`python -m app.worker`) exists but **is not deployed** (`render.yaml` has no worker). |
| 15 | Safe with several instances | **Partially.** Sessions (including the administrator's single active session and idle timeout), jobs (atomic claims) and idempotent sync are database-backed. Not safe/accurate: login, admin and OTP **rate limits are in process memory** (limits multiply with instances); migrations run in every container start (concurrent boots race); BackgroundTasks jobs stranded on a restart need the undeployed worker. |
| 16 | Institution-level access enforced by backend | **Partially.** Registration validates college, code, branch, section server-side; branch-wide classes are restricted to students of that branch (list, detail, token, recordings); teacher class targeting is limited to the assigned section/branch. **Courses and the catalogue are not scoped to a college**, there is no institution-administrator role and no membership approval workflow. |
| 17 | Schema fit for multi-institution | Adequate (colleges -> branches -> sections, composite foreign key, unique names per parent, 48 indexes). Courses lack `college_id`; audit events lack an institution column. |
| 18 | Hard quotas / usage billing | Yes: LiveKit minutes and egress, Neon CU-hours/storage, EmailJS requests, Groq tokens/audio, Vercel bandwidth, Render hours/bandwidth. See cost model. |
| 19 | Environments separated | Partially. `APP_ENV` and `.env` differ by machine, but the developer's local `.env` points at the **same Neon database and LiveKit/R2 services** as production, which let an uncommitted migration reach the shared database during this project (stamped `815ac36126a9`, repaired). No staging environment exists. |
| 20 | Secrets exposed | `.env` is git-ignored and `render.yaml` uses `sync: false`. **Finding:** `backend/.env.example` on `origin/main` (commit `3b47ed2`) contained the real admin username/password; it is blanked in the working tree during this audit but **remains in git history**, so the admin password must be rotated (see the README security section). No other secret patterns were found in tracked files. |

## 4. Scaling bottlenecks

Ordered by when they bite (security blockers are listed separately in the README and are not performance issues).

1. **Render free instance** - spins down after 15 min idle (about 1 min cold start for the first user), restarts any time, one instance, and a small CPU/memory share must run the API, BackgroundTasks and ffmpeg transcription together.
2. **LiveKit Build limits** - 60 egress minutes/month (about one recorded class-hour), 5,000 participant-minutes, 100 concurrent connections. First paid upgrade trigger for any college that records classes.
3. **Heartbeat traffic** - every open tab calls `/health` every 15 s (240/hour). At 500 concurrent users that is about 33 requests/s of pure heartbeat before any real work. It also keeps a free Render instance from sleeping while anyone is online.
4. **Neon free** - suspend-after-5-minutes cold starts, 100 CU-hours, 1 GB, 6 h restore; no `pool_pre_ping`, so a connection held across a suspend can fail once.
5. **In-memory rate limiting** - becomes ineffective with more than one instance.
6. **Undeployed worker** - jobs stranded by a crash are not recovered automatically.
7. **EmailJS** - 200 requests/month and 1 request/s cannot serve a login-approval flow at college scale.
8. **No monitoring or alerts** - quota exhaustion would be noticed by users first.

## 5. Target architecture per stage

Stage definitions and costs: [DEPLOYMENT_UPGRADE_ROADMAP.md](DEPLOYMENT_UPGRADE_ROADMAP.md). All stages **keep Vercel** for the frontend and change one component at a time; none of them introduces Kubernetes.

| Stage | Registered users (planning range) | Architecture changes |
|---|---|---|
| 1 MVP | about 100 | Current stack. Fix security findings, confirm EmailJS delivery, record real usage. |
| 2 College pilot | 100-1,000 | Vercel Pro; Render Standard (always on); Neon paid with 7-day restore; LiveKit Ship; EmailJS Personal; deploy the worker only if jobs get stranded; provider usage alerts. |
| 3 Multi-college | 1,000-10,000 | Second Standard instance behind Render's load balancing; shared rate-limit store **only if** measurements show abusive traffic bypassing per-instance limits; separate worker; reduce heartbeat frequency; transactional-email provider; retention policy on R2; add college scoping to courses. |
| 4 Large | 10,000-100,000 | Several instances (cost model: 5-12 Standard); Neon Scale with 30-day restore; LiveKit Scale or Enterprise; read replica **only** if measured read load requires it; formal backup/restore drills. |

These are planning ranges, not capacity guarantees. Capacity must be **measured** with [CAPACITY_TEST_PLAN.md](CAPACITY_TEST_PLAN.md) before any user-count claim.

## 6. Verified facts versus assumptions

| Category | Items |
|---|---|
| **Verified by tests that were run** | Auth, sessions, OTP flows, admin panel, colleges/branches/sections, registration validation, branch-wide classes and join-token authorisation, recording lifecycle and signed playback against an S3 emulator, offline sync and downloads, layout. Backend 421 tests on SQLite and 422 on PostgreSQL 18; frontend 179 unit tests; real-browser suites. |
| **Verified against real external services by the owner or by an e2e suite** | LiveKit Cloud signalling with several students (`e2e-live`, not media content); Neon connectivity and schema (read-only inspection in this audit). |
| **Implemented, not verified in production** | EmailJS delivery, Groq summaries/transcription on Render, R2 recording end to end on production, Vercel-to-Render cookie flow (`SameSite=None`). |
| **Configured, not deployed** | Standalone worker (`app.worker`); FreeLLMAPI local proxy. |
| **Planned / missing** | CI workflows, error tracking, usage alerts, staging environment, institution administrators and membership approval, college scoping of courses, audio-only recording, shared rate limiter, load-test results. |
| **Assumed (cost model)** | MAU shares, concurrency shares, minutes per user, 40 requests/s per instance, CU sizing, recording size and retention. |
| **Unknown** | Vercel / Render / Neon / LiveKit actual plans and usage; Neon pooler limits; production latency and error rate. |

## 7. Newer features and their effect on scaling

| Feature | Where it runs | Scaling effect |
|---|---|---|
| Whiteboard | LiveKit data channel (a few hundred bytes per stroke, sent in batches about 16 times a second while drawing) | no API load; works in audio-only mode; no storage |
| Screen sharing (one or several screens) | LiveKit media tracks | counts as participant minutes and downstream bandwidth like video |
| Teacher background blur | the teacher's browser (segmentation model fetched from a CDN once) | no server cost |
| Assignment files (PDF, DOC, DOCX; 5 files of 20 MB at most) | direct browser-to-R2 uploads with presigned URLs, then a size and content check by the API | R2 storage and operations only; the API never carries the file bytes |
| Lecture notes as PDF or Word | generated in the browser | no server cost |
| Syllabus PDF import | the API reads the PDF text (10 MB at most, 100 pages) and proposes lessons | a short CPU burst per import; nothing stored |
| Second-device sign-in code | one EmailJS request per second-device sign-in | adds to the email volume used in the cost model |
| Administrator single session | `user_sessions.last_seen_at` updated on admin requests | one row per admin session |

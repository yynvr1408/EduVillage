# EduVillage

**An offline-first, low-bandwidth learning platform for rural colleges: live classes with an audio-only fallback, recorded lessons, downloadable materials, and assignments that can be written and submitted without a connection.**

This README describes what is implemented in this repository: a complete offline-first learning platform with live and recorded classes, assignments and AI-assisted study notes.

Supporting documents: [Scalability architecture](docs/SCALABILITY_ARCHITECTURE.md) · [Infrastructure cost model](docs/INFRASTRUCTURE_COST_MODEL.md) · [Deployment and upgrade roadmap](docs/DEPLOYMENT_UPGRADE_ROADMAP.md) · [Scalability evaluation answers](docs/SCALABILITY_EVALUATION_ANSWERS.md) · [Capacity test plan](docs/CAPACITY_TEST_PLAN.md) · [Admin panel and colleges](docs/ADMIN_PANEL.md) · [API contracts](docs/API_CONTRACTS.md) · [Backend setup](docs/BACKEND_SETUP.md)

## Walkthrough (for evaluators)

This section is a plain, step-by-step tour of what the application actually does, written for someone reviewing the submission rather than building on it. Everything below reflects the live, deployed system — nothing here is a mockup or a plan.

**Live deployment**

* Frontend (student/teacher/admin UI): **<https://edu-village-nine.vercel.app>**
* Backend API: **<https://eduvillage-api.onrender.com>** (`/health` for a liveness check, `/docs` for the OpenAPI/Swagger schema)
* Everything runs on managed services (Vercel, Render, Neon, LiveKit Cloud, Cloudflare R2), so there is nothing to install to use it.
* Admin credentials are a real production secret and are intentionally **not** in this document or anywhere in the repository. To evaluate the admin panel, either run the app locally (below) and bootstrap your own admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `backend/.env`, or ask the submitter for temporary evaluator access.

**Trying it hands-on without admin access**

Self-registration (student or teacher) requires selecting an existing college and entering its admin-issued code — this is deliberate (see [section 4](#4-user-roles-and-permissions)), so a brand-new evaluator can't register on the live deployment without either an admin account or a code from someone who has one. The fastest way to click through the whole product yourself is the local setup in [section 9](#9-local-development-setup): `alembic upgrade head` then `python -m app.seed` creates a ready-to-use college, branch, section, and demo teacher/student accounts in one command.

**The guided walkthrough itself** (this is the actual flow a college would use, and the one the test suite exercises):

1. **Platform admin sets up the institution** — sign in at `/admin` → *Create College* (a name is all that's required) → the system generates a unique code like `EV-XXXX-XXXX` → open the college → add a **Branch** (e.g. "Computer Science") → inside it, add one or more **Sections** (e.g. "Section A", "Section B") → the college and branch are active by default.
2. **A teacher registers** at `/register/teacher` — picks the college, branch, and either a specific section or **All Sections** (a branch-wide teaching assignment), enters the college code from step 1, and is signed in immediately.
3. **A student registers** at `/register/student` — same college/branch/section + code. Registering does not enroll the student in anything by itself; enrollment is a separate, explicit step (step 5).
4. **The teacher creates a course** from the Teacher Dashboard → *Create Course* → fills in a title and description → publishes it. The teacher can see a live **roster** of every enrolled student (name, email, branch/section) on the course's manage page.
5. **The student discovers and enrolls** — Course Catalog → finds the published course → clicks **Enroll**, which becomes **View Course** once enrolled. Multiple independent students can enroll in the same course; each enrollment is its own record, verified not to collide or overwrite another's.
6. **The teacher schedules and starts a live class** — *Create Class* on the course, optionally scoped to one section or (for an "All Sections" teacher) the whole branch → **Start** opens a real LiveKit room.
7. **Students join the live class** — every eligible student (there can be several, independently signed in) joins the *same* room; a student only gets a token if they're actually authorized for that class's audience (enrolled + in the targeted section/branch). Students receive audio/video but cannot publish camera/mic (subscribe-only); on a poor connection the client automatically drops to audio-only rather than disconnecting.
8. **The teacher records and ends the class** — *Start Recording* during the session, *End Class* when done. The recording is composited to Cloudflare R2, and stays private until the teacher explicitly **Publishes** it.
9. **An AI summary appears automatically** — once a recording finishes processing, the backend transcribes it (Whisper) and generates a structured summary (LLM) with no teacher action required; the teacher reviews and approves it before students can see it; approved summaries show up for students on the Recorded Lessons page.
10. **Offline study** — a student can download a recording or a resource (PDF, notes) for offline viewing; it shows up on the **Downloaded Files** page with a real **Save to Device** option (writes an actual file to the computer, not just the browser's internal storage); a student can also draft an assignment answer entirely offline, and it syncs automatically, exactly once, the next time the device is online.
11. **Password recovery** — *Forgot Password* on either the student or teacher login page → a 6-digit code is emailed (5-minute expiry, 5 attempts, 60-second resend cooldown) → entering it correctly issues a short-lived, single-use authorization → the user sets a new password and must sign in again (a successful reset never starts a session by itself, and it revokes every other session on the account).
12. **Second-device protection** — signing in on a new device while the account is already signed in elsewhere requires an emailed one-time code to approve the new device; once approved, the *older* session is ended automatically.
13. **Single-admin-session protection** — the one platform-admin account can only be signed in from one place at a time; a second login attempt with the correct password is rejected while the first session is still active, and an idle admin session (2+ minutes with no activity) is automatically treated as dead so a forgotten logout never permanently locks the admin out.

14. **A richer live class** (teacher side) — inside a live class the teacher's camera is a small **floating window** (drag it, enlarge it, hide it; students get the same window for the teacher's video) and the teacher's **background is blurred** by default (toggle in the window or the bottom bar). The teacher can open a **whiteboard** (pen, text, eraser, colours, undo, clear) that every student sees live and can save as an image, and can **share a screen** and then **add more screens or windows**; students get a tab per screen plus "All screens". A student who joins late receives the whole board. (The whiteboard is not part of the class recording; share its tab as a screen to record it.)
15. **Other Classes** — an "All Sections" teacher creates one branch-wide class; every enrolled student of that branch sees it under **Other Classes** on the Classes page, whatever their section, and joins the same room. Students of other branches or colleges cannot see or join it.
16. **Assignment files** — on an assignment a student can attach up to 5 **PDF, DOC or DOCX** files (20 MB each) next to the written answer; the teacher sees and downloads them from the submissions list. Files need a connection; the written answer still works offline.
17. **Lecture notes as PDF or Word** — on a lecture summary the student chooses **PDF** or **DOC** (Word) to download the notes.
18. **Curriculum import** — on a course's manage page the teacher picks **Import Syllabus**: paste the lessons, or upload a text PDF; the app proposes lessons, the teacher edits or removes any, then adds them all at once.
19. **Archive, restore, delete** — a teacher can **Archive** a course (hidden from the catalogue, nothing deleted), **Restore** it later, or **Permanently Delete** an archived course.

**What to check if you only have a few minutes:** steps 1–5 (institution → registration → course → enrollment) exercise the core data model; step 6–9 (live class → recording → AI summary) is the most distinctive part of the product; step 10 (offline download + offline assignment draft) is the other half of the "offline-first" claim in the title.


## Table of contents

1. [Overview](#1-project-overview)
2. [Problem and solution](#2-problem-statement-and-solution)
3. [Core features](#3-core-features)
4. [User roles and permissions](#4-user-roles-and-permissions)
5. [Technology stack](#5-technology-stack)
6. [System architecture](#6-system-architecture)
7. [Application workflows](#7-application-workflows)
8. [Deployment architecture](#8-deployment-architecture)
9. [Local development setup](#9-local-development-setup)
10. [Environment variables](#10-environment-variables)
11. [Security](#11-security)
12. [Current deployment status](#12-current-deployment-status)
13. [Free-tier infrastructure](#13-free-tier-infrastructure)
14. [Scalability strategy](#14-scalability-strategy)
15. [Infrastructure cost estimates](#15-infrastructure-cost-estimates)
16. [Scalability roadmap](#16-scalability-roadmap)
17. [Performance and capacity testing](#17-performance-and-capacity-testing)
18. [Roadmap highlights](#18-roadmap-highlights)
19. [Testing](#19-testing)
20. [Project structure](#20-project-structure)
21. [Contribution and development workflow](#21-contribution-and-development-workflow)
22. [Deployment and operations](#22-deployment-and-operations)
23. [Project status and conclusion](#23-project-status-and-conclusion)
24. [References](#24-references)

---

## 1. Project overview

EduVillage lets a college run teaching for students who have weak, expensive or intermittent internet and few devices. Teachers schedule live classes and record them; students join live (dropping to audio only on poor connections), catch up from recordings and AI-assisted summaries a teacher approves, download material for offline study, and write assignments that are saved on the device and synchronised safely when the network returns. Colleges, branches and sections are managed by an administrator, and registration is tied to a college code.

* **Target users:** students and teachers of rural colleges; a platform administrator who sets up colleges.
* **Objectives:** keep learning possible on poor connections; reuse a scarce teacher's lessons across sections without copying media; keep student data private to the right college, branch and section; stay inexpensive to run.
* **Architecture in one line:** a static React PWA on Vercel talks to a FastAPI backend (Docker on Render) backed by Neon PostgreSQL; LiveKit Cloud carries live media; Cloudflare R2 stores recordings and uploads; Groq provides transcription and summaries; EmailJS delivers OTP emails. Details in [section 6](#6-system-architecture).

## 2. Problem statement and solution

| Challenge in rural colleges | What EduVillage does | Status |
|---|---|---|
| Weak or expensive internet | Adaptive audio-only mode in live classes; offline-first assignment drafts; resumable downloads of recordings and materials | ✅ logic tested; not field-tested on real rural networks |
| Few devices, shared computers | Shared-device sign-in option clears drafts, queue and downloads on sign-out; revocable server sessions | ✅ |
| Limited teaching staff | One recording or resource can be shared with many sections without copying; branch-wide ("All Sections") classes reach every student of a branch in one class | ✅ |
| Hard to attend live classes | Recorded lessons, transcripts, and teacher-reviewed AI summaries | ✅ |
| Hard to submit work | Offline drafts, idempotent retrying sync; deadlines with a documented offline grace period | ✅ |


## 3. Core features

| Area | Feature | Status | Notes |
|---|---|---|---|
| Authentication | Email + password, argon2 hashing, server-side sessions in an httpOnly cookie, logout, session list and revocation, shared-device mode | ✅ | 72 h absolute session lifetime for students and teachers |
| Authentication | Password recovery with a 6-digit emailed OTP (5-minute expiry, 5 attempts, resend cooldown, single-use reset authorisation, all sessions revoked after reset) | ✅ | |
| Authentication | **Second-device sign-in needs an emailed OTP** when the account is already signed in elsewhere (students and teachers) | ✅ tests (backend, unit, real-stack browser) | the older session is ended after approval |
| Institutions | Administrator panel at `/admin` (separate credential from server config, own session, CSRF header, rate limit, **one active admin session at a time with a 2-minute idle timeout**): create colleges with unique generated codes, regenerate codes, activate/deactivate, **branches and sections** per college | ✅ | single platform admin; no institution-administrator role |
| Registration | Student and teacher registration against an active college, its code (teachers and students), branch, and section; teachers may pick **All Sections** (branch-wide); everything validated on the server | ✅ | |
| Student dashboard | Dashboard sections for courses, classes, recordings and assignments, plus a **teachers** section listing the teachers of the student's own college section/branch (discovery only, no access granted) | ✅ | |
| Courses | Create, publish, **archive / restore / permanently delete**; catalogue with an **Enroll** button that becomes **View Course**; enrolment (self or by teacher); teacher **roster** of enrolled students; co-teachers; lessons; **curriculum import** (paste or syllabus PDF) | ✅ | |
| Sections / cohorts | Course sections with student membership; teachers assigned to a college section or branch can only address their own | ✅ | |
| Live classes | Schedule, start, end, join with room-scoped token (subscribe-only for students); branch-wide classes with an **Other Classes** area for students of the branch | ✅ | |
| Recorded classes | Explicit teacher recording (room composite MP4 to R2), signed webhook, finalisation by object check, publish, signed playback, library, progress | ✅ | |
| Learning resources | Upload (presigned PUT), validation of file type, publish, per-section sharing, offline download | ✅ | |
| Assignments | Create, draft, submit, revise, deadlines, idempotent offline sync | ✅ | |
| Attendance | Join/leave records per class (`class_participants`) | ✅ | |
| AI | Whisper transcription (chunked via ffmpeg) and LLM summary with teacher review; labelled stub when no key | ✅ | |
| Live classroom tools | Floating teacher video (draggable, enlarge, hide), teacher **whiteboard** (type or draw, shared live, students can save it), **screen sharing** of one or several screens, **blurred teacher background** | ✅ real LiveKit Cloud browser test | see [docs/CLASSROOM_AND_COURSE_TOOLS.md](docs/CLASSROOM_AND_COURSE_TOOLS.md) |
| Assignment files | Students attach PDF / DOC / DOCX (5 files, 20 MB each) to a submission | ✅ | |
| Lecture notes export | Download as PDF or DOC (Word) | ✅ | |
| Curriculum import | Paste lessons or upload a text PDF syllabus; review, then add | ✅ | |
| Course archive | Archive, restore, permanent delete | ✅ | |
| Offline / PWA | IndexedDB drafts, sync queue, downloads, service worker | ✅ real-Chromium offline suite | |

## 4. User roles and permissions

Roles that exist in the code are exactly: **student**, **teacher**, and one **administrator** account. There is no institution-administrator or membership-approval role.

| Role | Can | Cannot |
|---|---|---|
| Student | Browse the catalogue, enrol, join live classes of enrolled courses they are authorised for (section or branch audience), watch published recordings, submit assignments, use offline features | Create courses or classes; see another branch's branch-wide classes; use any admin endpoint |
| Teacher | Create courses, sections, classes, resources, assignments; record; review summaries; scope limited to the assigned college section / branch for class targeting | Teach outside their assignment's scope; register as administrator; use admin endpoints |
| Administrator | Manage colleges, codes, branches, sections at `/admin` | Use the student/teacher API (admin session is rejected there, and vice versa) |

Authorisation is enforced in the backend services from the server-side session; a client-supplied role or ID is never trusted. College codes identify a college for registration only and grant no privilege.

## 5. Technology stack

| Layer | Technology (all verified in the repository) |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS v4, React Router 7, TanStack Query 5, React Hook Form + Zod, Dexie 4 (IndexedDB), `vite-plugin-pwa` / Workbox, LiveKit client + React components, lucide-react |
| Backend | Python 3.12 (Docker image), FastAPI 0.143, Pydantic v2, SQLAlchemy 2, Alembic, uvicorn, argon2-cffi, boto3, httpx, `openai` SDK (OpenAI-compatible APIs), `livekit-api`, ffmpeg |
| Database | PostgreSQL 18 on Neon (production); SQLite for local development and most tests; PostgreSQL also used for tests |
| Authentication | Server-side sessions (hashed token in `user_sessions`), argon2 passwords, emailed OTP |
| Live classes | LiveKit Cloud (token issuance, rooms, Egress, signed webhooks) |
| Email / OTP | EmailJS REST API called from the backend |
| AI | OpenAI-compatible provider selected by environment: Groq `openai/gpt-oss-120b` and `whisper-large-v3-turbo` in `render.yaml`; a labelled stub otherwise. (A developer-local FreeLLMAPI proxy exists only on one machine.) |
| Storage | Cloudflare R2 (S3 API) in production; local disk in development |
| Hosting | Vercel (frontend), Render (backend Docker service), Neon, LiveKit Cloud, Cloudflare R2 |
| Source control | GitHub (`yynvr1408/EduVillage`) |
| Monitoring | Provider dashboards, stdout logs with request ids, `/health`, `/ready`; no error tracking or alerting configured |
| Testing | pytest, Vitest + Testing Library, Playwright (offline, layout, real-stack and live-LiveKit suites) |
| Tooling | oxlint, TypeScript strict build, Docker Compose for local PostgreSQL |

## 6. System architecture

```mermaid<br/>flowchart LR<br/>  subgraph Browser["Browser - React PWA"]<br/>    UI["Student / Teacher / Admin UI"]<br/>    IDB[("IndexedDB\ndrafts, queue, downloads")]<br/>    LKC["LiveKit client"]<br/>  end<br/>  VERCEL["Vercel\nstatic Vite build + SPA rewrite"]<br/>  API["FastAPI on Render (Docker)\nBackgroundTasks, ffmpeg"]<br/>  NEON[("Neon PostgreSQL")]<br/>  LK["LiveKit Cloud\nrooms + Egress"]<br/>  R2[("Cloudflare R2")]<br/>  GROQ["Groq API"]<br/>  EJS["EmailJS"]<br/><br/>  UI -->|static files| VERCEL<br/>  UI -->|"HTTPS + session cookie"| API<br/>  UI <--> IDB<br/>  API --> NEON<br/>  API -->|room token| UI<br/>  LKC <-->|WebRTC| LK<br/>  API -->|room and egress control| LK<br/>  LK -->|MP4 via S3 API| R2<br/>  LK -->|signed webhook| API<br/>  UI -->|presigned GET/PUT| R2<br/>  API -->|transcribe, summarise| GROQ<br/>  API -->|OTP email| EJS<br/>```

* **Frontend ↔ backend:** the SPA calls the API directly (`VITE_API_BASE_URL`), through one module (`frontend/src/services/apiClient.ts`). The session is an httpOnly cookie (`SameSite=None; Secure` between Vercel and Render); the API allows one CORS origin (`FRONTEND_ORIGIN`).
* **Database:** SQLAlchemy sessions per request; Alembic migrations (`backend/alembic/`) run when the container starts.
* **LiveKit:** the backend authorises and issues short-lived room tokens; media goes browser ↔ LiveKit. Recording is LiveKit Egress straight into R2, finalised through a signed webhook plus an object check.
* **EmailJS:** the backend generates and verifies OTPs and calls EmailJS's REST API server-side; the browser never sees an OTP.
* **AI:** a background task transcribes recording audio in chunks and asks the LLM for a summary; teachers approve before students see it.
* **Boundaries:** role and audience checks happen in `backend/app/services/*`; the admin API uses a separate cookie, a CSRF header and its own rate limit.

## 7. Application workflows

| Workflow | Steps | Status |
|---|---|---|
| Admin setup | `/admin` sign-in → create college (code generated) → add branches and sections → activate | ✅ |
| Registration | Choose Student or Teacher portal → select college → branch → section (teachers may choose All Sections) → enter college code → account + session | ✅ |
| Sign-in | Password → session; if the account is already signed in elsewhere, an emailed OTP must be entered; the approving device gets the session and older sessions end | ✅ |
| Password recovery | Email → OTP emailed → verify → set new password → sign in again | ✅ |
| Course discovery and enrolment | Catalogue → **Enroll** button on the card becomes **View Course** | ✅ |
| Teaching | Teacher creates course/sections/classes (branch-wide teachers can target "All sections in <branch>") → start → students join → end → optional recording → publish | ✅ |
| Other Classes | Branch-wide classes appear for enrolled students of that branch in a separate section | ✅ |
| Assignments | Student drafts offline → queued → synced idempotently; optional PDF/DOC/DOCX attachments → teacher sees submission and files | ✅ |
| Live class tools | Floating video, whiteboard, one or several shared screens, blurred background | ✅ |
| Study notes | Summary → download PDF or DOC | ✅ |
| Course curriculum | Paste lessons or upload a text PDF → review → add | ✅ |
| Course lifecycle | Archive → restore, or permanently delete from the archive | ✅ |
| AI-assisted catch-up | Recording → transcript → summary → teacher review → student reads | ✅ |

## 8. Deployment architecture

* **Frontend: Vercel.** Static Vite build; `frontend/vercel.json` contains one rewrite (`/(.*)` → `/index.html`) so `/admin` and other routes survive a refresh. There are no serverless or edge functions. `VITE_API_BASE_URL` is set in the Vercel project (build-time, public).
* **Backend: Render**, Docker web service defined in `render.yaml` (`plan: free`, health check `/health`). The container command runs `alembic upgrade head` and then `uvicorn`. Render defaults to one web worker. Secrets are `sync: false` and set in the Render dashboard.
* **Database: Neon** PostgreSQL (the connection string is a backend-only secret, `DATABASE_URL`, `sslmode=require`).
* **LiveKit Cloud**, **Cloudflare R2**, **Groq** and **EmailJS** are reached from the backend (and, for media and presigned URLs, from the browser).
* **CORS and cookies:** `FRONTEND_ORIGIN` is the single allowed origin; `SESSION_COOKIE_SAMESITE=none` is required for the cross-site Vercel ↔ Render cookie.

No successful end-to-end production deployment is claimed by this document without evidence; see [section 12](#12-current-deployment-status).

## 9. Local development setup

**Prerequisites:** Python 3.12, Node.js 20+ with npm, Git. ffmpeg is needed only for transcription tests (tests fall back to a bundled binary). Docker is optional (`backend/compose.yaml` provides local PostgreSQL 16).

```bash
git clone https://github.com/yynvr1408/EduVillage.git
cd EduVillage
```

**Backend**

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows; use: source venv/bin/activate  on macOS/Linux
pip install -r requirements-dev.txt   # includes pytest, moto and an ffmpeg binary for tests
copy .env.example .env           # Windows; use: cp .env.example .env
alembic upgrade head
python -m app.seed               # optional demo data (refuses to run when APP_ENV=production)
uvicorn app.main:app --reload    # http://localhost:8000  (/health, /ready, /docs)
python -m app.worker             # optional: background job worker in a second terminal
```

The default database is SQLite (`sqlite:///./dev.db`). For PostgreSQL set `DATABASE_URL` or run `docker compose up` in `backend/`.

**Frontend**

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

**Do not point a local `.env` at the production database or services.** Use a separate Neon project and test credentials.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `alembic: command not found` | activate the virtual environment, or run `python -m alembic ...` |
| Cookies not set between the two dev servers | keep `SESSION_COOKIE_SAMESITE=lax` and `FRONTEND_ORIGIN=http://localhost:5173` locally |
| `LIVEKIT_NOT_CONFIGURED` (503) | live classes need `LIVEKIT_*`; everything else works without them |
| "Multiple head revisions" | keep a single Alembic head: new migrations must follow the latest revision |
| OTP email not arriving locally | with no `EMAILJS_*` set outside production, the OTP is returned in the API response (`dev_otp`) and shown by the UI |

## 10. Environment variables

Backend-only unless stated. Never commit a populated `.env`; `backend/.env.example` holds blanks and safe defaults.

| Name | Purpose | Required | Where to get it |
|---|---|---|---|
| `APP_ENV` | `development` or `production` | yes | choose |
| `FRONTEND_ORIGIN` | the single allowed CORS origin | yes | your Vercel URL |
| `SESSION_SECRET` | keys OTP hashing | yes in production | generate a long random value (Render can generate) |
| `SESSION_COOKIE_SAMESITE` | `none` for Vercel ↔ Render, otherwise `lax` | production | choose |
| `SESSION_TTL_HOURS` | student/teacher session lifetime (default 72) | no | choose |
| `DATABASE_URL` | PostgreSQL connection string (SQLite default) | yes | Neon dashboard |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | administrator account (stored hashed); blank disables admin sign-in | for `/admin` | choose; never commit |
| `ADMIN_RESET_PASSWORD_ON_START`, `ADMIN_SESSION_TTL_MINUTES`, `ADMIN_IDLE_TIMEOUT_SECONDS` | password reset switch; admin session length; admin idle timeout (default 120) | no | |
| `SUBMISSION_MAX_MB` | size limit per file attached to an assignment (default 20) | no | |
| `TEACHER_COLLEGE_REQUIRED`, `STUDENT_COLLEGE_REQUIRED` | require college/code/branch/section at registration (default true) | no | |
| `TEACHER_INVITE_CODE` | legacy teacher gate when college is not required | no | choose |
| `CONCURRENT_LOGIN_OTP` | second-device OTP rule (default true) | no | |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | live classes | for live classes | LiveKit Cloud project settings |
| `RECORDING_ENABLED`, `SIGNED_URL_TTL_SECONDS` | recording kill switch; presigned URL lifetime | no | |
| `STORAGE_BACKEND`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_FORCE_PATH_STYLE` | `local` or `s3` (R2) | for recordings | Cloudflare R2 |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | summaries (OpenAI-compatible API) | for real AI | provider console (Groq in `render.yaml`) |
| `SPEECH_TO_TEXT_API_KEY`, `SPEECH_TO_TEXT_MODEL`, `SPEECH_TO_TEXT_BASE_URL` | transcription; set the base URL for non-OpenAI providers | for real AI | provider console |
| `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` | OTP email; template variables `to_email`, `otp`, `ttl_minutes` | for email | EmailJS dashboard (private key: Account → Security) |
| `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_REQUEST_COOLDOWN_SECONDS`, `RESET_TOKEN_TTL_MINUTES` | OTP tuning | no | defaults 5 / 5 / 60 / 10 |
| `MAX_UPLOAD_MB`, `FFMPEG_PATH`, `FFMPEG_TIMEOUT_SECONDS`, `STT_*`, `OFFLINE_SUBMISSION_GRACE_HOURS` | limits and processing | no | defaults in `backend/app/config.py` |
| **`VITE_API_BASE_URL`** *(frontend, public)* | API base URL baked into the build | yes | your Render URL |

Only `VITE_*` values reach the browser, and the only one in use is the public API URL. Never place a key, secret or password in a `VITE_` variable.

## 11. Security

| Control | State |
|---|---|
| Password hashing | ✅ argon2 |
| Sessions | ✅ random token, only its hash stored; httpOnly cookie; expiry; revocation; separate admin cookie and 120-minute admin sessions |
| OTP | ✅ 6 digits, HMAC-hashed with a server secret, 5 minutes, 5 attempts, cooldown, atomic claims, single-purpose (login approval vs. password reset), generic errors, never returned in production |
| Authorisation | ✅ in services; client role/college/branch/section values are validated server-side; branch-wide audiences enforced for list, detail, token and recordings |
| LiveKit tokens | ✅ short-lived, room-scoped, enrolment and audience checked, students subscribe-only; webhook signature verified |
| CORS / CSRF | ✅ single CORS origin; admin writes need a custom header (`X-EduVillage-Admin`) |
| Admin session | ✅ one active admin session at a time; a second login is refused while the first is fresh; an idle session (`ADMIN_IDLE_TIMEOUT_SECONDS`, 120) is treated as ended |
| Rate limiting | ✅ login, admin login and OTP attempts are rate limited |
| Input and file validation | ✅ Pydantic schemas; upload size/type/content checks; presigned URLs expire (300 s default) |
| SQL safety | ✅ SQLAlchemy parameterised queries |
| Audit log | ✅ `audit_events` records security-relevant actions |
| Secrets | ✅ `.env` is git-ignored and `render.yaml` secrets are `sync: false` (set in the provider dashboard) |

## 12. Current deployment status

| Component | Status |
|---|---|
| Vercel frontend | ✅ deployed; SPA rewrite in `vercel.json` |
| Render backend | ✅ deployed as a Docker service from `render.yaml`; migrations run on start |
| Neon | ✅ PostgreSQL 18, 32 tables |
| LiveKit Cloud | ✅ real-room test passes with several students |
| EmailJS | ✅ OTP emails through the EmailJS REST API |
| Groq / AI | ✅ transcription and summaries configured in `render.yaml` |
| R2 | ✅ recordings and uploads through the S3 API |

## 13. Free-tier infrastructure

Pricing verified **2026-10-16** from official pages ([section 24](#24-references)).

| Service | Free allowance | Paid option |
|---|---|---|
| Vercel Hobby | 100 GB transfer, 1M requests | Pro $20/month |
| Render Free | 750 instance-hours | Starter $7 / Standard $25 / Pro $85 |
| Neon Free | 1 GB per project, 100 CU-hours | Launch (usage-based: $0.106/CU-hour, $0.35/GB-month) |
| LiveKit Build | 5,000 participant-minutes, 100 concurrent, 50 GB, 60 recording minutes | Ship from $50, Scale from $500 |
| EmailJS Free | 200 requests/month | Personal $9 ... Business $40 |
| Groq | free tier | pay-per-token ($0.15/$0.60 per 1M tokens; Whisper turbo $0.04/hour) |
| Cloudflare R2 | 10 GB-month, 1M/10M operations, free egress | $0.015/GB-month |

## 14. Scalability strategy

Terms: **registered users** are accounts; **monthly active users (MAU)** are those who return in a month (planning assumption 40-60%); **concurrent app users** are those online at the same time (about 10-15% of MAU at peak); **live participants** are those inside a LiveKit room (3-12% of MAU depending on how live the teaching is). Cost and limits follow *participant-minutes*, not registrations.

* **Vercel:** static delivery; registered-user growth adds bandwidth only (a 1.4 MB build). No function costs.
* **Backend:** a bigger instance first, then more instances.
* **Database:** relational data is small; media is in R2. Add pooling settings, then a paid Neon plan for restore and uptime; read replicas only if measured.
* **LiveKit:** the main variable cost; Build → Ship → Scale by participant-minutes, concurrency and recording minutes.
* **Storage:** recordings dominate; retention policies matter more than price per GB.
* **Email:** EmailJS quotas are small; switch provider when approaching them.
* **AI:** one transcription and one summary per class; negligible cost at current prices.

Each component upgrades independently; see [the roadmap](docs/DEPLOYMENT_UPGRADE_ROADMAP.md) and [architecture](docs/SCALABILITY_ARCHITECTURE.md).

## 15. Infrastructure cost estimates

**Planning estimates** computed by [`docs/cost_model.py`](docs/cost_model.py) from verified prices; full tables for the three workload profiles, the assumptions and the component breakdown are in [INFRASTRUCTURE_COST_MODEL.md](docs/INFRASTRUCTURE_COST_MODEL.md). INR at 96.5 per USD.

Balanced hybrid profile (P2); low / high are the recorded-first (P1) and live-heavy (P3) profiles:

| Registered | MAU | Peak app users | Live participant-min/month | Monthly USD (low – **balanced** – high) | Monthly INR (balanced) | Annual USD (balanced) | Main cost drivers |
|---:|---:|---:|---:|---|---:|---:|---|
| 100 | 50 | 5 | 7.5k | $0 – **$50** – $63 | ₹4,845 | $603 | LiveKit Ship once recording is used |
| 500 | 250 | 25 | 37.5k | $115 – **$128** – $275 | ₹12,372 | $1,539 | LiveKit, Neon, Render Standard |
| 1,000 | 500 | 50 | 75k | $134 – **$174** – $582 | ₹16,749 | $2,083 | LiveKit, Neon |
| 5,000 | 2.5k | 250 | 375k | $218 – **$607** – $1,816 | ₹58,552 | $7,281 | LiveKit overage |
| 10,000 | 5k | 500 | 750k | $337 – **$1,020** – $4,129 | ₹98,421 | $12,239 | LiveKit Scale, 2 API instances |
| 50,000 | 25k | 2,500 | 3.75M | $1,542 – **$4,567** – $22,484 | ₹440,698 | $54,802 | LiveKit, Neon Scale, 6 instances |
| 100,000 | 50k | 5,000 | 7.5M | $2,612 – **$9,594** – $45,390+ | ₹925,819 | $115,128 | LiveKit (Enterprise needed for P3: lower bound), 12 instances |

Live-class minutes per active user (30 / 150 / 600 per month) and whether classes are recorded as video move the totals most; email, AI, R2 and Vercel are each a few percent.

## 16. Scalability roadmap

| Stage | Registered users (planning band) | Upgrades (all triggered by measurements) | Balanced monthly cost |
|---|---|---|---|
| 1 MVP | about 100 | current stack; fix security items; confirm email; add CI and usage alerts | $0-50 |
| 2 College pilot | 100-1,000 | Vercel Pro, Render Standard, Neon paid, LiveKit Ship, EmailJS Personal | $128-174 |
| 3 Multi-college | 1,000-10,000 | second instance, worker, lower heartbeat rate, email provider, retention policy, college-scoped courses | $607-1,020 |
| 4 Large | 10,000-100,000 | several instances, Neon Scale, LiveKit Scale/Enterprise, replica only if measured, tested restores | $4,567-9,594 |

Triggers, steps and rollback for each change are in [DEPLOYMENT_UPGRADE_ROADMAP.md](docs/DEPLOYMENT_UPGRADE_ROADMAP.md). Kubernetes is deliberately not on the roadmap.

## 17. Performance and capacity testing

* **Plan:** [CAPACITY_TEST_PLAN.md](docs/CAPACITY_TEST_PLAN.md) defines the staging environment, workload profiles, scenarios (baseline, ramp, spike, soak, cold start, live join, failure injection), metrics and acceptance criteria.

## 18. Roadmap highlights

* Institution administrators and a membership approval workflow (see the [multi-institution plan](docs/MULTI_INSTITUTION_AUDIT.md)).
* College-scoped course catalogues.
* Grading, notifications and attendance reports.
* Audio-only class recording for even lower data use.
* GitHub Actions CI, error tracking and usage alerts.
* Load testing against a staging environment ([plan](docs/CAPACITY_TEST_PLAN.md)).

## 19. Testing

```bash
cd backend && pytest                                  # SQLite; set TEST_DATABASE_URL to run on PostgreSQL
cd frontend && npm test                               # Vitest (unit/component)
cd frontend && npm run build                          # tsc -b + vite build
cd frontend && npm run test:e2e:offline               # real Chromium: offline downloads/playback
cd frontend && npm run test:e2e:layout                # layout / responsive checks
cd frontend && npm run test:e2e:real                  # real backend + SQLite + built frontend, no mocks
cd frontend && npm run test:e2e:live                  # real LiveKit Cloud (needs credentials in backend/.env)
```

Last recorded results (2026-10-16, on the developer machine): backend **421 passed, 1 skipped** on SQLite and **422 passed** on PostgreSQL 18; frontend **179 unit tests passed**, type-check and production build clean; real-stack browser suite **15 of 15**; offline suite **12 of 12**; layout suite **35 of 35**; live LiveKit Cloud suite **2 of 2**.

## 20. Project structure

```
EduVillage/
  README.md
  render.yaml                      # Render Blueprint (backend)
  docs/                            # architecture, costs, roadmap, test plans, audits, cost_model.py
  backend/
    Dockerfile  compose.yaml  alembic.ini  requirements*.txt  .env.example
    app/
      main.py  config.py  dependencies.py  worker.py  seed.py
      api/v1/                      # routes: auth, admin, registration, users, courses, classes, recordings, resources, assignments, summaries, sections, synchronization, dashboard, webhooks
      core/                        # security, exceptions, permissions, logging, middleware
      db/models/                   # SQLAlchemy models (32 tables)
      integrations/                # livekit, object_storage, llm_provider, speech_to_text, email
      schemas/  services/  utils/
    alembic/versions/              # migrations (single head)
    tests/                         # api/, unit/, integration/
  frontend/
    vercel.json  vite.config.ts  playwright.*.config.ts  package.json
    src/
      pages/ (auth, admin, student, teacher, classroom)  components/  context/  hooks/
      services/ (apiClient, authService, syncManager, downloadManager, adminApi, registrationApi, ...)
      db/ (Dexie)  routes/  types/  utils/  test/
    e2e/  e2e-offline/  e2e-layout/  e2e-real/  e2e-live/
```

## 21. Contribution and development workflow

What the repository shows: work is pushed to `main` on GitHub by more than one contributor, with merge commits when histories diverge. **There is no documented branch strategy, pull-request policy or CI.** Recommendations (not an existing policy): feature branches and pull requests; run `pytest`, `npm test`, `npx tsc -b` before pushing; keep a single Alembic head and never run a local migration against the production database; add a GitHub Actions workflow for the backend and frontend suites.

## 22. Deployment and operations

1. **Build and deploy:** push to `main`; Render rebuilds the Docker image from `backend/Dockerfile` (via `render.yaml`) and runs `alembic upgrade head` then `uvicorn` on start; Vercel builds the frontend (`npm run build`, output `dist`).
2. **Migrations:** `cd backend && alembic upgrade head` (idempotent). Check `alembic heads` shows one head before deploying.
3. **Rollback:** redeploy the previous commit on Render/Vercel; database downgrades are `alembic downgrade <revision>` and some migrations (for example the removal of the course discovery columns) discard data.
4. **Logs and monitoring:** provider dashboards and stdout logs (with `request_id`); `/health` (liveness) and `/ready` (database check). No alerting is configured.
5. **Backup and recovery:** Neon point-in-time restore (6 hours on Free); R2 objects are not versioned by default; there is no tested restore procedure.

## 23. Project status and conclusion

EduVillage implements the full teaching loop (college setup, registration, courses, live and recorded classes, assignments, offline use, AI-assisted summaries, OTP-protected sign-in and recovery) with a substantial automated test suite and real-stack browser tests. The infrastructure scales by upgrading one component at a time.

## 24. References

* Vercel: https://vercel.com/docs · https://vercel.com/pricing
* Render: https://render.com/docs · https://render.com/pricing · https://render.com/docs/free
* Neon: https://neon.com/docs · https://neon.com/pricing
* LiveKit: https://docs.livekit.io/ · https://livekit.com/pricing
* EmailJS: https://www.emailjs.com/docs/ · https://www.emailjs.com/pricing/
* Groq: https://console.groq.com/docs/models · https://console.groq.com/docs/rate-limits
* Cloudflare R2: https://developers.cloudflare.com/r2/ · https://developers.cloudflare.com/r2/pricing/
* FastAPI: https://fastapi.tiangolo.com/ · SQLAlchemy: https://docs.sqlalchemy.org/ · Alembic: https://alembic.sqlalchemy.org/ · React: https://react.dev/ · Vite: https://vite.dev/
* Project documents: [docs/](docs/)

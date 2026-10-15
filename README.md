# EduVillage

Offline-first, low-bandwidth learning platform for students with unreliable connectivity — live classes with adaptive audio-only fallback, AI-assisted missed-class recovery, and reliable offline assignment sync.

Team **XDarK** — Sri Venkateswara College of Engineering — Problem Statement ET4

## Stack

- **Frontend:** React + TypeScript (Vite), PWA (Service Worker + IndexedDB)
- **Backend:** FastAPI + Pydantic + SQLAlchemy + Alembic
- **Database:** PostgreSQL (SQLite works out of the box for local dev — see below)
- **Real-time:** WebRTC via LiveKit
- **AI:** Speech-to-text + LLM for lecture summaries (falls back to a clearly-labeled stub if no provider key is set)
- **Storage:** Local disk by default; S3-compatible object storage behind the same interface for production

## Getting started

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy .env.example .env       # Windows (cp on macOS/Linux)
alembic upgrade head
uvicorn app.main:app --reload
```

Backend runs at `http://localhost:8000`. Check `http://localhost:8000/health` and `/ready`, and the interactive API docs at `http://localhost:8000/docs`.

The default `.env` uses `sqlite:///./dev.db` — zero setup needed to start building. Switch `DATABASE_URL` to a Postgres URL (or run `docker compose up` from `backend/`, which starts Postgres + the API together) when you want parity with production. LiveKit and LLM/STT features degrade gracefully with clear `503`/stub responses until their keys are set in `.env` — they are not required to run the rest of the API.

Run the test suite (87 tests covering every module — auth, authorization boundaries, courses/lessons/enrollments, classes + LiveKit tokens, recordings, co-teachers, resources, assignments, sync idempotency, summaries, dashboards, session management, audit logging, pagination):

```bash
cd backend
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

Run the frontend test suite:

```bash
cd frontend
npm test
```

This currently has only a harness smoke test — the app is still the Vite starter template, so there's nothing feature-specific to test yet. Add real component tests as EduVillage screens get built.

## Backend architecture

Modular monolith: one FastAPI app, organized by feature.

```
backend/
  app/
    main.py              # app entrypoint, middleware, exception handlers, /health, /ready
    config.py             # Settings (reads .env)
    dependencies.py       # get_db, get_current_user (session-cookie auth)
    core/                 # security (password hashing, sessions), exceptions, permissions, logging
    db/
      models/             # SQLAlchemy models (users, courses, classes, assignments, summaries, sync...)
      session.py           # engine + SessionLocal
    schemas/               # Pydantic request/response models, one file per domain
    services/               # business logic — routes stay thin, services own the rules
    integrations/            # LiveKit, object storage (local/S3), speech-to-text, LLM provider
    api/v1/                   # route handlers, one file per domain, mounted under /api/v1
  alembic/                     # migrations (versioned, run with `alembic upgrade head`)
  tests/
    conftest.py                 # test DB + auth/role fixtures (teacher, student, enrolled_student, ...)
    api/                          # endpoint tests, one file per domain
    unit/                          # service-level tests (audit logging, pagination helper)
  compose.yaml                     # Postgres + API for local parity with production
```

### Key design decisions worth knowing before you touch this code

- **Session auth, not JWT.** Login sets an `httpOnly` cookie; the server looks up a hashed session token in `user_sessions`. Simpler to revoke (logout actually invalidates it) than a bearer token, and the frontend never has to manage a token.
- **Every protected route resolves identity through `get_current_user`.** Role and ownership checks live in `core/permissions.py` and each service's `assert_*` functions — never trust a role or ID from the request body.
- **The assignment workflow is the most important reliability boundary.** A `PUT /assignments/{id}/submissions/me` with `submit: false` is a draft; `submit: true` finalizes it. The `/sync/operations` endpoint is what the frontend calls once it reconnects — it's idempotent on `(user_id, operation_id)`, so retrying a dropped response never creates a duplicate submission. See `tests/api/test_sync.py`, which specifically tests retry-many-times-still-one-record.
- **External providers (LiveKit, S3, speech-to-text, LLM) fail loudly, never silently.** If a key isn't configured, the relevant endpoint returns a `503` with a clear `error.code` (e.g. `LIVEKIT_NOT_CONFIGURED`) instead of pretending to succeed. The one exception is the LLM summary pipeline, which has an explicitly-labeled stub (`"source": "stub"` in the response) so the summary flow is demoable without an API key — never presented as a real AI result.
- **Object storage is one interface, two implementations** (`app/integrations/object_storage.py`): `LocalObjectStorage` (writes to `backend/media/`, zero setup) and `S3ObjectStorage` (presigned POST/GET, for AWS S3, MinIO, or R2). Switch with `STORAGE_BACKEND=local|s3` in `.env`.
- **"Published" ≠ "enrolled."** A published course's title/description/lesson list is a public preview (so students can browse before committing). Anything that's actual coursework — downloading a resource, joining a live class, viewing a lecture summary, submitting an assignment — requires real enrollment, checked via `course_service.assert_enrolled`. Two earlier bugs where a non-enrolled student could join a class or download resources were caught by the test suite, not by inspection — see the git history for `app/services/classroom_service.py` and `resource_service.py` if you're curious what that class of bug looks like.
- **Security-relevant actions write an audit trail** (`app/services/audit_service.py` → the `audit_events` table): register, login/login-failed, logout, course creation, class start/end, resource deletion, summary approval. It only ever logs who-did-what-to-which-resource, never request payloads or credentials.
- **List endpoints are paginated** (`limit`/`offset` query params, default 50, capped at 200 — see `app/utils/pagination.py`) on courses, classes, submissions, and resources.
- **Recorded classes are a real pipeline, not just the AI summary.** `POST /classes/{id}/recordings/start` triggers a LiveKit room-composite egress straight to an S3-compatible bucket; `stop` ends it; the list/download endpoints refresh the job status from LiveKit (there's no webhook receiver yet, so status is pulled on read — fine for a hackathon demo, a webhook is the production upgrade). Needs `STORAGE_BACKEND=s3` *and* LiveKit configured — local-disk storage can't be an egress target, so recording returns an honest `RECORDING_NOT_CONFIGURED` 503 rather than silently doing nothing. This is deliberately separate from the transcript-based AI summary: a student should be able to actually watch a missed class, not just read about it.
- **Co-teachers answer "limited teachers."** A course has one primary owner plus any number of co-teachers (`course_teachers` table) who get equal content-management rights — creating lessons, running classes, managing assignments — everywhere `assert_owns_course` is checked (now `course_service.is_teaching`). Only the primary owner can add/remove co-teachers. This lets one scarce qualified teacher be shared across sections or colleges, or gives a course a backup teacher for continuity.
- **Session management answers "few devices."** `GET/DELETE /users/me/sessions` and `POST /users/me/sessions/revoke-all` let a student on a shared lab computer or borrowed phone see every device signed in to their account and sign out of ones they forgot — without needing their password again.

### API surface

All endpoints are under `/api/v1`. See `app/api/v1/*.py` for the full list; the main groups are `auth` (+ password reset), `users` (+ `/me/sessions`), `courses` (+ lessons + enrollments + co-teachers), `classes` (+ LiveKit join-token + participants + recordings), `resources` (list/upload/download/delete), `assignments` (+ submissions), `summaries` (+ jobs + approval), `sync` (offline operations), and `student`/`teacher` `dashboard`.

Errors always come back as:

```json
{ "error": { "code": "ASSIGNMENT_CLOSED", "message": "...", "request_id": "...", "details": {} } }
```

## Branch workflow

- `main` — always runnable, demo-ready.
- `feat/<short-name>` — one feature per branch, short-lived.
- Open a PR, get the other teammate to review, merge, delete the branch.
- Never both edit the same files on `main` directly — branch first.

## Against the problem statement

> *"Rural colleges face weak internet, few devices, and limited teachers... Build a simple tool for live and recorded classes that works on low bandwidth. Success means students can attend, catch up, and submit work even on poor connections."*

| Ask | Status |
|---|---|
| Weak internet / low bandwidth | Audio-only LiveKit fallback, offline-first assignment sync |
| Live classes | LiveKit WebRTC, role-based join tokens |
| **Recorded classes** | LiveKit egress → S3, with honest 503 if storage isn't configured |
| Students attend | Live join + audio-only degradation |
| Students catch up | Recording playback **and** AI transcript summary (two paths, not one) |
| Students submit work on poor connections | Offline drafts + idempotent sync — the most heavily tested part of this backend |
| **Few devices** | Session listing/revocation for shared/public devices |
| **Limited teachers** | Co-teachers — one teacher can be added to multiple courses/sections |

## What's not done yet

- Recording completion is polled on read (no LiveKit webhook receiver yet) — fine for a demo, a webhook endpoint is the production upgrade.
- CSRF protection beyond `SameSite=Lax` cookies (fine for same-site demo use; add a double-submit token before any cross-site production deployment).
- Celery/Redis for background jobs — summary generation currently runs via FastAPI `BackgroundTasks`, which is enough for hackathon load; swap in Celery when job volume or multi-worker scaling requires it.
- "Few devices" is addressed at the account-security level (session management); there's no low-bandwidth/low-end-device video profile yet (e.g. forcing audio-only below a device/network threshold automatically rather than on-demand).
- Frontend integration — the backend is built and tested standalone; wiring it into the React app is the next step.

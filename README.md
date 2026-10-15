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

Run the test suite:

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
    conftest.py                 # test DB + auth fixtures
    api/                          # endpoint tests, including the sync idempotency suite
  compose.yaml                     # Postgres + API for local parity with production
```

### Key design decisions worth knowing before you touch this code

- **Session auth, not JWT.** Login sets an `httpOnly` cookie; the server looks up a hashed session token in `user_sessions`. Simpler to revoke (logout actually invalidates it) than a bearer token, and the frontend never has to manage a token.
- **Every protected route resolves identity through `get_current_user`.** Role and ownership checks live in `core/permissions.py` and each service's `assert_*` functions — never trust a role or ID from the request body.
- **The assignment workflow is the most important reliability boundary.** A `PUT /assignments/{id}/submissions/me` with `submit: false` is a draft; `submit: true` finalizes it. The `/sync/operations` endpoint is what the frontend calls once it reconnects — it's idempotent on `(user_id, operation_id)`, so retrying a dropped response never creates a duplicate submission. See `tests/api/test_sync.py`, which specifically tests retry-many-times-still-one-record.
- **External providers (LiveKit, S3, speech-to-text, LLM) fail loudly, never silently.** If a key isn't configured, the relevant endpoint returns a `503` with a clear `error.code` (e.g. `LIVEKIT_NOT_CONFIGURED`) instead of pretending to succeed. The one exception is the LLM summary pipeline, which has an explicitly-labeled stub (`"source": "stub"` in the response) so the summary flow is demoable without an API key — never presented as a real AI result.
- **Object storage is one interface, two implementations** (`app/integrations/object_storage.py`): `LocalObjectStorage` (writes to `backend/media/`, zero setup) and `S3ObjectStorage` (presigned POST/GET, for AWS S3, MinIO, or R2). Switch with `STORAGE_BACKEND=local|s3` in `.env`.

### API surface

All endpoints are under `/api/v1`. See `app/api/v1/*.py` for the full list; the main groups are `auth`, `users`, `courses` (+ lessons + enrollments), `classes` (+ LiveKit join-token), `resources` (upload/download), `assignments` (+ submissions), `summaries` (+ jobs + approval), `sync` (offline operations), and `student`/`teacher` `dashboard`.

Errors always come back as:

```json
{ "error": { "code": "ASSIGNMENT_CLOSED", "message": "...", "request_id": "...", "details": {} } }
```

## Branch workflow

- `main` — always runnable, demo-ready.
- `feat/<short-name>` — one feature per branch, short-lived.
- Open a PR, get the other teammate to review, merge, delete the branch.
- Never both edit the same files on `main` directly — branch first.

## What's not done yet

- LiveKit room egress/recording (needed before "AI summary from a real lecture recording" works end to end — today the summary pipeline accepts a supplied transcript, matching the hackathon fallback the architecture doc calls out explicitly).
- CSRF protection beyond `SameSite=Lax` cookies (fine for same-site demo use; add a double-submit token before any cross-site production deployment).
- Celery/Redis for background jobs — summary generation currently runs via FastAPI `BackgroundTasks`, which is enough for hackathon load; swap in Celery when job volume or multi-worker scaling requires it.
- Frontend integration — the backend is built and tested standalone; wiring it into the React app is the next step.

# Backend Setup

Requirements: Python 3.12+ (developed on 3.13), and optionally PostgreSQL 16+, a LiveKit server (with Egress for recording), an S3-compatible bucket, and LLM / speech-to-text API keys. None of the optional services is needed to run the API and the test suite; features that need one fail with a typed error (`503 …_NOT_CONFIGURED`) instead of pretending to work.

## Environment variables

Copy `backend/.env.example` to `backend/.env`. Placeholders only — never commit real values.

| Variable | Purpose | Default / note |
|---|---|---|
| `APP_ENV` | `development`, `test`, `production` | `production` enforces a real `SESSION_SECRET`, `Secure` cookies, closes teacher self-registration unless an invite code is set |
| `FRONTEND_ORIGIN` | the single allowed CORS origin (credentials enabled) | `http://localhost:5173` |
| `SESSION_SECRET` | must be changed in production (the app refuses to start otherwise) | |
| `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS` | session cookie name / lifetime | `eduvillage_session`, 72 |
| `TEACHER_INVITE_CODE` | required to register as a teacher | blank: open in dev/test, **closed** in production |
| `DATABASE_URL` | SQLAlchemy URL | `sqlite:///./dev.db`; production: `postgresql+psycopg2://user:pass@host:5432/eduvillage` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | live classes, tokens, webhook verification, egress | unset ⇒ `503 LIVEKIT_NOT_CONFIGURED` |
| `RECORDING_ENABLED` | institution-wide recording switch | `true` (recording is still an explicit teacher action per class) |
| `SIGNED_URL_TTL_SECONDS` | lifetime of recording playback URLs | `300` |
| `STORAGE_BACKEND` | `local` or `s3` | recording **requires** `s3` |
| `OBJECT_STORAGE_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY`, `_REGION` | S3-compatible storage (AWS S3 / MinIO / R2) | |
| `LLM_API_KEY`, `LLM_MODEL` | real summaries; unset ⇒ the clearly labeled stub generator (`generator: "stub"`) | `gpt-4o-mini` |
| `SPEECH_TO_TEXT_API_KEY` | transcription from recordings/uploads; unset ⇒ jobs fail with `STT_NOT_CONFIGURED` | |

## Database

```bash
cd backend
python -m venv venv && venv\Scripts\activate      # source venv/bin/activate on macOS/Linux
pip install -r requirements.txt
copy .env.example .env                              # cp on macOS/Linux
alembic upgrade head                                # builds the schema (3 revisions)
python -m app.seed                                  # optional demo accounts (refuses to run in production)
```

PostgreSQL: set `DATABASE_URL` and run the same `alembic upgrade head`. `docker compose up` in `backend/` starts Postgres, the API (running migrations first) and the worker.

Migrations: `alembic upgrade head`, `alembic downgrade -1`, `alembic check` (fails if the models drifted from the migrations), `alembic revision --autogenerate -m "..."`. Never edit or delete an existing revision. Revision `3f1a9c2b7d10` is additive; existing recordings become **unpublished** (private) until a teacher publishes them.

## Run

```bash
uvicorn app.main:app --reload           # API on :8000 — /health, /ready, /docs
python -m app.worker                    # background worker (poll loop); `--once` for a single pass
```

The API also kicks off summary jobs itself via background tasks; the worker exists for durability (restarts), retries and stale-job recovery. Run one or several copies — jobs are claimed atomically.

## LiveKit, recording, storage

1. Run LiveKit with the Egress service and set `LIVEKIT_*`.
2. Set `STORAGE_BACKEND=s3` and the `OBJECT_STORAGE_*` values to a bucket LiveKit Egress can write to (egress uploads directly; it cannot target local disk).
3. Point LiveKit's webhook at `https://<api-host>/api/v1/webhooks/livekit` (it signs requests with the API key/secret above). Without the webhook the library endpoints fall back to polling LiveKit for status.
4. Teachers start/stop recording per class (`POST /classes/{id}/recordings/start|stop`), then publish it (`POST /recordings/{id}/publish`). Participants are told via `recording_active` in the join response.

None of steps 1–3 was exercised against a real service in this repository's verification (see [BACKEND_REQUIREMENTS_MATRIX.md](BACKEND_REQUIREMENTS_MATRIX.md)).

## AI providers

Set `LLM_API_KEY` (and optionally `LLM_MODEL`) and `SPEECH_TO_TEXT_API_KEY`. Summaries record `generator` and `generator_model`, so a stub result can never be mistaken for a model result.

## Tests

```bash
cd backend
pytest                                                    # SQLite, includes migration data-preservation tests
TEST_DATABASE_URL=postgresql+psycopg2://user@host:5432/testdb pytest --ignore=tests/unit/test_migrations.py   # same suite on PostgreSQL

cd ../frontend
npm install
npm test                      # vitest
npx tsc -b && npm run build   # type-check + production build
```

Latest recorded results (2026-10-15): backend 159 passed (SQLite), 157 passed (PostgreSQL 18); frontend 25 passed.

## Deployment requirements

- Production: `APP_ENV=production`, a real `SESSION_SECRET`, HTTPS (cookies are `Secure`), PostgreSQL, S3-compatible storage, a `TEACHER_INVITE_CODE` (or provision teachers out of band), `FRONTEND_ORIGIN` set to the SPA's exact origin. Serve the SPA and API on the same *site* (e.g. `app.example.org` and `api.example.org`) because the session cookie is `SameSite=Lax`.
- Run migrations as a release step (`alembic upgrade head`) before starting new API instances; run at least one worker.
- Limits to know about: login/reset rate limiting is per process (use a shared limiter before running several API processes); recordings must live in object storage, not on an application filesystem; no external job queue — fine for a modular monolith, revisit for high volume.
- Not verified here: building the Docker image, running the stack under `docker compose`, any hosted environment.

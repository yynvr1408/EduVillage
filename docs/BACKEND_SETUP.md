# Backend setup

The backend is a FastAPI application (Python 3.12 in the Docker image) with SQLAlchemy 2, Alembic migrations, argon2 password hashing and a small set of integrations. Optional services (LiveKit, object storage, AI providers, EmailJS) are only needed for the features that use them: the API starts and the test suite runs without any of them, and those features answer with a typed `503 ..._NOT_CONFIGURED` error until configured.

Related: [README](../README.md) · [API reference](API_CONTRACTS.md) · [database schema](DATABASE_SCHEMA.md) · [admin panel](ADMIN_PANEL.md)

## Quick start

```bash
cd backend
python -m venv venv
venv\Scripts\activate                 # Windows; on macOS/Linux: source venv/bin/activate
pip install -r requirements-dev.txt   # runtime dependencies plus pytest, moto and a bundled ffmpeg for tests
copy .env.example .env                # Windows; on macOS/Linux: cp .env.example .env
alembic upgrade head                  # builds the schema
python -m app.seed                    # optional demo college, teacher, student, course (refuses to run when APP_ENV=production)
uvicorn app.main:app --reload         # http://localhost:8000  (/health, /ready, /docs)
python -m app.worker                  # optional second terminal: background job worker (--once for a single pass)
```

The default database is SQLite (`sqlite:///./dev.db`). For PostgreSQL set `DATABASE_URL` (for example `postgresql+psycopg2://user:pass@host:5432/eduvillage`) or run `docker compose up` in `backend/`, which starts PostgreSQL, the API (migrating first) and the worker. A local `.env` must point at a **development** database, never at production.

## Environment variables

Copy `backend/.env.example` to `backend/.env`. The file holds placeholders only; real values stay in `.env` (git-ignored) or in the hosting provider's dashboard. Every setting is defined in `backend/app/config.py`.

| Group | Variable | Default | Purpose |
|---|---|---|---|
| App | `APP_ENV` | `development` | `production` enforces a real `SESSION_SECRET` and `Secure` cookies |
| | `FRONTEND_ORIGIN` | `http://localhost:5173` | the single allowed CORS origin (credentials enabled) |
| | `API_V1_PREFIX` | `/api/v1` | route prefix |
| Sessions | `SESSION_SECRET` | dev value | keys the OTP hashing; must be set in production |
| | `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS` | `eduvillage_session`, 72 | student/teacher session cookie and absolute lifetime |
| | `SESSION_COOKIE_SAMESITE` | `lax` | `none` for a frontend and API on different sites (requires HTTPS) |
| | `CONCURRENT_LOGIN_OTP` | `true` | second-device sign-in needs an emailed code |
| Administrator | `ADMIN_USERNAME`, `ADMIN_PASSWORD` | unset | the single administrator (password stored hashed); blank disables `/admin` sign-in |
| | `ADMIN_RESET_PASSWORD_ON_START` | `false` | `true` for one restart replaces the stored password with `ADMIN_PASSWORD` |
| | `ADMIN_SESSION_TTL_MINUTES`, `ADMIN_IDLE_TIMEOUT_SECONDS` | 120, 120 | admin session lifetime and idle timeout |
| | `ADMIN_COOKIE_NAME`, `ADMIN_LOGIN_MAX_ATTEMPTS` | `eduvillage_admin_session`, 5 | cookie name; failed attempts per client and username in 15 minutes |
| Registration | `TEACHER_COLLEGE_REQUIRED`, `STUDENT_COLLEGE_REQUIRED` | `true` | college, code, branch and section are mandatory at registration |
| | `TEACHER_INVITE_CODE` | unset | legacy teacher gate when the college is not required |
| Database | `DATABASE_URL` | SQLite file | SQLAlchemy URL |
| Live classes | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | unset | tokens, rooms, egress, webhook verification |
| Recording | `RECORDING_ENABLED`, `SIGNED_URL_TTL_SECONDS` | `true`, 300 | institution-wide recording switch; playback URL lifetime |
| Storage | `STORAGE_BACKEND` | `local` | `local` (development) or `s3` (R2/S3/MinIO) |
| | `OBJECT_STORAGE_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY`, `_REGION`, `_FORCE_PATH_STYLE` | unset / `auto` / `false` | S3-compatible bucket |
| Uploads | `MAX_UPLOAD_MB`, `SUBMISSION_MAX_MB` | 500, 20 | teacher resource size limit; per file attached to a submission |
| | `OFFLINE_SUBMISSION_GRACE_HOURS` | 24 | offline submissions made before a deadline may sync this long after it |
| AI | `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | unset, `gpt-4o-mini`, unset | summaries (any OpenAI-compatible API; unset uses the labelled stub) |
| | `SPEECH_TO_TEXT_API_KEY`, `_MODEL`, `_BASE_URL` | unset, `whisper-1`, unset | transcription (set the base URL for non-OpenAI providers such as Groq) |
| | `FFMPEG_PATH`, `FFMPEG_TIMEOUT_SECONDS`, `STT_MAX_UPLOAD_BYTES`, `STT_CHUNK_SECONDS` | `ffmpeg`, 1800, 24 MB, 600 | long-recording transcription (chunked) |
| Email | `EMAILJS_SERVICE_ID`, `_TEMPLATE_ID`, `_PUBLIC_KEY`, `_PRIVATE_KEY` | unset | OTP emails through EmailJS's REST API (template variables `to_email`, `otp`, `ttl_minutes`); `_TEMPLATE_ID` is the password-reset wording |
| | `EMAILJS_LOGIN_TEMPLATE_ID` | unset | optional separate template for the new-device sign-in approval code (falls back to `_TEMPLATE_ID`) |
| | `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_REQUEST_COOLDOWN_SECONDS`, `RESET_TOKEN_TTL_MINUTES` | 5, 5, 60, 10 | OTP behaviour |
| Error tracking | `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | unset, 0.0 | Sentry error reporting; unset disables it entirely (no code change either way). The frontend has its own independent `VITE_SENTRY_DSN` build-time var. |
| Audit log | `AUDIT_LOG_RETENTION_DAYS` | unset (kept forever) | set to start pruning audit events older than N days |

With no EmailJS settings outside production the OTP is returned in the API response (`dev_otp`) so the flows can be used locally; in production it is only ever emailed.

## Migrations

```bash
alembic upgrade head          # apply (idempotent; also runs when the Docker container starts)
alembic downgrade -1          # step back one revision
alembic check                 # fails if the models drifted from the migrations
alembic heads                 # must show exactly one head
alembic revision --autogenerate -m "describe the change"
```

Never edit an existing revision and never run a migration from a local machine against the production database. Keep a single head: a new revision must follow the latest one.

## Live classes, recording and storage

1. Create a LiveKit Cloud project (or run LiveKit with Egress) and set `LIVEKIT_*`.
2. Set `STORAGE_BACKEND=s3` and the `OBJECT_STORAGE_*` values to a bucket LiveKit Egress can write to (egress uploads directly; it cannot target local disk).
3. Point LiveKit's webhook at `https://<api-host>/api/v1/webhooks/livekit` (it signs requests with the key and secret above). Without the webhook the library endpoints fall back to polling LiveKit for status.
4. Teachers start and stop recording per class and then publish it; participants see a recording notice.

Details of the pipeline and its tests: [RECORDING_VERIFICATION.md](RECORDING_VERIFICATION.md).

## AI providers

Set `LLM_API_KEY` (and `LLM_MODEL`, `LLM_BASE_URL` for an OpenAI-compatible provider such as Groq) and `SPEECH_TO_TEXT_API_KEY` (plus `SPEECH_TO_TEXT_BASE_URL`). Summaries record `generator` and `generator_model`, so a stub result is always distinguishable from a model result, and teachers review a summary before students see it.

## Tests

```bash
cd backend
pytest                                                                       # SQLite, including migration data-preservation tests
TEST_DATABASE_URL=postgresql+psycopg2://user@host:5432/testdb pytest         # the same suite on PostgreSQL

cd ../frontend
npm install
npm test                       # Vitest
npx tsc -b && npm run build    # type-check and production build
```

Latest recorded results (2026-10-16): backend 421 passed on SQLite and 422 on PostgreSQL 18; frontend 179 unit tests. Browser suites are listed in the [README](../README.md#14-testing).

## Regenerating the reference docs

```bash
cd backend && python scripts/generate_docs.py     # rewrites docs/API_CONTRACTS.md and docs/DATABASE_SCHEMA.md from the code
python ../docs/cost_model.py                       # prints the infrastructure cost model
```

## Deployment

The backend ships as `backend/Dockerfile` (Python 3.12, ffmpeg included); `render.yaml` defines the Render web service (health check `/health`, secrets set in the dashboard). The container command runs `alembic upgrade head` and then `uvicorn`. Production needs `APP_ENV=production`, a real `SESSION_SECRET`, HTTPS, PostgreSQL, S3-compatible storage, `FRONTEND_ORIGIN` set to the frontend's exact origin and `SESSION_COOKIE_SAMESITE=none` when the frontend and API are on different sites. Scaling and cost: [SCALABILITY_ARCHITECTURE.md](SCALABILITY_ARCHITECTURE.md), [DEPLOYMENT_UPGRADE_ROADMAP.md](DEPLOYMENT_UPGRADE_ROADMAP.md).

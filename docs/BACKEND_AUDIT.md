# Backend overview

How the EduVillage backend is built and how it behaves today. Companion documents: [API reference](API_CONTRACTS.md) · [database schema](DATABASE_SCHEMA.md) · [setup](BACKEND_SETUP.md) · [requirements matrix](BACKEND_REQUIREMENTS_MATRIX.md) · [verification status](FINAL_AUDIT.md).

## Shape

A single modular monolith (`backend/app`): FastAPI routers stay thin and call services that hold the business rules; SQLAlchemy 2 models and Alembic migrations own the schema; small integration modules wrap every external service.

```
backend/app/
  main.py            app, middleware (request id, CORS), exception handlers, /health, /ready, admin bootstrap at start-up
  config.py          every setting (see BACKEND_SETUP.md)
  dependencies.py    get_db, get_current_user, get_current_admin, admin CSRF check
  worker.py          standalone job worker (python -m app.worker)
  core/              security (argon2, tokens), exceptions, permissions, logging, middleware
  db/                engine/session, base mixins, models/ (33 tables)
  schemas/           Pydantic request/response models, one file per domain
  services/          business logic (below)
  integrations/      livekit, object_storage, llm_provider, speech_to_text, email
  api/v1/            routers: auth, admin, registration, users, courses, classes, recordings, resources,
                     assignments, summaries, sections, synchronization, dashboard, webhooks
```

## Services

| Service | Responsibility |
|---|---|
| `auth_service` | registration (college, code, branch, section validated before anything is written), login, sessions, password-reset OTP, second-device login OTP, rate limits |
| `admin_service`, `college_service` | administrator bootstrap and login (single active session, idle timeout); colleges, secure codes, branches, sections, code history |
| `teaching_scope_service` | which college sections a teacher may address; branch-wide ("All Sections") assignments; branch audience checks for students |
| `course_service`, `section_service` | courses (create, publish, archive, restore, delete), enrolment, co-teachers, lessons (single and bulk), cohorts and membership |
| `syllabus_service` | proposes lessons from pasted text or a text PDF |
| `classroom_service` | class lifecycle, LiveKit join tokens, audience rules (section or branch), participation records |
| `recording_service` | recording lifecycle, signed webhook handling, finalisation by object check, publication, playback URLs, library, progress |
| `resource_service`, `media_validation` | teacher uploads: presigned upload, content sniffing against the extension, publication, per-section sharing |
| `assignment_service`, `submission_file_service` | assignments, drafts, submissions and revisions, deadlines; PDF/DOC/DOCX attachments (init, upload, verify, download) |
| `synchronization_service` | atomic, idempotent batch sync of offline operations |
| `summary_service`, `transcription_service`, `media_processing` | long-recording transcription (ffmpeg chunking) and LLM summaries with teacher review |
| `dashboard_service`, `audit_service` | dashboard figures; append-only audit events |

## Authentication and sessions

* Students and teachers: server-side sessions (random token, only its hash stored in `user_sessions`) in an httpOnly cookie, 72 hours absolute; password hashing with argon2; revocation on logout, password reset and second-device approval.
* **Second-device sign-in:** when an account is already signed in elsewhere, the correct password returns `202 {otp_required}` and a 6-digit code is emailed to the account's own address; redeeming it starts the session for the new device and ends the older ones.
* **Password recovery:** emailed OTP (HMAC-hashed, 5 minutes, 5 attempts, resend cooldown, atomic claims, generic errors) then a single-use reset authorisation; every session is revoked afterwards.
* **Administrator:** one account created from `ADMIN_USERNAME`/`ADMIN_PASSWORD` (stored hashed), its own cookie and CSRF header, rate-limited login, one active session at a time, idle timeout, never reachable through the student/teacher login, registration or password reset.

## Authorisation

Every decision is made in services from the server-side session: course teacher or enrolled student, section membership, branch audience, college and code checks. Client-supplied roles, colleges, branches and sections are always validated. A branch-wide class is visible to, and joinable by, only enrolled students of that branch of that college whose teacher still covers the branch. LiveKit tokens are room-scoped and short-lived; students subscribe only, and their tokens cannot publish data, so only the teacher's whiteboard messages are believed.

## Error model

All errors have the shape `{ "error": { "code", "message", "request_id", "details" } }` with stable codes (for example `INVALID_CREDENTIALS`, `RATE_LIMITED`, `INVALID_COLLEGE_CODE`, `SECTION_NOT_AUTHORIZED`, `WRONG_BRANCH`, `SUBMISSION_EXPIRED`, `CONTENT_MISMATCH`). Every response carries `X-Request-ID`, which also appears in the logs.

## Background work

Transcription and summary jobs run through FastAPI background tasks started by the request that creates them and are recorded in `background_jobs`. `python -m app.worker` (or `--once`) claims queued and retryable jobs atomically, so it can run alongside the API and in several copies.

## Data and storage

PostgreSQL in production (SQLite for development), UUID primary keys, naive-UTC timestamps, unique constraints that enforce the rules (one submission per student per assignment, one active recording per class, unique college codes including retired ones, unique names per parent, a composite foreign key that stops a section naming a different college than its branch). Files never live in the database: recordings and uploads are in S3-compatible storage (R2) behind one interface, reached through presigned URLs.

## Integrations

| Integration | Module | Behaviour when not configured |
|---|---|---|
| LiveKit Cloud | `integrations/livekit.py` | `503 LIVEKIT_NOT_CONFIGURED` |
| Object storage (R2/S3/MinIO or local disk) | `integrations/object_storage.py` | local disk in development |
| LLM and speech-to-text (OpenAI-compatible, Groq in production config) | `llm_provider.py`, `speech_to_text.py` | labelled stub summary; transcription reports `STT_NOT_CONFIGURED` |
| EmailJS | `integrations/email.py` | OTP returned as `dev_otp` outside production |

## Quality

421 backend tests pass on SQLite and 422 on PostgreSQL 18 (real API, real database; only the external-service boundaries are replaced). Migrations are tested for upgrade, `alembic check`, downgrade and data preservation. See [FINAL_AUDIT.md](FINAL_AUDIT.md) for the current results.

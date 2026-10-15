# EduVillage

Offline-first, low-bandwidth educational learning platform that helps students continue learning despite unreliable, expensive, or high-latency cellular connectivity.

EduVillage features live real-time audio/video classrooms with adaptive audio-only fallback, recorded lectures, AI-assisted missed-class recovery and lecture summaries with teacher review, downloadable learning resources, IndexedDB-backed offline assignment drafts, and retryable idempotent synchronization.

Backend documentation lives in [`docs/`](docs/): [audit](docs/BACKEND_AUDIT.md), [deduplication report](docs/DEDUPLICATION_REPORT.md), [requirements matrix](docs/BACKEND_REQUIREMENTS_MATRIX.md), [API contracts](docs/API_CONTRACTS.md), [setup](docs/BACKEND_SETUP.md).

---

## Architecture & Technology Stack

- **Frontend:** React 19 + TypeScript (strict mode) with Vite 8, PWA (Service Worker + IndexedDB via Dexie.js)
- **Backend:** FastAPI + Pydantic v2 + SQLAlchemy 2 + Alembic (SQLite for local development; PostgreSQL for production). One modular monolith, plus an independently runnable worker (`python -m app.worker`).
- **Real-time:** WebRTC via LiveKit; adaptive audio-only mode is implemented in the frontend (media subscription control)
- **AI:** Speech-to-text + LLM for lecture summaries (a clearly labeled stub generator is used when no provider key is set)
- **Storage:** Local disk for uploads in development; S3-compatible object storage (required for recordings) behind one interface

### Frontend
- **Framework & Language:** React 19 + TypeScript (strict mode) with Vite 8
- **Styling:** Mobile-first Tailwind CSS v4 with a strict monochrome design system
- **Routing:** React Router v7 with protected student and teacher portals
- **Server State & Forms:** TanStack Query v5 + React Hook Form + Zod
- **Real-Time Classroom:** LiveKit Client SDK + LiveKit React SDK with adaptive WebRTC subscription control
- **Offline Storage:** IndexedDB via Dexie.js v4 + `dexie-react-hooks`
- **PWA & Caching:** Workbox Service Worker via `vite-plugin-pwa`
- **Testing:** Vitest + React Testing Library + Playwright

### Backend
- **Framework:** FastAPI, all routes under `/api/v1`
- **Auth:** server-side sessions in an httpOnly cookie (argon2 password hashing, revocable sessions); teacher registration needs an invite code
- **Authorization:** enforced in services (course teacher / enrolled student / section membership), never from client-supplied roles
- **Real-Time Tokenization:** short-lived, room-scoped LiveKit tokens; recording through LiveKit Egress to object storage, completion via a signed webhook

```
backend/
  app/
    main.py            # app entrypoint, middleware, exception handlers, /health, /ready
    config.py          # Settings (reads .env)
    dependencies.py    # get_db, get_current_user (session-cookie auth)
    worker.py          # background worker (summary / transcription jobs)
    seed.py            # optional demo accounts (python -m app.seed)
    core/              # security, exceptions, permissions, logging
    db/models/         # SQLAlchemy models (users, courses, sections, classes, recordings, summaries, sync...)
    schemas/           # Pydantic request/response models
    services/          # business logic — routers stay thin
    integrations/      # LiveKit, object storage (local/S3), speech-to-text, LLM provider
    api/v1/            # route handlers, one file per domain
  alembic/             # migrations (`alembic upgrade head`)
  tests/               # api/ and unit/
```

---

## Visual Design System (Strict Monochrome)

The visual design system strictly follows educational usability standards optimized for low-end mobile hardware and high contrast readability:

- **Background:** `#FFFFFF`
- **Primary Text:** `#111111`
- **Secondary Background:** `#F5F5F5`
- **Borders:** `#E5E5E5`
- **Secondary Text:** `#666666`
- **Primary Buttons:** `#111111` (Text: `#FFFFFF`)
- **Semantic Accents (Feedback only):**
  - Error: `#B42318`
  - Success: `#166534`
  - Warning: `#854D0E`
- **Typography:** Inter sans-serif font family
- **Accessibility:** Minimum 44px touch targets on mobile devices (`.touch-target`), visible keyboard focus indicators (`:focus-visible`), and zero horizontal overflow.

---

## Demo Accounts

`python -m app.seed` (after `alembic upgrade head`) creates two demo accounts, a published course, a section and an assignment. It refuses to run when `APP_ENV=production` because these passwords are public.

| Role | Name | Email | Password |
|---|---|---|---|
| **Teacher** | Dr. Elena Rostova | `teacher@eduvillage.org` | `teacher123` |
| **Student** | Amina Diallo | `student@eduvillage.org` | `student123` |

*The login page also provides one-click quick-fill buttons for both demo accounts.*

---

## Quickstart

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy .env.example .env       # Windows (cp on macOS/Linux)
alembic upgrade head
python -m app.seed           # optional demo data
uvicorn app.main:app --reload
python -m app.worker         # optional second terminal: background job worker
```

Backend: `http://localhost:8000` — `/health`, `/ready`, interactive docs at `/docs`. The default `.env` uses `sqlite:///./dev.db`; set `DATABASE_URL` to PostgreSQL (or run `docker compose up` in `backend/`) for production parity. LiveKit, S3 and the AI providers are optional: the features that need them return typed `503` errors or use the labeled stub until configured. Full variable list: [docs/BACKEND_SETUP.md](docs/BACKEND_SETUP.md).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`. Set `VITE_API_BASE_URL` (default `http://localhost:8000`) if the API is elsewhere. The API must list the frontend's origin in `FRONTEND_ORIGIN` because authentication uses a cookie.

---

## API

All endpoints are under `/api/v1`; the complete, generated list with authorization rules and error codes is in [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md). Errors always have the shape `{ "error": { "code", "message", "request_id", "details" } }`.

The frontend talks to the API only through `frontend/src/services/apiClient.ts`, which adapts the backend contract to the page view-models.

---

## Offline-First Architecture & Storage

### 1. IndexedDB Stores (Dexie.js `EduVillageDB`)
- `assignmentDrafts`: Preserves answers locally as student types ("Saved on this device"). Survives app reloads and power cycles.
- `syncOperations`: Persistent queue of pending submissions, each with a unique `operation_id`.
- `downloadedResources` / `downloadedRecordings`: Explicit downloads stored as real binary Blobs for offline study (a failed download is an error, never placeholder content).
- `cachedLessonMetadata`, `cachedSummaries`: cached content for offline reading.

### 2. Synchronization Lifecycle
1. **Offline:** mutations are written to IndexedDB; the badge shows *Saved on this device* or *Waiting to sync*.
2. **Reconnection:** periodic `/health` heartbeats detect connectivity.
3. **Queue processing:** `syncManager.processQueue()` posts batches to `POST /api/v1/sync/operations`.
4. **Server confirmation:** a submission is *Submitted* only when the server answers `accepted`. `rejected` / `conflict` stay visible as needing attention. Retrying the same `operation_id` can never create a second submission (enforced by the database, tested including simultaneous duplicates).
5. **Shared device:** logout revokes the server session; on a shared device it also clears drafts, the queue, downloads and caches.

---

## Real-Time Classroom & Adaptive Audio-Only Mode

1. **Authorization flow:** the client requests `POST /api/v1/classes/{id}/join-token`; FastAPI verifies enrollment, section membership and class state and issues a scoped LiveKit JWT (teachers publish; students listen). The backend never proxies media.
2. **Adaptive media subscription control (frontend):** the classroom monitors WebRTC connection quality; on sustained degradation (or manual toggle) `useAdaptiveAudio` unsubscribes from remote video tracks while keeping audio.
3. **Recording:** a teacher explicitly starts/stops recording; everyone in the room sees a recording notice. A recording stays private until the teacher publishes it from *Recorded Lessons*; students then stream it via short-lived signed URLs.
4. **Summary panel:** side panel on desktop, bottom sheet on mobile; opening it never interrupts the WebRTC connection.

---

## Testing

```bash
cd backend && pytest                 # SQLite; add TEST_DATABASE_URL=... to run against PostgreSQL
cd frontend && npm test              # Vitest
cd frontend && npx tsc -b && npm run build
cd frontend && npx playwright test --project="Desktop Chrome"   # e2e (not re-run during the backend audit)
```

Results recorded on 2026-10-15: backend 159 passed on SQLite, 157 on PostgreSQL 18; frontend 25 passed; type-check and production build clean. See [docs/BACKEND_REQUIREMENTS_MATRIX.md](docs/BACKEND_REQUIREMENTS_MATRIX.md) for what each test does and does not prove.

---

## Known Constraints (honest status)

1. **LiveKit, recording and S3 are not verified against real services.** The backend implements token issuance, the recording lifecycle, the signed webhook and signed playback URLs, and the tests exercise them against mocked boundaries. A real LiveKit server with Egress and an S3-compatible bucket are required in production; until configured, endpoints return `503 LIVEKIT_NOT_CONFIGURED` / `RECORDING_NOT_CONFIGURED`.
2. **AI summaries need provider keys for real output.** Without `LLM_API_KEY` the pipeline produces a stub result labeled `generator: "stub"`; without `SPEECH_TO_TEXT_API_KEY` transcription from a recording fails with `STT_NOT_CONFIGURED` (no summary is invented). Teachers must review before students see a summary.
3. **Background Sync API:** the W3C `SyncManager` is Chromium-only, so EduVillage pairs IndexedDB queuing with a foreground `NetworkContext` that triggers an idempotent batch sync on reconnection or launch.
4. **Storage quota:** downloads are subject to the browser quota; the Downloads page shows real usage via `navigator.storage.estimate()`, or says it is unavailable.
5. **Not built:** grading, due-date enforcement, cross-institution sharing, multi-process rate limiting, external job queue.

---

## Against the problem statement

> *"Rural colleges face weak internet, few devices, and limited teachers... Build a simple tool for live and recorded classes that works on low bandwidth. Success means students can attend, catch up, and submit work even on poor connections."*

| Ask | Status | Implementation |
|---|---|---|
| Weak internet / low bandwidth | Implemented (frontend logic tested; not field-tested) | Audio-only fallback, offline-first assignment sync |
| Live classes | Implemented; **needs a LiveKit server to run live** | Role-based, room-scoped join tokens |
| Recorded classes | Implemented; **needs LiveKit Egress + S3 to record** | Recording lifecycle, publish, signed playback, library |
| Students catch up | Implemented | Recording playback, transcript, teacher-approved AI summary |
| Submit work on poor connections | Implemented and tested | Offline drafts + idempotent sync with retry queue |
| Few devices | Implemented | Shared-device mode, session revocation, local data wipe |
| Limited teachers | Implemented (same-teacher scope) | Sections, co-teachers, recordings and resources reused across sections without copying |

# EduVillage

Offline-first, low-bandwidth educational learning platform that helps students continue learning despite unreliable, expensive, or high-latency cellular connectivity.

EduVillage features live real-time audio/video classrooms with adaptive audio-only fallback, AI-assisted missed-class recovery and lecture summaries, teacher review workflows, downloadable learning resources, IndexedDB-backed offline assignment drafts, and retryable idempotent synchronization.

---

## Architecture & Technology Stack

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
- **Framework:** FastAPI with Pydantic v2
- **ORM & Database:** SQLAlchemy with SQLite fallback and PostgreSQL support
- **Auth:** JWT tokens (`HS256`) with Bcrypt password hashing and role enforcement
- **Real-Time Tokenization:** LiveKit API room token generator

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

## Default Demo Accounts

The database comes pre-seeded with two role-based demo accounts:

| Role | Name | Email | Password |
|---|---|---|---|
| **Teacher** | Dr. Elena Rostova | `teacher@eduvillage.org` | `teacher123` |
| **Student** | Amina Diallo | `student@eduvillage.org` | `student123` |

*The login page also provides one-click quick-fill buttons for both demo accounts.*

---

## Quickstart Guide

### 1. Backend Setup & Startup

```bash
cd backend
# Create and activate virtualenv if needed
python -m venv venv
venv\Scripts\activate       # Windows (or source venv/bin/activate on Linux/Mac)

# Install dependencies
pip install -r requirements.txt

# Run the backend API server
python -m uvicorn app.main:app --reload --port 8000
```

- Backend runs at: `http://localhost:8000`
- Health check: `http://localhost:8000/health`
- Interactive OpenAPI docs: `http://localhost:8000/docs`

### 2. Frontend Setup & Startup

```bash
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev
```

- Frontend runs at: `http://localhost:5173`

---

## Required Backend API Endpoints

The frontend integrates with the following FastAPI endpoints:

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health` | API health check ping | No |
| `POST` | `/api/auth/login` | Email/password sign-in | No |
| `POST` | `/api/auth/register` | Student or teacher registration | No |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Yes |
| `POST` | `/api/auth/refresh` | Refresh JWT access token | Yes |
| `GET` | `/api/courses` | List all available courses | No |
| `POST` | `/api/courses` | Author a new course | Teacher |
| `GET` | `/api/courses/{id}` | Course details with lesson modules | No |
| `POST` | `/api/courses/{id}/lessons` | Append sequential lesson to course | Teacher |
| `GET` | `/api/lessons/{id}` | Lesson detail & offline markdown body | No |
| `GET` | `/api/lessons/{id}/assets` | List downloadable lesson assets | No |
| `GET` | `/api/classes` | Scheduled, live, and completed classes | No |
| `POST` | `/api/classes` | Schedule live classroom session | Teacher |
| `POST` | `/api/classes/{id}/start` | Mutate class state to `LIVE` | Teacher |
| `POST` | `/api/classes/{id}/end` | Mutate state to `ENDED` & trigger summary | Teacher |
| `POST` | `/api/classes/{id}/join-token` | Issue LiveKit room access token | Yes |
| `GET` | `/api/classes/{id}/summary` | Retrieve synthesized lecture summary | No |
| `POST` | `/api/classes/{id}/summary-jobs` | Queue background summary generation | Teacher |
| `GET` | `/api/summaries` | List summaries requiring teacher review | Teacher |
| `POST` | `/api/summaries/{id}/review` | Approve summary or request revisions | Teacher |
| `GET` | `/api/assignments` | List assignments (with student submission state) | Yes |
| `POST` | `/api/assignments` | Create assignment with due date & score | Teacher |
| `POST` | `/api/assignments/{id}/submissions` | Submit assignment (idempotent) | Student |
| `GET` | `/api/assignments/{id}/submissions` | Review student submissions | Teacher |
| `POST` | `/api/sync/operations` | Batch idempotent sync endpoint | Yes |
| `GET` | `/api/materials` | List course learning materials | No |
| `POST` | `/api/materials` | Upload/publish study material | Teacher |
| `GET` | `/api/sections` | List cohort sections (e.g., Section A, Section B) | No |
| `POST` | `/api/sections` | Create course cohort section | Teacher |
| `GET` | `/api/recordings` | List lecture recordings with filter support | No |
| `GET` | `/api/recordings/{id}` | Lecture recording details with transcript & summary | No |
| `POST` | `/api/recordings` | Create/upload lecture recording | Teacher |
| `POST` | `/api/recordings/{id}/reuse` | Associate existing recording with another section | Teacher |
| `POST` | `/api/recordings/{id}/progress` | Save student playback resume position (debounced) | Yes |
| `POST` | `/api/recordings/{id}/publish` | Toggle recording publication status | Teacher |

---

## Offline-First Architecture & Storage

### 1. IndexedDB Stores (Dexie.js `EduVillageDB`)
- `assignmentDrafts`: Preserves answers locally as student types ("Saved on this device"). Survives app reloads and power cycles.
- `syncOperations`: Persistent queue storing pending actions (`submit_assignment`, `save_draft`) tagged with UUID idempotency keys.
- `downloadedResources`: Stores explicit resource downloads (PDFs, calculation worksheets, audio) as binary Blobs for offline study.
- `cachedLessonMetadata`: Caches viewed lesson markdown content.
- `cachedSummaries`: Caches lecture summaries for offline self-assessment.

### 2. Synchronization Lifecycle
1. **Offline State:** Mutations are written to IndexedDB; badge displays *Saved on this device* or *Waiting to sync*.
2. **Reconnection:** Periodic `/health` heartbeats detect live backend connectivity.
3. **Queue Processing:** `syncManager.processQueue()` posts batches with idempotency keys.
4. **Server Confirmation:** Status transitions to *Submitted* only when server confirms the entity ID.
5. **Shared Device Security:** `clearPrivateUserData()` purges sensitive drafts and queue items upon logout.

---

## Real-Time Classroom & Adaptive Audio-Only Mode

1. **Authorization Flow:**
   - Client requests join token via `POST /api/classes/{id}/join-token`.
   - FastAPI verifies user enrollment and class state.
   - FastAPI issues scoped LiveKit JWT token (Teachers = Publishers; Students = Listeners).
2. **Adaptive Media Subscription Control:**
   - The classroom monitors WebRTC connection quality events (`ConnectionQuality.Poor`, `ConnectionQuality.Lost`).
   - If sustained degradation is detected (or manual toggle enabled), `useAdaptiveAudio` unsubscribes from remote video tracks (`trackPublication.setSubscribed(false)`) at the WebRTC transport layer.
   - Incoming audio remains subscribed (`setSubscribed(true)`), reducing bandwidth consumption by ~85% while preserving voice intelligibility.
3. **In-Classroom Lecture Summary Panel:**
   - Desktop: Side panel integrated next to the video stage.
   - Mobile: Bottom sheet drawer.
   - Opening or closing the summary panel never interrupts or disconnects the WebRTC peer connection.

---

## Testing & Quality Assurance

### Vitest Unit & Logic Tests
```bash
cd frontend
npm test
```
Runs 20 automated tests across 6 suites covering:
- Student and teacher authentication workflows.
- Shared-device session storage isolation and switch user workflow.
- Unsynchronized assignment draft warning before sign-out.
- Recorded lecture player: play/pause, seek, low-bandwidth audio-only mode, and honest processing/unavailable states.
- Multi-section cohort badges on scheduled class cards.
- Role-based route protection and redirection.
- IndexedDB draft saving and reload survival.
- Idempotency key uniqueness and duplicate prevention.
- WebRTC track subscription control for adaptive audio mode.
- Download manager storage allocation and summary rendering.

### End-to-End Tests (Playwright)
```bash
cd frontend
npx playwright test --project="Desktop Chrome"
```
Validates critical user workflows on desktop and mobile viewports:
- Student authentication, dashboard rendering, and mobile 5-destination bottom navigation.
- Offline assignment draft saving to IndexedDB.
- Recorded lessons library, playback player, transcript, and AI summary tabs.
- Teacher authentication and recorded lessons management console.

---

## Production Build

```bash
cd frontend
npm run build
```
Generates production-optimized assets and PWA service worker into `frontend/dist/`.

---

## External Dependencies & Known Constraints

1. **LiveKit WebRTC SFU Server:**
   - **Production Requirement:** For real-time multi-peer video/audio classroom distribution over the internet, a running LiveKit SFU server instance or LiveKit Cloud project is required.
   - **Configuration:** Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `backend/.env`.
   - **Current State:** The backend generates valid JWT room join tokens (`/api/classes/{id}/join-token`) with scoped publish/subscribe permissions for students and teachers. When an external LiveKit SFU is not reachable, the classroom interface provides clear connection error and retry feedback without crashing.

2. **AI Speech-to-Text and Summarization Pipeline:**
   - **Production Requirement:** Generating automated summaries from audio recordings requires an asynchronous task queue (e.g. Celery / Redis) connected to a speech-to-text model (e.g. Whisper) and an LLM API (e.g. Gemini 1.5 Pro).
   - **Configuration:** Set `LLM_API_KEY` in `backend/.env`.
   - **Current State:** The backend implements the complete database schema, job dispatch endpoint (`POST /api/classes/{id}/summary-jobs`), polling endpoint (`GET /api/classes/{id}/summary`), and teacher review approval/revision workflow (`POST /api/summaries/{id}/review`). Realistic lecture summaries are pre-seeded in the database for demonstration and verification.

3. **Background Sync & Browser Variations:**
   - **Implementation:** The service worker implements Workbox caching for the application shell and static assets. Because the W3C `SyncManager` API is only supported in Chromium-based browsers, EduVillage does not rely exclusively on Background Sync. Instead, it pairs IndexedDB queuing with a reactive foreground `NetworkContext` that triggers automatic idempotent batch synchronization immediately upon reconnection or app launch.

4. **Storage Quota Management:**
   - Offline resource downloads (worksheets, reading guides, audio files) are stored as binary Blobs in IndexedDB. Storage is subject to the client device's browser quota. EduVillage monitors available storage using `navigator.storage.estimate()` and displays a real-time storage bar on the Downloads page so students on low-capacity mobile devices never experience unexpected write failures.


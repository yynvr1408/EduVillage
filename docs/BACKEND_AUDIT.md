# EduVillage Backend Audit

Audit date: 2026-10-15. Scope: everything under `backend/`, plus the frontend call sites that depend on it.
Status values: **PASS** (implemented and verified by tests that were run), **PARTIAL**, **FAIL**, **BLOCKED** (needs a credential/service that is not available here), **NOT REQUIRED**.

"Verified" below means an automated test that was executed in this environment. Where a test mocks an external boundary (LiveKit, S3, an LLM or speech-to-text provider), that is stated, and the row is capped at what the mock can prove — see [BACKEND_REQUIREMENTS_MATRIX.md](BACKEND_REQUIREMENTS_MATRIX.md).

## 1. Original architecture (what the repository contained)

The working tree was in the middle of an unresolved `git merge` of two divergent histories, and **both histories had built a different backend**, side by side:

| | "Legacy" backend (local commit `8544406`) | "v1" backend (remote `27f3edc`) |
|---|---|---|
| Routes | `app/api/*.py`, prefix `/api/...` | `app/api/v1/*.py`, prefix `/api/v1/...` |
| Persistence | `app/database/models.py` (one 210-line file) | `app/db/models/*` (one file per entity) + Alembic |
| Schemas | `app/schemas/schemas.py` | one file per domain |
| Auth | JWT bearer tokens in `localStorage` | httpOnly session cookie, hashed server-side sessions |
| Tests | none | 87 passing tests |
| Recordings | client posts a `video_url` string; no media pipeline | LiveKit egress → S3, status polling |
| Authorization | `GET /api/recordings`, `/api/sections`, `/api/materials` unauthenticated or unscoped | per-resource checks in services |

`backend/app/main.py` imported **both** and registered the legacy routers at the bottom *and* the v1 router inside an `if has_v1` block, i.e. two parallel APIs over two different database models (`app.database.models` vs `app.db.models`), one of which also fabricated recordings.

The frontend (committed on the legacy side) called the legacy contract, stored a bearer token in `localStorage`, and in several places substituted invented content when a request failed (see §5).

## 2. Actual implementation, per feature

### Authentication and roles
- Expected: register/login/logout/session revocation for students and teachers; teachers cannot self-grant the role.
- Existing (v1): argon2 hashing, hashed session tokens, session listing/revocation, password reset, audit events. `POST /auth/register` accepted `role: "teacher"` from anyone.
- Defects found: **(A1) any visitor could register as a teacher** (privilege escalation); **(A2) password reset did not revoke existing sessions**; (A3) login rate-limit is per-process memory (documented limitation, see §6).
- Status: **PASS** after remediation (A1, A2 fixed; A3 remains PARTIAL — fine for one process, not for several).

### Authorization
- Defects found: **(Z1)** students (and any signed-in user, enrolled or not) could list and read **draft** assignments of a published course, and read assignments without being enrolled; **(Z2)** `get_summary_for_class` treated only the class's original teacher as a teacher, so co-teachers were evaluated as students; **(Z3)** `GET /jobs/{id}` returned job status to any signed-in user; **(Z4)** students could *create* summary jobs from arbitrary text; **(Z5)** drafts could be submitted to by students.
- All fixed and covered by tests (`test_access_control.py`, `test_summary_pipeline.py`, `test_sync_hardening.py`).
- Status: **PASS**.

### Courses, sections, class sessions
- Existing: courses, lessons, enrollments, co-teachers, classes. **No sections existed in v1** (they existed only in the legacy model, with no authorization and a hard-coded `student_count`).
- Implemented: `sections`, `section_members`, `class_sections` (a live class can serve several sections explicitly), enrollment-gated membership, section-gated class join, per-student section listing.
- Status: **PASS** (SQLite and PostgreSQL).

### Live classes and LiveKit
- Existing: start/end/join-token with short-lived, room-scoped tokens, `can_publish` only for teachers, enrollment checked, 503 with a typed code when LiveKit is unconfigured.
- Defects found: ending a class left an egress job running; join response did not tell participants a session was being recorded.
- Status: token issuance and state machine **PASS** (token generation is real local JWT signing with fake credentials). **Real media connectivity: BLOCKED** — no LiveKit server or credentials here. Adaptive audio-only mode is a frontend concern (media subscription control) and is not claimed by the backend.

### Recorded-lecture pipeline
- Existing (v1): start/stop egress, status refresh by polling, a download redirect. No webhook, no publication, no sharing, one recording row had no title/size/duration, no library view, no idempotency guard against concurrent starts, no deletion/retention.
- Legacy: fully mocked (the client supplied the video URL).
- Implemented: `recording_service` is the single owner of the lifecycle (`recording → processing → available | failed → archived`), signed LiveKit **webhook** receiver (JWT + body SHA-256 verified), idempotent provider transitions, "complete but file missing" ⇒ `failed` (never `available`), a partial unique index so a retried/concurrent start cannot launch a second egress, teacher-controlled **publication** (private by default), short-lived signed playback URLs re-authorized on every call, per-student progress, delete = remove media + keep metadata, institution kill switch, recording notice in the join response.
- Status: backend state machine, authorization, signed-URL issuance, webhook verification **PASS**. **Real recording (egress writing an MP4 to a bucket): BLOCKED** — no LiveKit/egress/S3 in this environment; the boundaries are mocked in tests (`fake_storage`, `mock_recording_pipeline`) and that is the maximum those tests prove.

### Durable storage
- Existing: `ObjectStorage` interface with local-disk and S3 (presigned POST/GET). Recording requires S3 (LiveKit egress cannot write to a local disk) and says so with `RECORDING_NOT_CONFIGURED`.
- Changes: signed-URL TTL is configurable (`SIGNED_URL_TTL_SECONDS`, default 300 s); `fetch_to_path` added for transcription; local upload endpoint now rejects empty/oversize bodies and re-uploads.
- Status: S3 path **BLOCKED** (no bucket); local path **PASS**.

### Transcripts and AI summaries
- Existing: transcript text → background task → stub/LLM summary → teacher approve. Defects: any enrolled **student** could trigger it; duplicate requests created duplicate jobs; `request-changes` set `queued` but never created a job (summary stuck forever); a failed provider call lost the reason; background-only (a restart dropped queued work); no link from a summary to a recording; no provenance.
- Implemented: teacher-only requests, per-source idempotency (content hash), `recording_id` on transcripts/summaries, provenance (`generator` = `llm`/`stub`, `generator_model`), atomic job claim, bounded retries for transient errors only, a standalone worker (`python -m app.worker`) that also re-queues crashed jobs, teacher edit-before-approve (`PATCH /summaries/{id}`, flagged `teacher_edited`), `GET /summaries` (teachers: all in their courses; students: approved only), recording-sourced transcription via the STT boundary.
- Status: pipeline **PASS** with the labeled stub generator and a mocked STT boundary. **Real LLM output and real speech-to-text: BLOCKED** (no provider keys). With no STT key the job fails honestly with `STT_NOT_CONFIGURED` and no summary is invented.

### Offline assignments and synchronization
- Existing: idempotent on `(user_id, operation_id)` with a DB unique constraint, but: reusing an `operation_id` with a *different* payload silently returned the old result; the submission and its idempotency record committed separately (a crash between them would double-apply on retry); two simultaneous first-time requests raised an unhandled `IntegrityError` (HTTP 500); every operation, supported or not, was stored as `assignment_submission`.
- Implemented: payload hash ⇒ `OPERATION_ID_REUSED` conflict; side effect + idempotency record in **one transaction**; bounded retry on unique-constraint races; unsupported types recorded as `unsupported`.
- Status: **PASS**, including a 6-thread simultaneous-duplicate test (repeated 3×; one submission, `version == 1`).

### Learning materials
- Existing: upload-init → upload → complete with server-measured size, MIME and size validation, enrollment-gated download.
- Implemented: sharing a resource with a section (no copy), section-scoped listing.
- Status: **PASS** for local storage; S3 **BLOCKED**.

### Shared-device security (backend side)
- Verified: a logged-out cookie replayed afterwards is rejected, expired sessions are rejected, password reset ends all sessions, no endpoint reads another user's data by client-supplied id. The frontend clears local data (see §5).
- Status: **PASS**.

### Health / observability
- `/ready` previously returned the raw exception text on database failure (information leak) — fixed. Structured logs added for recording transitions, sync outcomes, summary failures.
- Status: **PASS**.

### Deployment and migrations
- Alembic history preserved (2 existing revisions untouched); one new revision `3f1a9c2b7d10`. Verified on SQLite and on a real **PostgreSQL 18** server: upgrade, downgrade, re-upgrade, `alembic check` (no drift), and a data-preservation test.
- `compose.yaml` gained a `worker` service.
- Status: **PASS** locally. Hosted deployment: **BLOCKED** (no target available).

## 3. Security findings

| # | Finding | Severity | Resolution |
|---|---|---|---|
| S1 | Self-service teacher registration | High | Invite code required; closed in production without one (`TEACHER_INVITE_CODE`) |
| S2 | Draft/unenrolled assignment access | High | `assert_can_view_assignment`; drafts 404 for non-teachers |
| S3 | Legacy API: unauthenticated recordings/sections/materials, client-supplied media URLs | High | Legacy API removed |
| S4 | Legacy API: JWT in `localStorage` | Medium | Replaced by httpOnly cookie sessions; frontend no longer holds a token |
| S5 | Password reset kept sessions alive | Medium | All sessions revoked on reset |
| S6 | Job status readable by any user | Low | Restricted to the course's teachers |
| S7 | `/ready` leaked exception text | Low | Generic body; detail only in logs |
| S8 | Webhook state changes would have been possible without verifying the sender | — (new surface) | JWT signature + body hash required; tampered/unsigned/wrong-secret requests rejected before any state change (tested) |
| S9 | Frontend fabricated "downloaded" files and storage numbers when a request failed | Medium (integrity) | Removed; failures now surface as errors |
| S10 | Local upload endpoint accepted unbounded and repeat uploads | Low | Bounded; one upload per pending resource |

Not changed (documented): CORS is a single configured origin with credentials; cookies are `SameSite=Lax` and `Secure` in production, which is what the CSRF defence relies on (no cookie-authenticated cross-site POST is possible from another origin; if the SPA and API ever live on different *sites*, add an explicit CSRF token).

## 4. Duplicates

See [DEDUPLICATION_REPORT.md](DEDUPLICATION_REPORT.md).

## 5. Frontend findings that affect backend claims

These are outside the backend but would have made backend claims false in practice, so they were fixed or flagged:
- `downloadManager` replaced failed downloads with synthesized text and stored them as if they were the real file; storage numbers were invented when the browser had no estimate. **Fixed.**
- `StudentCourseDetailPage` displayed three hard-coded fake "materials". **Replaced with real course resources.**
- Online submission treated *any* error (including a server refusal such as "assignment closed") as "offline" and queued it forever. **Now only network failures queue.**
- Logout did not revoke the server session and did not clear downloads/caches on a shared device. **Fixed.**
- `TeacherMaterialsPage` published metadata-only "materials" with a fake URL. **Now performs a real upload.**

## 6. Remaining blockers and limitations

- **BLOCKED**: real LiveKit media, egress recording, S3 storage, real LLM and speech-to-text calls, hosted deployment. Code boundaries, configuration and failure modes exist and are tested against mocks only.
- Login/reset rate limiting is in-process memory: it does not coordinate across multiple API processes (use a shared store before scaling out).
- Background execution: API-spawned tasks plus the standalone worker; no external queue. Adequate for a modular monolith, not for high job volume.
- No grading model for submissions; no due-date enforcement on submit; students cannot be removed from a recording library per-item beyond section/publication controls.
- Cross-institution sharing is **NOT REQUIRED / not modelled**: there is no institution entity, so sharing is restricted to sections of courses the same teacher teaches.
- Frontend pagination: list calls request `limit=200`; very large catalogs need paging UI.
- A rejected sync operation replays the same rejection for the same `operation_id` by design; the client must create a new operation to retry after fixing the cause.

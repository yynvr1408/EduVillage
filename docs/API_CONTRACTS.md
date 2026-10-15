# API Contracts

Everything below is **implemented** and appears in the generated OpenAPI document (`GET /openapi.json`, browsable at `/docs`). 83 operations (including `/health` and `/ready`). Interactive truth beats this file: if they disagree, `/openapi.json` wins.

## Conventions

- **Base URL**: `http://localhost:8000`; all application routes are under `/api/v1`. `GET /health` and `GET /ready` are unversioned.
- **Authentication**: an httpOnly session cookie (`eduvillage_session`) set by `POST /auth/register` and `POST /auth/login`. Browsers must send credentials (`fetch(..., { credentials: "include" })`). There is no bearer token. Sessions are stored hashed server-side and can be revoked (`POST /auth/logout`, `DELETE /users/me/sessions/{id}`, `POST /users/me/sessions/revoke-all`, password reset). The cookie is `SameSite=Lax`, `HttpOnly`, and `Secure` in production.
- **Authorization** is enforced in services, never from client-supplied roles or ids:
  - *Teacher on a course* = course owner or an added co-teacher. Nothing is automatic for other teachers.
  - *Coursework* (assignments, resources, class join, summaries, recordings) requires **enrollment** for students; a published course is only a title/description/lesson-list preview.
  - Sections narrow access further when a class, recording or resource is section-scoped.
- **Pagination**: `limit` (default 50, max 200) and `offset` on list endpoints that accept them.
- **Errors** always have this shape (also for validation errors, `422`):

```json
{ "error": { "code": "ASSIGNMENT_CLOSED", "message": "...", "request_id": "uuid", "details": {} } }
```

Common codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (also used instead of 403 when revealing existence would leak, e.g. a student asking for a private recording), `CONFLICT` 409, `VALIDATION_FAILED` 422, `SERVICE_UNAVAILABLE` 503, plus the feature codes below.

## Operations

| Method | Path | Success | Response model | Tag |
|---|---|---|---|---|
| `GET` | `/api/v1/assignments` | 200 | list of AssignmentOut | assignments |
| `POST` | `/api/v1/assignments` | 201 | AssignmentOut | assignments |
| `GET` | `/api/v1/assignments/{assignment_id}` | 200 | AssignmentOut | assignments |
| `PATCH` | `/api/v1/assignments/{assignment_id}` | 200 | AssignmentOut | assignments |
| `GET` | `/api/v1/assignments/{assignment_id}/submissions` | 200 | list of SubmissionOut | assignments |
| `GET` | `/api/v1/assignments/{assignment_id}/submissions/me` | 200 | SubmissionOut | assignments |
| `PUT` | `/api/v1/assignments/{assignment_id}/submissions/me` | 200 | SubmissionOut | assignments |
| `POST` | `/api/v1/auth/forgot-password` | 202 | - | auth |
| `POST` | `/api/v1/auth/login` | 200 | AuthResponse | auth |
| `POST` | `/api/v1/auth/logout` | 204 | - | auth |
| `POST` | `/api/v1/auth/register` | 201 | AuthResponse | auth |
| `POST` | `/api/v1/auth/reset-password` | 204 | - | auth |
| `GET` | `/api/v1/classes` | 200 | list of ClassOut | classes |
| `POST` | `/api/v1/classes` | 201 | ClassOut | classes |
| `GET` | `/api/v1/classes/recordings/{recording_id}/download` | 200 | - | classes |
| `GET` | `/api/v1/classes/{class_id}` | 200 | ClassOut | classes |
| `PATCH` | `/api/v1/classes/{class_id}` | 200 | ClassOut | classes |
| `POST` | `/api/v1/classes/{class_id}/end` | 200 | ClassOut | classes |
| `POST` | `/api/v1/classes/{class_id}/join-token` | 200 | JoinTokenResponse | classes |
| `GET` | `/api/v1/classes/{class_id}/participants` | 200 | list of ParticipantOut | classes |
| `GET` | `/api/v1/classes/{class_id}/recordings` | 200 | list of RecordingOut | classes |
| `POST` | `/api/v1/classes/{class_id}/recordings/start` | 201 | RecordingOut | classes |
| `POST` | `/api/v1/classes/{class_id}/recordings/{recording_id}/stop` | 200 | RecordingOut | classes |
| `POST` | `/api/v1/classes/{class_id}/start` | 200 | ClassOut | classes |
| `GET` | `/api/v1/classes/{class_id}/summary` | 200 | SummaryOut | summaries |
| `POST` | `/api/v1/classes/{class_id}/summary-jobs` | 202 | SummaryJobOut | summaries |
| `GET` | `/api/v1/courses` | 200 | list of CourseOut | courses |
| `POST` | `/api/v1/courses` | 201 | CourseOut | courses |
| `GET` | `/api/v1/courses/catalog` | 200 | list of CourseOut | courses |
| `GET` | `/api/v1/courses/{course_id}` | 200 | CourseOut | courses |
| `PATCH` | `/api/v1/courses/{course_id}` | 200 | CourseOut | courses |
| `GET` | `/api/v1/courses/{course_id}/enrollments` | 200 | list of EnrollmentOut | courses |
| `POST` | `/api/v1/courses/{course_id}/enrollments` | 201 | EnrollmentOut | courses |
| `GET` | `/api/v1/courses/{course_id}/lessons` | 200 | list of LessonOut | courses |
| `POST` | `/api/v1/courses/{course_id}/lessons` | 201 | LessonOut | courses |
| `GET` | `/api/v1/courses/{course_id}/resources` | 200 | list of ResourceOut | resources |
| `GET` | `/api/v1/courses/{course_id}/sections` | 200 | list of SectionOut | sections |
| `POST` | `/api/v1/courses/{course_id}/sections` | 201 | SectionOut | sections |
| `GET` | `/api/v1/courses/{course_id}/teachers` | 200 | list of CoTeacherOut | courses |
| `POST` | `/api/v1/courses/{course_id}/teachers` | 201 | CoTeacherOut | courses |
| `DELETE` | `/api/v1/courses/{course_id}/teachers/{teacher_id}` | 204 | - | courses |
| `GET` | `/api/v1/jobs/{job_id}` | 200 | JobStatusOut | summaries |
| `GET` | `/api/v1/lessons/{lesson_id}` | 200 | LessonOut | courses |
| `PATCH` | `/api/v1/lessons/{lesson_id}` | 200 | LessonOut | courses |
| `GET` | `/api/v1/recordings` | 200 | list of RecordingLibraryItem | recordings |
| `DELETE` | `/api/v1/recordings/{recording_id}` | 204 | - | recordings |
| `GET` | `/api/v1/recordings/{recording_id}` | 200 | RecordingDetail | recordings |
| `GET` | `/api/v1/recordings/{recording_id}/playback` | 200 | PlaybackOut | recordings |
| `POST` | `/api/v1/recordings/{recording_id}/progress` | 200 | ProgressOut | recordings |
| `POST` | `/api/v1/recordings/{recording_id}/publish` | 200 | RecordingLibraryItem | recordings |
| `POST` | `/api/v1/recordings/{recording_id}/sections` | 201 | RecordingLibraryItem | recordings |
| `DELETE` | `/api/v1/recordings/{recording_id}/sections/{section_id}` | 204 | - | recordings |
| `POST` | `/api/v1/recordings/{recording_id}/summary-jobs` | 202 | SummaryJobOut | recordings |
| `GET` | `/api/v1/resources/download-content/{storage_key}` | 200 | - | resources |
| `PUT` | `/api/v1/resources/upload-content/{storage_key}` | 204 | - | resources |
| `POST` | `/api/v1/resources/upload-init` | 200 | UploadInitResponse | resources |
| `DELETE` | `/api/v1/resources/{resource_id}` | 204 | - | resources |
| `GET` | `/api/v1/resources/{resource_id}` | 200 | ResourceOut | resources |
| `POST` | `/api/v1/resources/{resource_id}/complete` | 200 | ResourceOut | resources |
| `GET` | `/api/v1/resources/{resource_id}/download` | 200 | - | resources |
| `POST` | `/api/v1/resources/{resource_id}/sections` | 201 | ResourceOut | resources |
| `DELETE` | `/api/v1/resources/{resource_id}/sections/{section_id}` | 204 | - | resources |
| `GET` | `/api/v1/sections/{section_id}/members` | 200 | list of SectionMemberOut | sections |
| `POST` | `/api/v1/sections/{section_id}/members` | 201 | SectionMemberOut | sections |
| `DELETE` | `/api/v1/sections/{section_id}/members/{student_id}` | 204 | - | sections |
| `GET` | `/api/v1/sections/{section_id}/resources` | 200 | list of ResourceOut | resources |
| `GET` | `/api/v1/student/dashboard` | 200 | StudentDashboardOut | dashboard |
| `GET` | `/api/v1/summaries` | 200 | list of SummaryOut | summaries |
| `PATCH` | `/api/v1/summaries/{summary_id}` | 200 | SummaryOut | summaries |
| `POST` | `/api/v1/summaries/{summary_id}/approve` | 200 | SummaryOut | summaries |
| `POST` | `/api/v1/summaries/{summary_id}/request-changes` | 200 | SummaryOut | summaries |
| `POST` | `/api/v1/sync/operations` | 200 | SyncBatchResponse | synchronization |
| `GET` | `/api/v1/sync/operations/{operation_id}` | 200 | SyncOperationResult | synchronization |
| `GET` | `/api/v1/sync/pending` | 200 | list of SyncOperationResult | synchronization |
| `GET` | `/api/v1/teacher/dashboard` | 200 | TeacherDashboardOut | dashboard |
| `GET` | `/api/v1/users/me` | 200 | UserOut | users |
| `PATCH` | `/api/v1/users/me` | 200 | UserOut | users |
| `GET` | `/api/v1/users/me/sessions` | 200 | list of SessionOut | users |
| `POST` | `/api/v1/users/me/sessions/revoke-all` | 200 | RevokeAllResponse | users |
| `DELETE` | `/api/v1/users/me/sessions/{session_id}` | 204 | - | users |
| `POST` | `/api/v1/webhooks/livekit` | 200 | - | webhooks |
| `GET` | `/health` | 200 | - |  |
| `GET` | `/ready` | 200 | - |  |

Every operation except `/health`, `/ready`, `POST /auth/register|login|forgot-password|reset-password` and `POST /webhooks/livekit` requires a valid session (401 otherwise). `POST /webhooks/livekit` is authenticated by LiveKit's signed JWT instead of a session.

## Feature contracts

### Registration
`POST /auth/register` body: `{ full_name, email, password (8+), role: "student"|"teacher", invite_code? }`.
`role: "teacher"` requires `invite_code` equal to the server's `TEACHER_INVITE_CODE`, otherwise `403 INVALID_INVITE_CODE`. If that variable is unset: allowed outside production, `403 TEACHER_REGISTRATION_CLOSED` in production. Rate limited: `429 RATE_LIMITED`.

### Courses and sections
- `GET /courses` — my courses (students: enrolled; teachers: owned + co-taught). `GET /courses/catalog` — published courses to browse. `POST /courses/{id}/enrollments` with `{}` self-enrolls a student in a **published** course.
- `POST /courses/{id}/sections` `{name, code}` (course teachers; code unique per course and upper-cased → `409 SECTION_CODE_TAKEN`).
- `POST /sections/{id}/members` `{student_id}` (course teachers; the student must already be enrolled → `409 NOT_ENROLLED`; duplicate → `409 ALREADY_MEMBER`). `GET /courses/{id}/sections`: teachers see all, a student sees only their own.
- `POST /classes?course_id=` body `{title, scheduled_start, scheduled_end?, section_ids?: []}`. Empty `section_ids` = the whole course. Sections must belong to the class's course (`422 INVALID_SECTION`). A student outside the class's sections gets `403 WRONG_SECTION`.

### Live classes
`POST /classes/{id}/start` (teachers; creates the LiveKit room), `POST /classes/{id}/end` (also stops any active recording), `POST /classes/{id}/join-token` → `{ livekit_url, token, room_name, can_publish, recording_active }`. The token is a short-lived LiveKit JWT scoped to the room; only course teachers get `can_publish`. Not live → `409`; LiveKit unconfigured → `503 LIVEKIT_NOT_CONFIGURED`. The backend never proxies media.

### Recording lifecycle

| Step | Endpoint | Rules |
|---|---|---|
| Start | `POST /classes/{id}/recordings/start` | course teacher; class must be live (`409 CLASS_NOT_LIVE`); already recording → `409 ALREADY_RECORDING`; `RECORDING_ENABLED=false` → `403 RECORDING_DISABLED`; needs `STORAGE_BACKEND=s3` plus LiveKit, else `503 RECORDING_NOT_CONFIGURED` |
| Stop | `POST /classes/{id}/recordings/{rid}/stop` | idempotent; status → `processing` |
| Provider result | `POST /webhooks/livekit` (`egress_ended`) | signature verified; `available` only if the object exists in storage, else `failed` |
| Library | `GET /recordings?course_id=&section_id=` | teachers: recordings of courses they teach (all states). Students: only `available` **and** published recordings they are allowed to see |
| Detail | `GET /recordings/{id}` | metadata, `has_transcript`, summary id/status (students see a summary only once approved), transcript when allowed, progress |
| Playback | `GET /recordings/{id}/playback` → `{ url, expires_in, method }` | re-authorized on every call; signed URL, TTL `SIGNED_URL_TTL_SECONDS`; `409 RECORDING_NOT_READY / RECORDING_FAILED / RECORDING_ARCHIVED`, `404 RECORDING_MEDIA_MISSING` |
| Publish | `POST /recordings/{id}/publish` `{published}` | course teacher; only a ready recording can be published |
| Share | `POST /recordings/{id}/sections` `{section_id}` / `DELETE .../{section_id}` | the teacher must teach the recording's course **and** the target section's course; idempotent; delete removes only that association |
| Progress | `POST /recordings/{id}/progress` `{position_seconds, completed}` | per user |
| Delete | `DELETE /recordings/{id}` | removes the media, keeps the row as `archived` |
| Transcribe + summarize | `POST /recordings/{id}/summary-jobs` | course teacher; the recording must be ready |

Recording status values: `recording`, `processing`, `available`, `failed`, `archived`.
Student visibility rule: allowed sections = the class's sections ∪ the sections the recording is shared with; if that set is non-empty the student must belong to one of them, otherwise they must be enrolled in the recording's course.

### Summaries
`POST /classes/{id}/summary-jobs` `{transcript_text?|resource_id?}` (course teachers → `202 {job_id,status}`; the same source returns the same job). `GET /jobs/{id}` (course teachers only). `GET /classes/{id}/summary`, `GET /summaries`. `PATCH /summaries/{id}` (edit while `needs_review`; flags `teacher_edited`), `POST /summaries/{id}/approve`, `POST /summaries/{id}/request-changes` (creates a new job). Statuses: `queued, processing, needs_review, completed, failed`. `SummaryOut` includes `generator` (`llm` or the labeled `stub`) and `generator_model`. Job `error_code` values include `STT_NOT_CONFIGURED`, `NO_TRANSCRIPT_SOURCE`, `LLM_ERROR`, `UNEXPECTED_ERROR`.

### Synchronization — `POST /sync/operations`
Request: `{ operations: [{ operation_id (<=128), operation_type, entity_id, payload, client_updated_at? }] }` (1–50 per call).
Supported `operation_type`: `assignment_submission` with `payload: { answer: { ... } }` and `entity_id` = assignment id.
Per-operation result: `{ operation_id, status: "accepted"|"rejected"|"conflict", server_entity_id?, server_version?, server_updated_at?, error_code?, message? }`.

Semantics:
- Unique per `(authenticated user, operation_id)`. A replay returns the **originally recorded** result and changes nothing.
- The same `operation_id` with a different `operation_type`, `entity_id` or `payload` → `conflict` / `OPERATION_ID_REUSED`; nothing is applied.
- The submission and the idempotency record commit atomically; concurrent duplicates yield exactly one effect.
- Refusals are recorded and replayed too: `ASSIGNMENT_CLOSED` / `ASSIGNMENT_NOT_PUBLISHED` (`conflict`), `FORBIDDEN` (not enrolled; `rejected`), `INVALID_PAYLOAD` (`rejected`), `UNSUPPORTED_OPERATION_TYPE` (`rejected`).
- `GET /sync/operations/{operation_id}` and `GET /sync/pending` (everything not accepted, i.e. "requires attention").
- Draft saves use `PUT /assignments/{id}/submissions/me {answer, submit:false}`; `submit:true` finalizes. A client should show "Submitted" only after an `accepted` result or a `submitted` server record.

### Resources
`POST /resources/upload-init` → `{ resource_id, upload: {method,url,fields} }` (local storage: `PUT` the raw bytes to the returned URL; S3: presigned `POST`) → `POST /resources/{id}/complete` (the server measures the size). `GET /resources/{id}/download` (redirect). Share into a section: `POST /resources/{id}/sections`, list with `GET /sections/{id}/resources`. Allowed: PDF, text, image, audio, video, common office types, up to 50 MB.

### Webhook
`POST /webhooks/livekit` — the body is LiveKit's webhook JSON; the `Authorization` header is LiveKit's JWT (signed with `LIVEKIT_API_SECRET`, carrying the body's SHA-256). An invalid or missing signature → `401 INVALID_WEBHOOK_SIGNATURE` with no state change. Only `egress_ended` is acted on.

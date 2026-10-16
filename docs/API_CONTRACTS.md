# API reference

Generated from the running application by `backend/scripts/generate_docs.py`; do not edit by hand. Interactive documentation is served by the backend at `/docs` (Swagger) and `/openapi.json`.

124 operations. All application routes are under `/api/v1`. Errors always have the shape `{ "error": { "code", "message", "request_id", "details" } }`.

**Authentication.** Students and teachers authenticate with an httpOnly session cookie (`eduvillage_session`). The administrator uses a separate cookie (`eduvillage_admin_session`) and must send `X-EduVillage-Admin: 1` on every request that changes data. "public" means no session is required.


## admin

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/auth/login` | public | admin login |
| POST | `/api/v1/admin/auth/logout` | administrator session | admin logout |
| GET | `/api/v1/admin/auth/me` | administrator session | admin me |
| PATCH | `/api/v1/admin/branches/{branch_id}` | administrator session | update branch |
| GET | `/api/v1/admin/branches/{branch_id}/sections` | administrator session | list branch sections |
| POST | `/api/v1/admin/branches/{branch_id}/sections` | administrator session | create branch section |
| POST | `/api/v1/admin/branches/{branch_id}/status` | administrator session | change branch status |
| GET | `/api/v1/admin/colleges` | administrator session | list colleges |
| POST | `/api/v1/admin/colleges` | administrator session | create college |
| GET | `/api/v1/admin/colleges/{college_id}` | administrator session | get college |
| PATCH | `/api/v1/admin/colleges/{college_id}` | administrator session | update college |
| GET | `/api/v1/admin/colleges/{college_id}/branches` | administrator session | list branches |
| POST | `/api/v1/admin/colleges/{college_id}/branches` | administrator session | create branch |
| POST | `/api/v1/admin/colleges/{college_id}/regenerate-code` | administrator session | regenerate code |
| POST | `/api/v1/admin/colleges/{college_id}/status` | administrator session | change status |
| GET | `/api/v1/admin/overview` | administrator session | overview |
| PATCH | `/api/v1/admin/sections/{section_id}` | administrator session | update college section |
| POST | `/api/v1/admin/sections/{section_id}/status` | administrator session | change section status |

## assignments

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/assignments` | signed-in user | list assignments |
| POST | `/api/v1/assignments` | signed-in user | create assignment |
| PUT | `/api/v1/assignments/attachments/upload-content/{storage_key:path}` | signed-in user | Local-storage upload target for submission files (S3/R2 uploads go straight to the presigned URL). |
| GET | `/api/v1/assignments/{assignment_id}` | signed-in user | get assignment |
| PATCH | `/api/v1/assignments/{assignment_id}` | signed-in user | update assignment |
| GET | `/api/v1/assignments/{assignment_id}/attachments` | signed-in user | The caller's own attached files (a student sees theirs; teachers read files through the submissions list). |
| POST | `/api/v1/assignments/{assignment_id}/attachments` | signed-in user | init attachment |
| DELETE | `/api/v1/assignments/{assignment_id}/attachments/{attachment_id}` | signed-in user | delete attachment |
| POST | `/api/v1/assignments/{assignment_id}/attachments/{attachment_id}/complete` | signed-in user | complete attachment |
| GET | `/api/v1/assignments/{assignment_id}/attachments/{attachment_id}/download` | signed-in user | download attachment |
| GET | `/api/v1/assignments/{assignment_id}/submissions` | signed-in user | list submissions |
| GET | `/api/v1/assignments/{assignment_id}/submissions/me` | signed-in user | get my submission |
| PUT | `/api/v1/assignments/{assignment_id}/submissions/me` | signed-in user | save my submission |

## auth

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/forgot-password` | public | forgot password |
| POST | `/api/v1/auth/login` | public | login |
| POST | `/api/v1/auth/login/verify-otp` | public | verify login otp |
| POST | `/api/v1/auth/logout` | signed-in user | logout |
| POST | `/api/v1/auth/register` | public | register |
| POST | `/api/v1/auth/reset-password` | public | reset password |
| POST | `/api/v1/auth/verify-reset-otp` | public | verify reset otp |

## classes

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/classes` | signed-in user | list classes |
| POST | `/api/v1/classes` | signed-in user | create class |
| GET | `/api/v1/classes/recordings/{recording_id}/download` | signed-in user | Kept for existing clients; same authorization + signed URL as /recordings/{id}/playback. |
| GET | `/api/v1/classes/{class_id}` | signed-in user | get class |
| PATCH | `/api/v1/classes/{class_id}` | signed-in user | update class |
| POST | `/api/v1/classes/{class_id}/cancel` | signed-in user | cancel class |
| POST | `/api/v1/classes/{class_id}/end` | signed-in user | end class |
| POST | `/api/v1/classes/{class_id}/join-token` | signed-in user | join token |
| GET | `/api/v1/classes/{class_id}/participants` | signed-in user | list participants |
| POST | `/api/v1/classes/{class_id}/participants/{student_id}/remove` | signed-in user | remove participant |
| GET | `/api/v1/classes/{class_id}/recordings` | signed-in user | list recordings |
| POST | `/api/v1/classes/{class_id}/recordings/start` | signed-in user | start recording |
| POST | `/api/v1/classes/{class_id}/recordings/{recording_id}/stop` | signed-in user | stop recording |
| POST | `/api/v1/classes/{class_id}/start` | signed-in user | start class |

## courses

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/courses` | signed-in user | list courses |
| POST | `/api/v1/courses` | signed-in user | create course |
| GET | `/api/v1/courses/catalog` | signed-in user | Published courses a student can browse and then self-enroll in. |
| DELETE | `/api/v1/courses/{course_id}` | signed-in user | Permanently deletes an empty, untouched draft; archives (never destroys) anything with |
| GET | `/api/v1/courses/{course_id}` | signed-in user | get course |
| PATCH | `/api/v1/courses/{course_id}` | signed-in user | update course |
| POST | `/api/v1/courses/{course_id}/archive` | signed-in user | Explicit archive: out of the catalog and self-enrolment, nothing deleted, reversible with /restore. |
| GET | `/api/v1/courses/{course_id}/enrollments` | signed-in user | list enrollments |
| POST | `/api/v1/courses/{course_id}/enrollments` | signed-in user | create enrollment |
| GET | `/api/v1/courses/{course_id}/lessons` | signed-in user | list lessons |
| POST | `/api/v1/courses/{course_id}/lessons` | signed-in user | create lesson |
| POST | `/api/v1/courses/{course_id}/lessons/bulk` | signed-in user | create lessons bulk |
| POST | `/api/v1/courses/{course_id}/restore` | signed-in user | Reverts an archive (back to published). |
| POST | `/api/v1/courses/{course_id}/syllabus/preview` | signed-in user | Proposes lessons from pasted text. Saves nothing. |
| POST | `/api/v1/courses/{course_id}/syllabus/preview-pdf` | signed-in user | Proposes lessons from an uploaded syllabus PDF (text PDFs only). Saves nothing. |
| GET | `/api/v1/courses/{course_id}/teachers` | signed-in user | list co teachers |
| POST | `/api/v1/courses/{course_id}/teachers` | signed-in user | add co teacher |
| DELETE | `/api/v1/courses/{course_id}/teachers/{teacher_id}` | signed-in user | remove co teacher |
| GET | `/api/v1/lessons/{lesson_id}` | signed-in user | get lesson |
| PATCH | `/api/v1/lessons/{lesson_id}` | signed-in user | update lesson |

## dashboard

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/student/dashboard` | signed-in user | student dashboard |
| GET | `/api/v1/teacher/dashboard` | signed-in user | teacher dashboard |

## health

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | public | health |
| GET | `/ready` | public | ready |

## recordings

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/recordings` | signed-in user | list recordings |
| DELETE | `/api/v1/recordings/{recording_id}` | signed-in user | delete recording |
| GET | `/api/v1/recordings/{recording_id}` | signed-in user | get recording |
| GET | `/api/v1/recordings/{recording_id}/playback` | signed-in user | playback |
| POST | `/api/v1/recordings/{recording_id}/progress` | signed-in user | progress |
| POST | `/api/v1/recordings/{recording_id}/publish` | signed-in user | publish |
| POST | `/api/v1/recordings/{recording_id}/sections` | signed-in user | share |
| DELETE | `/api/v1/recordings/{recording_id}/sections/{section_id}` | signed-in user | unshare |
| POST | `/api/v1/recordings/{recording_id}/summary-jobs` | signed-in user | Teacher-triggered transcript + summary for a recording. Independent of playback: a failure |

## registration

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/registration/branches/{branch_id}/sections` | public | registerable sections |
| GET | `/api/v1/registration/colleges` | public | Active colleges only, read live from the admin-managed table. Public, and never includes college codes. |
| GET | `/api/v1/registration/colleges/{college_id}/branches` | public | registerable branches |

## resources

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/courses/{course_id}/resources` | signed-in user | list course resources |
| GET | `/api/v1/resources/download-content/{storage_key:path}` | signed-in user | download content |
| PUT | `/api/v1/resources/upload-content/{storage_key:path}` | signed-in user | Local-storage upload target: PUT the raw file bytes here. Not used with the S3 backend, |
| POST | `/api/v1/resources/upload-init` | signed-in user | upload init |
| DELETE | `/api/v1/resources/{resource_id}` | signed-in user | delete |
| GET | `/api/v1/resources/{resource_id}` | signed-in user | get resource |
| PATCH | `/api/v1/resources/{resource_id}` | signed-in user | Edit title/description and publish or unpublish. Publishing requires a fully processed resource. |
| POST | `/api/v1/resources/{resource_id}/complete` | signed-in user | complete |
| GET | `/api/v1/resources/{resource_id}/download` | signed-in user | download |
| GET | `/api/v1/resources/{resource_id}/download-info` | signed-in user | Where and how to fetch the file, for clients that download in byte-range chunks. |
| POST | `/api/v1/resources/{resource_id}/sections` | signed-in user | share resource |
| DELETE | `/api/v1/resources/{resource_id}/sections/{section_id}` | signed-in user | unshare resource |
| GET | `/api/v1/sections/{section_id}/resources` | signed-in user | list section resources |

## sections

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/courses/{course_id}/sections` | signed-in user | list sections |
| POST | `/api/v1/courses/{course_id}/sections` | signed-in user | create section |
| GET | `/api/v1/sections/{section_id}/members` | signed-in user | list members |
| POST | `/api/v1/sections/{section_id}/members` | signed-in user | add member |
| DELETE | `/api/v1/sections/{section_id}/members/{student_id}` | signed-in user | remove member |

## summaries

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/classes/{class_id}/summary` | signed-in user | get class summary |
| POST | `/api/v1/classes/{class_id}/summary-jobs` | signed-in user | create summary job |
| GET | `/api/v1/jobs/{job_id}` | signed-in user | get job |
| GET | `/api/v1/summaries` | signed-in user | list summaries |
| PATCH | `/api/v1/summaries/{summary_id}` | signed-in user | edit summary |
| POST | `/api/v1/summaries/{summary_id}/approve` | signed-in user | approve summary |
| POST | `/api/v1/summaries/{summary_id}/request-changes` | signed-in user | request summary changes |

## synchronization

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/sync/operations` | signed-in user | submit operations |
| GET | `/api/v1/sync/operations/{operation_id}` | signed-in user | get operation |
| GET | `/api/v1/sync/pending` | signed-in user | list pending |

## users

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/users/me` | signed-in user | read me |
| PATCH | `/api/v1/users/me` | signed-in user | update me |
| GET | `/api/v1/users/me/college-teachers` | signed-in user | Teachers in the student's own college, assigned to their college section or branch-wide. |
| GET | `/api/v1/users/me/sessions` | signed-in user | For shared/public devices: shows every device currently signed in, so a student |
| POST | `/api/v1/users/me/sessions/revoke-all` | signed-in user | Signs out every other device for this account, keeping the caller's own session. |
| DELETE | `/api/v1/users/me/sessions/{session_id}` | signed-in user | revoke my session |
| GET | `/api/v1/users/me/teaching-scope` | signed-in user | The branch / college section this teacher is assigned to ("none" for legacy or student accounts). |

## webhooks

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/webhooks/livekit` | public | LiveKit -> us. Authenticated by LiveKit's signed JWT (not by a user session); an |

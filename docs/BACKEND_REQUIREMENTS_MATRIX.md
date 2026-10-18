# Requirements matrix

What LanternEd does, where it is implemented, and which tests exercise it. Test files are under `backend/tests/` (pytest) and `frontend/` (Vitest and Playwright). Where a test replaces an external service (LiveKit's network calls, S3, an AI provider) with a fake it proves LanternEd's own logic around that boundary; real-service runs are listed in [FINAL_AUDIT.md](FINAL_AUDIT.md).

Related: [backend overview](BACKEND_AUDIT.md) · [API reference](API_CONTRACTS.md) · [README](../README.md)

## Accounts and access

| Capability | Implementation | Tests |
|---|---|---|
| Student and teacher registration against an active college, its code, branch and section; teachers may pick All Sections | `auth_service.register_user`, `college_service.validate_registration_target`, `api/v1/registration.py` | `test_college_registration`, `test_branches`, `test_registration_policy`, `register_college.test.tsx`, `e2e-real/college_registration` |
| Sign-in, sessions, logout, session list and revocation, shared-device mode | `auth_service`, `dependencies.get_current_user` | `test_auth`, `test_sessions`, `test_shared_device`, `auth.test.tsx`, `logout_confirm.test.tsx` |
| Second-device sign-in needs an emailed OTP; the older session ends | `auth_service.login_requires_otp / request_login_otp / verify_login_otp` | `test_login_otp` (16), `login_otp.test.tsx`, `e2e-real` |
| Password recovery by emailed OTP | `auth_service.request_password_reset / verify_reset_otp / reset_password`, `integrations/email.py` | `test_password_reset` (33), `password_reset_otp.test.tsx` |
| Role-based and resource-level authorisation | `core/permissions`, `course_service`, `assignment_service`, `recording_service.can_access` | `test_access_control`, `test_users`, `test_student_teacher_visibility` |
| Administrator panel: colleges, codes, branches, sections; single active session with idle timeout | `admin_service`, `college_service`, `api/v1/admin.py` | `test_admin`, `test_branches`, `admin_panel.test.tsx`, `e2e-layout/admin`, `e2e-real` |
| Teachers limited to their section or branch when targeting classes | `teaching_scope_service` | `test_branches`, `test_other_classes` |

## Teaching and learning

| Capability | Implementation | Tests |
|---|---|---|
| Courses: create, publish, archive, restore, permanently delete; catalogue; enrolment; roster; co-teachers | `course_service`, `api/v1/courses.py` | `test_courses`, `test_enrollments`, `test_co_teachers`, `course_enroll_button.test.tsx`, `teacher_course_roster.test.tsx` |
| Lessons, bulk lessons, curriculum import from pasted text or a text PDF | `course_service`, `syllabus_service` | `test_lessons`, `test_syllabus`, `syllabus_import.test.tsx` |
| Sections (cohorts) and membership; resources and recordings shared per section | `section_service`, `resource_service`, `recording_service` | `test_sections`, `test_resources` |
| Live classes: schedule, start, end, join tokens, audience by section or branch ("Other Classes") | `classroom_service`, `livekit.generate_access_token` | `test_classes`, `test_other_classes`, `test_multi_student_live_class`, `test_livekit_token`, `other_classes.test.tsx`, `e2e-live`, `e2e-real/other_classes` |
| Classroom tools: floating video, whiteboard, one or several shared screens, blurred background | `frontend/src/components/class`, `hooks/useScreenShares`, `hooks/useBackgroundBlur` | `classroom_tools.test.tsx`, `e2e-live/classroom_tools` |
| Recording to object storage, signed webhook, publication, signed playback, library, progress | `recording_service`, `integrations/livekit`, `api/v1/webhooks.py` | `test_recordings`, `test_recording_library`, `test_livekit_webhook`, `test_s3_storage_and_recording_chain` |
| Teacher resource uploads with content validation | `resource_service`, `media_validation` | `test_resource_uploads`, `test_resources` |
| Assignments, drafts, revisions, deadlines, offline sync | `assignment_service`, `synchronization_service` | `test_assignments`, `test_deadlines`, `test_sync`, `test_sync_hardening`, `assignment_status.test.tsx`, `e2e-offline/assignment_status` |
| PDF / DOC / DOCX files on a submission | `submission_file_service` | `test_submission_files` (14), `submission_files.test.tsx` |
| AI summaries: chunked transcription, LLM summary, teacher review, PDF/Word notes | `summary_service`, `transcription_service`, `utils/summaryExport.ts` | `test_summaries`, `test_summary_pipeline`, `test_long_recording_transcription`, `summary_export.test.ts`, `downloads_summary.test.tsx` |

## Offline and connectivity

| Capability | Implementation | Tests |
|---|---|---|
| Offline shell and service worker; offline downloads and playback | `vite-plugin-pwa`, `downloadEngine`, `downloadManager`, `playbackStore` | `download_engine.test.ts`, `download_manager.test.ts`, `offline_playback.test.tsx`, `e2e-offline/offline_shell`, `real_video_offline` |
| Adaptive audio-only mode and connection recovery | `hooks/useAdaptiveAudio`, `useConnectionRecovery`, `services/connectivity.ts` | `adaptive_audio.test.ts`, `live_connectivity.test.tsx`, `e2e-offline/live_class_connectivity`, `e2e-live/adaptive_bandwidth` |
| Idempotent retrying sync | `synchronization_service`, `services/syncManager.ts` | `sync_offline.test.ts`, `test_sync*` |

## Platform

| Capability | Implementation | Tests |
|---|---|---|
| Migrations (single linear chain) | `backend/alembic/versions` | `test_migrations` (upgrade, check, downgrade, data preservation) |
| Pagination, error model, audit trail, health and readiness | `utils/pagination`, `core/exceptions`, `audit_service`, `/health`, `/ready` | `test_pagination`, `test_audit`, `test_health` |
| Responsive layout across desktop, tablet and phone | Tailwind v4 design system, `components/ui` | `e2e-layout/layout`, `e2e-layout/admin` |

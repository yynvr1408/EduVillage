# Database schema

Generated from the SQLAlchemy models by `backend/scripts/generate_docs.py`; do not edit by hand. Migrations live in `backend/alembic/versions/` (one linear chain; `alembic heads` shows one head). Production uses PostgreSQL (Neon); development and most tests use SQLite.

33 tables. Primary keys are 36-character UUID strings. Timestamps are stored as naive UTC.

## `assignment_submissions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `assignment_id` | VARCHAR(36) | no | -> `assignments.id` |
| `student_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `answer` | JSON | no |  |
| `status` | VARCHAR(9) | no |  |
| `version` | INTEGER | no |  |
| `submitted_at` | DATETIME | yes |  |
| `updated_at` | DATETIME | no |  |
| `score` | FLOAT | yes |  |
| `feedback` | TEXT | yes |  |
| `graded_at` | DATETIME | yes |  |
| `graded_by` | VARCHAR(36) | yes | -> `users.id` |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (assignment_id, student_id).

## `assignments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `created_by` | VARCHAR(36) | no | -> `users.id` |
| `title` | VARCHAR(255) | no |  |
| `instructions` | TEXT | yes |  |
| `due_at` | DATETIME | yes |  |
| `status` | VARCHAR(9) | no |  |
| `max_score` | INTEGER | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `audit_events`

| Column | Type | Null | Notes |
|---|---|---|---|
| `actor_id` | VARCHAR(36) | yes | -> `users.id` |
| `action` | VARCHAR(120) | no |  |
| `resource_type` | VARCHAR(80) | no |  |
| `resource_id` | VARCHAR(36) | yes |  |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `background_jobs`

| Column | Type | Null | Notes |
|---|---|---|---|
| `job_type` | VARCHAR(19) | no |  |
| `status` | VARCHAR(10) | no |  |
| `reference_id` | VARCHAR(36) | yes | indexed |
| `attempts` | INTEGER | no |  |
| `max_attempts` | INTEGER | no |  |
| `error_code` | VARCHAR(120) | yes |  |
| `error_message` | TEXT | yes |  |
| `completed_at` | DATETIME | yes |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `class_participants`

| Column | Type | Null | Notes |
|---|---|---|---|
| `class_id` | VARCHAR(36) | no | -> `classes.id`, indexed |
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `joined_at` | DATETIME | yes |  |
| `left_at` | DATETIME | yes |  |
| `participation_status` | VARCHAR(7) | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `class_recordings`

| Column | Type | Null | Notes |
|---|---|---|---|
| `class_id` | VARCHAR(36) | no | -> `classes.id`, indexed |
| `requested_by` | VARCHAR(36) | no | -> `users.id` |
| `egress_id` | VARCHAR(255) | yes |  |
| `storage_key` | VARCHAR(512) | yes |  |
| `status` | VARCHAR(10) | no |  |
| `started_at` | DATETIME | no |  |
| `completed_at` | DATETIME | yes |  |
| `title` | VARCHAR(255) | yes |  |
| `duration_seconds` | INTEGER | no |  |
| `size_bytes` | INTEGER | no |  |
| `is_published` | BOOLEAN | no |  |
| `error_message` | TEXT | yes |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `class_sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `class_id` | VARCHAR(36) | no | primary key, -> `classes.id` |
| `section_id` | VARCHAR(36) | no | primary key, -> `sections.id` |

## `classes`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `teacher_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `title` | VARCHAR(255) | no |  |
| `scheduled_start` | DATETIME | no |  |
| `scheduled_end` | DATETIME | yes |  |
| `status` | VARCHAR(9) | no |  |
| `livekit_room_name` | VARCHAR(255) | yes |  |
| `audience_branch_id` | VARCHAR(36) | yes | -> `college_branches.id`, indexed |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `college_branches`

| Column | Type | Null | Notes |
|---|---|---|---|
| `college_id` | VARCHAR(36) | no | -> `colleges.id`, indexed |
| `name` | VARCHAR(120) | no |  |
| `name_key` | VARCHAR(120) | no |  |
| `short_code` | VARCHAR(20) | yes |  |
| `status` | VARCHAR(8) | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Constraints: unique (id, college_id); unique (college_id, name_key).

## `college_code_history`

| Column | Type | Null | Notes |
|---|---|---|---|
| `college_id` | VARCHAR(36) | no | -> `colleges.id`, indexed |
| `code` | VARCHAR(32) | no | unique, indexed |
| `replaced_at` | DATETIME | no |  |
| `replaced_by` | VARCHAR(36) | yes | -> `users.id` |
| `id` | VARCHAR(36) | no | primary key |

## `college_sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `college_id` | VARCHAR(36) | no | -> `colleges.id`, indexed |
| `branch_id` | VARCHAR(36) | no | -> `college_branches.id`, indexed |
| `name` | VARCHAR(80) | no |  |
| `name_key` | VARCHAR(80) | no |  |
| `status` | VARCHAR(8) | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Constraints: unique (branch_id, name_key).

## `colleges`

| Column | Type | Null | Notes |
|---|---|---|---|
| `name` | VARCHAR(160) | no |  |
| `name_key` | VARCHAR(160) | no |  |
| `location` | VARCHAR(160) | yes |  |
| `location_key` | VARCHAR(160) | no |  |
| `contact_email` | VARCHAR(320) | yes |  |
| `contact_phone` | VARCHAR(40) | yes |  |
| `code` | VARCHAR(32) | no | unique, indexed |
| `code_generated_at` | DATETIME | no |  |
| `status` | VARCHAR(8) | no | indexed |
| `created_by` | VARCHAR(36) | yes | -> `users.id` |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Constraints: unique (name_key, location_key).

## `course_enrollments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id` |
| `student_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `status` | VARCHAR(7) | no |  |
| `enrolled_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (course_id, student_id).

## `course_teachers`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `teacher_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `role` | VARCHAR(10) | no |  |
| `added_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (course_id, teacher_id).

## `courses`

| Column | Type | Null | Notes |
|---|---|---|---|
| `title` | VARCHAR(255) | no |  |
| `description` | TEXT | yes |  |
| `subject` | VARCHAR(120) | yes |  |
| `teacher_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `status` | VARCHAR(9) | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `learning_resources`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `lesson_id` | VARCHAR(36) | yes | -> `lessons.id` |
| `uploaded_by` | VARCHAR(36) | no | -> `users.id` |
| `storage_key` | VARCHAR(512) | no |  |
| `filename` | VARCHAR(255) | no |  |
| `mime_type` | VARCHAR(120) | no |  |
| `size_bytes` | INTEGER | no |  |
| `status` | VARCHAR(9) | no |  |
| `title` | VARCHAR(255) | yes |  |
| `description` | TEXT | yes |  |
| `resource_type` | VARCHAR(12) | yes |  |
| `is_published` | BOOLEAN | no |  |
| `processing_status` | VARCHAR(10) | no |  |
| `processing_error` | VARCHAR(500) | yes |  |
| `version` | INTEGER | no |  |
| `checksum_sha256` | VARCHAR(64) | yes |  |
| `detected_mime_type` | VARCHAR(120) | yes |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `lecture_summaries`

| Column | Type | Null | Notes |
|---|---|---|---|
| `class_id` | VARCHAR(36) | no | -> `classes.id`, indexed |
| `transcript_id` | VARCHAR(36) | yes | -> `lecture_transcripts.id` |
| `recording_id` | VARCHAR(36) | yes | -> `class_recordings.id`, indexed |
| `generator` | VARCHAR(20) | yes |  |
| `generator_model` | VARCHAR(120) | yes |  |
| `content_json` | JSON | no |  |
| `status` | VARCHAR(12) | no |  |
| `reviewed_by` | VARCHAR(36) | yes | -> `users.id` |
| `reviewed_at` | DATETIME | yes |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `lecture_transcripts`

| Column | Type | Null | Notes |
|---|---|---|---|
| `class_id` | VARCHAR(36) | no | -> `classes.id`, indexed |
| `resource_id` | VARCHAR(36) | yes | -> `learning_resources.id` |
| `recording_id` | VARCHAR(36) | yes | -> `class_recordings.id`, indexed |
| `chunk_state` | JSON | yes |  |
| `language` | VARCHAR(10) | no |  |
| `content_hash` | VARCHAR(64) | yes | indexed |
| `content` | TEXT | yes |  |
| `status` | VARCHAR(7) | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `lessons`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `title` | VARCHAR(255) | no |  |
| `content` | TEXT | yes |  |
| `position` | INTEGER | no |  |
| `status` | VARCHAR(9) | no |  |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

## `password_reset_otp_challenges`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `otp_hash` | VARCHAR(128) | no | indexed |
| `purpose` | VARCHAR(40) | no |  |
| `expires_at` | DATETIME | no |  |
| `attempts` | INTEGER | no |  |
| `max_attempts` | INTEGER | no |  |
| `verified_at` | DATETIME | yes |  |
| `consumed_at` | DATETIME | yes |  |
| `revoked_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `password_reset_tokens`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `token_hash` | VARCHAR(128) | no | unique, indexed |
| `expires_at` | DATETIME | no |  |
| `used_at` | DATETIME | yes |  |
| `revoked_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `recording_progress`

| Column | Type | Null | Notes |
|---|---|---|---|
| `recording_id` | VARCHAR(36) | no | -> `class_recordings.id`, indexed |
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `position_seconds` | INTEGER | no |  |
| `completed` | BOOLEAN | no |  |
| `updated_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (recording_id, user_id).

## `recording_sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `recording_id` | VARCHAR(36) | no | primary key, -> `class_recordings.id` |
| `section_id` | VARCHAR(36) | no | primary key, -> `sections.id` |
| `shared_by` | VARCHAR(36) | no | -> `users.id` |
| `shared_at` | DATETIME | no |  |

## `resource_sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `resource_id` | VARCHAR(36) | no | primary key, -> `learning_resources.id` |
| `section_id` | VARCHAR(36) | no | primary key, -> `sections.id` |
| `shared_by` | VARCHAR(36) | no | -> `users.id` |
| `shared_at` | DATETIME | no |  |

## `section_members`

| Column | Type | Null | Notes |
|---|---|---|---|
| `section_id` | VARCHAR(36) | no | -> `sections.id`, indexed |
| `student_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `added_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (section_id, student_id).

## `sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `course_id` | VARCHAR(36) | no | -> `courses.id`, indexed |
| `name` | VARCHAR(255) | no |  |
| `code` | VARCHAR(40) | no |  |
| `college_section_id` | VARCHAR(36) | yes | -> `college_sections.id`, indexed |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Constraints: unique (course_id, code).

## `submission_attachments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `assignment_id` | VARCHAR(36) | no | -> `assignments.id`, indexed |
| `student_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `storage_key` | VARCHAR(500) | no | unique |
| `filename` | VARCHAR(255) | no |  |
| `mime_type` | VARCHAR(120) | no |  |
| `detected_mime_type` | VARCHAR(120) | yes |  |
| `size_bytes` | INTEGER | no |  |
| `status` | VARCHAR(20) | no |  |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `submission_revisions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `submission_id` | VARCHAR(36) | no | -> `assignment_submissions.id`, indexed |
| `revision_number` | INTEGER | no |  |
| `answer_snapshot` | JSON | no |  |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

## `sync_operations`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `operation_id` | VARCHAR(128) | no |  |
| `operation_type` | VARCHAR(21) | no |  |
| `payload_hash` | VARCHAR(64) | yes |  |
| `status` | VARCHAR(8) | no |  |
| `result_json` | JSON | no |  |
| `created_at` | DATETIME | no |  |
| `processed_at` | DATETIME | yes |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (user_id, operation_id).

## `user_branch_assignments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `branch_id` | VARCHAR(36) | no | -> `college_branches.id`, indexed |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (user_id, branch_id).

## `user_college_sections`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | VARCHAR(36) | no | -> `users.id`, indexed |
| `college_section_id` | VARCHAR(36) | no | -> `college_sections.id`, indexed |
| `created_at` | DATETIME | no |  |
| `id` | VARCHAR(36) | no | primary key |

Constraints: unique (user_id, college_section_id).

## `user_sessions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | VARCHAR(36) | no | primary key |
| `user_id` | VARCHAR(36) | no | -> `users.id` |
| `session_hash` | VARCHAR(128) | no | unique, indexed |
| `expires_at` | DATETIME | no |  |
| `revoked_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `last_seen_at` | DATETIME | no |  |

## `users`

| Column | Type | Null | Notes |
|---|---|---|---|
| `full_name` | VARCHAR(255) | no |  |
| `email` | VARCHAR(320) | no | unique, indexed |
| `password_hash` | VARCHAR(255) | no |  |
| `role` | VARCHAR(7) | no |  |
| `status` | VARCHAR(9) | no |  |
| `college_id` | VARCHAR(36) | yes | -> `colleges.id`, indexed |
| `id` | VARCHAR(36) | no | primary key |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |


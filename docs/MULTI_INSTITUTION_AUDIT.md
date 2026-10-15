# Multi-institution architecture: Phase 1 audit and plan

Audit date: 2026-10-16, against `main` @ `73ac773`. This is an inspection of the existing code only; nothing has been changed for this feature yet.

## 1. What exists today

### Identity and roles
| Item | Today | Gap vs. the spec |
|---|---|---|
| `users` | `full_name, email, password_hash, role (student|teacher), status (active|pending|suspended)` | No admin roles of any kind; one global `role` per user |
| Sessions | server-side hashed session cookie, revocable, password reset revokes all | Reusable for admins, but needs a **separate** admin session/cookie and CSRF protection |
| Registration | `POST /auth/register {role, invite_code?}`; teacher role needs `TEACHER_INVITE_CODE` (closed in production if unset) | No institution selection, no approval; the invite code is the only teacher gate |
| Profiles | none (`student_profiles` / `teacher_profiles` do not exist) | Must be created; grade/language currently live only on courses |
| Demo credentials | `app/seed.py` creates `teacher@/student@eduvillage.org` with public passwords (refuses to run in production); the quick-fill buttons were removed from the login pages | Keep the production guard; remove demo accounts from any deployed database |

### Institutions
- There is **no** institution entity. `courses.institution` is a **free-text** column (added with the discovery fields; indexed, used as a filter and filled in by the teacher in the create-course form). This is exactly the "free-text institution used as an authoritative relationship" the spec forbids. `courses.region` is the same.
- No institution memberships, no approval workflow, no administrator concept.

### Courses, teaching, enrollment
| Item | Today | Gap |
|---|---|---|
| `courses` | `teacher_id` (owner), `status (draft|published|archived)`, `grade_level, language, institution(text), region(text)` | No `institution_id`, `visibility`, `enrollment_policy`, `created_by` distinct from owner |
| `course_teachers` | **already many-to-many** (`role owner|co_teacher`); only the owner can add/remove co-teachers; `is_teaching()` is the single authorization check | Needs `status`, `ended_at`, optional `institution_membership_id`; owner row is not materialized (owner = `courses.teacher_id`) |
| `course_enrollments` | exists: unique `(course, student)`, `active|removed`, self-enroll only in published courses | No enrollment policies (approval / private / institution-restricted) |
| Catalog | `GET /courses/catalog` (published only) with subject/grade/language/institution/region filters, paginated | Institution filter is text; no "prioritize my institution" |
| Course delete | collaborator added delete / force-delete | Conflicts with the spec's retention rule ("do not hard-delete courses with learning records"): needs review |

### Authorization and learning features
- `is_teaching / assert_enrolled / assert_owns_course` in `course_service` are the central checks; every recording, resource, assignment, summary and class check goes through them. **LiveKit tokens already require course teaching or active enrollment (plus section membership)**, so that requirement is met; it must be re-verified when memberships are added.
- Attendance = `class_participants` (join/leave rows). Progress = `recording_progress`. No grades table, no notifications table.
- Audit = `audit_events (actor, action, resource_type, resource_id, created_at)`: no institution scope, no IP, no before/after, no viewer endpoint.
- Rate limiting is in-process memory (documented limitation).

### Migration state
Alembic has one head (`d4e9e92dd07b`); migrations are tested on SQLite and PostgreSQL 18, including a data-preservation test that must be extended for every new revision.

## 2. Dependency map (what a change touches)

- `users.role` is referenced in ~35 places (`UserRole.teacher/student`) across services, schemas, dashboards and the frontend `ProtectedRoute`/`AuthContext`. Adding roles must not break these.
- `course_service.is_teaching` / `assert_enrolled` gate nearly every endpoint: the safest place to add institution rules is **inside these functions**, not in every router.
- `courses.institution` (text) is read by `course_service.list_catalog`, `schemas/course.py`, `api/v1/courses.py`, `TeacherCreateCoursePage` and the catalog UI.
- Registration touches `auth_service.register_user`, `schemas/auth.py`, `api/v1/auth.py`, `RegisterPage`, `AuthContext`, `authService`.
- Frontend portals: separate `LoginPage` (student/teacher), student and teacher layouts/sidebars/routes. A platform-admin area must live outside both.

## 3. Problems found (by the spec's checklist)

1. Free-text institution used as data (`courses.institution`, `region`). **Present.**
2. Automatic institution assignment at registration. **Absent** (there is no institution at all).
3. Direct teacher-student relationship duplicating enrollment. **Not present** (derived through `course_teachers` + enrollments: good).
4. Single-teacher courses. **Not present**: co-teachers already exist.
5. Missing membership status / approval / rejection. **Present (missing).**
6. Server-side authorization. Good for course scope; **none** for institution or admin scope (nothing to enforce yet).
7. Demo credentials in the frontend. **Not present** now (only `seed.py`, guarded).
8. LiveKit tokens without course membership validation. **Not present**: validated.
9. Teacher registration gated only by a shared invite code (anyone holding the code can claim to be a teacher anywhere). **Present**: to be replaced by per-institution approval.
10. Course hard delete (force delete) vs retention policy. **Present**: needs a decision.

## 4. Proposed design decisions (please confirm or change)

1. **Roles.** Keep `users.role` (`student|teacher`) for the two portals and add `platform_admin` as a third value used *only* by accounts created from the command line. **Institution Admin is not a user role**: it is an *active `institution_memberships` row with `membership_role = institution_admin`*, so one person can be a teacher everywhere and an admin at one institution only. Every authorization check takes the institution as an argument.
2. **Replace the teacher invite code with institution approval.** A teacher registers, selects an institution and is `pending` until that institution's admin approves. `TEACHER_INVITE_CODE` would be retired (or kept only as an optional extra gate). *Decision needed.*
3. **What a pending/rejected user can do.** Can sign in, see profile and membership status, browse public courses and enroll where policy allows. Cannot teach in, or access institution-restricted content of, an institution without an **active** membership.
4. **Existing data is not guessed.** No memberships are created for existing users, and the free-text `courses.institution` becomes `legacy_institution_name` (kept, never authoritative). A platform admin maps legacy names to real institutions by hand. **Grandfathering:** existing teachers keep teaching their existing courses (their `course_teachers`/owner rows are untouched); the new rules apply to creating *new* institution courses. Independent (institution-less) public courses are allowed while `ALLOW_INDEPENDENT_TEACHERS=true` (default true during the transition, so nobody loses access on deploy).
5. **First Platform Super Admin** is created with `python -m app.cli create-platform-admin` (password read from a prompt or env var, never from the repo). There is no public path to any admin role.
6. **Hidden admin console** at `/platform-console`: separate login endpoint, separate session cookie, CSRF header on every state-changing request, stricter rate limit, audit log entry for every sensitive action; security comes from the backend checks, not the URL.
7. **One table for requests**: `institution_memberships` with `pending` status *is* the request (resubmission = a new row after `rejected`; history preserved). A separate request table is not justified yet.
8. **Course deletion**: replace force-delete with archive when a course has enrollments, submissions or recordings; hard delete only for empty draft courses.

## 5. Migration plan (additive, reversible, one revision per step)

1. `institutions` (+ normalized unique key on `lower(trim(name))` per country/state, `slug` unique).
2. `institution_memberships` + constraints: unique active `(user, institution, role)`, partial unique index for one active primary per `(user, role)`, indexes on `(institution_id, status)`, `(user_id)`.
3. `student_profiles`, `teacher_profiles` (backfilled 1:1 for existing users with empty fields; no data guessed).
4. `notifications`; extend `audit_events` with `institution_id`, `ip`, `details (JSON)`.
5. `courses`: add `institution_id` (nullable FK), `visibility`, `enrollment_policy`, `created_by`; rename `institution` → `legacy_institution_name`. `course_teachers`: add `status`, `ended_at`, `institution_membership_id`.
6. `course_enrollments`: add `enrollment_source`, `completed_at`, status values for pending approval.
7. `UserRole.platform_admin` (varchar enum: no DDL change).
Each revision gets: upgrade → check → downgrade → upgrade on SQLite **and PostgreSQL**, plus rows-survive tests. Obsolete columns are removed only after nothing reads them.

## 6. API change list

- Public: `GET /institutions` (active only, searchable, paginated); `POST /auth/register` gains `institution_id` and profile fields; `POST /institution-requests` (ask the platform to add a missing institution, never auto-created).
- Account: `GET /users/me/memberships`; `POST /users/me/memberships` (request another institution, idempotent).
- Institution Admin (scoped to institutions they administer): list/view/approve/reject membership requests (transactional state machine, optimistic concurrency), list active teachers/students, institution dashboard stats (real queries).
- Platform admin (`/platform/…`, separate auth): login/logout; institution CRUD with suspend/archive (no hard delete when memberships/records exist); assign/replace institution admins; global membership queue (includes the no-admin fallback); users (suspend), audit log viewer.
- Courses: `institution_id`, `visibility`, `enrollment_policy`; enrollment approval endpoints; catalog prioritizing the student's primary institution.
- Notifications: `GET /notifications`, mark read; delivery failures never roll back a membership transaction.

## 7. Frontend change list (new screens reuse the existing design system)

Registration (institution selector from the API, student/teacher fields) · profile membership status/history and "request another institution" · institution-admin area (dashboard, request queue with filters, teachers, students) · hidden platform console (login + dashboard + institutions CRUD + admins + queue + audit log), not linked anywhere · course form (institution select instead of free text, visibility/enrollment policy) · catalog (institution-aware ordering) · notification bell.

## 8. Regression-test plan

Keep green: all existing backend (213), frontend (101) and browser tests. New: the spec's registration/membership/admin-security matrix (including concurrent approve-vs-reject, duplicate requests, no-admin fallback, notification failure, cross-institution access denial, self-promotion rejected), migration data-preservation tests per revision on SQLite and PostgreSQL, and browser tests for the hidden console login and the approval flow end to end.

## 9. Proposed phases (each independently shippable, tested and committed)

| Phase | Deliverable |
|---|---|
| A | `institutions` + hidden Platform Super Admin (CLI creation, separate login/session/CSRF, audit) + institution CRUD |
| B | Memberships, profiles, registration with institution selection, institution-admin queue and approval, fallback queue, notifications |
| C | Course ↔ institution link, visibility and enrollment policies, discovery, `is_teaching`/enrollment institution rules, course archive instead of force delete |
| D | Institution Admin and Platform Admin interfaces (frontend) |
| E | Free-text migration tooling, LiveKit/attendance/recording re-verification, audit-log viewer, production hardening and final audit |

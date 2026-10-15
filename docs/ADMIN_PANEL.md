# Admin panel and college management

Route: `/admin` (not linked from any page). The SPA rewrite in `frontend/vercel.json` already serves it on direct navigation and refresh.

## Configuration (server-side only)

| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME` | Admin sign-in name. Blank = admin login disabled. |
| `ADMIN_PASSWORD` | Admin password. Hashed with argon2 when the account is created; never stored or logged in plaintext. |
| `ADMIN_RESET_PASSWORD_ON_START` | `true` for one restart to replace the stored password with `ADMIN_PASSWORD`, then set back to `false`. |
| `ADMIN_SESSION_TTL_MINUTES` | Admin session lifetime (default 120). |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | Failed attempts per username / IP per 15 minutes (default 5). |

Set them in `backend/.env` locally (gitignored) and in the Render dashboard (`render.yaml` lists the keys with `sync: false`). None of them is a `VITE_` variable and none reaches the frontend bundle.
The account is created at API start-up (`admin_service.bootstrap_admin`) after `alembic upgrade head`.

## Security model

- Separate HttpOnly cookie (`eduvillage_admin_session`), server-side session with expiry and revocation on logout.
- Every `/api/v1/admin/*` route except login requires a valid admin session whose user has role `admin` (checked on every request). Student/teacher sessions are rejected, and admin sessions are rejected by the student/teacher API.
- Non-GET admin requests, including login, require the `X-EduVillage-Admin: 1` header (CSRF defence; CORS preflight blocks other origins).
- Generic login error, constant-time check for unknown usernames, failed-attempt rate limiting (in-process; use a shared store if the API runs on several instances).
- The admin role cannot be registered or used through `/auth/register`, `/auth/login` or password reset.

## College codes

`EV-XXXX-XXXX`, 8 symbols from a 32-symbol alphabet without 0/O/1/I (`secrets`, 40 bits). Unique indexes on the current code and on every retired code; collisions retry. Regenerating keeps the college id and moves the old code to `college_code_history` (never reissued, never resolves). `users.college_id` is nullable and not assigned to anyone; a code only identifies a college (`college_service.resolve_active_college_by_code`) and grants no privilege.

## Registration with colleges and sections

- Public, code-free lookups: `GET /api/v1/registration/colleges` (active only) and `GET /api/v1/registration/colleges/{id}/sections` (active sections of an active college).
- `POST /auth/register` accepts `college_id`, `section_id` and (teachers) `college_code`. Everything is validated before any row is written: college exists and is active, the code matches THAT college's current code (a wrong code and another college's code give the same error; retired codes fail), the section belongs to the college and is active. The role comes from the portal route but is checked server-side; `admin` can never be registered.
- Stored as `users.college_id` plus a `user_college_sections` row. A college section is NOT a course section: choosing one never enrols a student in a course or gives a teacher access to anyone's course.
- Administrators manage sections in /admin ("Sections" on each college). `TEACHER_COLLEGE_REQUIRED` (default true) makes the college fields mandatory for teachers; when false the old `TEACHER_INVITE_CODE` gate applies to teacher registrations that send no college.
- Real end-to-end run (real backend + SQLite + built frontend, no mocks): `npm run test:e2e:real` in `frontend/`.

## Branches, sections and "All Sections"

Hierarchy: College -> Branch (`college_branches`) -> Section (`college_sections`). A section's `(branch_id, college_id)` is a composite foreign key to the branch, so the database itself refuses a section that names another college. Names are unique per parent (case/spacing-insensitive). Admin endpoints: `GET/POST /admin/colleges/{id}/branches`, `PATCH /admin/branches/{id}`, `POST /admin/branches/{id}/status`, `GET/POST /admin/branches/{id}/sections`, `PATCH /admin/sections/{id}`, `POST /admin/sections/{id}/status`. Public (active only): `GET /registration/colleges/{id}/branches`, `GET /registration/branches/{id}/sections`.

Teacher assignment is either one college section (`user_college_sections`) or branch-wide (`user_branch_assignments`, sent as `all_sections: true`; no section row exists for it, and sections added later are covered). Students use the same college -> branch -> section choice but cannot pick "All Sections".

Class targeting (enforced in `teaching_scope_service`, used by `POST /classes` and course-section creation):
- a course section may carry `college_section_id`; a teacher can link only to a college section they are assigned to / whose branch they cover (unassigned teachers cannot link);
- a scoped teacher cannot address a cohort linked to another section/branch/college, and a whole-course class is refused if the course contains such cohorts (`SECTION_REQUIRED`);
- `all_branch_sections: true` (branch-wide teachers only) expands to every course section linked to an ACTIVE section of the branch at that moment;
- plain cohorts (no link) and unassigned legacy teachers behave exactly as before. Assignments never enrol students: participation still needs course enrollment and cohort membership.
`GET /users/me/teaching-scope` reports the caller's scope.

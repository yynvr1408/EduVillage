# Admin panel and college management

The administrator sets up institutions at `/admin` (not linked from any page; the SPA rewrite in `frontend/vercel.json` serves it on direct navigation and refresh). Related: [multi-college support](MULTI_INSTITUTION_AUDIT.md) · [API reference](API_CONTRACTS.md#admin) · [backend setup](BACKEND_SETUP.md) · [README](../README.md).

## Configuration (server side only)

| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | the administrator account, created at API start-up (`admin_service.bootstrap_admin`); the password is hashed with argon2 and never stored or logged in plaintext. Blank disables admin sign-in |
| `ADMIN_RESET_PASSWORD_ON_START` | `true` for one restart replaces the stored password with `ADMIN_PASSWORD`, then set it back to `false` |
| `ADMIN_SESSION_TTL_MINUTES` | session lifetime (default 120) |
| `ADMIN_IDLE_TIMEOUT_SECONDS` | idle timeout (default 120) |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | failed attempts per username and client per 15 minutes (default 5) |

Set them in `backend/.env` locally (git-ignored) and in the hosting dashboard (`render.yaml` lists the keys as `sync: false`). None of them is a `VITE_` variable and none reaches the frontend bundle.

## Security model

* Its own httpOnly cookie (`eduvillage_admin_session`) and server-side session with expiry, idle timeout and revocation on sign-out.
* **One active administrator session at a time:** a second sign-in with the correct password is refused while the first session is active; a session idle past the timeout counts as ended, so a forgotten sign-out never locks the administrator out.
* Every `/api/v1/admin/*` route except sign-in requires a valid administrator session, checked on every request. Student and teacher sessions are rejected there, and an administrator session is rejected by the student and teacher API.
* Requests that change data (including sign-in) carry the header `X-EduVillage-Admin: 1`; a cross-site form cannot add it and a cross-origin script is stopped by the CORS preflight.
* Generic sign-in errors, a constant-time check for unknown usernames, and rate limiting of failed attempts.
* The administrator role cannot be registered, signed in through `/auth/login`, or reset through password recovery, and nobody can self-register with the administrator's own email address. College codes never grant any privilege.

## What the administrator manages

| Item | Capabilities |
|---|---|
| Colleges | create (name required; optional location, contact email and phone), list with search, status filter and pagination, edit, activate or deactivate, copy the code, regenerate the code |
| College codes | `EV-XXXX-XXXX` from a 32-symbol alphabet without look-alikes (`secrets`, 40 bits); unique across current and retired codes; regenerating retires the old code permanently and keeps every relationship |
| Branches | add, rename, short code, search, activate or deactivate (with confirmation), per college |
| Sections | add, rename, search, activate or deactivate (with confirmation), per branch |
| Overview | total, active and inactive colleges, codes generated |

Names are unique per parent (case and spacing ignored). Deactivating a college, branch or section removes it from registration without touching existing accounts, assignments or classes. Every change is recorded in the audit log.

## Registration against these records

* Public lookups (active records only, never including codes): `GET /api/v1/registration/colleges`, `.../colleges/{id}/branches`, `.../branches/{id}/sections`.
* `POST /auth/register` accepts `college_id`, `branch_id`, `section_id` (or `all_sections` for teachers) and `college_code`. Everything is validated before any record is written: the college is active, the code matches that college's current code (a wrong code and another college's code give the same error; retired codes fail), the branch belongs to the college, the section belongs to the branch, and active status at every level.
* Stored as `users.college_id` plus a `user_college_sections` row, or a `user_branch_assignments` row for "All Sections". A college section is not a course section: choosing one never enrols a student in a course.
* `TEACHER_COLLEGE_REQUIRED` and `STUDENT_COLLEGE_REQUIRED` (default true) make these fields mandatory.

## Teaching scope and branch-wide classes

* A teacher can link a course cohort only to a college section they are assigned to (or any section of their branch for All Sections), and cannot address cohorts outside that scope; a whole-course class is refused if the course contains cohorts outside the teacher's scope.
* `all_branch_sections: true` (All Sections teachers only) creates one class with a branch audience: enrolled students of that branch see it under **Other Classes**, join the same single LiveKit room, and students of other branches or colleges cannot see or join it. The same check covers the class list, class detail, join tokens, summaries and recordings. `GET /users/me/teaching-scope` reports the caller's scope.

## Second-device sign-in

Student and teacher accounts already signed in elsewhere cannot be signed in again with the password alone. The correct password returns `202 {otp_required: true}` and a 6-digit code is emailed (EmailJS) to the account's own address; `POST /auth/login/verify-otp` redeems it, ends the other sessions and signs in the device that proved control of the mailbox. The same browser holding the user's valid session, accounts with no active session, and the administrator are unaffected. The approval email can use its own EmailJS template (`EMAILJS_LOGIN_TEMPLATE_ID`, falling back to the password-reset template). Codes last `OTP_TTL_MINUTES` (5), allow `OTP_MAX_ATTEMPTS` (5) tries, are single use and are separate from password-reset codes. `CONCURRENT_LOGIN_OTP=false` switches the rule off. Without EmailJS settings and outside production the code is returned as `dev_otp`.

Session lifetime: `SESSION_TTL_HOURS` = 72 for students and teachers.

## Tests

`backend/tests/api/test_admin.py`, `test_college_registration.py`, `test_branches.py`, `test_other_classes.py`, `test_login_otp.py`; `frontend/src/test/admin_panel.test.tsx`, `register_college.test.tsx`, `other_classes.test.tsx`; browser: `e2e-layout/admin.spec.ts` (responsive) and the real-stack `e2e-real/` suite (admin builds a college, people register, branch-wide classes appear). Run the real-stack suite with `npm run test:e2e:real` in `frontend/`.

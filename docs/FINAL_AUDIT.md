# Verification status

The current test results and the real-service runs behind them. Companion: [BACKEND_REQUIREMENTS_MATRIX.md](BACKEND_REQUIREMENTS_MATRIX.md) (what is tested where) and [RECORDING_VERIFICATION.md](RECORDING_VERIFICATION.md).

Results are from runs on the developer machine on 2026-10-16. "Faked" means an external boundary was replaced in the test; a fake proves LanternEd's own logic around it, so real-service runs are listed separately.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Backend, SQLite | `cd backend && pytest` | 421 passed, 1 skipped (a PostgreSQL-only constraint test) |
| Backend, PostgreSQL 18 | `TEST_DATABASE_URL=... pytest` | 422 passed |
| Migrations | `alembic upgrade head`, `check`, `downgrade -1`, `upgrade head` on SQLite and PostgreSQL | clean, single head |
| Frontend type-check and production build | `npx tsc -b && npm run build` | clean |
| Frontend unit and component tests | `npm test` | 179 passed (25 files) |
| Offline browser suite (real Chromium, production build, service worker) | `npm run test:e2e:offline` | 12 passed |
| Layout browser suite | `npm run test:e2e:layout` | 35 passed |
| Real-stack browser suite (real backend and database, built frontend, nothing mocked) | `npm run test:e2e:real` | 15 passed |
| Live LiveKit Cloud browser suite | `npm run test:e2e:live` | classroom tools and multi-student join passed |

## Runs against real services

* **LiveKit Cloud** (real project, real browsers with fake camera and microphone): several independently signed-in students join one real room; the teacher's floating video, the whiteboard (including a student who joins late), one and two shared screens and background blur were exercised. The synthetic media proves the features run and that data and tracks arrive; picture quality was not judged.
* **PostgreSQL 18**: the full backend suite and the migration chain.
* **Neon** (production database): schema and migration state inspected; the production database is never used by tests.
* **Real PDF and DOCX**: the syllabus importer reads a generated PDF; the notes export produces real PDF and DOCX bytes; attachments are validated against real file signatures.
* **S3 protocol**: the recording chain runs against an S3-compatible emulator over real HTTP.

## Highlights of what the suites cover

* Registration validation (college, code, branch, section), role enforcement, cross-college and cross-branch isolation, branch-wide class visibility and join-token authorisation.
* Sessions: second-device OTP, password-reset OTP (attempt limits, expiry, single use, purpose separation), administrator single-session and idle timeout.
* Courses (archive, restore, delete), syllabus import, enrolment and roster.
* Assignments: deadlines in UTC across SQLite and PostgreSQL, idempotent offline sync including simultaneous duplicates, PDF/DOC/DOCX attachments with content checks and size limits.
* Recording lifecycle, signed webhooks (unsigned, tampered and replayed events), signed playback, notes export.
* Layout without horizontal overflow at desktop, tablet and phone widths for the main pages, the admin panel and the registration form.

# Codebase structure: one backend, one API, one data layer

LanternEd was consolidated into a single backend with no parallel implementations. This note records the structure that results, so new work reuses it instead of adding a second path.

| Concern | The one implementation |
|---|---|
| Application entry point | `backend/app/main.py` |
| Routes | `backend/app/api/v1/*` under `/api/v1` (one file per domain) |
| Persistence | `backend/app/db/models/*` (one file per entity) with Alembic migrations in `backend/alembic/versions` |
| Database session | `backend/app/db/session.py` |
| Schemas | `backend/app/schemas/*` (one file per domain) |
| Authentication | `auth_service` and `dependencies.get_current_user` (server-side sessions in an httpOnly cookie); the administrator uses `admin_service` and `dependencies.get_current_admin` with its own cookie |
| Authorisation | service-level checks (`course_service`, `assignment_service`, `recording_service`, `teaching_scope_service`); never decided on the client |
| Frontend transport | `frontend/src/services/apiClient.ts` for the student and teacher portals; `adminApi.ts` for the administrator panel (its own cookie, CSRF header and session handling) |
| Recording pipeline | `integrations/livekit.py` and `recording_service` (LiveKit Egress to object storage, signed webhook) |
| File storage | `integrations/object_storage.py` (local disk in development, S3-compatible storage in production) |
| Colleges, branches, sections | `college_service` and the `colleges`, `college_branches`, `college_sections` tables (course "sections" are cohorts inside a course and are separate on purpose) |

Guidelines that keep it this way: add a route to the existing router for its domain; put rules in a service; add a migration as the next revision after the current head; reuse `apiClient` for new student and teacher calls; regenerate [API_CONTRACTS.md](API_CONTRACTS.md) and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) with `backend/scripts/generate_docs.py`.

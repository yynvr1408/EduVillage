# Deduplication Report

## Duplicate groups identified

Method: inspected both sides of the in-progress merge (`git show HEAD:` / `MERGE_HEAD:`), diffed the route tables (OpenAPI), and grepped for importers of each module before removing anything. A copy of the pre-cleanup legacy backend was archived outside the repo during the work; it is also in git history at commit `8544406`.

| Group | Versions | Active? | Unique behaviour in the older version | Canonical |
|---|---|---|---|---|
| FastAPI app / entry point | `main.py` importing legacy routers + conditionally mounting v1 | both (every route registered twice in different shapes) | seeding on start-up | `app/main.py` (v1 only) |
| Routers | `app/api/{auth,courses,classes,assignments,summaries,sync,materials,sections,recordings}.py` vs `app/api/v1/*.py` | both | sections, recorded-lecture library (publish/reuse/progress), materials | `app/api/v1/*` (+ new `sections.py`, `recordings.py`, `webhooks.py`) |
| Models | `app/database/models.py` vs `app/db/models/*` | both (two different `users` tables' worth of ORM) | `Section`, `Recording`, `RecordingProgress`, `Material` | `app/db/models/*` |
| DB session | `app/database/session.py` vs `app/db/session.py` | both | — | `app/db/session.py` |
| Schemas | `app/schemas/schemas.py` vs per-domain files | both | section/recording shapes | per-domain files |
| Authentication | `app/services/auth.py` (JWT) vs `app/services/auth_service.py` + `dependencies.py` (cookie sessions) | both | none worth keeping | `auth_service` + `dependencies.get_current_user` |
| Authorization | ad-hoc `require_role` in legacy routers vs `core/permissions` + service `assert_*` | both | none | services' `assert_*` |
| LiveKit token | `app/services/livekit_token.py` vs `app/integrations/livekit.py` | both | none | `integrations/livekit.py` |
| Class lifecycle | legacy `classes.py` handlers vs `classroom_service` | both (disagreed on status casing: `LIVE` vs `live`) | optional `section_id` | `classroom_service` |
| Recording logic | legacy `recordings.py` (client-supplied URL) vs `recording_service` | both | library/reuse/progress ideas | `recording_service` (rewritten to own the whole lifecycle) |
| Sync / submissions | legacy `sync.py`/`assignments.py` vs `synchronization_service`/`assignment_service` | both | none | the v1 services |
| Seed data | `services/seed.py` (called on every start-up) | legacy | demo accounts | `app/seed.py` (explicit CLI, refuses to run in production) |
| Tests | none (legacy) | — | — | `backend/tests` |
| Frontend API layer | `services/apiClient.ts` `api` object **and** five service files each re-implementing `apiRequest` calls | both | — | `services/apiClient.ts` is the only transport + mapper; service files delegate |
| Frontend starter test | `src/App.test.tsx` (Vite "count is 0" smoke test that fails against the real app) | stale | — | removed |

Legitimately kept (not duplicates): Alembic revisions `8c8eb922acdd` and `ad72faae9d99` (history preserved untouched), the `/api/v1` version prefix, `tests/api` vs `tests/unit`, the worker entry point (`app/worker.py`, distinct responsibility from the API).

## Consolidation performed

- Unique legacy behaviour ported into the canonical implementation: **sections** (`section_service`, `/courses/{id}/sections`, `/sections/{id}/members`, class↔section association), **recorded-lecture library** (`/recordings`, publish, share-with-section, progress), **material sharing**. Legacy "materials" (client-supplied URL) was *not* ported; the existing upload flow (`/resources/...`) is the single materials mechanism.
- Behaviour that was only "unique" because it was wrong (client-supplied `video_url`, unauthenticated listing, JWT in the browser) was dropped.
- `end_class` now stops active recordings through the same `recording_service`; the legacy download route `/classes/recordings/{id}/download` is kept as a thin alias over `recording_service.playback_info` so there is one signed-URL code path.

## Files removed

`backend/app/api/{assignments,auth,classes,courses,materials,recordings,sections,summaries,sync}.py`,
`backend/app/database/` (`models.py`, `session.py`, package),
`backend/app/schemas/schemas.py`,
`backend/app/services/{auth.py,livekit_token.py,seed.py}`,
`frontend/src/App.test.tsx`.

(`backend/app/api/__init__.py` and `backend/app/api/router.py` remain; the former is the package marker, the latter is the v1 router aggregator.)

## Import changes

- `app/main.py`: now imports only `app.api.router.api_router`; the `try/except ImportError` / `has_v1` switch and all legacy router imports are gone. A fresh `python -c "import app.main"` and the full test suite import cleanly.
- Frontend: `courseService`, `classService`, `summaryService`, `assignmentService`, `syncManager`, `authService`, `downloadManager` and three pages now import from `services/apiClient` (`api`, `apiUrl`, `ApiError`); the only callers of the raw transport `apiRequest` are `apiClient.ts` itself and the three auth calls in `authService` (`/auth/login`, `/auth/register`, `/auth/logout`).

## Migration considerations

- No historical migration was edited or deleted. The legacy `database/models.py` tables (`sections`, `recordings`, `materials`, `recording_progress`, `sync_logs`) were **never** in the Alembic history, so no migration drops them; a database created by the legacy `create_all` is a different schema and was not migrated (the dev `backend/eduvillage.db` file is git-ignored and left untouched).
- New revision `3f1a9c2b7d10` is additive. Non-null columns carry server defaults so existing rows stay valid. Existing recordings default to `is_published = false` (private until a teacher publishes) — a deliberate privacy-preserving backfill that teachers must act on once.

## Verification (executed)

- `alembic upgrade head` → `check` (no drift) → `downgrade ad72faae9d99` → `upgrade head`: SQLite and PostgreSQL 18.
- `tests/unit/test_migrations.py`: builds the pre-change schema, inserts rows, upgrades, asserts the rows survive.
- OpenAPI inspection: 83 operations, 83 unique (method, path) pairs — no route is registered twice.
- Backend suite: **159 passed** (SQLite); **157 passed** (PostgreSQL 18, migration subprocess tests excluded). Frontend: `tsc -b` clean, `vitest` **25 passed**, `vite build` succeeds.
- `grep` for removed module names (`app.database`, `services.auth`, `livekit_token`, `schemas.schemas`) finds no remaining references.

## Remaining duplication (with justification)

- `LocalObjectStorage`/`S3ObjectStorage` implement one interface — intentional.
- `recording_service.list_recordings_for_class` (teacher/class view) and `list_library` (cross-course view) both list recordings but answer different questions; both funnel authorization through the single `can_access`.
- Frontend: view-model mapping lives in one file but several pages still call `courseService.getCourses()` independently (N identical GETs per page load); this is a performance, not a correctness, duplication.

from fastapi import APIRouter

from app.api.v1 import (
    assignments,
    auth,
    classes,
    courses,
    dashboard,
    recordings,
    resources,
    sections,
    summaries,
    synchronization,
    users,
    webhooks,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(courses.router)
api_router.include_router(classes.router)
api_router.include_router(resources.router)
api_router.include_router(sections.router)
api_router.include_router(recordings.router)
api_router.include_router(webhooks.router)
api_router.include_router(assignments.router)
api_router.include_router(summaries.router)
api_router.include_router(synchronization.router)
api_router.include_router(dashboard.router)

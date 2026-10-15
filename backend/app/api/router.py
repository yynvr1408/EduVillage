from fastapi import APIRouter

from app.api.v1 import assignments, auth, classes, courses, dashboard, resources, summaries, synchronization, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(courses.router)
api_router.include_router(classes.router)
api_router.include_router(resources.router)
api_router.include_router(assignments.router)
api_router.include_router(summaries.router)
api_router.include_router(synchronization.router)
api_router.include_router(dashboard.router)

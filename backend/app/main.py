from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .services.seed import init_db_and_seed
from .api.auth import router as auth_router
from .api.courses import router as courses_router
from .api.classes import router as classes_router
from .api.assignments import router as assignments_router
from .api.summaries import router as summaries_router
from .api.sync import router as sync_router
from .api.materials import router as materials_router
from .api.sections import router as sections_router
from .api.recordings import router as recordings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB and seed baseline data
    init_db_and_seed()
    yield


app = FastAPI(
    title="EduVillage API",
    description="Backend API for EduVillage offline-first learning platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Preserve existing health check endpoint
@app.get("/health")
def health():
    return {"status": "ok"}


# Register API routers
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(classes_router)
app.include_router(assignments_router)
app.include_router(summaries_router)
app.include_router(sync_router)
app.include_router(materials_router)
app.include_router(sections_router)
app.include_router(recordings_router)


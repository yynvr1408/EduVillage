import os
import tempfile
import uuid

import pytest
from types import SimpleNamespace

# Must happen before any `app.*` import so Settings/engine pick up the test database.
_TEST_DB_PATH = tempfile.mktemp(suffix=".db")
# Set TEST_DATABASE_URL (e.g. a throwaway PostgreSQL database) to run the suite against another engine.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_TEST_DB_PATH}"
os.environ["APP_ENV"] = "test"
# Tests that process real media need an ffmpeg binary: use the system one, else the one bundled with imageio-ffmpeg.
import shutil as _shutil  # noqa: E402

if not _shutil.which("ffmpeg") and not os.environ.get("FFMPEG_PATH"):
    try:
        import imageio_ffmpeg  # noqa: E402

        os.environ["FFMPEG_PATH"] = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - ffmpeg-dependent tests are skipped when unavailable
        pass
os.environ["SESSION_COOKIE_NAME"] = "eduvillage_session"
# Legacy fixtures register teachers/students without a college; tests of the college rule switch this back on.
# Many existing tests sign the same user in from several clients; the second-device OTP rule has its own tests.
os.environ["CONCURRENT_LOGIN_OTP"] = "false"
os.environ["TEACHER_COLLEGE_REQUIRED"] = "false"
os.environ["STUDENT_COLLEGE_REQUIRED"] = "false"
# The suite is written against the local-disk storage backend and the labeled stub AI
# providers; a developer's real .env (real S3/LiveKit/LLM credentials) must not leak into
# tests, or they silently start hitting live third-party services instead of the fakes.
os.environ["STORAGE_BACKEND"] = "local"
# Tests assert against this exact origin (e.g. test_cors_exposes_range_headers_to_the_frontend_origin);
# a developer's real .env now legitimately points FRONTEND_ORIGIN at a deployed URL, which must not
# leak into the test process any more than the credentials below do.
os.environ["FRONTEND_ORIGIN"] = "http://localhost:5173"
# Set (not pop) to "": pydantic-settings reads backend/.env for any var absent from os.environ,
# so a bare pop() would still leak a developer's real .env values into the test process.
for _var in (
    "LLM_API_KEY", "LLM_BASE_URL",
    "SPEECH_TO_TEXT_API_KEY", "SPEECH_TO_TEXT_BASE_URL",
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
    "EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY",
):
    os.environ[_var] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.db import models  # noqa: E402,F401  (populates Base.metadata)
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _media_dir(tmp_path_factory):
    """Uploads made by tests go to a throwaway directory, not backend/media."""
    from app.integrations import object_storage

    object_storage.MEDIA_ROOT = tmp_path_factory.mktemp("media")
    yield


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()  # release SQLite's file handle before deleting it (Windows locks open files)
    if os.path.exists(_TEST_DB_PATH):
        os.remove(_TEST_DB_PATH)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    """For tests that exercise a service function directly rather than through the API."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture
def make_user(client):
    """Registers a user and returns (client_with_session_cookie, user_dict).
    Each call uses its own TestClient so sessions never leak between roles."""

    def _make(*, role: str, prefix: str = "user", password: str = "password123"):
        c = TestClient(app)
        email = unique_email(prefix)
        resp = c.post(
            "/api/v1/auth/register",
            json={"full_name": f"{prefix.title()} Example", "email": email, "password": password, "role": role},
        )
        assert resp.status_code == 201, resp.text
        return c, resp.json()["user"]

    return _make


@pytest.fixture
def teacher(make_user):
    return make_user(role="teacher", prefix="teacher")


@pytest.fixture
def student(make_user):
    return make_user(role="student", prefix="student")


@pytest.fixture
def published_course(teacher):
    client, _user = teacher
    resp = client.post(
        "/api/v1/courses", json={"title": "Intro to Biology", "description": "Basics", "status": "published"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def enrolled_student(student, published_course):
    client, user = student
    resp = client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert resp.status_code == 201, resp.text
    return student


@pytest.fixture
def published_assignment(teacher, published_course):
    client, _user = teacher
    resp = client.post(
        f"/api/v1/assignments?course_id={published_course['id']}",
        json={"title": "Cell structure quiz", "status": "published"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class FakeStorage:
    """In-memory stand-in for the S3 boundary. Real object storage is NOT exercised by tests."""

    def __init__(self):
        self.objects: dict[str, int] = {}
        self.deleted: list[str] = []

    def put(self, recording_id: str, class_id: str, size: int = 1234):
        self.objects[f"recordings/{class_id}/{recording_id}.mp4"] = size

    def put_key(self, key: str, size: int = 1234):
        self.objects[key] = size

    def verify_uploaded(self, key):
        return self.objects.get(key)

    def download_target(self, key, ttl_seconds=900):
        return {"method": "GET", "url": f"https://signed.example/{key}?ttl={ttl_seconds}", "stream": False}

    def delete(self, key):
        self.objects.pop(key, None)
        self.deleted.append(key)

    media_file = None  # a real media file served as the recording; set by the fixture

    def fetch_to_path(self, key, dest):
        import shutil

        if self.media_file is None:
            dest.write_bytes(b"audio")  # only for tests that never reach ffmpeg
        else:
            shutil.copyfile(self.media_file, dest)
        return dest


def ffmpeg_binary() -> str | None:
    import shutil

    return shutil.which(os.environ.get("FFMPEG_PATH") or "ffmpeg")


requires_ffmpeg = pytest.mark.skipif(ffmpeg_binary() is None, reason="ffmpeg is not available")


def make_audio(path, *, seconds: float, noise: bool = False, bitrate: str = "32k", rate: int = 16000):
    """Generates REAL audio with ffmpeg. noise=True gives incompressible CBR audio, so file size is
    exactly bitrate*seconds (used to build recordings that really exceed Whisper's 25 MB limit)."""
    import subprocess

    source = "anoisesrc=color=white:amplitude=0.3" if noise else "sine=frequency=440"
    subprocess.run(
        [ffmpeg_binary(), "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{source}:duration={seconds}",
         "-ac", "1", "-ar", str(rate), "-b:a", bitrate, str(path)],
        check=True, capture_output=True,
    )
    return path


@pytest.fixture(scope="session")
def short_audio(tmp_path_factory):
    """A real 4-second MP3 for tests that run the transcription pipeline on a small recording."""
    if ffmpeg_binary() is None:
        return None
    return make_audio(tmp_path_factory.mktemp("media") / "short.mp3", seconds=4)


@pytest.fixture
def fake_storage(monkeypatch, short_audio):
    storage = FakeStorage()
    storage.media_file = short_audio
    for target in ("app.services.recording_service.get_storage", "app.services.summary_service.get_storage"):
        monkeypatch.setattr(target, lambda: storage)
    return storage


@pytest.fixture
def mock_recording_pipeline(monkeypatch):
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    state = {"status": "recording", "last_egress_id": None}

    async def fake_start_recording(room_name: str, storage_key: str) -> str:
        state["last_egress_id"] = f"egress-{uuid.uuid4().hex[:10]}"
        return state["last_egress_id"]

    async def fake_stop_recording(egress_id: str) -> None:
        return None

    async def fake_get_egress_status(egress_id: str):
        from livekit.api import EgressStatus

        mapped = {
            "recording": EgressStatus.EGRESS_ACTIVE,
            "complete": EgressStatus.EGRESS_COMPLETE,
            "failed": EgressStatus.EGRESS_FAILED,
        }
        return SimpleNamespace(status=mapped[state["status"]])

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "start_recording", fake_start_recording)
    monkeypatch.setattr(livekit, "stop_recording", fake_stop_recording)
    monkeypatch.setattr(livekit, "get_egress_status", fake_get_egress_status)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")
    monkeypatch.setattr(livekit.settings, "storage_backend", "s3")
    monkeypatch.setattr(livekit.settings, "object_storage_bucket", "fake-bucket")
    monkeypatch.setattr(livekit.settings, "object_storage_access_key", "fake-access-key")
    monkeypatch.setattr(livekit.settings, "object_storage_secret_key", "fake-secret-key")
    monkeypatch.setattr(livekit.settings, "object_storage_region", "us-east-1")

    return state

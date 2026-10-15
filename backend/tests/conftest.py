import os
import tempfile
import uuid

import pytest

# Must happen before any `app.*` import so Settings/engine pick up the test database.
_TEST_DB_PATH = tempfile.mktemp(suffix=".db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ["APP_ENV"] = "test"
os.environ["SESSION_COOKIE_NAME"] = "eduvillage_session"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import models  # noqa: E402,F401  (populates Base.metadata)
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402


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

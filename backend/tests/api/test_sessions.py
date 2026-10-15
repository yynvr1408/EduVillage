"""Session management: lets a student on a shared/public device (a lab computer, a
borrowed phone) confirm no stray login is left behind — the "few devices" half of the
problem statement."""

from tests.conftest import unique_email


def test_lists_only_my_own_active_session(student):
    client, _user = student
    resp = client.get("/api/v1/users/me/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) == 1


def test_logging_in_from_a_second_device_shows_two_sessions(client):
    email = unique_email("shared")
    register = client.post(
        "/api/v1/auth/register",
        json={"full_name": "Shared Device User", "email": email, "password": "password123", "role": "student"},
    )
    assert register.status_code == 201

    from fastapi.testclient import TestClient
    from app.main import app

    second_device = TestClient(app)
    login = second_device.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200

    sessions = client.get("/api/v1/users/me/sessions").json()
    assert len(sessions) == 2


def test_revoke_specific_session_signs_it_out(client):
    email = unique_email("revoke")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Revoke Me", "email": email, "password": "password123", "role": "student"},
    )

    from fastapi.testclient import TestClient
    from app.main import app

    other_device = TestClient(app)
    other_device.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert other_device.get("/api/v1/users/me").status_code == 200

    sessions = client.get("/api/v1/users/me/sessions").json()
    assert len(sessions) == 2

    # Revoke both sessions individually (both belong to this user, so both succeed)
    for s in sessions:
        resp = client.delete(f"/api/v1/users/me/sessions/{s['id']}")
        assert resp.status_code == 204

    assert other_device.get("/api/v1/users/me").status_code == 401
    assert client.get("/api/v1/users/me").status_code == 401


def test_cannot_revoke_someone_elses_session(student, teacher):
    student_client, _ = student
    teacher_client, _ = teacher

    teacher_sessions = teacher_client.get("/api/v1/users/me/sessions").json()
    target_id = teacher_sessions[0]["id"]

    resp = student_client.delete(f"/api/v1/users/me/sessions/{target_id}")
    assert resp.status_code == 404  # existence not leaked either


def test_revoke_all_signs_out_other_devices_but_keeps_current(client):
    email = unique_email("revoke-all")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Revoke All", "email": email, "password": "password123", "role": "student"},
    )

    from fastapi.testclient import TestClient
    from app.main import app

    other_device = TestClient(app)
    other_device.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert other_device.get("/api/v1/users/me").status_code == 200

    resp = client.post("/api/v1/users/me/sessions/revoke-all")
    assert resp.status_code == 200
    assert resp.json()["revoked_count"] == 1

    assert client.get("/api/v1/users/me").status_code == 200  # current session survives
    assert other_device.get("/api/v1/users/me").status_code == 401  # other device signed out

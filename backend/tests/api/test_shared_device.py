"""Scenario E: shared device. The backend can't clear browser storage, but it must guarantee
that a signed-out/revoked/expired session reads nothing and that users are isolated."""

from datetime import timedelta

from fastapi.testclient import TestClient

from tests.conftest import unique_email


def _login(email, password="password123"):
    c = TestClient(__import__("app.main", fromlist=["app"]).app)
    resp = c.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return c


def test_student_a_signs_out_then_student_b_cannot_read_a_private_data(make_user, teacher, published_course, published_assignment):
    a_client, a_user = make_user(role="student", prefix="alice")
    a_client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    a_client.put(f"/api/v1/assignments/{published_assignment['id']}/submissions/me", json={"answer": {"text": "alice draft"}})
    assert a_client.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").status_code == 200

    # Alice signs out on the shared machine: her cookie must stop working server-side, even though
    # a browser that failed to clear it could still send it.
    stale_cookie = a_client.cookies.get("eduvillage_session")
    assert a_client.post("/api/v1/auth/logout").status_code == 204
    replay = TestClient(a_client.app)
    replay.cookies.set("eduvillage_session", stale_cookie)
    assert replay.get("/api/v1/users/me").status_code == 401
    assert replay.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").status_code == 401

    # Bob signs in on the same device and sees none of Alice's data.
    b_client, _ = make_user(role="student", prefix="bob")
    assert b_client.get("/api/v1/users/me").json()["id"] != a_user["id"]
    assert b_client.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").status_code in (403, 404)
    assert b_client.get(f"/api/v1/assignments/{published_assignment['id']}/submissions").status_code == 403
    assert b_client.get("/api/v1/recordings").json() == []


def test_expired_session_is_rejected(make_user, db_session):
    from app.db.base import utcnow
    from app.db.models.user import UserSession

    client, user = make_user(role="student", prefix="expiring")
    assert client.get("/api/v1/users/me").status_code == 200
    for session in db_session.query(UserSession).filter(UserSession.user_id == user["id"]):
        session.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()
    assert client.get("/api/v1/users/me").status_code == 401


def test_password_reset_does_not_leave_old_sessions_usable(make_user, client):
    c, user = make_user(role="student", prefix="reset")
    otp = client.post("/api/v1/auth/forgot-password", json={"email": user["email"]}).json().get("dev_otp")
    assert otp
    reset_token = client.post("/api/v1/auth/verify-reset-otp", json={"email": user["email"], "otp": otp}).json()["reset_token"]
    assert client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "brandnewpass1"}).status_code == 204
    # Resetting a password (e.g. after a lost shared-device login) must revoke existing sessions.
    assert c.get("/api/v1/users/me").status_code == 401
    assert _login(user["email"], "brandnewpass1").get("/api/v1/users/me").status_code == 200


def test_client_supplied_user_ids_are_never_trusted(make_user):
    a_client, a_user = make_user(role="student", prefix="victim")
    b_client, _ = make_user(role="student", prefix="attacker")
    # Only the session identifies the caller; there is no endpoint that takes a user id to read private data.
    assert b_client.get("/api/v1/users/me", params={"user_id": a_user["id"]}).json()["id"] != a_user["id"]
    assert b_client.get(f"/api/v1/users/{a_user['id']}").status_code in (404, 405)
    assert unique_email("x")

"""Nobody can grant themselves the teacher role by editing the registration payload."""

import pytest

from tests.conftest import unique_email


def _register(client, role, invite_code=None):
    body = {"full_name": "X Person", "email": unique_email("reg"), "password": "password123", "role": role}
    if invite_code is not None:
        body["invite_code"] = invite_code
    return client.post("/api/v1/auth/register", json=body)


@pytest.fixture
def invite_required(monkeypatch):
    from app.services import auth_service

    monkeypatch.setattr(auth_service.settings, "teacher_invite_code", "s3cret-invite")


def test_teacher_registration_needs_the_invite_code(client, invite_required):
    assert _register(client, "teacher").status_code == 403
    wrong = _register(client, "teacher", "nope")
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "INVALID_INVITE_CODE"
    assert _register(client, "teacher", "s3cret-invite").status_code == 201


def test_student_registration_never_needs_an_invite(client, invite_required):
    assert _register(client, "student").status_code == 201


def test_a_student_cannot_register_as_teacher_by_sending_an_invite_for_students(client, invite_required):
    resp = _register(client, "teacher", "")
    assert resp.status_code == 403


def test_teacher_registration_is_closed_in_production_without_an_invite_code(client, monkeypatch):
    from app.services import auth_service

    monkeypatch.setattr(auth_service.settings, "teacher_invite_code", None)
    monkeypatch.setattr(auth_service.settings, "app_env", "production")
    resp = _register(client, "teacher")
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "TEACHER_REGISTRATION_CLOSED"
    assert _register(client, "student").status_code == 201


def test_role_cannot_be_escalated_through_profile_update(student):
    client, _ = student
    resp = client.patch("/api/v1/users/me", json={"role": "teacher", "full_name": "Still Student"})
    assert resp.status_code in (200, 422)
    assert client.get("/api/v1/users/me").json()["role"] == "student"

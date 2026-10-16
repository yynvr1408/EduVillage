"""Registration requires proving control of the email address first (request-otp -> verify-otp ->
register with the resulting verification_token). The rest of the suite runs with this switched
off (see conftest.py's REQUIRE_REGISTRATION_OTP=false) so these are the tests that turn it back on
and exercise the real enforcement path end to end."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import auth_service
from tests.conftest import unique_email

BASE = "/api/v1/auth"


@pytest.fixture(autouse=True)
def _require_otp(monkeypatch):
    monkeypatch.setattr(auth_service.settings, "require_registration_otp", True)


@pytest.fixture
def client():
    return TestClient(app)


def _register_payload(email, role="student", **extra):
    return {"full_name": "Test Person", "email": email, "password": "password123", "role": role, **extra}


def _get_verified_token(client, email):
    r = client.post(f"{BASE}/register/request-otp", json={"email": email})
    assert r.status_code == 202, r.text
    otp = r.json()["dev_otp"]
    v = client.post(f"{BASE}/register/verify-otp", json={"email": email, "otp": otp})
    assert v.status_code == 200, v.text
    return v.json()["verification_token"]


def test_full_flow_request_verify_then_register_succeeds(client):
    email = unique_email("regotp")
    token = _get_verified_token(client, email)
    r = client.post(f"{BASE}/register", json=_register_payload(email, verification_token=token))
    assert r.status_code == 201, r.text
    assert r.json()["user"]["email"] == email


def test_registering_without_a_verification_token_is_rejected(client):
    email = unique_email("regotp")
    r = client.post(f"{BASE}/register", json=_register_payload(email))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_a_token_for_a_different_email_is_rejected(client):
    email_a = unique_email("regotp-a")
    email_b = unique_email("regotp-b")
    token = _get_verified_token(client, email_a)
    r = client.post(f"{BASE}/register", json=_register_payload(email_b, verification_token=token))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_a_token_cannot_be_reused_for_a_second_registration(client):
    email = unique_email("regotp")
    token = _get_verified_token(client, email)
    first = client.post(f"{BASE}/register", json=_register_payload(email, verification_token=token))
    assert first.status_code == 201

    other_email = unique_email("regotp-reuse")
    second = client.post(f"{BASE}/register", json=_register_payload(other_email, verification_token=token))
    assert second.status_code == 403
    assert second.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_incorrect_otp_is_rejected_and_attempts_are_capped(client):
    email = unique_email("regotp")
    r = client.post(f"{BASE}/register/request-otp", json={"email": email})
    real_otp = r.json()["dev_otp"]
    for _ in range(5):
        bad = client.post(f"{BASE}/register/verify-otp", json={"email": email, "otp": "000000"})
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "INVALID_OTP"
    # attempts on this challenge are now exhausted: even the real OTP for it is dead
    exhausted = client.post(f"{BASE}/register/verify-otp", json={"email": email, "otp": real_otp})
    assert exhausted.status_code == 401 and exhausted.json()["error"]["code"] == "INVALID_OTP"


def test_resend_cooldown_is_enforced(client, monkeypatch):
    monkeypatch.setattr(auth_service.settings, "otp_request_cooldown_seconds", 9999)
    email = unique_email("regotp")
    first = client.post(f"{BASE}/register/request-otp", json={"email": email})
    assert first.status_code == 202 and "dev_otp" in first.json()
    second = client.post(f"{BASE}/register/request-otp", json={"email": email})
    assert second.status_code == 202 and "dev_otp" not in second.json()  # same code still outstanding, not resent


def test_otp_expires(client, monkeypatch):
    monkeypatch.setattr(auth_service.settings, "otp_ttl_minutes", -1)  # already expired the instant it's created
    email = unique_email("regotp")
    r = client.post(f"{BASE}/register/request-otp", json={"email": email})
    otp = r.json()["dev_otp"]
    v = client.post(f"{BASE}/register/verify-otp", json={"email": email, "otp": otp})
    assert v.status_code == 401 and v.json()["error"]["code"] == "INVALID_OTP"


def test_requesting_an_otp_for_an_already_registered_email_is_rejected(client):
    email = unique_email("regotp")
    token = _get_verified_token(client, email)
    client.post(f"{BASE}/register", json=_register_payload(email, verification_token=token))

    r = client.post(f"{BASE}/register/request-otp", json={"email": email})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "EMAIL_TAKEN"


def test_blocked_email_cannot_even_request_a_registration_otp(client):
    r = client.post(f"{BASE}/register/request-otp", json={"email": "yynandhivardhanreddy@gmail.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "EMAIL_NOT_ALLOWED"


def test_teacher_registration_also_requires_verification(client):
    email = unique_email("regotp-teacher")
    token = _get_verified_token(client, email)
    r = client.post(f"{BASE}/register", json=_register_payload(email, role="teacher", verification_token=token))
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "teacher"


def test_invalid_email_format_is_rejected_before_any_otp_is_sent(client):
    r = client.post(f"{BASE}/register/request-otp", json={"email": "not-an-email"})
    assert r.status_code == 422


def test_login_and_role_based_access_still_work_after_otp_registration(client):
    email = unique_email("regotp-login")
    token = _get_verified_token(client, email)
    reg = client.post(f"{BASE}/register", json=_register_payload(email, verification_token=token))
    assert reg.status_code == 201
    client.post(f"{BASE}/logout")
    login = client.post(f"{BASE}/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    me = client.get(f"{BASE}/../users/me")
    assert me.status_code == 200 and me.json()["email"] == email

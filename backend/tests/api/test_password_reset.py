from tests.conftest import unique_email


def test_forgot_password_returns_token_in_dev_mode(client):
    email = unique_email("reset")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Reset Me", "email": email, "password": "original-password", "role": "student"},
    )
    resp = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "dev_mode_token_returned"
    assert body["reset_token"]


def test_forgot_password_unknown_email_does_not_leak_existence(client):
    resp = client.post("/api/v1/auth/forgot-password", json={"email": unique_email("ghost")})
    assert resp.status_code == 202
    assert resp.json()["reset_token"] is None


def test_reset_password_with_valid_token_then_login_with_new_password(client):
    email = unique_email("reset2")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Reset Two", "email": email, "password": "old-password", "role": "student"},
    )
    forgot = client.post("/api/v1/auth/forgot-password", json={"email": email})
    token = forgot.json()["reset_token"]

    reset = client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "new-password-123"})
    assert reset.status_code == 204

    old_login = client.post("/api/v1/auth/login", json={"email": email, "password": "old-password"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"email": email, "password": "new-password-123"})
    assert new_login.status_code == 200


def test_reset_password_with_invalid_token_rejected(client):
    resp = client.post("/api/v1/auth/reset-password", json={"token": "not-a-real-token", "new_password": "whatever123"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_reset_token_cannot_be_reused(client):
    email = unique_email("reset3")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Reset Three", "email": email, "password": "old-password", "role": "student"},
    )
    token = client.post("/api/v1/auth/forgot-password", json={"email": email}).json()["reset_token"]

    first = client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "first-new-pass"})
    assert first.status_code == 204

    second = client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "second-new-pass"})
    assert second.status_code == 401

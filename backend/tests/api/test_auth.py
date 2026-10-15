from tests.conftest import unique_email


def test_register_and_me(client):
    email = unique_email("alice")
    resp = client.post(
        "/api/v1/auth/register",
        json={"full_name": "Alice", "email": email, "password": "password123", "role": "student"},
    )
    assert resp.status_code == 201
    assert resp.json()["user"]["role"] == "student"

    me = client.get("/api/v1/users/me")
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_duplicate_email_rejected(client):
    email = unique_email("bob")
    payload = {"full_name": "Bob", "email": email, "password": "password123", "role": "teacher"}
    first = client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201

    second = client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "EMAIL_TAKEN"


def test_login_wrong_password_rejected(client):
    email = unique_email("carol")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Carol", "email": email, "password": "correct-password", "role": "student"},
    )
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_me_requires_authentication(client):
    resp = client.get("/api/v1/users/me")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


def test_logout_revokes_session(client):
    email = unique_email("dave")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Dave", "email": email, "password": "password123", "role": "student"},
    )
    assert client.get("/api/v1/users/me").status_code == 200

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204

    assert client.get("/api/v1/users/me").status_code == 401

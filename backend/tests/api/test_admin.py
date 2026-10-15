"""Admin panel: authentication, authorization and college management.

The admin credentials used here are random test-only values generated per run; the real ones live
only in server configuration.
"""

import secrets
import threading
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db.base import utcnow
from app.db.models.college import College, CollegeCodeHistory
from app.db.models.enums import UserRole
from app.db.models.sync_operation import AuditEvent
from app.db.models.user import User, UserSession
from app.main import app
from app.services import admin_service, college_service

CSRF = {"X-EduVillage-Admin": "1"}
BASE = "/api/v1/admin"


def _remove_admins(db):
    from sqlalchemy import delete, update

    ids = list(db.execute(select(User.id).where(User.role == UserRole.admin)).scalars())
    if ids:
        db.execute(update(AuditEvent).where(AuditEvent.actor_id.in_(ids)).values(actor_id=None))
        db.execute(update(College).where(College.created_by.in_(ids)).values(created_by=None))
        db.execute(update(CollegeCodeHistory).where(CollegeCodeHistory.replaced_by.in_(ids)).values(replaced_by=None))
        db.execute(delete(UserSession).where(UserSession.user_id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()


@pytest.fixture
def admin_creds(monkeypatch, db_session):
    settings = get_settings()
    username = f"admin-{secrets.token_hex(4)}"
    password = secrets.token_urlsafe(18)
    monkeypatch.setattr(settings, "admin_username", username)
    monkeypatch.setattr(settings, "admin_password", password)
    # Only one admin account exists: remove any left over from an earlier test.
    _remove_admins(db_session)
    admin_service.reset_rate_limits()
    admin_service.bootstrap_admin(db_session)
    yield username, password
    admin_service.reset_rate_limits()


@pytest.fixture
def admin_client(admin_creds):
    c = TestClient(app, headers=CSRF)
    r = c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]})
    assert r.status_code == 200, r.text
    return c


def _create(c, name=None, **extra):
    return c.post(f"{BASE}/colleges", json={"name": name or f"College {secrets.token_hex(4)}", **extra})


# ---- authentication -------------------------------------------------------------------------------

def test_login_success_sets_httponly_cookie_and_hashes_password(admin_creds, db_session):
    c = TestClient(app, headers=CSRF)
    r = c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]})
    assert r.status_code == 200
    assert r.json()["username"] == admin_creds[0]
    assert "httponly" in r.headers["set-cookie"].lower()
    assert admin_creds[1] not in r.text
    admin = db_session.execute(select(User).where(User.role == UserRole.admin)).scalar_one()
    assert admin.password_hash.startswith("$argon2") and admin_creds[1] not in admin.password_hash
    assert c.get(f"{BASE}/auth/me").json()["username"] == admin_creds[0]


def test_wrong_password_and_unknown_user_get_the_same_generic_error(admin_creds):
    c = TestClient(app, headers=CSRF)
    wrong = c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": "nope-nope"})
    unknown = c.post(f"{BASE}/auth/login", json={"username": "someone-else", "password": "nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_is_rate_limited(admin_creds, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_login_max_attempts", 3)
    c = TestClient(app, headers=CSRF)
    codes = [c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": "bad-pass-1"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    # Even the right password is refused while locked out.
    assert c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]}).status_code == 429


def test_login_requires_csrf_header(admin_creds):
    c = TestClient(app)  # no custom header
    r = c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF_REJECTED"


def test_unauthenticated_requests_are_rejected(admin_creds):
    c = TestClient(app, headers=CSRF)
    assert c.get(f"{BASE}/overview").status_code == 401
    assert c.get(f"{BASE}/colleges").status_code == 401
    assert _create(c).status_code == 401
    assert c.get(f"{BASE}/auth/me").status_code == 401


def test_mutations_without_csrf_header_are_rejected(admin_client):
    admin_client.headers.pop("X-EduVillage-Admin")
    assert _create(admin_client).status_code == 403


def test_students_and_teachers_cannot_use_admin_api(admin_creds, student, teacher):
    for client, _ in (student, teacher):
        client.headers.update(CSRF)
        assert client.get(f"{BASE}/overview").status_code == 401
        assert _create(client).status_code == 401
        # Even a user token planted in the admin cookie slot grants nothing.
        token = client.cookies.get(get_settings().session_cookie_name)
        c = TestClient(app, headers=CSRF, cookies={get_settings().admin_cookie_name: token})
        assert c.get(f"{BASE}/overview").status_code == 401


def test_admin_cannot_sign_in_or_be_created_through_normal_flows(admin_creds, client):
    r = client.post("/api/v1/auth/login", json={"email": f"{admin_creds[0]}@example.com", "password": admin_creds[1]})
    assert r.status_code == 401
    r = client.post("/api/v1/auth/register", json={"full_name": "X Y", "email": "x@example.com", "password": "password123", "role": "admin"})
    assert r.status_code == 422


def test_admin_session_token_does_not_work_on_student_api(admin_client, db_session):
    token = admin_client.cookies.get(get_settings().admin_cookie_name)
    c = TestClient(app, cookies={get_settings().session_cookie_name: token})
    assert c.get("/api/v1/users/me").status_code == 401


def test_logout_invalidates_the_session(admin_client):
    token = admin_client.cookies.get(get_settings().admin_cookie_name)
    assert admin_client.post(f"{BASE}/auth/logout").status_code == 204
    replay = TestClient(app, headers=CSRF, cookies={get_settings().admin_cookie_name: token})
    assert replay.get(f"{BASE}/overview").status_code == 401


def test_expired_session_is_rejected(admin_client, db_session):
    for s in db_session.execute(select(UserSession)).scalars():
        s.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()
    assert admin_client.get(f"{BASE}/overview").status_code == 401


def test_session_lifetime_follows_configuration(admin_creds, monkeypatch, db_session):
    monkeypatch.setattr(get_settings(), "admin_session_ttl_minutes", 7)
    c = TestClient(app, headers=CSRF)
    c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]})
    newest = db_session.execute(select(UserSession).order_by(UserSession.created_at.desc())).scalars().first()
    assert timedelta(minutes=6) < newest.expires_at - utcnow() <= timedelta(minutes=7)


def test_no_admin_login_when_unconfigured(monkeypatch, db_session):
    settings = get_settings()
    _remove_admins(db_session)
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password", None)
    admin_service.bootstrap_admin(db_session)
    assert db_session.execute(select(User).where(User.role == UserRole.admin)).first() is None


def test_bootstrap_is_idempotent_and_reset_flag_changes_password(admin_creds, monkeypatch, db_session):
    admin_service.bootstrap_admin(db_session)
    assert len(list(db_session.execute(select(User).where(User.role == UserRole.admin)).scalars())) == 1
    new_password = secrets.token_urlsafe(18)
    settings = get_settings()
    monkeypatch.setattr(settings, "admin_password", new_password)
    admin_service.bootstrap_admin(db_session)  # flag off: old password still works
    c = TestClient(app, headers=CSRF)
    assert c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]}).status_code == 200
    monkeypatch.setattr(settings, "admin_reset_password_on_start", True)
    admin_service.bootstrap_admin(db_session)
    admin_service.reset_rate_limits()
    assert c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]}).status_code == 401
    assert c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": new_password}).status_code == 200


def test_credentials_never_written_to_audit_log(admin_client, admin_creds, db_session):
    for ev in db_session.execute(select(AuditEvent)).scalars():
        blob = f"{ev.action} {ev.resource_type} {ev.resource_id}"
        assert admin_creds[1] not in blob


# ---- colleges -------------------------------------------------------------------------------------

def test_create_college_generates_secure_code_and_persists(admin_client, db_session):
    r = _create(admin_client, name="  Rural   Science College ", location="Pune", contact_email="office@example.com")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Rural Science College" and body["status"] == "active"
    assert college_service.CODE_PATTERN.match(body["code"])
    assert body["code"] != body["id"]
    stored = db_session.get(College, body["id"])
    assert stored.code == body["code"] and stored.created_by is not None
    assert admin_client.get(f"{BASE}/colleges/{body['id']}").json()["code"] == body["code"]


def test_create_validation(admin_client):
    assert admin_client.post(f"{BASE}/colleges", json={"name": "A"}).status_code == 422
    assert admin_client.post(f"{BASE}/colleges", json={"name": "Valid", "contact_email": "not-an-email"}).status_code == 422


def test_invalid_custom_code_rejected(admin_client):
    r = admin_client.post(f"{BASE}/colleges", json={"name": "Custom Code College", "code": "bad-code"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_COLLEGE_CODE"


def test_duplicate_code_rejected(admin_client):
    code = _create(admin_client).json()["code"]
    r = admin_client.post(f"{BASE}/colleges", json={"name": "Other College", "code": code})
    assert r.status_code == 409 and r.json()["error"]["code"] == "COLLEGE_CODE_TAKEN"


def test_duplicate_name_and_location_rejected_case_insensitively(admin_client):
    name = f"Dup {secrets.token_hex(3)}"
    assert _create(admin_client, name=name, location="Delhi").status_code == 201
    r = _create(admin_client, name=name.upper(), location=" delhi ")
    assert r.status_code == 409 and r.json()["error"]["code"] == "COLLEGE_EXISTS"
    assert _create(admin_client, name=name, location="Mumbai").status_code == 201


def test_concurrent_creation_yields_unique_codes(admin_creds):
    results, errors = [], []

    def worker(i):
        c = TestClient(app, headers=CSRF)
        c.post(f"{BASE}/auth/login", json={"username": admin_creds[0], "password": admin_creds[1]})
        r = _create(c, name=f"Concurrent {secrets.token_hex(4)} {i}")
        (results if r.status_code == 201 else errors).append(r)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors, [e.text for e in errors]
    codes = [r.json()["code"] for r in results]
    assert len(codes) == len(set(codes)) == 8


def test_code_collision_is_retried(admin_client, monkeypatch):
    existing = _create(admin_client).json()["code"]
    draws = iter([existing, existing, "EV-ZZZZ-2222"])
    monkeypatch.setattr(college_service, "generate_code", lambda: next(draws))
    r = _create(admin_client)
    assert r.status_code == 201 and r.json()["code"] == "EV-ZZZZ-2222"


def test_generated_codes_are_well_formed_and_distinct():
    codes = {college_service.generate_code() for _ in range(2000)}
    assert len(codes) == 2000
    assert all(college_service.CODE_PATTERN.match(c) for c in codes)
    assert college_service.normalize_code("ev k7qm 2xpd") == "EV-K7QM-2XPD"


def test_list_search_filter_and_pagination(admin_client):
    tag = secrets.token_hex(4)
    for i in range(3):
        _create(admin_client, name=f"Alpha{tag} {i}", location="Nashik")
    inactive = _create(admin_client, name=f"Beta{tag}", location="Goa", status="inactive").json()
    page = admin_client.get(f"{BASE}/colleges", params={"search": f"alpha{tag}", "limit": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["limit"] == 2
    page2 = admin_client.get(f"{BASE}/colleges", params={"search": f"alpha{tag}", "limit": 2, "offset": 2}).json()
    assert len(page2["items"]) == 1
    by_loc = admin_client.get(f"{BASE}/colleges", params={"search": "goa", "status": "inactive"}).json()
    assert inactive["id"] in [c["id"] for c in by_loc["items"]]
    by_code = admin_client.get(f"{BASE}/colleges", params={"search": inactive["code"].lower()}).json()
    assert [c["id"] for c in by_code["items"]] == [inactive["id"]]
    assert admin_client.get(f"{BASE}/colleges", params={"status": "bogus"}).status_code == 422


def test_edit_college(admin_client):
    c = _create(admin_client, location="Old").json()
    r = admin_client.patch(f"{BASE}/colleges/{c['id']}", json={"location": "New Town", "contact_phone": "+91 98765 43210"})
    assert r.status_code == 200 and r.json()["location"] == "New Town" and r.json()["code"] == c["code"]
    other = _create(admin_client, location="New Town").json()
    clash = admin_client.patch(f"{BASE}/colleges/{other['id']}", json={"name": c["name"]})
    assert clash.status_code == 409
    assert admin_client.patch(f"{BASE}/colleges/nope", json={"location": "x1"}).status_code == 404


def test_activate_and_deactivate(admin_client, db_session):
    c = _create(admin_client).json()
    r = admin_client.post(f"{BASE}/colleges/{c['id']}/status", json={"status": "inactive"})
    assert r.status_code == 200 and r.json()["status"] == "inactive"
    assert college_service.resolve_active_college_by_code(db_session, c["code"]) is None
    admin_client.post(f"{BASE}/colleges/{c['id']}/status", json={"status": "active"})
    db_session.expire_all()
    assert college_service.resolve_active_college_by_code(db_session, c["code"].lower()).id == c["id"]
    assert admin_client.post(f"{BASE}/colleges/{c['id']}/status", json={"status": "weird"}).status_code == 422


def test_regenerate_code_retires_old_code(admin_client, db_session):
    c = _create(admin_client).json()
    r = admin_client.post(f"{BASE}/colleges/{c['id']}/regenerate-code")
    assert r.status_code == 200
    new = r.json()
    assert new["id"] == c["id"] and new["code"] != c["code"]
    assert db_session.execute(select(CollegeCodeHistory).where(CollegeCodeHistory.code == c["code"])).scalar_one().college_id == c["id"]
    # The retired code can neither be resolved nor reissued.
    assert college_service.resolve_active_college_by_code(db_session, c["code"]) is None
    taken = admin_client.post(f"{BASE}/colleges", json={"name": "Reuse Old Code", "code": c["code"]})
    assert taken.status_code == 409


def test_overview_counts_come_from_the_database(admin_client):
    before = admin_client.get(f"{BASE}/overview").json()
    a = _create(admin_client).json()
    _create(admin_client, status="inactive")
    admin_client.post(f"{BASE}/colleges/{a['id']}/regenerate-code")
    after = admin_client.get(f"{BASE}/overview").json()
    assert after["total_colleges"] == before["total_colleges"] + 2
    assert after["active_colleges"] == before["active_colleges"] + 1
    assert after["inactive_colleges"] == before["inactive_colleges"] + 1
    assert after["total_codes_generated"] == before["total_codes_generated"] + 3


def test_college_actions_are_audited(admin_client, db_session):
    c = _create(admin_client).json()
    admin_client.post(f"{BASE}/colleges/{c['id']}/regenerate-code")
    actions = {e.action for e in db_session.execute(select(AuditEvent).where(AuditEvent.resource_id == c["id"])).scalars()}
    assert {"college_created", "college_code_regenerated"} <= actions


def test_existing_users_are_not_assigned_a_college(student, db_session):
    _, user = student
    assert db_session.get(User, user["id"]).college_id is None

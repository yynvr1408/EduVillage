"""Registration against admin-managed colleges and sections (real API + database, no mocks)."""

import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.db.models.college import College, UserCollegeSection
from app.db.models.course import CourseEnrollment
from app.db.models.enums import UserRole
from app.db.models.section import SectionMember
from app.db.models.user import User
from app.main import app
from app.services import admin_service

from tests.api.test_admin import BASE, CSRF, _remove_admins  # noqa: F401

REG = "/api/v1/registration"


@pytest.fixture
def admin(monkeypatch, db_session):
    settings = get_settings()
    monkeypatch.setattr(settings, "teacher_college_required", True)
    username, password = f"admin-{secrets.token_hex(4)}", secrets.token_urlsafe(18)
    monkeypatch.setattr(settings, "admin_username", username)
    monkeypatch.setattr(settings, "admin_password", password)
    _remove_admins(db_session)
    admin_service.reset_rate_limits()
    admin_service.bootstrap_admin(db_session)
    c = TestClient(app, headers=CSRF)
    assert c.post(f"{BASE}/auth/login", json={"username": username, "password": password}).status_code == 200
    return c


def make_college(admin, sections=("CSE-A", "CSE-B"), status="active"):
    college = admin.post(f"{BASE}/colleges", json={"name": f"Reg College {secrets.token_hex(4)}", "status": status}).json()
    branch = admin.post(f"{BASE}/colleges/{college['id']}/branches", json={"name": "Computer Science", "short_code": "CSE"}).json()
    college["_branch_id"] = branch["id"]
    secs = [admin.post(f"{BASE}/branches/{branch['id']}/sections", json={"name": n}).json() for n in sections]
    return college, secs


def register(college=None, section=None, code="__use_college__", role="teacher", email=None, password="password123", all_sections=False, **extra):
    c = TestClient(app)
    body = {"full_name": "Reg Tester", "email": email or f"reg-{secrets.token_hex(4)}@example.com", "password": password, "role": role, **extra}
    if college:
        body["college_id"] = college["id"]
        if code == "__use_college__":
            code = college["code"]
        if code is not None:
            body["college_code"] = code
    if section:
        body["section_id"] = section["id"]
    if college:
        body["branch_id"] = (section or {}).get("branch_id") or college.get("_branch_id")
    if all_sections:
        body["all_sections"] = True
    return c, c.post("/api/v1/auth/register", json=body)


# ---- registration lookups --------------------------------------------------------------------------

# ---- teachers --------------------------------------------------------------------------------------

def test_teacher_registers_with_college_code_and_section_and_it_persists(admin, db_session):
    college, secs = make_college(admin)
    client, r = register(college, secs[1])
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    assert user["role"] == "teacher"
    assert client.get("/api/v1/users/me").status_code == 200  # existing post-registration session
    db_session.expire_all()
    row = db_session.get(User, user["id"])
    assert row.college_id == college["id"] and row.role == UserRole.teacher
    links = db_session.execute(select(UserCollegeSection).where(UserCollegeSection.user_id == user["id"])).scalars().all()
    assert [l.college_section_id for l in links] == [secs[1]["id"]]


def test_code_is_case_and_spacing_tolerant(admin):
    college, secs = make_college(admin)
    _, r = register(college, secs[0], code=college["code"].lower().replace("-", " "))
    assert r.status_code == 201, r.text


@pytest.mark.parametrize("bad", ["EV-AAAA-2222", "", "nonsense", None])
def test_wrong_or_missing_code_rejected_and_no_account_created(admin, db_session, bad):
    college, secs = make_college(admin)
    email = f"nobody-{secrets.token_hex(4)}@example.com"
    _, r = register(college, secs[0], code=bad, email=email)
    assert r.status_code in (403, 422), r.text
    assert r.json()["error"]["code"] in {"INVALID_COLLEGE_CODE", "VALIDATION_FAILED"}
    assert db_session.execute(select(User).where(User.email == email)).first() is None


def test_another_colleges_code_is_rejected_with_the_same_error_as_a_wrong_code(admin):
    a, a_secs = make_college(admin)
    b, _ = make_college(admin)
    _, other = register(a, a_secs[0], code=b["code"])
    _, wrong = register(a, a_secs[0], code="EV-AAAA-2222")
    assert other.status_code == wrong.status_code
    assert other.json()["error"]["code"] == wrong.json()["error"]["code"] == "INVALID_COLLEGE_CODE"
    assert other.json()["error"]["message"] == wrong.json()["error"]["message"]


def test_retired_code_no_longer_registers(admin):
    college, secs = make_college(admin)
    admin.post(f"{BASE}/colleges/{college['id']}/regenerate-code")
    _, r = register(college, secs[0])  # still the OLD code
    assert r.json()["error"]["code"] == "INVALID_COLLEGE_CODE"


def test_inactive_college_rejects_teachers_and_students(admin, db_session):
    college, secs = make_college(admin)
    admin.post(f"{BASE}/colleges/{college['id']}/status", json={"status": "inactive"})
    _, t = register(college, secs[0])
    _, s = register(college, secs[0], role="student")
    for r in (t, s):
        assert r.status_code == 409 and r.json()["error"]["code"] == "COLLEGE_INACTIVE"


def test_section_from_another_college_or_nonexistent_is_rejected(admin, db_session):
    a, a_secs = make_college(admin)
    _, b_secs = make_college(admin)
    _, cross = register(a, b_secs[0])
    assert cross.status_code == 422 and cross.json()["error"]["code"] == "INVALID_BRANCH"  # B's branch is not A's
    _, ghost = register(a, {"id": "00000000-0000-0000-0000-000000000000"})
    assert ghost.json()["error"]["code"] == "INVALID_SECTION"
    _, junk = register(a, {"id": "not-an-id"})
    assert junk.json()["error"]["code"] == "INVALID_SECTION"


def test_inactive_section_rejected(admin):
    college, secs = make_college(admin)
    admin.post(f"{BASE}/sections/{secs[0]['id']}/status", json={"status": "inactive"})
    _, r = register(college, secs[0])
    assert r.status_code == 409 and r.json()["error"]["code"] == "SECTION_INACTIVE"


def test_missing_section_or_college_rejected(admin):
    college, secs = make_college(admin)
    _, no_section = register(college, None)
    assert no_section.json()["error"]["code"] == "SECTION_REQUIRED"
    _, nothing = register(None, None)
    assert nothing.status_code == 422 and nothing.json()["error"]["code"] == "COLLEGE_REQUIRED"
    c = TestClient(app)
    r = c.post("/api/v1/auth/register", json={"full_name": "A B", "email": "x@example.com", "password": "password123", "role": "teacher", "section_id": secs[0]["id"]})
    assert r.json()["error"]["code"] == "COLLEGE_REQUIRED"
    missing_name = c.post("/api/v1/auth/register", json={"email": "y@example.com", "password": "password123", "role": "teacher"})
    assert missing_name.status_code == 422


def test_duplicate_email_conflicts_and_leaves_existing_account_untouched(admin, db_session):
    college, secs = make_college(admin)
    email = f"dupe-{secrets.token_hex(4)}@example.com"
    assert register(college, secs[0], email=email)[1].status_code == 201
    _, again = register(college, secs[1], email=email)
    assert again.status_code == 409 and again.json()["error"]["code"] == "EMAIL_TAKEN"
    user = db_session.execute(select(User).where(User.email == email)).scalar_one()
    links = db_session.execute(select(UserCollegeSection).where(UserCollegeSection.user_id == user.id)).scalars().all()
    assert [l.college_section_id for l in links] == [secs[0]["id"]]


def test_short_password_rejected(admin):
    college, secs = make_college(admin)
    _, r = register(college, secs[0], password="short")
    assert r.status_code == 422


def test_role_and_college_cannot_be_forged(admin, db_session):
    college, secs = make_college(admin)
    _, as_admin = register(college, secs[0], role="admin")
    assert as_admin.status_code == 422
    # A college code never turns into admin rights.
    client, ok = register(college, secs[0])
    assert ok.status_code == 201
    client.headers.update(CSRF)
    assert client.get(f"{BASE}/overview").status_code == 401


def test_teacher_without_college_is_rejected_when_required_and_legacy_gate_still_works_when_not(admin, monkeypatch):
    _, r = register(None, None)
    assert r.status_code == 422
    monkeypatch.setattr(get_settings(), "teacher_college_required", False)
    _, legacy = register(None, None)
    assert legacy.status_code == 201


# ---- students --------------------------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["EV-AAAA-2222", "", "nonsense", None])
def test_student_wrong_or_missing_code_rejected_and_no_account_created(admin, db_session, bad):
    college, secs = make_college(admin)
    email = f"nobody-{secrets.token_hex(4)}@example.com"
    _, r = register(college, secs[0], code=bad, role="student", email=email)
    assert r.status_code in (403, 422), r.text
    assert r.json()["error"]["code"] in {"INVALID_COLLEGE_CODE", "VALIDATION_FAILED"}
    assert db_session.execute(select(User).where(User.email == email)).first() is None


def test_students_and_teachers_share_one_college_code_not_separate_systems(admin):
    college, secs = make_college(admin)
    # A different college's code is rejected for a student exactly as it is for a teacher.
    other, _ = make_college(admin)
    _, r = register(college, secs[0], code=other["code"], role="student")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_COLLEGE_CODE"
    # The college's own real code works for a student, same as for a teacher.
    _, ok = register(college, secs[0], role="student")
    assert ok.status_code == 201


def test_student_without_college_is_rejected_when_required_and_legacy_gate_still_works_when_not(admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "student_college_required", True)
    _, r = register(None, None, role="student")
    assert r.status_code == 422 and r.json()["error"]["code"] == "COLLEGE_REQUIRED"
    monkeypatch.setattr(get_settings(), "student_college_required", False)
    _, legacy = register(None, None, role="student")
    assert legacy.status_code == 201


def test_student_cannot_register_for_all_sections(admin):
    college, secs = make_college(admin)
    _, r = register(college, None, role="student", all_sections=True)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_SECTION"


def test_student_registers_with_college_code_and_section_and_is_not_enrolled_anywhere(admin, db_session):
    college, secs = make_college(admin)
    client, r = register(college, secs[0], role="student")
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    db_session.expire_all()
    assert db_session.get(User, uid).college_id == college["id"]
    links = db_session.execute(select(UserCollegeSection).where(UserCollegeSection.user_id == uid)).scalars().all()
    assert [l.college_section_id for l in links] == [secs[0]["id"]]
    # Choosing a college section does not enrol the student in a course or a course section.
    assert db_session.execute(select(func.count()).select_from(CourseEnrollment).where(CourseEnrollment.student_id == uid)).scalar_one() == 0
    assert db_session.execute(select(func.count()).select_from(SectionMember).where(SectionMember.student_id == uid)).scalar_one() == 0
    assert client.get("/api/v1/courses").json() == []


def test_teacher_in_a_section_does_not_gain_access_to_students_or_their_course_data(published_course, admin):
    college, secs = make_college(admin)
    teacher_client, _ = register(college, secs[0])
    student_client, _ = register(college, secs[0], role="student")
    assert student_client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={}).status_code == 201  # normal rules
    # Sharing a college section gives the new teacher no rights over another teacher's course or students.
    me = student_client.get("/api/v1/users/me").json()
    assert teacher_client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={"student_id": me["id"]}).status_code == 403
    assert teacher_client.get(f"/api/v1/courses/{published_course['id']}/enrollments").status_code in (403, 404)
    assert teacher_client.get(f"/api/v1/courses/{published_course['id']}/sections").status_code in (403, 404)


def test_student_registration_stays_backward_compatible_without_college(client):
    r = client.post("/api/v1/auth/register", json={"full_name": "Old Flow", "email": f"old-{secrets.token_hex(4)}@example.com", "password": "password123", "role": "student"})
    assert r.status_code == 201


def test_student_cross_college_section_rejected(admin):
    a, _ = make_college(admin)
    _, b_secs = make_college(admin)
    _, r = register(a, b_secs[0], role="student")  # a's code, but b's section
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_BRANCH"


def test_existing_login_still_works_for_college_users(admin):
    college, secs = make_college(admin)
    email = f"login-{secrets.token_hex(4)}@example.com"
    assert register(college, secs[0], email=email)[1].status_code == 201
    r = TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "teacher"


def test_deactivating_a_college_keeps_existing_users_and_links(admin, db_session):
    college, secs = make_college(admin)
    _, r = register(college, secs[0])
    uid = r.json()["user"]["id"]
    admin.post(f"{BASE}/colleges/{college['id']}/status", json={"status": "inactive"})
    db_session.expire_all()
    assert db_session.get(User, uid).college_id == college["id"]
    assert db_session.execute(select(func.count()).select_from(UserCollegeSection).where(UserCollegeSection.user_id == uid)).scalar_one() == 1
    assert TestClient(app).post("/api/v1/auth/login", json={"email": r.json()["user"]["email"], "password": "password123"}).status_code == 200

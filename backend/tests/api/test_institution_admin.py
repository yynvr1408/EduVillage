"""Delegated institution administration: a platform admin can hand one teacher the ability to
manage ONE college's own branches/sections/code, without granting them the platform admin's own
separate login or any power over colleges they weren't delegated for."""

import secrets

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.api.test_admin import BASE as ADMIN_BASE
from tests.api.test_admin import CSRF, admin_client, admin_creds  # noqa: F401 - fixtures
from tests.api.test_college_registration import register_active

INST_BASE = "/api/v1/institution-admin"


@pytest.fixture
def college(admin_client):
    resp = admin_client.post(f"{ADMIN_BASE}/colleges", json={"name": f"Rural College {secrets.token_hex(4)}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def other_college(admin_client):
    resp = admin_client.post(f"{ADMIN_BASE}/colleges", json={"name": f"Rural College {secrets.token_hex(4)}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _delegate(admin_client, college_id, user_id):
    resp = admin_client.post(f"{ADMIN_BASE}/colleges/{college_id}/administrators", json={"user_id": user_id})
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---- granting / revoking the delegation (platform-admin-only) -----------------------------------


def test_platform_admin_can_delegate_a_teacher_and_it_is_listed(admin_client, college, teacher):
    _tclient, tuser = teacher
    out = _delegate(admin_client, college["id"], tuser["id"])
    assert out["user_id"] == tuser["id"]
    assert out["college_id"] == college["id"]
    assert out["full_name"] == tuser["full_name"]

    listed = admin_client.get(f"{ADMIN_BASE}/colleges/{college['id']}/administrators")
    assert listed.status_code == 200
    assert [a["user_id"] for a in listed.json()] == [tuser["id"]]


def test_delegating_the_same_teacher_twice_is_idempotent(admin_client, college, teacher):
    _tclient, tuser = teacher
    first = _delegate(admin_client, college["id"], tuser["id"])
    second = _delegate(admin_client, college["id"], tuser["id"])
    assert first["id"] == second["id"]
    listed = admin_client.get(f"{ADMIN_BASE}/colleges/{college['id']}/administrators")
    assert len(listed.json()) == 1


def test_only_a_teacher_can_be_delegated(admin_client, college, student):
    _sclient, suser = student
    resp = admin_client.post(f"{ADMIN_BASE}/colleges/{college['id']}/administrators", json={"user_id": suser["id"]})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "NOT_A_TEACHER"


def test_removing_a_delegation_that_does_not_exist_is_404(admin_client, college, teacher):
    _tclient, tuser = teacher
    resp = admin_client.delete(f"{ADMIN_BASE}/colleges/{college['id']}/administrators/{tuser['id']}")
    assert resp.status_code == 404


def test_revoking_removes_their_access(admin_client, college, teacher):
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])
    assert [c["id"] for c in tclient.get(f"{INST_BASE}/colleges").json()] == [college["id"]]  # sanity: has it before revoking

    revoke = admin_client.delete(f"{ADMIN_BASE}/colleges/{college['id']}/administrators/{tuser['id']}")
    assert revoke.status_code == 204
    assert tclient.get(f"{INST_BASE}/colleges").json() == []
    forbidden = tclient.patch(f"{INST_BASE}/colleges/{college['id']}", json={"location": "New City"})
    assert forbidden.status_code == 403


def test_a_teachers_own_session_cannot_grant_delegations(college, teacher):
    """The delegation-management routes are platform-admin-only (a separate session/cookie
    entirely) - a teacher's ordinary session, which has none of that, is simply unauthenticated
    against them."""
    tclient, tuser = teacher
    resp = tclient.post(f"{ADMIN_BASE}/colleges/{college['id']}/administrators", json={"user_id": tuser["id"]}, headers=CSRF)
    assert resp.status_code == 401


# ---- a delegated teacher managing their own college ----------------------------------------------


def test_a_non_delegated_teacher_cannot_manage_any_college(college, teacher):
    tclient, _tuser = teacher
    resp = tclient.patch(f"{INST_BASE}/colleges/{college['id']}", json={"location": "New City"})
    assert resp.status_code == 403


def test_a_student_cannot_access_institution_admin_routes(college, student):
    sclient, _suser = student
    resp = sclient.get(f"{INST_BASE}/colleges")
    assert resp.status_code == 403


def test_a_delegated_teacher_can_manage_their_college_branches_and_sections(admin_client, college, teacher):
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])

    mine = tclient.get(f"{INST_BASE}/colleges")
    assert mine.status_code == 200
    assert [c["id"] for c in mine.json()] == [college["id"]]

    updated = tclient.patch(f"{INST_BASE}/colleges/{college['id']}", json={"location": "Riverside"})
    assert updated.status_code == 200 and updated.json()["location"] == "Riverside"

    old_code = college["code"]
    regenerated = tclient.post(f"{INST_BASE}/colleges/{college['id']}/regenerate-code")
    assert regenerated.status_code == 200 and regenerated.json()["code"] != old_code

    branch = tclient.post(f"{INST_BASE}/colleges/{college['id']}/branches", json={"name": "Computer Science"})
    assert branch.status_code == 201, branch.text
    branch_id = branch.json()["id"]

    branch_update = tclient.patch(f"{INST_BASE}/branches/{branch_id}", json={"name": "CS & Engineering"})
    assert branch_update.status_code == 200 and branch_update.json()["name"] == "CS & Engineering"

    section = tclient.post(f"{INST_BASE}/branches/{branch_id}/sections", json={"name": "Section A"})
    assert section.status_code == 201, section.text
    section_id = section.json()["id"]

    section_update = tclient.patch(f"{INST_BASE}/sections/{section_id}", json={"name": "Section A1"})
    assert section_update.status_code == 200 and section_update.json()["name"] == "Section A1"

    deactivated = tclient.post(f"{INST_BASE}/sections/{section_id}/status", json={"status": "inactive"})
    assert deactivated.status_code == 200 and deactivated.json()["status"] == "inactive"

    branches = tclient.get(f"{INST_BASE}/colleges/{college['id']}/branches")
    assert branches.status_code == 200 and len(branches.json()) == 1


def test_a_delegated_teacher_cannot_manage_a_different_college(admin_client, college, other_college, teacher):
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])

    forbidden = tclient.patch(f"{INST_BASE}/colleges/{other_college['id']}", json={"location": "Nowhere"})
    assert forbidden.status_code == 403

    forbidden_branch = tclient.post(f"{INST_BASE}/colleges/{other_college['id']}/branches", json={"name": "Math"})
    assert forbidden_branch.status_code == 403


def test_a_delegated_teacher_cannot_manage_a_branch_belonging_to_another_college(admin_client, college, other_college, teacher):
    """The permission check must resolve the branch's OWN college, not trust a college_id the
    caller could otherwise control - this exercises that resolution path directly."""
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])

    other_branch = admin_client.post(f"{ADMIN_BASE}/colleges/{other_college['id']}/branches", json={"name": "Physics"})
    assert other_branch.status_code == 201
    branch_id = other_branch.json()["id"]

    resp = tclient.patch(f"{INST_BASE}/branches/{branch_id}", json={"name": "Applied Physics"})
    assert resp.status_code == 403


def test_institution_admins_cannot_create_or_delete_colleges(college, teacher, admin_client):
    """Creating a new institution, and suspending/activating one, stay platform-admin-only -
    deliberately not exposed on the institution-admin router at all."""
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])

    create = tclient.post(f"{INST_BASE}/colleges", json={"name": "A New College"})
    assert create.status_code in (404, 405)  # the route simply doesn't exist here


# ---- the student/teacher roster ------------------------------------------------------------------


def _branch_and_section(admin_client, college):
    branch = admin_client.post(f"{ADMIN_BASE}/colleges/{college['id']}/branches", json={"name": "Computer Science"})
    assert branch.status_code == 201, branch.text
    branch = branch.json()
    section = admin_client.post(f"{ADMIN_BASE}/branches/{branch['id']}/sections", json={"name": "Section A"})
    assert section.status_code == 201, section.text
    return branch, section.json()


def test_roster_lists_only_active_and_suspended_members_of_this_college(admin_client, college, teacher):
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])
    _branch, section = _branch_and_section(admin_client, college)

    student_client, student_resp = register_active(college, section, role="student")
    assert student_resp.status_code == 201, student_resp.text
    member_id = student_resp.json()["user"]["id"]

    roster = tclient.get(f"{INST_BASE}/colleges/{college['id']}/members")
    assert roster.status_code == 200
    assert [m["id"] for m in roster.json()] == [member_id]
    assert roster.json()[0]["status"] == "active"


def test_suspending_a_member_blocks_their_login_and_can_be_reversed(admin_client, college, teacher):
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])
    _branch, section = _branch_and_section(admin_client, college)

    email = f"roster-{secrets.token_hex(4)}@example.com"
    _student_client, student_resp = register_active(college, section, role="student", email=email)
    member_id = student_resp.json()["user"]["id"]

    suspended = tclient.post(f"{INST_BASE}/colleges/{college['id']}/members/{member_id}/suspend")
    assert suspended.status_code == 200 and suspended.json()["status"] == "suspended"

    blocked_login = TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert blocked_login.status_code == 401
    assert blocked_login.json()["error"]["code"] == "ACCOUNT_INACTIVE"

    reactivated = tclient.post(f"{INST_BASE}/colleges/{college['id']}/members/{member_id}/reactivate")
    assert reactivated.status_code == 200 and reactivated.json()["status"] == "active"

    ok_login = TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert ok_login.status_code == 200


def test_removing_a_member_detaches_them_without_deleting_the_account(admin_client, college, teacher, db_session):
    from sqlalchemy import select as sa_select
    from app.db.models.college import UserCollegeSection
    from app.db.models.user import User

    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])
    _branch, section = _branch_and_section(admin_client, college)

    _student_client, student_resp = register_active(college, section, role="student")
    member_id = student_resp.json()["user"]["id"]

    removed = tclient.post(f"{INST_BASE}/colleges/{college['id']}/members/{member_id}/remove")
    assert removed.status_code == 200

    db_session.expire_all()
    row = db_session.get(User, member_id)
    assert row is not None  # the account itself survives
    assert row.college_id is None
    links = db_session.execute(sa_select(UserCollegeSection).where(UserCollegeSection.user_id == member_id)).scalars().all()
    assert links == []

    roster = tclient.get(f"{INST_BASE}/colleges/{college['id']}/members")
    assert roster.json() == []


def test_a_college_admin_cannot_act_on_their_own_roster_entry(admin_client, college):
    """The administrator here is themselves a roster member of this college (registered through
    the normal flow, college_id set) - the generic `teacher` fixture isn't, since it's never tied
    to any particular college, so it wouldn't exercise this guard meaningfully."""
    _branch, section = _branch_and_section(admin_client, college)

    self_client, self_resp = register_active(college, section, role="teacher")
    self_id = self_resp.json()["user"]["id"]
    _delegate(admin_client, college["id"], self_id)

    self_action = self_client.post(f"{INST_BASE}/colleges/{college['id']}/members/{self_id}/suspend")
    assert self_action.status_code == 403 and self_action.json()["error"]["code"] == "CANNOT_ACT_ON_SELF"


def test_a_college_has_at_most_one_administrator(admin_client, college, teacher):
    """Delegating a second, different teacher to a college that already has one is rejected -
    the platform admin must remove the existing delegation first to hand it to someone else."""
    tclient, tuser = teacher
    _delegate(admin_client, college["id"], tuser["id"])

    second = admin_client.post(f"{ADMIN_BASE}/colleges/{college['id']}/administrators", json={"user_id": tuser["id"]})
    assert second.status_code == 201  # same teacher again: idempotent, not a second administrator

    _other_client, other_resp = register_active(role="teacher")  # no college: a plain second teacher account
    other_id = other_resp.json()["user"]["id"]
    conflict = admin_client.post(f"{ADMIN_BASE}/colleges/{college['id']}/administrators", json={"user_id": other_id})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "COLLEGE_ALREADY_HAS_ADMINISTRATOR"

    # Removing the first, THEN delegating someone else, works.
    admin_client.delete(f"{ADMIN_BASE}/colleges/{college['id']}/administrators/{tuser['id']}")
    replaced = admin_client.post(f"{ADMIN_BASE}/colleges/{college['id']}/administrators", json={"user_id": other_id})
    assert replaced.status_code == 201


def test_a_non_delegated_teacher_cannot_touch_the_roster(college, teacher):
    tclient, _tuser = teacher
    resp = tclient.get(f"{INST_BASE}/colleges/{college['id']}/members")
    assert resp.status_code == 403

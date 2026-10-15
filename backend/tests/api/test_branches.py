"""College -> branch -> section management, branch-wide ("All Sections") teacher assignments and the
class-targeting rules built on them. Real API and database, no mocks."""

import os
import secrets
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.db.models.college import CollegeBranch, CollegeSection, UserBranchAssignment, UserCollegeSection
from app.db.models.section import Section, SectionMember
from app.db.models.user import User
from app.main import app
from app.services import admin_service

from tests.api.test_admin import BASE, CSRF, _remove_admins
from tests.api.test_college_registration import admin, register  # noqa: F401  (fixture reuse)

REG = "/api/v1/registration"
BACKEND = Path(__file__).resolve().parents[2]


def new_college(admin):
    return admin.post(f"{BASE}/colleges", json={"name": f"Branch College {secrets.token_hex(4)}"}).json()


def new_branch(admin, college, name, sections=()):
    b = admin.post(f"{BASE}/colleges/{college['id']}/branches", json={"name": name, "short_code": name[:3].upper()}).json()
    secs = [admin.post(f"{BASE}/branches/{b['id']}/sections", json={"name": n}).json() for n in sections]
    return b, secs


@pytest.fixture
def campus(admin):
    """College with CSE (A, B), ECE (A) and a second, unrelated college."""
    college = new_college(admin)
    cse, (cse_a, cse_b) = new_branch(admin, college, "Computer Science", ["Section A", "Section B"])
    ece, (ece_a,) = new_branch(admin, college, "Electronics", ["Section A"])
    other = new_college(admin)
    other_branch, (other_a,) = new_branch(admin, other, "Computer Science", ["Section A"])
    return dict(college=college, cse=cse, cse_a=cse_a, cse_b=cse_b, ece=ece, ece_a=ece_a, other=other, other_branch=other_branch, other_a=other_a)


def reg_teacher(college, branch, section=None, all_sections=False, code="__use_college__", **kw):
    c = college
    body_section = section
    client, r = register(c, body_section, code=code, all_sections=all_sections, **kw)
    return client, r


def teacher_payload(college, branch, section=None, all_sections=False, code=None, email=None):
    body = {
        "full_name": "Scope Teacher", "email": email or f"scope-{secrets.token_hex(4)}@example.com", "password": "password123",
        "role": "teacher", "college_id": college["id"], "college_code": code or college["code"], "branch_id": branch["id"],
    }
    if section:
        body["section_id"] = section["id"]
    if all_sections:
        body["all_sections"] = True
    return body


def sign_up(payload):
    c = TestClient(app)
    r = c.post("/api/v1/auth/register", json=payload)
    return c, r


# ---- admin: branches and sections ------------------------------------------------------------------

def test_branches_and_sections_form_a_persisted_hierarchy(admin, campus):
    branches = admin.get(f"{BASE}/colleges/{campus['college']['id']}/branches").json()
    assert {b["name"] for b in branches} == {"Computer Science", "Electronics"}
    assert all(b["college_id"] == campus["college"]["id"] for b in branches)
    cse_sections = admin.get(f"{BASE}/branches/{campus['cse']['id']}/sections").json()
    assert [s["name"] for s in cse_sections] == ["Section A", "Section B"]
    assert all(s["branch_id"] == campus["cse"]["id"] and s["college_id"] == campus["college"]["id"] for s in cse_sections)
    # the other college has its own, separate tree
    assert [b["name"] for b in admin.get(f"{BASE}/colleges/{campus['other']['id']}/branches").json()] == ["Computer Science"]


def test_duplicate_names_rejected_only_within_the_same_parent(admin, campus):
    dup = admin.post(f"{BASE}/colleges/{campus['college']['id']}/branches", json={"name": " computer   science "})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "BRANCH_EXISTS"
    # same branch name in another college is fine
    assert admin.post(f"{BASE}/colleges/{campus['other']['id']}/branches", json={"name": "Electronics"}).status_code == 201
    dup_s = admin.post(f"{BASE}/branches/{campus['cse']['id']}/sections", json={"name": "section a"})
    assert dup_s.status_code == 409 and dup_s.json()["error"]["code"] == "SECTION_EXISTS"
    # "Section A" exists under ECE as well: same name under a different branch is fine
    assert any(s["name"] == "Section A" for s in admin.get(f"{BASE}/branches/{campus['ece']['id']}/sections").json())


def test_edit_and_deactivate_branch_and_section(admin, campus):
    b = admin.patch(f"{BASE}/branches/{campus['ece']['id']}", json={"name": "Electronics and Communication", "short_code": "ECE"}).json()
    assert b["name"] == "Electronics and Communication" and b["short_code"] == "ECE"
    clash = admin.patch(f"{BASE}/branches/{campus['ece']['id']}", json={"name": "Computer Science"})
    assert clash.status_code == 409
    s = admin.patch(f"{BASE}/sections/{campus['cse_b']['id']}", json={"name": "Section Z"}).json()
    assert s["name"] == "Section Z"
    assert admin.patch(f"{BASE}/sections/{campus['cse_b']['id']}", json={"name": "Section A"}).status_code == 409
    assert admin.post(f"{BASE}/sections/{campus['cse_b']['id']}/status", json={"status": "inactive"}).json()["status"] == "inactive"
    assert admin.post(f"{BASE}/branches/{campus['ece']['id']}/status", json={"status": "inactive"}).json()["status"] == "inactive"
    assert admin.get(f"{BASE}/branches/{campus['cse']['id']}/sections", params={"search": "z"}).json()[0]["id"] == campus["cse_b"]["id"]
    assert admin.get(f"{BASE}/colleges/{campus['college']['id']}/branches", params={"search": "comp"}).json()[0]["id"] == campus["cse"]["id"]
    assert admin.patch(f"{BASE}/branches/nope", json={"name": "Whatever"}).status_code == 404


def test_branch_and_section_endpoints_require_admin(admin, campus, student):
    anon = TestClient(app, headers=CSRF)
    assert anon.post(f"{BASE}/colleges/{campus['college']['id']}/branches", json={"name": "Hack"}).status_code == 401
    assert anon.get(f"{BASE}/branches/{campus['cse']['id']}/sections").status_code == 401
    client, _ = student
    client.headers.update(CSRF)
    assert client.post(f"{BASE}/branches/{campus['cse']['id']}/sections", json={"name": "X"}).status_code == 401
    assert client.patch(f"{BASE}/sections/{campus['cse_a']['id']}", json={"name": "X"}).status_code == 401
    assert client.post(f"{BASE}/branches/{campus['cse']['id']}/status", json={"status": "inactive"}).status_code == 401


def test_database_rejects_a_section_whose_college_differs_from_its_branch(admin, campus, db_session):
    if db_session.bind.dialect.name == "sqlite":
        pytest.skip("SQLite does not enforce foreign keys by default; verified on PostgreSQL")
    bad = CollegeSection(college_id=campus["other"]["id"], branch_id=campus["cse"]["id"], name="Bad", name_key="bad")
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---- registration lookups --------------------------------------------------------------------------

def test_registration_lists_only_active_branches_and_sections_live(admin, campus):
    pub = TestClient(app)
    names = lambda url: [x["name"] for x in pub.get(url).json()]  # noqa: E731
    assert names(f"{REG}/colleges/{campus['college']['id']}/branches") == ["Computer Science", "Electronics"]
    assert names(f"{REG}/branches/{campus['cse']['id']}/sections") == ["Section A", "Section B"]
    new_sec = admin.post(f"{BASE}/branches/{campus['cse']['id']}/sections", json={"name": "Section C"})
    assert names(f"{REG}/branches/{campus['cse']['id']}/sections")[-1] == "Section C"  # live, no redeploy
    admin.post(f"{BASE}/sections/{new_sec.json()['id']}/status", json={"status": "inactive"})
    assert "Section C" not in names(f"{REG}/branches/{campus['cse']['id']}/sections")
    admin.post(f"{BASE}/branches/{campus['ece']['id']}/status", json={"status": "inactive"})
    assert names(f"{REG}/colleges/{campus['college']['id']}/branches") == ["Computer Science"]
    assert pub.get(f"{REG}/branches/{campus['ece']['id']}/sections").status_code == 404
    admin.post(f"{BASE}/colleges/{campus['college']['id']}/status", json={"status": "inactive"})
    assert pub.get(f"{REG}/colleges/{campus['college']['id']}/branches").status_code == 404
    assert pub.get(f"{REG}/branches/{campus['cse']['id']}/sections").status_code == 404


# ---- teacher registration --------------------------------------------------------------------------

def test_teacher_single_section_assignment_persists_as_a_section_link(admin, campus, db_session):
    _, r = sign_up(teacher_payload(campus["college"], campus["cse"], campus["cse_b"]))
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    db_session.expire_all()
    assert db_session.get(User, uid).college_id == campus["college"]["id"]
    links = db_session.execute(select(UserCollegeSection).where(UserCollegeSection.user_id == uid)).scalars().all()
    assert [l.college_section_id for l in links] == [campus["cse_b"]["id"]]
    assert db_session.execute(select(func.count()).select_from(UserBranchAssignment).where(UserBranchAssignment.user_id == uid)).scalar_one() == 0


def test_all_sections_is_a_branch_assignment_not_a_fake_section(admin, campus, db_session):
    before = db_session.execute(select(func.count()).select_from(CollegeSection)).scalar_one()
    _, r = sign_up(teacher_payload(campus["college"], campus["cse"], all_sections=True))
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    db_session.expire_all()
    assert db_session.execute(select(UserBranchAssignment.branch_id).where(UserBranchAssignment.user_id == uid)).scalars().all() == [campus["cse"]["id"]]
    assert db_session.execute(select(func.count()).select_from(UserCollegeSection).where(UserCollegeSection.user_id == uid)).scalar_one() == 0
    assert db_session.execute(select(func.count()).select_from(CollegeSection)).scalar_one() == before  # no section row created
    assert not db_session.execute(select(CollegeSection).where(func.lower(CollegeSection.name).like("%all sections%"))).first()


@pytest.mark.parametrize(
    "mutate,code",
    [
        (lambda p, c: p.update(branch_id=c["other_branch"]["id"]), "INVALID_BRANCH"),  # another college's branch
        (lambda p, c: p.update(section_id=c["ece_a"]["id"]), "INVALID_SECTION"),  # another branch's section
        (lambda p, c: p.update(section_id=c["other_a"]["id"]), "INVALID_SECTION"),  # another college's section
        (lambda p, c: p.update(section_id=c["cse_a"]["id"], all_sections=True), "INVALID_SECTION"),  # both at once
        (lambda p, c: p.update(branch_id="00000000-0000-0000-0000-000000000000"), "INVALID_BRANCH"),
        (lambda p, c: p.pop("branch_id"), "BRANCH_REQUIRED"),
        (lambda p, c: p.update(college_code="EV-AAAA-2222"), "INVALID_COLLEGE_CODE"),
        (lambda p, c: p.update(college_code=c["other"]["code"]), "INVALID_COLLEGE_CODE"),
    ],
)
def test_inconsistent_teacher_selections_are_rejected_without_creating_an_account(admin, campus, db_session, mutate, code):
    p = teacher_payload(campus["college"], campus["cse"], campus["cse_a"])
    mutate(p, campus)
    _, r = sign_up(p)
    assert r.status_code in (403, 422), r.text
    assert r.json()["error"]["code"] == code
    assert db_session.execute(select(User).where(User.email == p["email"])).first() is None


def test_inactive_branch_or_section_cannot_be_selected(admin, campus):
    admin.post(f"{BASE}/sections/{campus['cse_b']['id']}/status", json={"status": "inactive"})
    _, r = sign_up(teacher_payload(campus["college"], campus["cse"], campus["cse_b"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "SECTION_INACTIVE"
    admin.post(f"{BASE}/branches/{campus['ece']['id']}/status", json={"status": "inactive"})
    for kwargs in ({"section": campus["ece_a"]}, {"all_sections": True}):
        _, r = sign_up(teacher_payload(campus["college"], campus["ece"], **kwargs))
        assert r.status_code == 409 and r.json()["error"]["code"] == "BRANCH_INACTIVE"


def test_students_use_the_same_hierarchy_but_cannot_pick_all_sections(admin, campus, db_session):
    p = teacher_payload(campus["college"], campus["cse"], campus["cse_a"])
    p.update(role="student")
    p.pop("college_code")
    c, r = sign_up(p)
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    assert db_session.execute(select(UserCollegeSection.college_section_id).where(UserCollegeSection.user_id == uid)).scalars().all() == [campus["cse_a"]["id"]]
    bad = teacher_payload(campus["college"], campus["cse"], all_sections=True)
    bad.update(role="student")
    _, r2 = sign_up(bad)
    assert r2.status_code == 422 and r2.json()["error"]["code"] == "INVALID_SECTION"
    wrong_branch = teacher_payload(campus["college"], campus["ece"], campus["cse_a"])
    wrong_branch.update(role="student")
    _, r3 = sign_up(wrong_branch)
    assert r3.json()["error"]["code"] == "INVALID_SECTION"


def test_deactivating_branch_or_section_keeps_existing_assignments(admin, campus, db_session):
    _, single = sign_up(teacher_payload(campus["college"], campus["cse"], campus["cse_a"]))
    _, wide = sign_up(teacher_payload(campus["college"], campus["cse"], all_sections=True))
    admin.post(f"{BASE}/sections/{campus['cse_a']['id']}/status", json={"status": "inactive"})
    admin.post(f"{BASE}/branches/{campus['cse']['id']}/status", json={"status": "inactive"})
    db_session.expire_all()
    assert db_session.execute(select(func.count()).select_from(UserCollegeSection)).scalar_one() >= 1
    for r in (single, wide):
        email = r.json()["user"]["email"]
        assert TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": "password123"}).status_code == 200


# ---- class authorization ---------------------------------------------------------------------------

def make_teacher(campus, section=None, all_sections=False, branch=None, college=None):
    c, r = sign_up(teacher_payload(college or campus["college"], branch or campus["cse"], section, all_sections))
    assert r.status_code == 201, r.text
    return c, r.json()["user"]


def make_course(client):
    r = client.post("/api/v1/courses", json={"title": f"Scoped {secrets.token_hex(3)}", "description": "x", "status": "published"})
    assert r.status_code == 201, r.text
    return r.json()


def link(client, course, college_section, code=None):
    return client.post(
        f"/api/v1/courses/{course['id']}/sections",
        json={"name": f"Cohort {college_section['name']}", "code": code or secrets.token_hex(3), "college_section_id": college_section["id"]},
    )


def schedule(client, course, **extra):
    start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    return client.post(f"/api/v1/classes?course_id={course['id']}", json={"title": "Lecture", "scheduled_start": start, **extra})


def test_teaching_scope_endpoint_describes_the_assignment(admin, campus):
    single, _ = make_teacher(campus, section=campus["cse_a"])
    wide, _ = make_teacher(campus, all_sections=True)
    s = single.get("/api/v1/users/me/teaching-scope").json()
    assert s["kind"] == "section" and s["section"]["id"] == campus["cse_a"]["id"] and [x["id"] for x in s["selectable_sections"]] == [campus["cse_a"]["id"]]
    w = wide.get("/api/v1/users/me/teaching-scope").json()
    assert w["kind"] == "branch" and w["branch"]["id"] == campus["cse"]["id"]
    assert {x["id"] for x in w["selectable_sections"]} == {campus["cse_a"]["id"], campus["cse_b"]["id"]}  # never ECE or another college


def test_single_section_teacher_is_confined_to_their_section(admin, campus, db_session):
    t, _ = make_teacher(campus, section=campus["cse_a"])
    course = make_course(t)
    assert link(t, course, campus["cse_a"]).status_code == 201
    for forbidden in (campus["cse_b"], campus["ece_a"], campus["other_a"]):
        r = link(t, course, forbidden)
        assert r.status_code == 403 and r.json()["error"]["code"] == "SECTION_NOT_AUTHORIZED"
    mine = t.get(f"/api/v1/courses/{course['id']}/sections").json()
    assert schedule(t, course, section_ids=[mine[0]["id"]]).status_code == 201
    # cannot ask for the branch as a whole
    r = schedule(t, course, all_branch_sections=True)
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_BRANCH_WIDE"
    # A cohort tied to someone else's section (e.g. left over from before an assignment change) is refused
    foreign = Section(course_id=course["id"], name="Foreign", code="FOR1", college_section_id=campus["cse_b"]["id"])
    db_session.add(foreign)
    db_session.commit()
    r = schedule(t, course, section_ids=[foreign.id])
    assert r.status_code == 403 and r.json()["error"]["code"] == "SECTION_NOT_AUTHORIZED"
    assert all(s["id"] != foreign.id for s in t.get(f"/api/v1/courses/{course['id']}/sections").json())  # not even listed
    # a whole-course class would reach that foreign cohort too
    r = schedule(t, course)
    assert r.status_code == 409 and r.json()["error"]["code"] == "SECTION_REQUIRED"


def test_branch_wide_teacher_targets_the_whole_branch_and_nothing_else(admin, campus, db_session):
    t, _ = make_teacher(campus, all_sections=True)
    course = make_course(t)
    a, b = link(t, course, campus["cse_a"]).json(), link(t, course, campus["cse_b"]).json()
    for forbidden in (campus["ece_a"], campus["other_a"]):
        assert link(t, course, forbidden).status_code == 403
    r = schedule(t, course, all_branch_sections=True)
    assert r.status_code == 201, r.text
    assert set(r.json()["section_ids"]) == {a["id"], b["id"]}
    # explicit subset still works; mixing "whole branch" with explicit ids does not
    assert schedule(t, course, section_ids=[a["id"]]).json()["section_ids"] == [a["id"]]
    assert schedule(t, course, all_branch_sections=True, section_ids=[a["id"]]).status_code == 422
    # a cohort of another branch smuggled into the course is neither included nor targetable
    foreign = Section(course_id=course["id"], name="ECE cohort", code="ECE1", college_section_id=campus["ece_a"]["id"])
    db_session.add(foreign)
    db_session.commit()
    assert foreign.id not in schedule(t, course, all_branch_sections=True).json()["section_ids"]
    assert schedule(t, course, section_ids=[foreign.id]).status_code == 403


def test_sections_added_or_deactivated_later_are_handled_by_branch_wide_assignments(admin, campus):
    t, _ = make_teacher(campus, all_sections=True)
    course = make_course(t)
    a = link(t, course, campus["cse_a"]).json()
    first = schedule(t, course, all_branch_sections=True).json()
    assert first["section_ids"] == [a["id"]]
    # the admin adds Section C afterwards: the same teacher may link and address it with no re-registration
    c_sec = admin.post(f"{BASE}/branches/{campus['cse']['id']}/sections", json={"name": "Section C"}).json()
    c = link(t, course, c_sec).json()
    assert set(schedule(t, course, all_branch_sections=True).json()["section_ids"]) == {a["id"], c["id"]}
    # a deactivated college section drops out of "all active sections", without touching the teacher's assignment
    admin.post(f"{BASE}/sections/{c_sec['id']}/status", json={"status": "inactive"})
    assert schedule(t, course, all_branch_sections=True).json()["section_ids"] == [a["id"]]
    assert link(t, make_course(t), c_sec).status_code == 409  # inactive: cannot be newly linked


def test_branch_wide_class_with_no_linked_sections_is_refused_clearly(admin, campus):
    t, _ = make_teacher(campus, all_sections=True)
    r = schedule(t, make_course(t), all_branch_sections=True)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_SECTIONS_IN_BRANCH"


def test_assignment_never_reaches_another_college(admin, campus):
    other_teacher, _ = make_teacher(campus, all_sections=True, branch=campus["other_branch"], college=campus["other"])
    course = make_course(other_teacher)
    assert link(other_teacher, course, campus["cse_a"]).status_code == 403  # first college's section
    assert link(other_teacher, course, campus["other_a"]).status_code == 201


def test_unscoped_legacy_teacher_cannot_link_but_keeps_existing_behaviour(teacher, admin, campus):
    t, _ = teacher
    course = make_course(t)
    assert link(t, course, campus["cse_a"]).status_code == 403
    plain = t.post(f"/api/v1/courses/{course['id']}/sections", json={"name": "Plain", "code": "PL1"})
    assert plain.status_code == 201
    assert schedule(t, course).status_code == 201  # whole-course class: unchanged
    assert schedule(t, course, section_ids=[plain.json()["id"]]).status_code == 201
    assert schedule(t, course, all_branch_sections=True).status_code == 403


def test_branch_assignment_does_not_enroll_students_or_open_classes_to_them(admin, campus, db_session):
    t, _ = make_teacher(campus, all_sections=True)
    course = make_course(t)
    a = link(t, course, campus["cse_a"]).json()
    klass = schedule(t, course, all_branch_sections=True).json()
    sp = teacher_payload(campus["college"], campus["cse"], campus["cse_a"])
    sp.update(role="student")
    sp.pop("college_code")
    student_client, r = sign_up(sp)
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    # picking the same college section at registration neither enrols nor adds the student to the cohort
    assert db_session.execute(select(func.count()).select_from(SectionMember).where(SectionMember.student_id == uid)).scalar_one() == 0
    from app.core.exceptions import ForbiddenError
    from app.db.models.classroom import Class
    from app.services import classroom_service

    def may_participate() -> bool:
        db_session.expire_all()
        try:
            classroom_service.assert_enrolled_in_class(db_session, db_session.get(User, uid), db_session.get(Class, klass["id"]))
            return True
        except ForbiddenError as exc:
            assert exc.code in ("NOT_ENROLLED", "WRONG_SECTION", "FORBIDDEN"), exc.code
            return False

    # participation (joining media, summaries) is what the existing rules gate: not enrolled -> no
    assert not may_participate()
    assert student_client.post(f"/api/v1/courses/{course['id']}/enrollments", json={}).status_code == 201
    assert not may_participate()  # enrolled, but not a member of the class's cohort -> still no
    # the teacher adds the student to the cohort through the existing section API -> now allowed
    assert t.post(f"/api/v1/sections/{a['id']}/members", json={"student_id": uid}).status_code == 201
    assert may_participate()


# ---- migration -------------------------------------------------------------------------------------

def test_migration_moves_existing_college_sections_under_a_general_branch(tmp_path):
    db = tmp_path / "branches.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}"}

    def alembic(*args):
        res = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
        assert res.returncode == 0, res.stdout + res.stderr

    alembic("upgrade", "b2d0ffee0002")
    con = sqlite3.connect(db)
    con.executescript(
        """
        INSERT INTO colleges (id, name, name_key, location_key, code, code_generated_at, status, created_at, updated_at)
          VALUES ('col1','Old College','old college','','EV-AAAA-2222','2026-01-01','active','2026-01-01','2026-01-01');
        INSERT INTO college_sections (id, college_id, name, name_key, status, created_at, updated_at)
          VALUES ('sec1','col1','CSE-A','cse-a','active','2026-01-01','2026-01-01'),
                 ('sec2','col1','CSE-B','cse-b','inactive','2026-01-01','2026-01-01');
        """
    )
    con.commit()
    con.close()
    alembic("upgrade", "head")
    con = sqlite3.connect(db)
    branches = con.execute("SELECT id, college_id, name, status FROM college_branches").fetchall()
    assert len(branches) == 1 and branches[0][1:] == ("col1", "General", "active")
    rows = con.execute("SELECT id, name, status, branch_id FROM college_sections ORDER BY id").fetchall()
    assert rows == [("sec1", "CSE-A", "active", branches[0][0]), ("sec2", "CSE-B", "inactive", branches[0][0])]
    con.close()
    alembic("check")

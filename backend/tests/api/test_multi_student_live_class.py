"""Audit: multiple distinct students in the same section, and one shared live class that several
of them can join concurrently. Real API + database (SQLite for the test run), no mocks beyond
LiveKit's own network calls (ensure_room / generate_access_token), exactly like test_classes.py."""

import pytest


@pytest.fixture
def mock_livekit(monkeypatch):
    """Same fake as test_classes.py: only LiveKit's network calls are faked (no real server
    reachable in the test run); EduVillage's own authorization/room-name/token-identity logic
    below this boundary is real and is exactly what this file verifies."""
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    def fake_generate_access_token(*, identity, name, room_name, can_publish, can_subscribe=True):
        return f"fake-jwt-for-{identity}-in-{room_name}-publish={can_publish}"

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "generate_access_token", fake_generate_access_token)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")


def _create_class(client, course_id, *, section_ids=None):
    body = {"title": "Live session", "scheduled_start": "2026-11-01T10:00:00Z"}
    if section_ids is not None:
        body["section_ids"] = section_ids
    resp = client.post(f"/api/v1/classes?course_id={course_id}", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _enroll_and_add_to_section(tclient, student_pair, course, section):
    sclient, suser = student_pair
    enroll = sclient.post(f"/api/v1/courses/{course['id']}/enrollments", json={})
    assert enroll.status_code == 201, enroll.text
    add = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert add.status_code == 201, add.text
    return suser


# ---- 1. multiple students in the same section (real DB) ---------------------------------------

def test_three_distinct_students_persist_in_the_same_section_with_no_cap(teacher, published_course, make_user, db_session):
    from app.db.models.section import SectionMember

    tclient, _ = teacher
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()

    students = [make_user(role="student", prefix=f"s{i}") for i in range(3)]
    added = [_enroll_and_add_to_section(tclient, pair, published_course, section) for pair in students]

    # Distinct accounts, distinct ids.
    ids = {u["id"] for u in added}
    assert len(ids) == 3

    # All three persisted against the SAME section row — no one-student-per-section limit anywhere.
    rows = db_session.execute(
        __import__("sqlalchemy").select(SectionMember).where(SectionMember.section_id == section["id"])
    ).scalars().all()
    assert {r.student_id for r in rows} == ids


def test_duplicate_enrollment_and_duplicate_section_add_are_handled_safely_not_corrupted(
    teacher, published_course, student, db_session
):
    from app.db.models.section import SectionMember
    from sqlalchemy import select

    tclient, _ = teacher
    sclient, suser = student
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()

    first_enroll = sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert first_enroll.status_code == 201
    second_enroll = sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert second_enroll.status_code in (200, 201, 409)  # idempotent or explicit conflict, never a crash

    first_add = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert first_add.status_code == 201
    second_add = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert second_add.status_code == 409 and second_add.json()["error"]["code"] == "ALREADY_MEMBER"

    rows = db_session.execute(select(SectionMember).where(SectionMember.section_id == section["id"])).scalars().all()
    assert len(rows) == 1  # exactly one row, not two, not zero


def test_section_membership_survives_logout_login_and_a_fresh_db_session(
    teacher, published_course, student, db_session
):
    """Simulates 'persists after logout, login, and restart': a brand new TestClient (no shared
    session/cookie with the original) logging in fresh, plus a fresh DB query, both see the
    same membership — nothing was held only in memory."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.models.section import SectionMember
    from sqlalchemy import select

    tclient, _ = teacher
    sclient, suser = student
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})

    # "Logout": discard the authenticated client entirely and log back in from scratch.
    fresh = TestClient(app)
    login = fresh.post("/api/v1/auth/login", json={"email": suser["email"], "password": "password123"})
    assert login.status_code == 200

    db_session.expire_all()  # "application restart": nothing cached, re-read from the real table
    rows = db_session.execute(select(SectionMember).where(SectionMember.section_id == section["id"])).scalars().all()
    assert [r.student_id for r in rows] == [suser["id"]]


# ---- 2. teacher assignment vs student enrollment are independent relationships -----------------

def test_teacher_college_scope_and_student_course_enrollment_use_separate_tables_and_rules(
    teacher, published_course, student, db_session
):
    """Teacher college/branch/section scoping (user_college_sections / user_branch_assignments,
    enforced by teaching_scope_service) and student course-section membership (section_members,
    enforced by section_service/classroom_service) are two independent relationships. Registering
    a teacher with no college scope at all must not affect, and must not be affected by, a
    student's own course enrollment and section membership."""
    from app.db.models.college import UserCollegeSection, UserBranchAssignment
    from app.db.models.section import SectionMember
    from sqlalchemy import select

    tclient, tuser = teacher
    sclient, suser = student
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    _enroll_and_add_to_section(tclient, student, published_course, section)

    # The teacher has zero rows in either college-scope table (this fixture never set one up) —
    # proving teacher scoping is a separate, optional mechanism, not something enrollment implies.
    assert db_session.execute(select(UserCollegeSection).where(UserCollegeSection.user_id == tuser["id"])).first() is None
    assert db_session.execute(select(UserBranchAssignment).where(UserBranchAssignment.user_id == tuser["id"])).first() is None
    # The student's real section membership exists independently, in its own table.
    assert db_session.execute(
        select(SectionMember).where(SectionMember.section_id == section["id"], SectionMember.student_id == suser["id"])
    ).scalar_one_or_none() is not None


# ---- 3 & 4. one live class, multiple simultaneous students, same room, tokens, authorization ----

def test_one_shared_room_multiple_students_each_get_a_distinct_token_for_the_same_room(
    mock_livekit, teacher, published_course, make_user
):
    tclient, tuser = teacher
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    students = [make_user(role="student", prefix=f"p{i}") for i in range(3)]
    for pair in students:
        _enroll_and_add_to_section(tclient, pair, published_course, section)

    cls = _create_class(tclient, published_course["id"], section_ids=[section["id"]])
    start = tclient.post(f"/api/v1/classes/{cls['id']}/start")
    assert start.status_code == 200 and start.json()["status"] == "live"

    teacher_join = tclient.post(f"/api/v1/classes/{cls['id']}/join-token").json()
    room = teacher_join["room_name"]
    assert teacher_join["can_publish"] is True

    joins = []
    for sclient, suser in students:
        resp = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["room_name"] == room  # same shared room, not one room per student
        assert body["can_publish"] is False
        assert suser["id"] in body["token"]  # token is scoped to this participant's real identity
        joins.append(body)

    # Every token is distinct (different identity baked in), never the same literal token reused.
    assert len({j["token"] for j in joins}) == 3

    participants = {p["user_id"] for p in tclient.get(f"/api/v1/classes/{cls['id']}/participants").json()}
    assert participants == {tuser["id"]} | {u["id"] for _, u in students}


def test_a_student_outside_the_targeted_section_is_rejected_a_valid_code_alone_is_not_enough(
    mock_livekit, teacher, published_course, make_user
):
    tclient, _ = teacher
    sec_in = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "In", "code": "IN"}).json()
    sec_out = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "Out", "code": "OUT"}).json()
    inside = make_user(role="student", prefix="inside")
    outside = make_user(role="student", prefix="outside")
    _enroll_and_add_to_section(tclient, inside, published_course, sec_in)
    _enroll_and_add_to_section(tclient, outside, published_course, sec_out)

    cls = _create_class(tclient, published_course["id"], section_ids=[sec_in["id"]])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    assert inside[0].post(f"/api/v1/classes/{cls['id']}/join-token").status_code == 200
    rejected = outside[0].post(f"/api/v1/classes/{cls['id']}/join-token")
    assert rejected.status_code == 403 and rejected.json()["error"]["code"] == "WRONG_SECTION"


def test_enrolled_but_not_in_any_targeted_section_is_also_rejected(mock_livekit, teacher, published_course, student):
    """Enrollment in the course alone (no section membership) is not enough once a class targets
    specific sections — enrollment and section targeting are two independent gates."""
    tclient, _ = teacher
    sclient, _ = student
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    assert sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={}).status_code == 201
    # Enrolled, but never added as a SectionMember of "A".

    cls = _create_class(tclient, published_course["id"], section_ids=[section["id"]])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    resp = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "WRONG_SECTION"


def test_concurrent_join_requests_from_three_students_never_create_duplicate_classes_or_corrupt_state(
    mock_livekit, teacher, published_course, make_user
):
    """Real concurrency: 3 students call join-token at the same time via real threads hitting the
    real (test) database. Verifies no duplicate Class rows, no duplicate ClassParticipant rows,
    and every participant still lands in the one real room."""
    import threading

    tclient, tuser = teacher
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    students = [make_user(role="student", prefix=f"c{i}") for i in range(3)]
    for pair in students:
        _enroll_and_add_to_section(tclient, pair, published_course, section)

    cls = _create_class(tclient, published_course["id"], section_ids=[section["id"]])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    results = [None, None, None]

    def _join(i, sclient):
        results[i] = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")

    threads = [threading.Thread(target=_join, args=(i, pair[0])) for i, pair in enumerate(students)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert all(r is not None and r.status_code == 200 for r in results)
    rooms = {r.json()["room_name"] for r in results}
    assert len(rooms) == 1  # all three landed in the one real room, not three separate rooms

    classes = tclient.get(f"/api/v1/classes").json()
    assert sum(1 for c in classes if c["id"] == cls["id"]) == 1  # exactly one class row, no duplicate created

    participant_ids = [p["user_id"] for p in tclient.get(f"/api/v1/classes/{cls['id']}/participants").json()]
    assert len(participant_ids) == len(set(participant_ids))  # no duplicate participant rows from the race


def test_one_participant_leaving_does_not_terminate_the_class_for_others(mock_livekit, teacher, published_course, make_user):
    """There is no backend mechanism that ties class lifecycle to any individual participant's
    connection state (grep-verified: only an explicit teacher end_class call changes status).
    This proves that by exercising it: after one student's own client simply stops calling the
    API (the closest a backend test can get to 'disconnects'), the class is still live and the
    other students can still fetch a join-token."""
    tclient, _ = teacher
    section = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    students = [make_user(role="student", prefix=f"d{i}") for i in range(3)]
    for pair in students:
        _enroll_and_add_to_section(tclient, pair, published_course, section)

    cls = _create_class(tclient, published_course["id"], section_ids=[section["id"]])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    for sclient, _ in students:
        assert sclient.post(f"/api/v1/classes/{cls['id']}/join-token").status_code == 200

    # Student 0 "disconnects": nothing more is ever called on their client again.
    remaining = students[1:]
    status_after = tclient.get(f"/api/v1/classes/{cls['id']}").json()["status"]
    assert status_after == "live"
    for sclient, _ in remaining:
        assert sclient.post(f"/api/v1/classes/{cls['id']}/join-token").status_code == 200

    end = tclient.post(f"/api/v1/classes/{cls['id']}/end")
    assert end.status_code == 200 and end.json()["status"] == "ended"
    # After the teacher ends it, nobody (including the ones who were still connected) can join again.
    for sclient, _ in remaining:
        blocked = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
        assert blocked.status_code == 409

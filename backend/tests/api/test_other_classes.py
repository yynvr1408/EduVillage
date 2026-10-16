"""Branch-wide ("All Sections") classes: one class, one LiveKit room, visible as "Other Classes" to every eligible
student of the same college + branch and to nobody else. Real API and database; only LiveKit's network calls are
faked (as in the other live-class tests)."""

import secrets
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, func, select

from app.db.models.classroom import Class, ClassRecording
from app.db.models.college import UserBranchAssignment
from app.db.models.enums import RecordingStatus
from app.services import recording_service

from tests.api.test_admin import BASE
from tests.api.test_branches import (  # noqa: F401  (fixtures + helpers)
    campus,
    link,
    make_course,
    make_teacher,
    schedule,
    sign_up,
    teacher_payload,
)
from tests.api.test_college_registration import admin  # noqa: F401


@pytest.fixture
def mock_livekit(monkeypatch):
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    def fake_token(*, identity, name, room_name, can_publish, can_subscribe=True):
        return f"jwt|{identity}|{room_name}|publish={can_publish}"

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "generate_access_token", fake_token)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")


def student_in(college, branch, section):
    body = teacher_payload(college, branch, section)
    body["role"] = "student"
    client, r = sign_up(body)
    assert r.status_code == 201, r.text
    return client, r.json()["user"]


def enroll(client, course):
    r = client.post(f"/api/v1/courses/{course['id']}/enrollments", json={})
    assert r.status_code == 201, r.text


def class_ids(client):
    r = client.get("/api/v1/classes")
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()]


@pytest.fixture
def world(admin, campus):  # noqa: F811
    """CSE with sections A, B, C; one branch-wide teacher T2 and a section teacher T1; students everywhere."""
    sec_c = admin.post(f"{BASE}/branches/{campus['cse']['id']}/sections", json={"name": "Section C"}).json()
    t2, _ = make_teacher(campus, all_sections=True)
    t1, _ = make_teacher(campus, section=campus["cse_a"])
    course2 = make_course(t2)
    course1 = make_course(t1)
    w = dict(campus, sec_c=sec_c, t1=t1, t2=t2, course1=course1, course2=course2)
    w["stu_a"] = student_in(campus["college"], campus["cse"], campus["cse_a"])
    w["stu_b"] = student_in(campus["college"], campus["cse"], campus["cse_b"])
    w["stu_c"] = student_in(campus["college"], campus["cse"], sec_c)
    w["stu_ece"] = student_in(campus["college"], campus["ece"], campus["ece_a"])  # same college, other branch
    w["stu_other"] = student_in(campus["other"], campus["other_branch"], campus["other_a"])  # other college
    for key in ("stu_a", "stu_b", "stu_c", "stu_ece", "stu_other"):
        enroll(w[key][0], course2)  # everyone passes the ordinary enrollment rule, so only the branch rule can exclude them
    return w


def test_teacher_creates_one_branch_wide_class(world, db_session):
    r = schedule(world["t2"], world["course2"], all_branch_sections=True)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["audience_branch_id"] == world["cse"]["id"] and body["audience_branch_name"] == "Computer Science"
    assert body["section_ids"] == []
    assert body["course_id"] == world["course2"]["id"]
    # exactly one class row for it; no per-section copies
    assert db_session.execute(select(func.count()).select_from(Class).where(Class.id == body["id"])).scalar_one() == 1
    assert db_session.execute(select(func.count()).select_from(Class).where(Class.course_id == world["course2"]["id"])).scalar_one() == 1


def test_students_of_every_section_in_the_branch_see_it_once(world):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    for key in ("stu_a", "stu_b", "stu_c"):
        client, _ = world[key]
        ids = class_ids(client)
        assert ids.count(klass["id"]) == 1, key
        listed = next(c for c in client.get("/api/v1/classes").json() if c["id"] == klass["id"])
        assert listed["audience_branch_id"] == world["cse"]["id"]
        assert client.get(f"/api/v1/classes/{klass['id']}").status_code == 200


def test_other_branch_and_other_college_students_cannot_see_or_join_it(world, mock_livekit):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    assert world["t2"].post(f"/api/v1/classes/{klass['id']}/start").status_code == 200
    for key in ("stu_ece", "stu_other"):
        client, _ = world[key]
        assert klass["id"] not in class_ids(client), key
        assert client.get(f"/api/v1/classes/{klass['id']}").status_code == 404, key
        r = client.post(f"/api/v1/classes/{klass['id']}/join-token")
        assert r.status_code == 403 and r.json()["error"]["code"] == "WRONG_BRANCH", key


def test_in_branch_but_not_enrolled_student_gets_no_token_and_no_listing(world, mock_livekit):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    world["t2"].post(f"/api/v1/classes/{klass['id']}/start")
    client, _ = student_in(world["college"], world["cse"], world["cse_a"])  # same branch, never enrolled
    assert klass["id"] not in class_ids(client)
    assert client.post(f"/api/v1/classes/{klass['id']}/join-token").status_code in (403, 404)


def test_eligible_students_join_the_same_single_room(world, mock_livekit):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    started = world["t2"].post(f"/api/v1/classes/{klass['id']}/start")
    assert started.status_code == 200 and started.json()["status"] == "live"
    rooms = set()
    for key in ("stu_a", "stu_b", "stu_c"):
        client, user = world[key]
        r = client.post(f"/api/v1/classes/{klass['id']}/join-token")
        assert r.status_code == 200, r.text
        assert r.json()["can_publish"] is False
        rooms.add(r.json()["room_name"])
        assert user["id"] in r.json()["token"]
    assert len(rooms) == 1  # one room for the whole branch
    # students leaving is a client-side LiveKit disconnect (the API has no per-student leave that touches the class):
    # the class stays live and other students can still get tokens
    assert world["stu_b"][0].post(f"/api/v1/classes/{klass['id']}/join-token").status_code == 200
    assert world["t2"].get(f"/api/v1/classes/{klass['id']}").json()["status"] == "live"


def test_section_teachers_class_stays_section_specific(world):
    cohort = link(world["t1"], world["course1"], world["cse_a"]).json()
    r = schedule(world["t1"], world["course1"], section_ids=[cohort["id"]])
    assert r.status_code == 201
    assert r.json()["section_ids"] == [cohort["id"]] and r.json()["audience_branch_id"] is None
    # a section teacher can never create a branch-wide class
    denied = schedule(world["t1"], world["course1"], all_branch_sections=True)
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "NOT_BRANCH_WIDE"


def test_lifecycle_and_withdrawn_assignment(world, mock_livekit, db_session):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    client, _ = world["stu_a"]
    # scheduled: listed, but cannot be joined yet
    assert klass["id"] in class_ids(client)
    assert client.post(f"/api/v1/classes/{klass['id']}/join-token").status_code == 409
    world["t2"].post(f"/api/v1/classes/{klass['id']}/start")
    assert client.post(f"/api/v1/classes/{klass['id']}/join-token").status_code == 200
    world["t2"].post(f"/api/v1/classes/{klass['id']}/end")
    ended = next(c for c in client.get("/api/v1/classes").json() if c["id"] == klass["id"])
    assert ended["status"] == "ended"  # ended classes stay listed (for recordings / summaries)
    assert client.post(f"/api/v1/classes/{klass['id']}/join-token").status_code == 409
    # if the teacher no longer covers the branch, the class stops being offered and joinable
    db_session.execute(delete(UserBranchAssignment).where(UserBranchAssignment.user_id == db_session.get(Class, klass["id"]).teacher_id))
    db_session.commit()
    assert klass["id"] not in class_ids(client)
    assert client.post(f"/api/v1/classes/{klass['id']}/join-token").status_code == 403


def test_recordings_of_a_branch_class_follow_the_same_boundary(world, db_session):
    klass = schedule(world["t2"], world["course2"], all_branch_sections=True).json()
    rec = ClassRecording(
        class_id=klass["id"], requested_by=db_session.get(Class, klass["id"]).teacher_id, egress_id=f"eg-{secrets.token_hex(3)}",
        storage_key=f"recordings/{klass['id']}/r.mp4", status=RecordingStatus.available, is_published=True,
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(rec)
    db_session.commit()
    from app.db.models.user import User

    def can(key):
        db_session.expire_all()
        return recording_service.can_access(db_session, db_session.get(User, world[key][1]["id"]), db_session.get(ClassRecording, rec.id))

    assert can("stu_a") and can("stu_b") and can("stu_c")
    assert not can("stu_ece") and not can("stu_other")

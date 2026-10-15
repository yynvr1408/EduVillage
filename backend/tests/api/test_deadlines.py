"""Deadline enforcement for assignments — direct submissions and offline sync."""

from datetime import datetime, timedelta, timezone

import pytest


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _assignment(tclient, course_id, *, due_in_hours: float | None):
    body = {"title": "Timed quiz", "status": "published"}
    if due_in_hours is not None:
        body["due_at"] = _iso(datetime.now(timezone.utc) + timedelta(hours=due_in_hours))
    resp = tclient.post(f"/api/v1/assignments?course_id={course_id}", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _sync(client, op_id, assignment_id, client_time=None, text="answer"):
    op = {"operation_id": op_id, "operation_type": "assignment_submission", "entity_id": assignment_id, "payload": {"answer": {"text": text}}}
    if client_time is not None:
        op["client_updated_at"] = _iso(client_time)
    return client.post("/api/v1/sync/operations", json={"operations": [op]}).json()["results"][0]


def test_submission_before_the_deadline_is_accepted(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=2)
    resp = enrolled_student[0].put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "on time"}, "submit": True})
    assert resp.status_code == 200 and resp.json()["status"] == "submitted"


def test_no_deadline_means_always_open(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=None)
    assert enrolled_student[0].put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "x"}, "submit": True}).status_code == 200


def test_final_submission_after_the_deadline_is_refused_but_a_draft_can_still_be_saved(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-1)
    resp = enrolled_student[0].put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "late"}, "submit": True})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "SUBMISSION_EXPIRED"
    assert teacher[0].get(f"/api/v1/assignments/{a['id']}/submissions").json() == []  # nothing was recorded as submitted
    # Saving a draft is allowed (nothing typed is lost) - and a late draft is never counted as submitted.
    draft = enrolled_student[0].put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "late draft"}, "submit": False})
    assert draft.status_code == 200 and draft.json()["status"] == "draft" and draft.json()["submitted_at"] is None


def test_work_submitted_before_the_deadline_cannot_be_edited_afterwards(teacher, enrolled_student, published_course, db_session):
    from app.db.base import utcnow
    from app.db.models.assignment import Assignment

    a = _assignment(teacher[0], published_course["id"], due_in_hours=1)
    sclient = enrolled_student[0]
    assert sclient.put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "v1"}, "submit": True}).status_code == 200
    row = db_session.get(Assignment, a["id"])
    row.due_at = utcnow() - timedelta(minutes=5)  # time passes
    db_session.commit()
    resp = sclient.put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "v2 changed after deadline"}, "submit": True})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "SUBMISSION_EXPIRED"
    assert sclient.get(f"/api/v1/assignments/{a['id']}/submissions/me").json()["answer"] == {"text": "v1"}


def test_sync_after_the_deadline_without_a_client_time_is_expired_and_replays_stably(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-1)
    first = _sync(enrolled_student[0], "op-late", a["id"])
    assert first["status"] == "conflict" and first["error_code"] == "SUBMISSION_EXPIRED"
    assert _sync(enrolled_student[0], "op-late", a["id"]) == first
    assert teacher[0].get(f"/api/v1/assignments/{a['id']}/submissions").json() == []


def test_an_offline_submission_made_before_the_deadline_may_sync_within_the_grace_window(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-1)  # deadline passed an hour ago
    made_at = datetime.now(timezone.utc) - timedelta(hours=3)  # the student wrote it while offline, before the deadline
    result = _sync(enrolled_student[0], "op-offline-ok", a["id"], client_time=made_at)
    assert result["status"] == "accepted" and result["server_entity_id"]
    subs = teacher[0].get(f"/api/v1/assignments/{a['id']}/submissions").json()
    assert len(subs) == 1 and subs[0]["status"] == "submitted"


def test_an_offline_submission_is_not_honoured_after_the_grace_window(teacher, enrolled_student, published_course, monkeypatch):
    from app.services import synchronization_service

    monkeypatch.setattr(synchronization_service.get_settings(), "offline_submission_grace_hours", 24)
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-48)  # deadline was two days ago
    made_at = datetime.now(timezone.utc) - timedelta(hours=60)  # made before it, but synced far too late
    result = _sync(enrolled_student[0], "op-too-late", a["id"], client_time=made_at)
    assert result["status"] == "conflict" and result["error_code"] == "SUBMISSION_EXPIRED"


def test_a_client_clock_claiming_a_time_before_the_deadline_that_was_made_after_it_gains_nothing(teacher, enrolled_student, published_course):
    """The device claims it wrote the answer before the deadline; that is honoured only inside the bounded window."""
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-30)
    forged = datetime.now(timezone.utc) - timedelta(hours=31)  # backdated beyond the 24 h window
    assert _sync(enrolled_student[0], "op-backdated", a["id"], client_time=forged)["error_code"] == "SUBMISSION_EXPIRED"


def test_a_forward_dated_client_clock_never_helps_or_hurts(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-1)
    future = datetime.now(timezone.utc) + timedelta(days=30)
    assert _sync(enrolled_student[0], "op-future", a["id"], client_time=future)["error_code"] == "SUBMISSION_EXPIRED"


def test_a_client_time_after_the_deadline_is_judged_late(teacher, enrolled_student, published_course):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=-2)
    written_late = datetime.now(timezone.utc) - timedelta(hours=1)  # after the deadline, even if synced "in grace"
    assert _sync(enrolled_student[0], "op-written-late", a["id"], client_time=written_late)["error_code"] == "SUBMISSION_EXPIRED"


@pytest.mark.parametrize("hours", [0.5, 5])
def test_open_assignments_still_accept_sync(teacher, enrolled_student, published_course, hours):
    a = _assignment(teacher[0], published_course["id"], due_in_hours=hours)
    assert _sync(enrolled_student[0], f"op-open-{hours}", a["id"], client_time=datetime.now(timezone.utc) - timedelta(minutes=5))["status"] == "accepted"


def test_times_are_returned_as_explicit_utc_and_offsets_are_converted_not_dropped(teacher, enrolled_student, published_course):
    from datetime import timedelta as td

    ist = timezone(td(hours=5, minutes=30))
    past_in_ist = (datetime.now(timezone.utc) - td(hours=1)).astimezone(ist).strftime("%Y-%m-%dT%H:%M:%S+05:30")
    resp = teacher[0].post(f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "IST", "status": "published", "due_at": past_in_ist})
    a = resp.json()
    assert a["due_at"].endswith("Z")  # explicit UTC for every client
    due = datetime.strptime(a["due_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert abs((due - (datetime.now(timezone.utc) - td(hours=1))).total_seconds()) < 5  # the same INSTANT, not 5.5 h off
    # ...so the deadline is genuinely in the past on every database, whatever its session time zone
    resp = enrolled_student[0].put(f"/api/v1/assignments/{a['id']}/submissions/me", json={"answer": {"text": "x"}, "submit": True})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "SUBMISSION_EXPIRED"


def test_class_times_round_trip_as_utc(teacher, published_course):
    cls = teacher[0].post(
        f"/api/v1/classes?course_id={published_course['id']}", json={"title": "TZ", "scheduled_start": "2026-11-02T15:30:00+05:30"}
    ).json()
    assert cls["scheduled_start"] == "2026-11-02T10:00:00Z"

"""Scenarios B (recorded lecture) and C (teacher resource reuse) plus section isolation.

LiveKit egress and S3 are mocked at their boundary (see conftest): these tests prove the
backend's state machine and authorization, NOT that real media is captured."""

import pytest


def _live_class(client, course_id, section_ids=()):
    cls = client.post(
        f"/api/v1/classes?course_id={course_id}",
        json={"title": "Lecture", "scheduled_start": "2026-11-02T10:00:00Z", "section_ids": list(section_ids)},
    )
    assert cls.status_code == 201, cls.text
    cls = cls.json()
    assert client.post(f"/api/v1/classes/{cls['id']}/start").status_code == 200
    return cls


def _record(client, cls, mock_pipeline, storage, *, publish=True):
    rec = client.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    client.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    mock_pipeline["status"] = "complete"
    storage.put(rec["id"], cls["id"])
    assert client.get(f"/api/v1/classes/{cls['id']}/recordings").json()[0]["status"] == "available"
    if publish:
        assert client.post(f"/api/v1/recordings/{rec['id']}/publish", json={"published": True}).status_code == 200
    return rec


@pytest.fixture
def recorded(mock_recording_pipeline, fake_storage, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    rec = _record(tclient, cls, mock_recording_pipeline, fake_storage)
    return {"cls": cls, "rec": rec, "tclient": tclient}


def test_enrolled_student_gets_short_lived_playback_url(recorded, enrolled_student):
    sclient, _ = enrolled_student
    resp = sclient.get(f"/api/v1/recordings/{recorded['rec']['id']}/playback")
    assert resp.status_code == 200
    body = resp.json()
    assert body["url"].startswith("https://signed.example/") and "ttl=300" in body["url"]
    assert body["expires_in"] == 300


def test_library_lists_only_authorized_recordings(recorded, enrolled_student, make_user):
    sclient, _ = enrolled_student
    listing = sclient.get("/api/v1/recordings").json()
    assert [r["id"] for r in listing] == [recorded["rec"]["id"]]
    assert listing[0]["course_title"] and listing[0]["status"] == "available"

    outsider, _ = make_user(role="student", prefix="outsider")  # registered but not enrolled
    assert outsider.get("/api/v1/recordings").json() == []
    resp = outsider.get(f"/api/v1/recordings/{recorded['rec']['id']}/playback")
    assert resp.status_code == 404  # existence is not confirmed to non-members


def test_unpublished_recording_is_hidden_from_students_but_not_teachers(
    mock_recording_pipeline, fake_storage, teacher, enrolled_student, published_course
):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    rec = _record(tclient, cls, mock_recording_pipeline, fake_storage, publish=False)
    sclient, _ = enrolled_student
    assert sclient.get("/api/v1/recordings").json() == []
    assert sclient.get(f"/api/v1/recordings/{rec['id']}/playback").status_code == 404
    assert [r["id"] for r in tclient.get("/api/v1/recordings").json()] == [rec["id"]]
    assert tclient.get(f"/api/v1/recordings/{rec['id']}/playback").status_code == 200


def test_cannot_publish_a_recording_that_is_not_ready(mock_recording_pipeline, teacher, published_course):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    resp = tclient.post(f"/api/v1/recordings/{rec['id']}/publish", json={"published": True})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "RECORDING_NOT_READY"


def test_failed_recording_is_reported_honestly_and_not_playable(
    mock_recording_pipeline, fake_storage, teacher, enrolled_student, published_course
):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    mock_recording_pipeline["status"] = "failed"
    tclient.get("/api/v1/recordings")  # triggers the provider poll
    detail = tclient.get(f"/api/v1/recordings/{rec['id']}").json()
    assert detail["status"] == "failed" and detail["error_message"]
    resp = tclient.get(f"/api/v1/recordings/{rec['id']}/playback")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "RECORDING_FAILED"


def test_complete_event_with_missing_media_is_failed_not_available(
    mock_recording_pipeline, fake_storage, teacher, published_course
):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    mock_recording_pipeline["status"] = "complete"  # provider says done, but nothing is in storage
    status = tclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()[0]
    assert status["status"] == "failed"


def test_playback_reports_media_missing_from_storage(recorded, enrolled_student, fake_storage):
    fake_storage.objects.clear()
    sclient, _ = enrolled_student
    resp = sclient.get(f"/api/v1/recordings/{recorded['rec']['id']}/playback")
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "RECORDING_MEDIA_MISSING"


def test_student_cannot_publish_share_or_delete(recorded, enrolled_student):
    sclient, _ = enrolled_student
    rid = recorded["rec"]["id"]
    assert sclient.post(f"/api/v1/recordings/{rid}/publish", json={"published": False}).status_code in (403, 404)
    assert sclient.delete(f"/api/v1/recordings/{rid}").status_code in (403, 404)


def test_another_teacher_has_no_automatic_access(recorded, make_user):
    other, _ = make_user(role="teacher", prefix="other")
    rid = recorded["rec"]["id"]
    assert other.get(f"/api/v1/recordings/{rid}").status_code == 403
    assert other.get(f"/api/v1/recordings/{rid}/playback").status_code == 403
    assert other.post(f"/api/v1/recordings/{rid}/publish", json={"published": False}).status_code == 403
    assert other.get("/api/v1/recordings").json() == []


def test_progress_is_per_student_and_visible_in_library(recorded, enrolled_student):
    sclient, _ = enrolled_student
    rid = recorded["rec"]["id"]
    assert sclient.post(f"/api/v1/recordings/{rid}/progress", json={"position_seconds": 90}).json()["position_seconds"] == 90
    item = sclient.get("/api/v1/recordings").json()[0]
    assert item["progress_seconds"] == 90 and item["completed"] is False
    assert sclient.post(f"/api/v1/recordings/{rid}/progress", json={"position_seconds": 100, "completed": True}).json()["completed"]


def test_delete_removes_media_but_keeps_metadata(recorded, enrolled_student, fake_storage):
    rid = recorded["rec"]["id"]
    assert recorded["tclient"].delete(f"/api/v1/recordings/{rid}").status_code == 204
    assert fake_storage.deleted
    detail = recorded["tclient"].get(f"/api/v1/recordings/{rid}").json()
    assert detail["status"] == "archived" and detail["is_published"] is False
    sclient, _ = enrolled_student
    assert sclient.get(f"/api/v1/recordings/{rid}/playback").status_code == 404


def test_ending_a_class_stops_its_active_recording(mock_recording_pipeline, teacher, published_course):
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert tclient.post(f"/api/v1/classes/{cls['id']}/end").status_code == 200
    assert tclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()[0]["status"] == "processing"


def test_join_token_tells_participants_when_recording(mock_recording_pipeline, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    sclient, _ = enrolled_student
    cls = _live_class(tclient, published_course["id"])
    assert sclient.post(f"/api/v1/classes/{cls['id']}/join-token").json()["recording_active"] is False
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert sclient.post(f"/api/v1/classes/{cls['id']}/join-token").json()["recording_active"] is True


def test_recording_can_be_disabled_by_institution_policy(mock_recording_pipeline, teacher, published_course, monkeypatch):
    from app.services import recording_service

    monkeypatch.setattr(recording_service.settings, "recording_enabled", False)
    tclient, _ = teacher
    cls = _live_class(tclient, published_course["id"])
    resp = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "RECORDING_DISABLED"


# ----------------------------------------------------------------------------- Scenario C: reuse


@pytest.fixture
def second_course_section(teacher):
    """A second course taught by the same teacher, with a section holding a student of its own."""
    tclient, _ = teacher
    course = tclient.post("/api/v1/courses", json={"title": "Biology Lab", "status": "published"}).json()
    section = tclient.post(f"/api/v1/courses/{course['id']}/sections", json={"name": "Rural cohort", "code": "rc"}).json()
    return course, section


def _enroll_in_section(tclient, student_pair, course, section):
    sclient, suser = student_pair
    assert sclient.post(f"/api/v1/courses/{course['id']}/enrollments", json={}).status_code == 201
    resp = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert resp.status_code == 201, resp.text


def test_reuse_recording_across_sections_without_copying(recorded, teacher, second_course_section, make_user):
    tclient = recorded["tclient"]
    course2, section2 = second_course_section
    rid = recorded["rec"]["id"]

    rural = make_user(role="student", prefix="rural")
    _enroll_in_section(tclient, rural, course2, section2)
    rural_client, _ = rural
    assert rural_client.get("/api/v1/recordings").json() == []  # not enrolled in the recording's course
    assert rural_client.get(f"/api/v1/recordings/{rid}/playback").status_code == 404

    shared = tclient.post(f"/api/v1/recordings/{rid}/sections", json={"section_id": section2["id"]})
    assert shared.status_code == 201 and shared.json()["section_ids"] == [section2["id"]]
    assert tclient.post(f"/api/v1/recordings/{rid}/sections", json={"section_id": section2["id"]}).status_code == 201  # idempotent

    listing = rural_client.get("/api/v1/recordings").json()
    assert [r["id"] for r in listing] == [rid]  # same recording row, no copy
    assert rural_client.get(f"/api/v1/recordings/{rid}/playback").status_code == 200

    # Revoking the share removes only that section's access; the recording survives for others.
    assert tclient.delete(f"/api/v1/recordings/{rid}/sections/{section2['id']}").status_code == 204
    assert rural_client.get(f"/api/v1/recordings/{rid}/playback").status_code == 404
    assert tclient.get(f"/api/v1/recordings/{rid}").json()["status"] == "available"


def test_cannot_share_into_a_section_you_do_not_teach(recorded, make_user):
    other, _ = make_user(role="teacher", prefix="other")
    foreign_course = other.post("/api/v1/courses", json={"title": "Chemistry", "status": "published"}).json()
    foreign_section = other.post(f"/api/v1/courses/{foreign_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    resp = recorded["tclient"].post(
        f"/api/v1/recordings/{recorded['rec']['id']}/sections", json={"section_id": foreign_section["id"]}
    )
    assert resp.status_code == 403
    # ...and the other teacher cannot pull in a recording they don't own either.
    resp = other.post(f"/api/v1/recordings/{recorded['rec']['id']}/sections", json={"section_id": foreign_section["id"]})
    assert resp.status_code == 403


def test_section_scoped_recording_is_hidden_from_other_sections(
    mock_recording_pipeline, fake_storage, teacher, published_course, make_user
):
    tclient, _ = teacher
    sec_a = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "A", "code": "A"}).json()
    sec_b = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "B", "code": "B"}).json()
    in_a, in_b = make_user(role="student", prefix="a"), make_user(role="student", prefix="b")
    for pair, sec in ((in_a, sec_a), (in_b, sec_b)):
        _enroll_in_section(tclient, pair, published_course, sec)

    cls = _live_class(tclient, published_course["id"], section_ids=[sec_a["id"]])
    rec = _record(tclient, cls, mock_recording_pipeline, fake_storage)

    assert in_a[0].get(f"/api/v1/recordings/{rec['id']}/playback").status_code == 200
    assert in_b[0].get(f"/api/v1/recordings/{rec['id']}/playback").status_code == 404
    assert in_b[0].get("/api/v1/recordings").json() == []
    # The live class itself is also section-gated.
    assert in_a[0].post(f"/api/v1/classes/{cls['id']}/join-token").status_code in (200, 503)
    wrong = in_b[0].post(f"/api/v1/classes/{cls['id']}/join-token")
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "WRONG_SECTION"

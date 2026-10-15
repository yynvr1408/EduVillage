"""Recorded classes: closes the "recorded classes" half of the problem statement, which
the AI text summary alone doesn't cover — a student should be able to actually watch
the missed lecture, not just read about it."""

from types import SimpleNamespace

import pytest


@pytest.fixture
def mock_recording_pipeline(monkeypatch):
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    async def fake_start_recording(room_name: str, storage_key: str) -> str:
        return "fake-egress-id-123"

    async def fake_stop_recording(egress_id: str) -> None:
        return None

    state = {"status": "recording"}

    async def fake_get_egress_status(egress_id: str):
        from livekit.api import EgressStatus

        mapped = {
            "recording": EgressStatus.EGRESS_ACTIVE,
            "complete": EgressStatus.EGRESS_COMPLETE,
            "failed": EgressStatus.EGRESS_FAILED,
        }
        return SimpleNamespace(status=mapped[state["status"]])

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "start_recording", fake_start_recording)
    monkeypatch.setattr(livekit, "stop_recording", fake_stop_recording)
    monkeypatch.setattr(livekit, "get_egress_status", fake_get_egress_status)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")
    monkeypatch.setattr(livekit.settings, "storage_backend", "s3")
    monkeypatch.setattr(livekit.settings, "object_storage_bucket", "fake-bucket")
    monkeypatch.setattr(livekit.settings, "object_storage_access_key", "fake-access-key")
    monkeypatch.setattr(livekit.settings, "object_storage_secret_key", "fake-secret-key")
    monkeypatch.setattr(livekit.settings, "object_storage_region", "us-east-1")

    return state


def _create_and_start_class(client, course_id):
    cls = client.post(
        f"/api/v1/classes?course_id={course_id}",
        json={"title": "Recorded session", "scheduled_start": "2026-11-02T10:00:00Z"},
    ).json()
    client.post(f"/api/v1/classes/{cls['id']}/start")
    return cls


def test_recording_without_s3_configured_returns_503(teacher, published_course, monkeypatch):
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")
    # storage_backend left as "local" (the test default) -> recording must refuse honestly

    client, _user = teacher
    cls = _create_and_start_class(client, published_course["id"])
    resp = client.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "RECORDING_NOT_CONFIGURED"


def test_full_recording_lifecycle(mock_recording_pipeline, teacher, enrolled_student, published_course):
    tclient, _tuser = teacher
    cls = _create_and_start_class(tclient, published_course["id"])

    start = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert start.status_code == 201
    recording = start.json()
    assert recording["status"] == "recording"

    # Can't start a second recording while one is already in progress
    duplicate = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "ALREADY_RECORDING"

    stop = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{recording['id']}/stop")
    assert stop.status_code == 200
    assert stop.json()["status"] == "processing"

    # Still processing -> listed as such, not yet downloadable
    sclient, _suser = enrolled_student
    listing = sclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()
    assert listing[0]["status"] == "processing"

    not_ready = sclient.get(f"/api/v1/classes/recordings/{recording['id']}/download")
    assert not_ready.status_code == 409
    assert not_ready.json()["error"]["code"] == "RECORDING_NOT_READY"

    # LiveKit finishes the upload
    mock_recording_pipeline["status"] = "complete"

    ready = sclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()
    assert ready[0]["status"] == "available"

    download = sclient.get(f"/api/v1/classes/recordings/{recording['id']}/download", follow_redirects=False)
    assert download.status_code in (302, 307)


def test_non_enrolled_student_cannot_see_recordings(mock_recording_pipeline, teacher, student, published_course):
    tclient, _ = teacher
    cls = _create_and_start_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")

    sclient, _ = student
    resp = sclient.get(f"/api/v1/classes/{cls['id']}/recordings")
    assert resp.status_code == 403


def test_only_teacher_can_start_recording(mock_recording_pipeline, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_and_start_class(tclient, published_course["id"])

    sclient, _ = enrolled_student
    resp = sclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert resp.status_code == 403


def test_cannot_record_a_class_that_is_not_live(mock_recording_pipeline, teacher, published_course):
    client, _user = teacher
    cls = client.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Not started yet", "scheduled_start": "2026-11-03T10:00:00Z"},
    ).json()
    resp = client.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CLASS_NOT_LIVE"


def test_recording_failure_is_reported_honestly(mock_recording_pipeline, teacher, published_course):
    tclient, _ = teacher
    cls = _create_and_start_class(tclient, published_course["id"])
    recording = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{recording['id']}/stop")

    mock_recording_pipeline["status"] = "failed"

    listing = tclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()
    assert listing[0]["status"] == "failed"

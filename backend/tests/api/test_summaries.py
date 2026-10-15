import pytest


@pytest.fixture
def live_class(teacher, published_course, monkeypatch):
    """A class in 'live' status so a summary can be requested against it.
    LiveKit itself isn't needed for the summary pipeline, so only ensure_room is faked."""
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)

    client, _user = teacher
    cls = client.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Live session", "scheduled_start": "2026-11-01T10:00:00Z"},
    ).json()
    client.post(f"/api/v1/classes/{cls['id']}/start")
    return cls


TRANSCRIPT = (
    "Today we covered photosynthesis. Plants convert light energy into chemical energy. "
    "Chlorophyll absorbs light. The products are glucose and oxygen. "
    "This process happens in the chloroplast."
)


def test_summary_pipeline_stub_provider_and_review_gate(teacher, enrolled_student, live_class):
    tclient, _tuser = teacher
    job = tclient.post(f"/api/v1/classes/{live_class['id']}/summary-jobs", json={"transcript_text": TRANSCRIPT})
    assert job.status_code == 202
    job_id = job.json()["job_id"]

    status = tclient.get(f"/api/v1/jobs/{job_id}")
    assert status.status_code == 200
    assert status.json()["status"] == "completed"

    summary = tclient.get(f"/api/v1/classes/{live_class['id']}/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["status"] == "needs_review"
    assert body["content_json"]["source"] == "stub"  # honest labeling: no LLM key configured in tests

    sclient, _suser = enrolled_student
    blocked = sclient.get(f"/api/v1/classes/{live_class['id']}/summary")
    assert blocked.status_code == 404  # not visible to students before approval

    approve = tclient.post(f"/api/v1/summaries/{body['id']}/approve")
    assert approve.status_code == 200
    assert approve.json()["status"] == "completed"

    visible = sclient.get(f"/api/v1/classes/{live_class['id']}/summary")
    assert visible.status_code == 200
    assert visible.json()["status"] == "completed"


def test_only_assigned_teacher_can_approve(teacher, live_class, make_user):
    tclient, _ = teacher
    job = tclient.post(f"/api/v1/classes/{live_class['id']}/summary-jobs", json={"transcript_text": TRANSCRIPT})
    summary = tclient.get(f"/api/v1/classes/{live_class['id']}/summary").json()

    other_client, _ = make_user(role="teacher", prefix="other-teacher")
    resp = other_client.post(f"/api/v1/summaries/{summary['id']}/approve")
    assert resp.status_code == 403


def test_request_changes_requeues_summary(teacher, live_class):
    tclient, _ = teacher
    tclient.post(f"/api/v1/classes/{live_class['id']}/summary-jobs", json={"transcript_text": TRANSCRIPT})
    summary = tclient.get(f"/api/v1/classes/{live_class['id']}/summary").json()

    resp = tclient.post(f"/api/v1/summaries/{summary['id']}/request-changes")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


def test_summary_job_requires_a_transcript_source(teacher, live_class):
    client, _user = teacher
    resp = client.post(f"/api/v1/classes/{live_class['id']}/summary-jobs", json={})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "MISSING_TRANSCRIPT_SOURCE"

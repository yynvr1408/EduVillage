"""Scenario F: AI learning recovery — sources, idempotency, provenance, failure isolation, worker.
The LLM and speech-to-text providers are mocked at their boundary; with no keys configured the
pipeline uses the clearly-labeled stub generator and says so."""

import pytest

from tests.api.test_summaries import TRANSCRIPT, live_class  # noqa: F401  (fixture reuse)


def _post(client, cls_id, **body):
    return client.post(f"/api/v1/classes/{cls_id}/summary-jobs", json=body)


def test_summary_records_provenance_and_labels_the_stub(teacher, live_class):
    client, _ = teacher
    job = _post(client, live_class["id"], transcript_text=TRANSCRIPT).json()
    summary = client.get(f"/api/v1/classes/{live_class['id']}/summary").json()
    assert job["job_id"]
    assert summary["generator"] == "stub" and summary["generator_model"] is None
    assert summary["transcript_id"]
    assert "definitions" in summary["content_json"]


def test_duplicate_request_for_same_transcript_reuses_the_job(teacher, live_class):
    client, _ = teacher
    first = _post(client, live_class["id"], transcript_text=TRANSCRIPT).json()
    again = _post(client, live_class["id"], transcript_text=TRANSCRIPT).json()
    assert again["job_id"] == first["job_id"]
    # a genuinely different transcript is a new job
    other = _post(client, live_class["id"], transcript_text=TRANSCRIPT + " Extra sentence here.").json()
    assert other["job_id"] != first["job_id"]


def test_students_cannot_trigger_summary_generation(enrolled_student, live_class):
    sclient, _ = enrolled_student
    assert _post(sclient, live_class["id"], transcript_text=TRANSCRIPT).status_code == 403


def test_job_status_is_only_visible_to_the_courses_teachers(teacher, live_class, make_user, enrolled_student):
    client, _ = teacher
    job = _post(client, live_class["id"], transcript_text=TRANSCRIPT).json()
    assert client.get(f"/api/v1/jobs/{job['job_id']}").status_code == 200
    assert enrolled_student[0].get(f"/api/v1/jobs/{job['job_id']}").status_code == 404
    other, _ = make_user(role="teacher", prefix="other")
    assert other.get(f"/api/v1/jobs/{job['job_id']}").status_code == 404


def test_only_approved_summary_reaches_students(teacher, enrolled_student, live_class):
    tclient, _ = teacher
    sclient, _ = enrolled_student
    _post(tclient, live_class["id"], transcript_text=TRANSCRIPT)
    assert sclient.get(f"/api/v1/classes/{live_class['id']}/summary").status_code == 404
    summary = tclient.get(f"/api/v1/classes/{live_class['id']}/summary").json()
    assert summary["status"] == "needs_review"
    assert tclient.post(f"/api/v1/summaries/{summary['id']}/approve").status_code == 200
    assert sclient.get(f"/api/v1/classes/{live_class['id']}/summary").json()["status"] == "completed"


def test_request_changes_regenerates_through_a_new_job(teacher, live_class, db_session):
    from app.db.models.summary import BackgroundJob

    client, _ = teacher
    _post(client, live_class["id"], transcript_text=TRANSCRIPT)
    summary = client.get(f"/api/v1/classes/{live_class['id']}/summary").json()
    resp = client.post(f"/api/v1/summaries/{summary['id']}/request-changes")
    assert resp.status_code == 200
    jobs = db_session.query(BackgroundJob).filter(BackgroundJob.reference_id == summary["id"]).all()
    assert len(jobs) == 2 and all(j.status.value == "completed" for j in jobs)


def test_stt_not_configured_fails_honestly_without_a_fake_summary(
    mock_recording_pipeline, fake_storage, teacher, published_course, db_session
):
    from app.db.models.summary import BackgroundJob, LectureSummary
    from app.integrations import speech_to_text

    speech_to_text.settings.speech_to_text_api_key = None
    tclient, _ = teacher
    cls = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}", json={"title": "Audio", "scheduled_start": "2026-11-02T10:00:00Z"}
    ).json()
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    mock_recording_pipeline["status"] = "complete"
    fake_storage.put(rec["id"], cls["id"])
    tclient.get(f"/api/v1/classes/{cls['id']}/recordings")

    job = tclient.post(f"/api/v1/recordings/{rec['id']}/summary-jobs", json={}).json()
    stored = db_session.get(BackgroundJob, job["job_id"])
    db_session.refresh(stored)
    assert stored.status.value == "failed" and stored.error_code == "STT_NOT_CONFIGURED"
    summary = db_session.get(LectureSummary, stored.reference_id)
    db_session.refresh(summary)
    assert summary.status.value == "failed" and not summary.content_json

    # Failure isolation: the recording is untouched and still plays.
    assert tclient.get(f"/api/v1/recordings/{rec['id']}").json()["status"] == "available"
    assert tclient.get(f"/api/v1/recordings/{rec['id']}/playback").status_code == 200


def test_recording_transcription_with_mocked_provider_links_source_and_recording(
    mock_recording_pipeline, fake_storage, teacher, enrolled_student, published_course, monkeypatch, db_session
):
    from app.db.models.summary import LectureSummary, LectureTranscript
    from app.integrations import speech_to_text

    monkeypatch.setattr(speech_to_text, "transcribe", lambda path: TRANSCRIPT)
    tclient, _ = teacher
    cls = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}", json={"title": "Recorded", "scheduled_start": "2026-11-02T10:00:00Z"}
    ).json()
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    mock_recording_pipeline["status"] = "complete"
    fake_storage.put(rec["id"], cls["id"])
    tclient.get(f"/api/v1/classes/{cls['id']}/recordings")
    tclient.post(f"/api/v1/recordings/{rec['id']}/publish", json={"published": True})

    first = tclient.post(f"/api/v1/recordings/{rec['id']}/summary-jobs", json={}).json()
    assert tclient.post(f"/api/v1/recordings/{rec['id']}/summary-jobs", json={}).json()["job_id"] == first["job_id"]

    transcript = db_session.query(LectureTranscript).filter(LectureTranscript.recording_id == rec["id"]).one()
    summary = db_session.query(LectureSummary).filter(LectureSummary.recording_id == rec["id"]).one()
    assert transcript.content == TRANSCRIPT and summary.transcript_id == transcript.id

    sclient, _ = enrolled_student
    assert sclient.get(f"/api/v1/recordings/{rec['id']}").json()["summary_id"] is None  # not approved yet
    assert tclient.post(f"/api/v1/summaries/{summary.id}/approve").status_code == 200
    detail = sclient.get(f"/api/v1/recordings/{rec['id']}").json()
    assert detail["summary_id"] == summary.id and detail["has_transcript"] and detail["transcript"] == TRANSCRIPT


def test_cannot_transcribe_a_recording_that_is_not_ready(mock_recording_pipeline, teacher, published_course):
    tclient, _ = teacher
    cls = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}", json={"title": "Early", "scheduled_start": "2026-11-02T10:00:00Z"}
    ).json()
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    resp = tclient.post(f"/api/v1/recordings/{rec['id']}/summary-jobs", json={})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "RECORDING_NOT_READY"


# ----------------------------------------------------------------------------- worker / retries


@pytest.fixture
def queued_job(teacher, live_class, db_session):
    """A queued job the API's background task has NOT processed (simulates a restart)."""
    from app.db.models.enums import JobStatus, JobType, SummaryStatus, TranscriptStatus
    from app.db.models.summary import BackgroundJob, LectureSummary, LectureTranscript

    t = LectureTranscript(class_id=live_class["id"], content=TRANSCRIPT, status=TranscriptStatus.ready)
    db_session.add(t)
    db_session.flush()
    s = LectureSummary(class_id=live_class["id"], transcript_id=t.id, status=SummaryStatus.queued)
    db_session.add(s)
    db_session.flush()
    j = BackgroundJob(job_type=JobType.summary_generation, status=JobStatus.queued, reference_id=s.id)
    db_session.add(j)
    db_session.commit()
    return j.id, s.id


def test_worker_processes_queued_jobs(queued_job, db_session):
    from app import worker
    from app.db.models.summary import BackgroundJob, LectureSummary

    job_id, summary_id = queued_job
    assert worker.run_once() >= 1
    db_session.expire_all()
    assert db_session.get(BackgroundJob, job_id).status.value == "completed"
    assert db_session.get(LectureSummary, summary_id).status.value == "needs_review"


def test_a_job_is_claimed_by_exactly_one_runner(queued_job, db_session):
    from app.db.session import SessionLocal
    from app.services import summary_service

    job_id, _ = queued_job
    with SessionLocal() as a, SessionLocal() as b:
        assert summary_service._claim(a, job_id) is True
        assert summary_service._claim(b, job_id) is False


def test_transient_llm_failure_is_retried_up_to_the_cap_then_fails(queued_job, db_session, monkeypatch):
    from app import worker
    from app.db.models.summary import BackgroundJob, LectureSummary
    from app.integrations import llm_provider

    def boom(text):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_provider, "generate_summary", boom)
    job_id, summary_id = queued_job
    for _ in range(5):
        worker.run_once()
    db_session.expire_all()
    job = db_session.get(BackgroundJob, job_id)
    assert job.status.value == "failed" and job.error_code == "LLM_ERROR" and job.attempts == job.max_attempts == 3
    assert db_session.get(LectureSummary, summary_id).status.value == "failed"


def test_stuck_processing_jobs_are_requeued(queued_job, db_session):
    from datetime import timedelta

    from app.db.base import utcnow
    from app.db.models.enums import JobStatus
    from app.db.models.summary import BackgroundJob
    from app.services import summary_service

    job_id, _ = queued_job
    job = db_session.get(BackgroundJob, job_id)
    job.status, job.updated_at = JobStatus.processing, utcnow() - timedelta(hours=1)
    db_session.commit()
    assert summary_service.requeue_retryable_jobs(db_session) >= 1
    db_session.expire_all()
    assert db_session.get(BackgroundJob, job_id).status.value == "queued"


def test_teacher_can_edit_then_approve_and_edits_are_flagged(teacher, enrolled_student, live_class):
    tclient, _ = teacher
    _post(tclient, live_class["id"], transcript_text=TRANSCRIPT)
    summary = tclient.get(f"/api/v1/classes/{live_class['id']}/summary").json()

    assert enrolled_student[0].patch(f"/api/v1/summaries/{summary['id']}", json={"overview": "x"}).status_code == 403
    edited = tclient.patch(f"/api/v1/summaries/{summary['id']}", json={"overview": "Corrected overview", "definitions": ["Chlorophyll: pigment"]})
    assert edited.status_code == 200
    content = edited.json()["content_json"]
    assert content["overview"] == "Corrected overview" and content["teacher_edited"] is True
    assert content["key_concepts"] == summary["content_json"]["key_concepts"]  # untouched keys survive
    assert edited.json()["generator"] == "stub"  # provenance is preserved

    tclient.post(f"/api/v1/summaries/{summary['id']}/approve")
    again = tclient.patch(f"/api/v1/summaries/{summary['id']}", json={"overview": "late edit"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "SUMMARY_NOT_IN_REVIEW"

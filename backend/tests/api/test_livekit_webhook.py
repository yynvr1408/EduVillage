"""The LiveKit egress webhook is the primary way a recording reaches 'available'. Payloads are
signed here exactly as LiveKit signs them (JWT carrying the body's SHA-256), so signature
verification is genuinely exercised; the media pipeline itself is still mocked."""

import base64
import hashlib
import json

import pytest

KEY, SECRET = "fake-key", "fake-secret"


def _signed_headers(body: str, *, secret: str = SECRET) -> dict:
    from livekit import api

    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    token = api.AccessToken(KEY, secret).with_sha256(digest).to_jwt()
    return {"Authorization": token, "Content-Type": "application/webhook+json"}


def _egress_ended(egress_id: str, status: str, *, error: str = "") -> str:
    return json.dumps(
        {
            "event": "egress_ended",
            "id": "evt-1",
            "createdAt": "1700000000",
            "egressInfo": {
                "egressId": egress_id,
                "status": status,
                "error": error,
                "fileResults": [{"duration": "65000000000", "size": "999"}],
            },
        }
    )


@pytest.fixture
def processing_recording(mock_recording_pipeline, fake_storage, teacher, published_course):
    tclient, _ = teacher
    cls = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}", json={"title": "Webhook", "scheduled_start": "2026-11-02T10:00:00Z"}
    ).json()
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")
    return {"tclient": tclient, "cls": cls, "rec": rec, "storage": fake_storage, "egress": mock_recording_pipeline["last_egress_id"]}


def test_webhook_without_signature_is_rejected(client, processing_recording):
    body = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")
    assert client.post("/api/v1/webhooks/livekit", content=body).status_code == 401


def test_webhook_with_wrong_secret_or_tampered_body_is_rejected(client, processing_recording):
    body = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")
    assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body, secret="x" * 32)).status_code == 401
    tampered = body.replace("EGRESS_COMPLETE", "EGRESS_FAILED")
    assert client.post("/api/v1/webhooks/livekit", content=tampered, headers=_signed_headers(body)).status_code == 401
    state = processing_recording["tclient"].get(f"/api/v1/recordings/{processing_recording['rec']['id']}").json()
    assert state["status"] == "processing"  # nothing changed


def test_signed_complete_event_makes_recording_available_and_is_idempotent(client, processing_recording):
    rec, storage, tclient = processing_recording["rec"], processing_recording["storage"], processing_recording["tclient"]
    storage.put(rec["id"], processing_recording["cls"]["id"], size=4321)
    body = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")

    for _ in range(2):  # LiveKit retries; replay must be harmless
        assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body)).status_code == 200

    detail = tclient.get(f"/api/v1/recordings/{rec['id']}").json()
    assert detail["status"] == "available"
    assert detail["size_bytes"] == 4321 and detail["duration_seconds"] == 65


def test_signed_failure_event_marks_recording_failed(client, processing_recording):
    body = _egress_ended(processing_recording["egress"], "EGRESS_FAILED", error="disk full")
    assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body)).status_code == 200
    detail = processing_recording["tclient"].get(f"/api/v1/recordings/{processing_recording['rec']['id']}").json()
    assert detail["status"] == "failed" and "disk full" in detail["error_message"]


def test_failed_recording_is_not_resurrected_by_a_late_complete_event(client, processing_recording):
    failed = _egress_ended(processing_recording["egress"], "EGRESS_FAILED", error="boom")
    client.post("/api/v1/webhooks/livekit", content=failed, headers=_signed_headers(failed))
    processing_recording["storage"].put(processing_recording["rec"]["id"], processing_recording["cls"]["id"])
    late = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")
    client.post("/api/v1/webhooks/livekit", content=late, headers=_signed_headers(late))
    detail = processing_recording["tclient"].get(f"/api/v1/recordings/{processing_recording['rec']['id']}").json()
    assert detail["status"] == "failed"


def test_event_for_unknown_egress_is_ignored(client, processing_recording):
    body = _egress_ended("not-ours", "EGRESS_COMPLETE")
    assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body)).status_code == 200


def test_recording_available_automatically_queues_a_summary_with_no_teacher_action(client, processing_recording):
    """The webhook alone — never a POST to /summary-jobs — must be enough to start the
    transcribe-and-summarize pipeline, so a student has something to read without the teacher
    remembering to click Generate Summary."""
    rec, storage, tclient, cls = (
        processing_recording["rec"],
        processing_recording["storage"],
        processing_recording["tclient"],
        processing_recording["cls"],
    )
    storage.put(rec["id"], cls["id"], size=4321)
    body = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")
    assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body)).status_code == 200

    summary = tclient.get(f"/api/v1/classes/{cls['id']}/summary")
    assert summary.status_code == 200
    body_json = summary.json()
    assert body_json["class_id"] == cls["id"]
    assert body_json["status"] in ("queued", "processing", "needs_review", "completed", "failed")


def test_a_replayed_webhook_never_double_queues_the_summary(client, processing_recording):
    rec, storage, tclient, cls = (
        processing_recording["rec"],
        processing_recording["storage"],
        processing_recording["tclient"],
        processing_recording["cls"],
    )
    storage.put(rec["id"], cls["id"], size=4321)
    body = _egress_ended(processing_recording["egress"], "EGRESS_COMPLETE")
    for _ in range(2):  # LiveKit retries the same event
        client.post("/api/v1/webhooks/livekit", content=body, headers=_signed_headers(body))

    summaries = tclient.get("/api/v1/summaries").json()
    matching = [s for s in summaries if s["class_id"] == cls["id"]]
    assert len(matching) == 1

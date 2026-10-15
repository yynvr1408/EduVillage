"""S3-compatible storage + the recording chain, over REAL HTTP against an S3-API emulator (moto server).

HONESTY NOTE: moto emulates the S3 protocol; it is NOT AWS S3 and NOT Cloudflare R2. It does not
validate signatures or enforce URL expiry. These tests therefore prove that our code speaks the S3
protocol correctly end to end (presigned PUT/GET, HEAD, ranged GET, delete, key layout) and that the
recording state machine is wired to it — they do NOT prove R2 accepts our credentials/CORS/signatures,
and LiveKit Egress itself is not involved (the "egress upload" is performed by the test). See
docs/RECORDING_VERIFICATION.md for what still needs real credentials and participants."""

import base64
import hashlib
import json

import boto3
import httpx
import pytest
from moto.server import ThreadedMotoServer

BUCKET = "eduvillage-test"
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + bytes(range(256)) * 40  # ~10 KB with real ftyp header
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 64


@pytest.fixture(scope="module")
def s3_server():
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    boto3.client("s3", endpoint_url=endpoint, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1").create_bucket(Bucket=BUCKET)
    yield endpoint
    server.stop()


@pytest.fixture
def s3(s3_server, monkeypatch):
    """Points the app's storage layer at the emulator (the settings object is shared by every module)."""
    from app.integrations import object_storage

    for key, value in {
        "storage_backend": "s3", "object_storage_endpoint": s3_server, "object_storage_bucket": BUCKET,
        "object_storage_access_key": "test", "object_storage_secret_key": "test", "object_storage_region": "us-east-1",
        "object_storage_force_path_style": True,
    }.items():
        monkeypatch.setattr(object_storage.settings, key, value)
    return boto3.client("s3", endpoint_url=s3_server, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")


def _object_exists(s3, key) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception:  # noqa: BLE001
        return False


def test_s3_storage_round_trip_over_real_http(s3):
    from app.integrations.object_storage import get_storage

    storage = get_storage()
    key = "unit/round-trip.bin"
    target = storage.upload_target(key, "video/mp4")
    assert target["method"] == "PUT" and target["url"].startswith("http") and target["headers"] == {"Content-Type": "video/mp4"}  # PUT: R2 has no POST policies

    assert storage.verify_uploaded(key) is None  # nothing uploaded yet
    put = httpx.put(target["url"], content=MP4, headers=target["headers"])
    assert put.status_code == 200
    assert storage.verify_uploaded(key) == len(MP4)
    assert storage.read_head(key, 16) == MP4[:16]

    dl = storage.download_target(key, ttl_seconds=120)
    assert "X-Amz-Expires=120" in dl["url"] and "Signature" in dl["url"]  # short-lived signed URL (v4)
    full = httpx.get(dl["url"])
    assert full.status_code == 200 and full.content == MP4
    part = httpx.get(dl["url"], headers={"Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == MP4[10:20]  # resumable downloads work against S3 semantics

    storage.delete(key)
    assert storage.verify_uploaded(key) is None


def test_teacher_uploads_a_resource_straight_to_object_storage_and_a_student_downloads_it_in_chunks(
    s3, teacher, enrolled_student, published_course
):
    tclient, _ = teacher
    init = tclient.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "lecture.mp4", "mime_type": "video/mp4", "size_bytes": len(MP4), "title": "Week 1"},
    ).json()
    up = init["upload"]
    assert up["method"] == "PUT" and up["url"].startswith("http")  # the browser uploads directly; the API never sees the bytes
    assert httpx.put(up["url"], content=MP4, headers=up["headers"]).status_code == 200

    done = tclient.post(f"/api/v1/resources/{init['resource_id']}/complete")
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "available" and body["resource_type"] == "video" and body["size_bytes"] == len(MP4)
    assert body["checksum_sha256"] is None  # not computed for remote objects (would mean downloading them)
    tclient.patch(f"/api/v1/resources/{init['resource_id']}", json={"is_published": True})

    sclient, _ = enrolled_student
    info = sclient.get(f"/api/v1/resources/{init['resource_id']}/download-info").json()
    assert info["same_origin"] is False and info["url"].startswith("http") and info["expires_in"] == 900
    assert httpx.get(info["url"], headers={"Range": "bytes=0-99"}).content == MP4[:100]
    assert httpx.get(info["url"]).content == MP4


def test_content_that_is_not_what_it_claims_is_deleted_from_the_bucket(s3, teacher, published_course, db_session):
    from app.db.models.lesson import LearningResource

    tclient, _ = teacher
    init = tclient.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "report.pdf", "mime_type": "application/pdf", "size_bytes": len(EXE)},
    ).json()
    httpx.put(init["upload"]["url"], content=EXE, headers=init["upload"]["headers"])
    key = db_session.get(LearningResource, init["resource_id"]).storage_key
    assert _object_exists(s3, key)
    resp = tclient.post(f"/api/v1/resources/{init['resource_id']}/complete")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "CONTENT_MISMATCH"
    assert not _object_exists(s3, key)  # the unsafe object was removed from storage


def test_complete_before_the_object_exists_is_an_incomplete_upload(s3, teacher, published_course):
    tclient, _ = teacher
    init = tclient.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "a.pdf", "mime_type": "application/pdf", "size_bytes": 10},
    ).json()
    resp = tclient.post(f"/api/v1/resources/{init['resource_id']}/complete")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "UPLOAD_INCOMPLETE"


# ----------------------------------------------------------------------------- recording chain


def _signed(body: str) -> dict:
    from livekit import api

    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    return {"Authorization": api.AccessToken("fake-key", "fake-secret").with_sha256(digest).to_jwt()}


def _egress_ended(egress_id: str, status: str, duration_s: int = 1800) -> str:
    return json.dumps({
        "event": "egress_ended", "id": "evt", "createdAt": "1",
        "egressInfo": {"egressId": egress_id, "status": status, "fileResults": [{"duration": str(duration_s * 10**9)}]},
    })


def test_egress_to_storage_to_webhook_to_student_playback(mock_recording_pipeline, s3, client, teacher, enrolled_student, published_course):
    """class live -> start recording -> (egress writes the file to the bucket) -> signed webhook ->
    the backend verifies the object really exists -> publish -> a student streams it with Range."""
    from app.integrations import livekit

    livekit.settings.object_storage_bucket = BUCKET  # the fixture above pointed this at a fake bucket
    tclient, _ = teacher
    cls = tclient.post(f"/api/v1/classes?course_id={published_course['id']}", json={"title": "Chain", "scheduled_start": "2026-11-02T10:00:00Z"}).json()
    tclient.post(f"/api/v1/classes/{cls['id']}/start")
    rec = tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start").json()
    egress_id = mock_recording_pipeline["last_egress_id"]
    key = f"recordings/{cls['id']}/{rec['id']}.mp4"
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec['id']}/stop")

    # 1. The provider says "complete" but nothing is in the bucket yet: the backend must NOT believe it.
    body = _egress_ended(egress_id, "EGRESS_COMPLETE")
    assert client.post("/api/v1/webhooks/livekit", content=body, headers=_signed(body)).status_code == 200
    assert tclient.get(f"/api/v1/recordings/{rec['id']}").json()["status"] == "failed"
    assert "not found in storage" in tclient.get(f"/api/v1/recordings/{rec['id']}").json()["error_message"]

    # 2. A second recording of the same class where the file really lands in the bucket.
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/start")
    rec2 = tclient.get(f"/api/v1/classes/{cls['id']}/recordings").json()[0]
    egress2 = mock_recording_pipeline["last_egress_id"]
    key2 = f"recordings/{cls['id']}/{rec2['id']}.mp4"
    tclient.post(f"/api/v1/classes/{cls['id']}/recordings/{rec2['id']}/stop")
    s3.put_object(Bucket=BUCKET, Key=key2, Body=MP4, ContentType="video/mp4")  # what LiveKit Egress would do

    body2 = _egress_ended(egress2, "EGRESS_COMPLETE", duration_s=2400)
    assert client.post("/api/v1/webhooks/livekit", content=body2, headers=_signed(body2)).status_code == 200
    detail = tclient.get(f"/api/v1/recordings/{rec2['id']}").json()
    assert detail["status"] == "available" and detail["size_bytes"] == len(MP4) and detail["duration_seconds"] == 2400
    assert not _object_exists(s3, key)  # (the failed one never had a file)

    # 3. Private until published; then the student gets a signed URL and can stream byte ranges.
    sclient, _ = enrolled_student
    assert sclient.get(f"/api/v1/recordings/{rec2['id']}/playback").status_code == 404
    tclient.post(f"/api/v1/recordings/{rec2['id']}/publish", json={"published": True})
    play = sclient.get(f"/api/v1/recordings/{rec2['id']}/playback").json()
    assert play["expires_in"] == 300 and "X-Amz-Expires=300" in play["url"]
    assert httpx.get(play["url"], headers={"Range": "bytes=0-31"}).content == MP4[:32]
    assert httpx.get(play["url"]).content == MP4

    # 4. Deleting removes the media from the bucket and playback stops.
    assert tclient.delete(f"/api/v1/recordings/{rec2['id']}").status_code == 204
    assert not _object_exists(s3, key2)
    assert sclient.get(f"/api/v1/recordings/{rec2['id']}/playback").status_code == 404

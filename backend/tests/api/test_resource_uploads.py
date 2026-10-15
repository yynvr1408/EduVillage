"""Phase 2: teacher uploads — content validation, publication, processing state, streaming limits."""

import hashlib

import pytest

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 16
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
PPTX = b"PK\x03\x04" + b"\x14\x00\x06\x00" + b"\x00" * 60
EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 64


def _init(client, course_id, filename, mime, size, **extra):
    return client.post(
        "/api/v1/resources/upload-init",
        json={"course_id": course_id, "filename": filename, "mime_type": mime, "size_bytes": size, **extra},
    )


def _upload(client, course_id, filename, mime, content, **extra):
    init = _init(client, course_id, filename, mime, len(content), **extra)
    assert init.status_code == 200, init.text
    body = init.json()
    assert client.put(body["upload"]["url"], content=content).status_code == 204
    return body["resource_id"], client.post(f"/api/v1/resources/{body['resource_id']}/complete")


@pytest.mark.parametrize(
    "filename,mime,content,expected_type",
    [
        ("lecture.mp4", "video/mp4", MP4, "video"),
        ("lecture.mp3", "audio/mpeg", MP3, "audio"),
        ("notes.pdf", "application/pdf", PDF, "document"),
        ("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", PPTX, "document"),
        ("readme.txt", "text/plain", b"Plain lecture notes\nline two\n", "notes"),
    ],
)
def test_valid_files_are_accepted_and_type_is_inferred_from_content(teacher, published_course, filename, mime, content, expected_type):
    client, _ = teacher
    rid, complete = _upload(client, published_course["id"], filename, mime, content)
    assert complete.status_code == 200, complete.text
    body = complete.json()
    assert body["status"] == "available" and body["processing_status"] == "ready"
    assert body["resource_type"] == expected_type
    assert body["is_published"] is False  # nothing is visible to students until published
    assert body["size_bytes"] == len(content)
    assert body["checksum_sha256"] == hashlib.sha256(content).hexdigest()
    assert body["version"] == 1


def test_teacher_can_choose_the_type_title_and_description(teacher, published_course):
    client, _ = teacher
    rid, complete = _upload(
        client, published_course["id"], "week1.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        PPTX, title="Week 1 slides", description="Cells and organelles", resource_type="presentation",
    )
    body = complete.json()
    assert (body["title"], body["description"], body["resource_type"]) == ("Week 1 slides", "Cells and organelles", "presentation")


def test_title_defaults_to_the_filename(teacher, published_course):
    client, _ = teacher
    _, complete = _upload(client, published_course["id"], "Cell Biology Notes.pdf", "application/pdf", PDF)
    assert complete.json()["title"] == "Cell Biology Notes"


def test_content_that_does_not_match_its_extension_is_rejected_and_removed(teacher, enrolled_student, published_course, db_session):
    from app.db.models.lesson import LearningResource
    from app.integrations import object_storage

    client, _ = teacher
    rid, complete = _upload(client, published_course["id"], "report.pdf", "application/pdf", EXE)
    assert complete.status_code == 422 and complete.json()["error"]["code"] == "CONTENT_MISMATCH"

    row = db_session.get(LearningResource, rid)
    db_session.refresh(row)
    assert row.status.value == "deleted" and row.processing_status.value == "failed" and not row.is_published
    assert not (object_storage.MEDIA_ROOT / row.storage_key).exists()  # the unsafe bytes are gone
    listing = client.get(f"/api/v1/courses/{published_course['id']}/resources").json()
    assert all(r["id"] != rid for r in listing)


def test_declared_type_must_match_the_files_real_type(teacher, published_course):
    client, _ = teacher
    _, complete = _upload(client, published_course["id"], "notes.pdf", "application/pdf", PDF, resource_type="video")
    assert complete.status_code == 422 and complete.json()["error"]["code"] == "RESOURCE_TYPE_MISMATCH"


def test_unknown_extension_and_unknown_type_are_rejected_at_init(teacher, published_course):
    client, _ = teacher
    assert _init(client, published_course["id"], "payload.exe", "application/pdf", 10).json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"
    bad_type = _init(client, published_course["id"], "a.pdf", "application/pdf", 10, resource_type="spreadsheet")
    assert bad_type.status_code == 422


def test_unsafe_filenames_are_sanitized_and_storage_keys_are_generated(teacher, published_course):
    client, _ = teacher
    rid, complete = _upload(client, published_course["id"], "../../etc/pass<wd>.pdf", "application/pdf", PDF)
    body = complete.json()
    assert ".." not in body["filename"] and "/" not in body["filename"] and "<" not in body["filename"]
    init = _init(client, published_course["id"], "..\\..\\evil.pdf", "application/pdf", len(PDF)).json()
    assert ".." not in init["upload"]["url"]


def test_upload_over_the_size_limit_is_stopped_while_streaming(teacher, published_course, monkeypatch, db_session):
    from app.integrations import object_storage
    from app.services import resource_service

    client, _ = teacher
    init = _init(client, published_course["id"], "big.mp4", "video/mp4", 1000).json()  # declared small, actually huge
    monkeypatch.setattr(resource_service, "MAX_UPLOAD_BYTES", 2048)
    resp = client.put(init["upload"]["url"], content=MP4 + b"\x00" * 10_000)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "FILE_TOO_LARGE"
    key = init["upload"]["url"].split("/upload-content/")[1]
    assert not (object_storage.MEDIA_ROOT / key).exists() and not (object_storage.MEDIA_ROOT / (key + ".part")).exists()
    # A failed upload never produces a completed record.
    assert client.post(f"/api/v1/resources/{init['resource_id']}/complete").json()["error"]["code"] == "UPLOAD_INCOMPLETE"


def test_pending_resource_is_not_ready_for_anyone_but_is_visible_to_its_teacher(teacher, enrolled_student, published_course):
    client, _ = teacher
    init = _init(client, published_course["id"], "later.pdf", "application/pdf", 20).json()
    teacher_view = client.get(f"/api/v1/courses/{published_course['id']}/resources").json()
    assert [(r["id"], r["status"], r["processing_status"]) for r in teacher_view] == [(init["resource_id"], "pending", "pending")]
    assert enrolled_student[0].get(f"/api/v1/courses/{published_course['id']}/resources").json() == []
    assert client.patch(f"/api/v1/resources/{init['resource_id']}", json={"is_published": True}).json()["error"]["code"] == "RESOURCE_NOT_READY"


def test_publish_unpublish_controls_student_visibility_and_bumps_the_version(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    sclient, _ = enrolled_student
    rid, _ = _upload(tclient, published_course["id"], "n.pdf", "application/pdf", PDF)
    url = f"/api/v1/courses/{published_course['id']}/resources"

    assert sclient.get(url).json() == []
    assert sclient.get(f"/api/v1/resources/{rid}/download").status_code == 404  # unpublished: no access by id either
    published = tclient.patch(f"/api/v1/resources/{rid}", json={"is_published": True}).json()
    assert published["is_published"] is True and published["version"] == 2
    assert [r["id"] for r in sclient.get(url).json()] == [rid]
    assert sclient.get(f"/api/v1/resources/{rid}/download", follow_redirects=True).status_code == 200

    tclient.patch(f"/api/v1/resources/{rid}", json={"is_published": False})
    assert sclient.get(url).json() == []
    assert sclient.get(f"/api/v1/resources/{rid}/download").status_code == 404


def test_only_a_teacher_of_the_course_can_edit_publish_or_upload(teacher, enrolled_student, published_course, make_user):
    tclient, _ = teacher
    rid, _ = _upload(tclient, published_course["id"], "n.pdf", "application/pdf", PDF)
    other, _ = make_user(role="teacher", prefix="other")
    assert other.patch(f"/api/v1/resources/{rid}", json={"title": "hijack"}).status_code == 403
    assert enrolled_student[0].patch(f"/api/v1/resources/{rid}", json={"is_published": True}).status_code == 403
    assert _init(other, published_course["id"], "x.pdf", "application/pdf", 10).status_code == 403
    assert other.get(f"/api/v1/courses/{published_course['id']}/resources").status_code == 403


def test_complete_is_idempotent(teacher, published_course):
    client, _ = teacher
    rid, first = _upload(client, published_course["id"], "n.pdf", "application/pdf", PDF)
    again = client.post(f"/api/v1/resources/{rid}/complete")
    assert again.status_code == 200 and again.json()["version"] == first.json()["version"]

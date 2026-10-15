def _upload_file(client, course_id, *, filename="notes.txt", mime_type="text/plain", content=b"hello world", size=None):
    init = client.post(
        "/api/v1/resources/upload-init",
        json={"course_id": course_id, "filename": filename, "mime_type": mime_type, "size_bytes": size or len(content)},
    )
    assert init.status_code == 200, init.text
    body = init.json()
    put = client.put(body["upload"]["url"], content=content, headers={"Content-Type": mime_type})
    assert put.status_code == 204, put.text
    complete = client.post(f"/api/v1/resources/{body['resource_id']}/complete")
    assert complete.status_code == 200, complete.text
    return complete.json()


def test_teacher_uploads_and_student_downloads(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    resource = _upload_file(tclient, published_course["id"], content=b"Photosynthesis notes.")
    assert resource["status"] == "available"
    assert resource["size_bytes"] == len(b"Photosynthesis notes.")

    sclient, _ = enrolled_student
    resp = sclient.get(f"/api/v1/resources/{resource['id']}/download", follow_redirects=True)
    assert resp.status_code == 200
    assert resp.text == "Photosynthesis notes."


def test_student_cannot_upload(student, published_course):
    client, _user = student
    resp = client.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "x.txt", "mime_type": "text/plain", "size_bytes": 5},
    )
    assert resp.status_code == 403


def test_disallowed_mime_type_rejected(teacher, published_course):
    client, _user = teacher
    resp = client.post(
        "/api/v1/resources/upload-init",
        json={
            "course_id": published_course["id"],
            "filename": "virus.exe",
            "mime_type": "application/x-msdownload",
            "size_bytes": 100,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_FAILED"


def test_oversized_declared_size_rejected(teacher, published_course):
    client, _user = teacher
    resp = client.post(
        "/api/v1/resources/upload-init",
        json={
            "course_id": published_course["id"],
            "filename": "huge.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 999_999_999_999,
        },
    )
    assert resp.status_code == 422


def test_complete_before_upload_is_a_conflict(teacher, published_course):
    client, _user = teacher
    init = client.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "late.txt", "mime_type": "text/plain", "size_bytes": 10},
    )
    resource_id = init.json()["resource_id"]
    resp = client.post(f"/api/v1/resources/{resource_id}/complete")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "UPLOAD_INCOMPLETE"


def test_list_course_resources_only_shows_available(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    _upload_file(tclient, published_course["id"], filename="a.txt")

    sclient, _ = enrolled_student
    resp = sclient.get(f"/api/v1/courses/{published_course['id']}/resources")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_owning_teacher_can_delete_resource(teacher, published_course):
    client, _user = teacher
    resource = _upload_file(client, published_course["id"], filename="delete-me.txt")

    resp = client.delete(f"/api/v1/resources/{resource['id']}")
    assert resp.status_code == 204

    listing = client.get(f"/api/v1/courses/{published_course['id']}/resources").json()
    assert all(r["id"] != resource["id"] for r in listing)


def test_non_enrolled_student_cannot_download(student, teacher, published_course):
    tclient, _ = teacher
    resource = _upload_file(tclient, published_course["id"], filename="private.txt")

    sclient, _ = student
    resp = sclient.get(f"/api/v1/resources/{resource['id']}/download")
    assert resp.status_code == 403

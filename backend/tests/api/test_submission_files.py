"""PDF / Word attachments on assignment submissions (real API + database + local-disk storage)."""

import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600  # legacy Word (OLE2) header


def docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()


def attach(client, assignment_id, filename, data, mime="application/octet-stream", declared_size=None):
    init = client.post(
        f"/api/v1/assignments/{assignment_id}/attachments",
        json={"filename": filename, "mime_type": mime, "size_bytes": declared_size or len(data)},
    )
    if init.status_code != 201:
        return init, None
    body = init.json()
    put = client.put(body["upload"]["url"], content=data)
    assert put.status_code == 204, put.text
    done = client.post(f"/api/v1/assignments/{assignment_id}/attachments/{body['attachment_id']}/complete")
    return done, body["attachment_id"]


@pytest.mark.parametrize(
    "name,data",
    [("answer.pdf", PDF), ("essay.docx", docx_bytes()), ("old.doc", DOC)],
)
def test_student_can_attach_pdf_doc_and_docx(enrolled_student, published_assignment, name, data):
    client, _ = enrolled_student
    done, aid = attach(client, published_assignment["id"], name, data)
    assert done.status_code == 200, done.text
    assert done.json()["filename"] == name and done.json()["size_bytes"] == len(data)
    listed = client.get(f"/api/v1/assignments/{published_assignment['id']}/attachments").json()
    assert [a["id"] for a in listed] == [aid]


def test_attachments_appear_on_the_submission_and_download_back_identically(enrolled_student, teacher, published_assignment):
    client, _ = enrolled_student
    aid_resp, aid = attach(client, published_assignment["id"], "work.pdf", PDF)
    assert aid_resp.status_code == 200
    saved = client.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me", json={"answer": {"text": "see file"}, "submit": True}
    ).json()
    assert [a["filename"] for a in saved["attachments"]] == ["work.pdf"]
    assert [a["filename"] for a in client.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").json()["attachments"]] == ["work.pdf"]

    tclient, _ = teacher
    subs = tclient.get(f"/api/v1/assignments/{published_assignment['id']}/submissions").json()
    assert [a["id"] for a in subs[0]["attachments"]] == [aid]
    for who in (client, tclient):
        dl = who.get(f"/api/v1/assignments/{published_assignment['id']}/attachments/{aid}/download")
        assert dl.status_code == 200 and dl.content == PDF


def test_other_students_and_outsiders_cannot_see_or_download(enrolled_student, student, make_user, published_assignment):
    client, _ = enrolled_student
    _, aid = attach(client, published_assignment["id"], "private.pdf", PDF)
    other_student, _ = make_user(role="student", prefix="peer")
    other_teacher, _ = make_user(role="teacher", prefix="otherteacher")
    for c in (other_student, other_teacher):
        assert c.get(f"/api/v1/assignments/{published_assignment['id']}/attachments/{aid}/download").status_code in (403, 404)
        assert c.delete(f"/api/v1/assignments/{published_assignment['id']}/attachments/{aid}").status_code in (403, 404)


def test_unsupported_types_are_refused_before_upload(enrolled_student, published_assignment):
    client, _ = enrolled_student
    for name in ("pic.png", "run.exe", "notes.txt", "archive.zip", "noext"):
        r = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": name, "size_bytes": 10})
        assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE", name


def test_a_renamed_file_is_rejected_and_removed(enrolled_student, published_assignment):
    client, _ = enrolled_student
    done, aid = attach(client, published_assignment["id"], "fake.pdf", b"just some plain text, not a pdf")
    assert done.status_code == 422 and done.json()["error"]["code"] == "CONTENT_MISMATCH"
    assert client.get(f"/api/v1/assignments/{published_assignment['id']}/attachments").json() == []
    done2, _ = attach(client, published_assignment["id"], "fake.docx", PDF)  # a PDF pretending to be Word
    assert done2.status_code == 422 and done2.json()["error"]["code"] == "CONTENT_MISMATCH"


def test_size_limit_and_empty_files(enrolled_student, published_assignment, monkeypatch):
    from app.config import get_settings

    client, _ = enrolled_student
    monkeypatch.setattr(get_settings(), "submission_max_mb", 1)
    too_big = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "big.pdf", "size_bytes": 2 * 1024 * 1024})
    assert too_big.status_code == 422 and too_big.json()["error"]["code"] == "FILE_TOO_LARGE"
    # a client that lies about the size is caught when the stored bytes are measured
    liar = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "x.pdf", "size_bytes": 100})
    url = liar.json()["upload"]["url"]
    assert client.put(url, content=b"%PDF-" + b"0" * (2 * 1024 * 1024)).status_code == 422
    empty = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "e.pdf", "size_bytes": 5})
    assert client.put(empty.json()["upload"]["url"], content=b"").status_code == 422


def test_at_most_five_files(enrolled_student, published_assignment):
    client, _ = enrolled_student
    for i in range(5):
        done, _ = attach(client, published_assignment["id"], f"f{i}.pdf", PDF)
        assert done.status_code == 200
    sixth = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "f6.pdf", "size_bytes": len(PDF)})
    assert sixth.status_code == 409 and sixth.json()["error"]["code"] == "TOO_MANY_FILES"


def test_student_can_remove_a_file_and_it_disappears_from_storage(enrolled_student, published_assignment):
    client, _ = enrolled_student
    _, aid = attach(client, published_assignment["id"], "gone.pdf", PDF)
    assert client.delete(f"/api/v1/assignments/{published_assignment['id']}/attachments/{aid}").status_code == 204
    assert client.get(f"/api/v1/assignments/{published_assignment['id']}/attachments").json() == []
    assert client.get(f"/api/v1/assignments/{published_assignment['id']}/attachments/{aid}/download").status_code == 404


def test_not_enrolled_students_cannot_attach(student, published_assignment):
    client, _ = student
    r = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "a.pdf", "size_bytes": 5})
    assert r.status_code == 403


def test_teachers_cannot_attach_as_students(teacher, published_assignment):
    client, _ = teacher
    r = client.post(f"/api/v1/assignments/{published_assignment['id']}/attachments", json={"filename": "a.pdf", "size_bytes": 5})
    assert r.status_code == 403


def test_closed_assignment_and_passed_deadline_block_changes(enrolled_student, teacher, published_course):
    tclient, _ = teacher
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    late = tclient.post(
        f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "Late", "status": "published", "due_at": past}
    ).json()
    client, _ = enrolled_student
    r = client.post(f"/api/v1/assignments/{late['id']}/attachments", json={"filename": "a.pdf", "size_bytes": 5})
    assert r.status_code == 409 and r.json()["error"]["code"] == "SUBMISSION_EXPIRED"

    open_one = tclient.post(f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "Open", "status": "published"}).json()
    _, aid = attach(client, open_one["id"], "keep.pdf", PDF)
    tclient.patch(f"/api/v1/assignments/{open_one['id']}", json={"status": "closed"})
    closed = client.post(f"/api/v1/assignments/{open_one['id']}/attachments", json={"filename": "b.pdf", "size_bytes": 5})
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "ASSIGNMENT_CLOSED"
    assert client.delete(f"/api/v1/assignments/{open_one['id']}/attachments/{aid}").status_code == 409


def test_text_only_submissions_still_work_and_have_no_attachments(enrolled_student, published_assignment):
    client, _ = enrolled_student
    r = client.put(f"/api/v1/assignments/{published_assignment['id']}/submissions/me", json={"answer": {"text": "plain"}, "submit": True})
    assert r.status_code == 200 and r.json()["attachments"] == []

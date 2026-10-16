"""Syllabus import: pasted text or a text PDF becomes proposed lessons; the teacher confirms before anything is saved."""

import pytest

from app.services import syllabus_service


def make_pdf(lines: list[str]) -> bytes:
    """A minimal one-page text PDF (Helvetica), enough for real text extraction."""
    def esc(t): return t.replace("\\", "\\\\").replace("(", "\(").replace(")", "\)")
    content = "BT /F1 12 Tf 72 740 Td 16 TL " + " T* ".join(f"({esc(l)}) Tj" for l in lines) + " ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out


def test_headings_start_lessons_and_following_lines_become_their_description():
    lessons = syllabus_service.split_into_lessons(
        "Unit 1: Cells\nStructure of a cell\nOrganelles\nUnit 2: Genetics\n- Mendel's laws\n3. Evolution"
    )
    assert [l["title"] for l in lessons] == ["Unit 1: Cells", "Unit 2: Genetics", "3. Evolution"]
    assert lessons[0]["content"] == "Structure of a cell\nOrganelles"
    assert lessons[1]["content"] == "Mendel's laws"
    assert lessons[2]["content"] is None


def test_plain_lines_without_headings_become_one_lesson_each():
    lessons = syllabus_service.split_into_lessons("Introduction\n\n  Photosynthesis  \nRespiration")
    assert [l["title"] for l in lessons] == ["Introduction", "Photosynthesis", "Respiration"]


def test_empty_and_oversized_text_rejected():
    with pytest.raises(Exception) as e:
        syllabus_service.split_into_lessons("  \n \n")
    assert getattr(e.value, "code", "") == "SYLLABUS_EMPTY"


def test_paste_preview_does_not_save_and_bulk_create_appends_in_order(teacher, published_course):
    client, _ = teacher
    cid = published_course["id"]
    client.post(f"/api/v1/courses/{cid}/lessons", json={"title": "Existing", "position": 1, "status": "published"})
    prev = client.post(f"/api/v1/courses/{cid}/syllabus/preview", json={"text": "Unit 1: A\nUnit 2: B\nUnit 3: C"})
    assert prev.status_code == 200 and len(prev.json()["lessons"]) == 3
    assert len(client.get(f"/api/v1/courses/{cid}/lessons").json()) == 1  # preview saved nothing
    created = client.post(f"/api/v1/courses/{cid}/lessons/bulk", json={"lessons": prev.json()["lessons"]})
    assert created.status_code == 201
    lessons = client.get(f"/api/v1/courses/{cid}/lessons").json()
    assert [l["title"] for l in lessons] == ["Existing", "Unit 1: A", "Unit 2: B", "Unit 3: C"]
    assert [l["position"] for l in lessons] == [1, 2, 3, 4]
    assert all(l["status"] == "published" for l in lessons[1:])


def test_pdf_upload_returns_proposed_lessons(teacher, published_course):
    client, _ = teacher
    pdf = make_pdf(["Syllabus", "Unit 1: Algebra", "Equations", "Unit 2: Geometry", "Triangles"])
    r = client.post(
        f"/api/v1/courses/{published_course['id']}/syllabus/preview-pdf", files={"file": ("syllabus.pdf", pdf, "application/pdf")}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pages"] == 1
    assert [l["title"] for l in body["lessons"]] == ["Unit 1: Algebra", "Unit 2: Geometry"]
    assert body["lessons"][0]["content"] == "Equations"


@pytest.mark.parametrize(
    "name,data,code",
    [
        ("notes.pdf", b"this is not a pdf at all", "NOT_A_PDF"),
        ("broken.pdf", b"%PDF-1.4\ngarbage", "PDF_UNREADABLE"),
        ("empty.pdf", make_pdf([" "]), "PDF_NO_TEXT"),
    ],
)
def test_bad_pdfs_are_rejected_clearly(teacher, published_course, name, data, code):
    client, _ = teacher
    r = client.post(f"/api/v1/courses/{published_course['id']}/syllabus/preview-pdf", files={"file": (name, data, "application/pdf")})
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_oversized_pdf_rejected(teacher, published_course):
    client, _ = teacher
    big = b"%PDF-1.4\n" + b"0" * (syllabus_service.MAX_PDF_BYTES + 10)
    r = client.post(f"/api/v1/courses/{published_course['id']}/syllabus/preview-pdf", files={"file": ("big.pdf", big, "application/pdf")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_only_the_course_owner_can_import(student, make_user, published_course):
    sclient, _ = student
    other, _ = make_user(role="teacher", prefix="other")
    cid = published_course["id"]
    for c in (sclient, other):
        assert c.post(f"/api/v1/courses/{cid}/syllabus/preview", json={"text": "Unit 1"}).status_code == 403
        assert c.post(f"/api/v1/courses/{cid}/lessons/bulk", json={"lessons": [{"title": "x"}]}).status_code == 403


def test_bulk_validation(teacher, published_course):
    client, _ = teacher
    assert client.post(f"/api/v1/courses/{published_course['id']}/lessons/bulk", json={"lessons": []}).status_code == 422
    assert client.post(f"/api/v1/courses/{published_course['id']}/lessons/bulk", json={"lessons": [{"title": ""}]}).status_code == 422

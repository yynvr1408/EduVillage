
def _section(tclient, course_id, code="A", name="Section A"):
    resp = tclient.post(f"/api/v1/courses/{course_id}/sections", json={"name": name, "code": code})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_teacher_creates_sections_and_codes_are_unique_per_course(teacher, published_course):
    tclient, _ = teacher
    section = _section(tclient, published_course["id"], code="sec-a")
    assert section["code"] == "SEC-A"
    dup = tclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "Again", "code": "SEC-A"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "SECTION_CODE_TAKEN"


def test_students_cannot_create_sections_and_other_teachers_cannot_either(enrolled_student, published_course, make_user):
    sclient, _ = enrolled_student
    assert sclient.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "x", "code": "x"}).status_code == 403
    other, _ = make_user(role="teacher", prefix="other")
    assert other.post(f"/api/v1/courses/{published_course['id']}/sections", json={"name": "x", "code": "x"}).status_code == 403


def test_membership_requires_course_enrollment(teacher, student, published_course):
    tclient, _ = teacher
    sclient, suser = student
    section = _section(tclient, published_course["id"])
    resp = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "NOT_ENROLLED"

    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]}).status_code == 201
    again = tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert again.status_code == 409 and again.json()["error"]["code"] == "ALREADY_MEMBER"


def test_student_sees_only_their_own_sections(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    sclient, suser = enrolled_student
    mine, other = _section(tclient, published_course["id"], "A"), _section(tclient, published_course["id"], "B")
    tclient.post(f"/api/v1/sections/{mine['id']}/members", json={"student_id": suser["id"]})
    assert {s["id"] for s in tclient.get(f"/api/v1/courses/{published_course['id']}/sections").json()} == {mine["id"], other["id"]}
    assert [s["id"] for s in sclient.get(f"/api/v1/courses/{published_course['id']}/sections").json()] == [mine["id"]]
    # the member list is teacher-only
    assert sclient.get(f"/api/v1/sections/{mine['id']}/members").status_code == 403


def test_remove_member(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    _, suser = enrolled_student
    section = _section(tclient, published_course["id"])
    tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})
    assert tclient.delete(f"/api/v1/sections/{section['id']}/members/{suser['id']}").status_code == 204
    assert tclient.delete(f"/api/v1/sections/{section['id']}/members/{suser['id']}").status_code == 404


def test_class_sections_must_belong_to_the_class_course(teacher, published_course):
    tclient, _ = teacher
    other_course = tclient.post("/api/v1/courses", json={"title": "Other", "status": "published"}).json()
    foreign = _section(tclient, other_course["id"])
    resp = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Bad", "scheduled_start": "2026-11-02T10:00:00Z", "section_ids": [foreign["id"]]},
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "INVALID_SECTION"


def test_one_live_class_can_serve_several_sections(teacher, published_course):
    tclient, _ = teacher
    a, b = _section(tclient, published_course["id"], "A"), _section(tclient, published_course["id"], "B")
    cls = tclient.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Joint lecture", "scheduled_start": "2026-11-02T10:00:00Z", "section_ids": [a["id"], b["id"]]},
    ).json()
    assert set(cls["section_ids"]) == {a["id"], b["id"]}
    assert tclient.get(f"/api/v1/classes/{cls['id']}").json()["section_ids"] == cls["section_ids"]


def test_resources_can_be_shared_with_a_section_without_copying(teacher, make_user):
    """Scenario C for learning materials: a resource from course 1 reaches a section of course 2."""
    tclient, _ = teacher
    course1 = tclient.post("/api/v1/courses", json={"title": "Source", "status": "published"}).json()
    course2 = tclient.post("/api/v1/courses", json={"title": "Target", "status": "published"}).json()
    section = _section(tclient, course2["id"])
    init = tclient.post(
        "/api/v1/resources/upload-init",
        json={"course_id": course1["id"], "filename": "notes.pdf", "mime_type": "application/pdf", "size_bytes": 12},
    ).json()
    storage_key = init["upload"]["url"].split("/upload-content/")[1]
    assert tclient.put(f"/api/v1/resources/upload-content/{storage_key}", content=b"%PDF-1.4 abc").status_code == 204
    assert tclient.post(f"/api/v1/resources/{init['resource_id']}/complete").status_code == 200
    assert tclient.patch(f"/api/v1/resources/{init['resource_id']}", json={"is_published": True}).status_code == 200

    sclient, suser = make_user(role="student", prefix="target")
    sclient.post(f"/api/v1/courses/{course2['id']}/enrollments", json={})
    tclient.post(f"/api/v1/sections/{section['id']}/members", json={"student_id": suser["id"]})

    assert sclient.get(f"/api/v1/resources/{init['resource_id']}").status_code == 403  # not shared yet
    assert tclient.post(f"/api/v1/resources/{init['resource_id']}/sections", json={"section_id": section["id"]}).status_code == 201
    assert sclient.get(f"/api/v1/resources/{init['resource_id']}").status_code == 200
    assert [r["id"] for r in sclient.get(f"/api/v1/sections/{section['id']}/resources").json()] == [init["resource_id"]]

    assert tclient.delete(f"/api/v1/resources/{init['resource_id']}/sections/{section['id']}").status_code == 204
    assert sclient.get(f"/api/v1/resources/{init['resource_id']}").status_code == 403
    assert tclient.get(f"/api/v1/resources/{init['resource_id']}").status_code == 200  # resource itself untouched


def test_local_upload_rejects_empty_body_and_double_upload(teacher, published_course):
    tclient, _ = teacher
    init = tclient.post(
        "/api/v1/resources/upload-init",
        json={"course_id": published_course["id"], "filename": "a.pdf", "mime_type": "application/pdf", "size_bytes": 6},
    ).json()
    key = init["upload"]["url"].split("/upload-content/")[1]
    assert tclient.put(f"/api/v1/resources/upload-content/{key}", content=b"").status_code == 422
    assert tclient.put(f"/api/v1/resources/upload-content/{key}", content=b"%PDF-1").status_code == 204
    tclient.post(f"/api/v1/resources/{init['resource_id']}/complete")
    assert tclient.put(f"/api/v1/resources/upload-content/{key}", content=b"zzz").status_code == 409

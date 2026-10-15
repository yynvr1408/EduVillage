def test_student_cannot_create_course(student):
    client, _user = student
    resp = client.post("/api/v1/courses", json={"title": "Hack Attempt"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_teacher_creates_course_and_sees_it(teacher):
    client, user = teacher
    resp = client.post("/api/v1/courses", json={"title": "Algebra I", "status": "draft"})
    assert resp.status_code == 201
    course = resp.json()
    assert course["teacher_id"] == user["id"]

    listing = client.get("/api/v1/courses")
    assert any(c["id"] == course["id"] for c in listing.json())


def test_student_can_self_enroll_in_published_course(student, published_course):
    client, user = student
    resp = client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert resp.status_code == 201
    assert resp.json()["student_id"] == user["id"]

    listing = client.get("/api/v1/courses")
    assert any(c["id"] == published_course["id"] for c in listing.json())


def test_student_cannot_self_enroll_in_draft_course(teacher, student):
    tclient, _ = teacher
    draft = tclient.post("/api/v1/courses", json={"title": "Private Draft", "status": "draft"}).json()

    sclient, _ = student
    resp = sclient.post(f"/api/v1/courses/{draft['id']}/enrollments", json={})
    assert resp.status_code == 403


def test_other_teacher_cannot_edit_course(teacher, published_course, make_user):
    other_client, _ = make_user(role="teacher", prefix="other-teacher")
    resp = other_client.patch(f"/api/v1/courses/{published_course['id']}", json={"title": "Hijacked"})
    assert resp.status_code == 403


def test_owner_can_edit_their_own_course(teacher, published_course):
    client, _ = teacher
    resp = client.patch(f"/api/v1/courses/{published_course['id']}", json={"title": "Updated Title", "description": "New description"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Updated Title"
    assert body["description"] == "New description"


def test_owner_can_archive_their_course(teacher, published_course):
    client, _ = teacher
    resp = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"

    # The row still exists (nothing was destroyed) and is still directly reachable by its owner.
    get_resp = client.get(f"/api/v1/courses/{published_course['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "archived"


def test_archiving_is_idempotent(teacher, published_course):
    client, _ = teacher
    first = client.delete(f"/api/v1/courses/{published_course['id']}")
    second = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["status"] == second.json()["status"] == "archived"


def test_other_teacher_cannot_archive_course(published_course, make_user):
    other_client, _ = make_user(role="teacher", prefix="other-archiver")
    resp = other_client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 403

    # Confirm nothing happened to the real course: it's still published, not archived.
    unaffected = other_client.get(f"/api/v1/courses/{published_course['id']}")
    assert unaffected.status_code == 200
    assert unaffected.json()["status"] == "published"


def test_student_cannot_archive_a_course(student, published_course):
    client, _ = student
    resp = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 403


def test_course_discovery_fields_persist_and_filter_the_catalog(teacher, student):
    tclient, _ = teacher
    math = tclient.post(
        "/api/v1/courses",
        json={"title": "Grade 9 Mathematics", "status": "published", "grade_level": "9", "language": "Telugu", "region": "District A"},
    ).json()
    assert math["grade_level"] == "9"
    assert math["language"] == "Telugu"
    assert math["region"] == "District A"

    tclient.post(
        "/api/v1/courses",
        json={"title": "Grade 10 Mathematics", "status": "published", "grade_level": "10", "language": "Telugu", "region": "District A"},
    )

    sclient, _ = student
    grade_9_only = sclient.get("/api/v1/courses/catalog", params={"grade_level": "9"}).json()
    assert any(c["id"] == math["id"] for c in grade_9_only)
    assert all(c["grade_level"] == "9" for c in grade_9_only)

    no_match = sclient.get("/api/v1/courses/catalog", params={"region": "District B"}).json()
    assert no_match == []


def test_archived_course_drops_out_of_the_catalog_but_stays_visible_to_its_teacher(teacher):
    client, user = teacher
    course = client.post("/api/v1/courses", json={"title": "Soon Archived", "status": "published"}).json()
    assert any(c["id"] == course["id"] for c in client.get("/api/v1/courses/catalog").json())

    client.delete(f"/api/v1/courses/{course['id']}")

    assert not any(c["id"] == course["id"] for c in client.get("/api/v1/courses/catalog").json())
    assert any(c["id"] == course["id"] for c in client.get("/api/v1/courses").json())

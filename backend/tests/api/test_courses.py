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

"""Cross-user / cross-course isolation for coursework, plus the aggregate list endpoints."""


def test_draft_assignments_are_invisible_to_students(teacher, enrolled_student, published_course):
    tclient, _ = teacher
    sclient, _ = enrolled_student
    draft = tclient.post(f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "Secret draft", "status": "draft"}).json()
    live = tclient.post(f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "Open", "status": "published"}).json()

    titles = [a["title"] for a in sclient.get(f"/api/v1/assignments?course_id={published_course['id']}").json()]
    assert titles == ["Open"]
    assert sclient.get(f"/api/v1/assignments/{draft['id']}").status_code == 404
    assert sclient.get(f"/api/v1/assignments/{live['id']}").status_code == 200
    assert {a["title"] for a in tclient.get(f"/api/v1/assignments?course_id={published_course['id']}").json()} == {"Secret draft", "Open"}


def test_unenrolled_student_cannot_read_assignments_of_a_published_course(student, published_assignment, published_course):
    client, _ = student  # signed in, NOT enrolled (a published course is only a title/description preview)
    assert client.get(f"/api/v1/assignments?course_id={published_course['id']}").status_code == 403
    assert client.get(f"/api/v1/assignments/{published_assignment['id']}").status_code == 403
    assert client.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").status_code == 403


def test_assignments_across_my_courses_without_a_course_filter(teacher, enrolled_student, published_assignment, make_user):
    sclient, _ = enrolled_student
    assert [a["id"] for a in sclient.get("/api/v1/assignments").json()] == [published_assignment["id"]]
    other, _ = make_user(role="student", prefix="nocourse")
    assert other.get("/api/v1/assignments").json() == []


def test_student_cannot_read_another_students_submission(make_user, teacher, published_course, published_assignment):
    a, _ = make_user(role="student", prefix="a")
    b, _ = make_user(role="student", prefix="b")
    for c in (a, b):
        c.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    a.put(f"/api/v1/assignments/{published_assignment['id']}/submissions/me", json={"answer": {"text": "mine"}, "submit": True})
    assert b.get(f"/api/v1/assignments/{published_assignment['id']}/submissions/me").status_code == 404
    assert b.get(f"/api/v1/assignments/{published_assignment['id']}/submissions").status_code == 403


def test_course_catalog_lists_only_published_courses_and_enables_self_enrollment(teacher, student):
    tclient, tuser = teacher
    sclient, _ = student
    pub = tclient.post("/api/v1/courses", json={"title": "Catalog Course", "status": "published"}).json()
    tclient.post("/api/v1/courses", json={"title": "Hidden Draft Course", "status": "draft"})
    catalog = sclient.get("/api/v1/courses/catalog").json()
    titles = {c["title"] for c in catalog}
    assert "Catalog Course" in titles and "Hidden Draft Course" not in titles
    assert next(c for c in catalog if c["id"] == pub["id"])["teacher_name"] == tuser["full_name"]
    assert sclient.post(f"/api/v1/courses/{pub['id']}/enrollments", json={}).status_code == 201
    assert pub["id"] in [c["id"] for c in sclient.get("/api/v1/courses").json()]


def test_summary_list_shows_teachers_everything_and_students_only_approved(teacher, enrolled_student):
    tclient, _ = teacher
    sclient, _ = enrolled_student
    course = tclient.get("/api/v1/courses").json()[0]
    cls = tclient.post(f"/api/v1/classes?course_id={course['id']}", json={"title": "L", "scheduled_start": "2026-11-02T10:00:00Z"}).json()
    from app.db.session import SessionLocal
    from app.db.models.summary import LectureSummary
    from app.db.models.enums import SummaryStatus

    with SessionLocal() as db:
        s = LectureSummary(class_id=cls["id"], content_json={"overview": "x"}, status=SummaryStatus.needs_review)
        db.add(s)
        db.commit()
        summary_id = s.id
    assert [s["id"] for s in tclient.get("/api/v1/summaries").json()] == [summary_id]
    assert sclient.get("/api/v1/summaries").json() == []
    assert tclient.post(f"/api/v1/summaries/{summary_id}/approve").status_code == 200
    assert [s["id"] for s in sclient.get("/api/v1/summaries").json()] == [summary_id]

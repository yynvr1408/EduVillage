def test_teacher_creates_lesson(teacher, published_course):
    client, _user = teacher
    resp = client.post(
        f"/api/v1/courses/{published_course['id']}/lessons",
        json={"title": "Cell Theory", "content": "Intro content", "position": 1, "status": "published"},
    )
    assert resp.status_code == 201
    lesson = resp.json()
    assert lesson["course_id"] == published_course["id"]


def test_student_can_view_lesson_in_published_course(enrolled_student, published_course, teacher):
    tclient, _ = teacher
    lesson = tclient.post(
        f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Photosynthesis", "status": "published"}
    ).json()

    sclient, _ = enrolled_student
    resp = sclient.get(f"/api/v1/lessons/{lesson['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Photosynthesis"


def test_non_owner_teacher_cannot_create_lesson(published_course, make_user):
    other_client, _ = make_user(role="teacher", prefix="intruder")
    resp = other_client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Hijack"})
    assert resp.status_code == 403


def test_student_cannot_create_lesson(student, published_course):
    client, _user = student
    resp = client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Nope"})
    assert resp.status_code == 403


def test_lessons_list_ordered_by_position(teacher, published_course):
    client, _user = teacher
    client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Second", "position": 2})
    client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "First", "position": 1})

    resp = client.get(f"/api/v1/courses/{published_course['id']}/lessons")
    assert resp.status_code == 200
    titles = [lesson["title"] for lesson in resp.json()]
    assert titles == ["First", "Second"]

def test_student_dashboard_shape(enrolled_student, published_assignment):
    client, user = enrolled_student
    resp = client.get("/api/v1/student/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["id"] == user["id"]
    assert any(c["id"] == published_assignment["course_id"] for c in body["courses"])
    assert any(a["id"] == published_assignment["id"] for a in body["pending_assignments"])


def test_submitted_assignment_drops_out_of_pending(enrolled_student, published_assignment):
    client, _user = enrolled_student
    client.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me",
        json={"answer": {"text": "done"}, "submit": True},
    )
    dashboard = client.get("/api/v1/student/dashboard").json()
    assert all(a["id"] != published_assignment["id"] for a in dashboard["pending_assignments"])


def test_teacher_dashboard_shape(teacher, published_course):
    client, user = teacher
    resp = client.get("/api/v1/teacher/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["id"] == user["id"]
    assert any(c["id"] == published_course["id"] for c in body["courses"])


def test_student_cannot_hit_teacher_dashboard(student):
    client, _user = student
    resp = client.get("/api/v1/teacher/dashboard")
    assert resp.status_code == 403


def test_teacher_cannot_hit_student_dashboard(teacher):
    client, _user = teacher
    resp = client.get("/api/v1/student/dashboard")
    assert resp.status_code == 403

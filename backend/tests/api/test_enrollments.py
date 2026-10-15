def test_teacher_enrolls_specific_student(teacher, student, published_course):
    tclient, _ = teacher
    sclient, suser = student

    resp = tclient.post(
        f"/api/v1/courses/{published_course['id']}/enrollments", json={"student_id": suser["id"]}
    )
    assert resp.status_code == 201
    assert resp.json()["student_id"] == suser["id"]

    enrollments = tclient.get(f"/api/v1/courses/{published_course['id']}/enrollments").json()
    assert any(e["student_id"] == suser["id"] for e in enrollments)


def test_duplicate_active_enrollment_conflicts(enrolled_student, published_course):
    client, _user = enrolled_student
    resp = client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"


def test_student_cannot_enroll_another_student(student, published_course, make_user):
    _other_client, other_user = make_user(role="student", prefix="victim")
    client, _user = student
    resp = client.post(
        f"/api/v1/courses/{published_course['id']}/enrollments", json={"student_id": other_user["id"]}
    )
    assert resp.status_code == 403


def test_non_owner_teacher_cannot_enroll_student_in_someone_elses_course(
    published_course, student, make_user
):
    other_teacher_client, _ = make_user(role="teacher", prefix="other-teacher")
    _sclient, suser = student
    resp = other_teacher_client.post(
        f"/api/v1/courses/{published_course['id']}/enrollments", json={"student_id": suser["id"]}
    )
    assert resp.status_code == 403


def test_only_owning_teacher_can_list_enrollments(published_course, make_user):
    other_client, _ = make_user(role="teacher", prefix="snooper")
    resp = other_client.get(f"/api/v1/courses/{published_course['id']}/enrollments")
    assert resp.status_code == 403

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


def test_deleting_an_empty_untouched_course_permanently_removes_it(teacher):
    client, _ = teacher
    course = client.post("/api/v1/courses", json={"title": "Never Used", "status": "draft"}).json()

    resp = client.delete(f"/api/v1/courses/{course['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is True
    assert body["course"] is None

    # The row is actually gone, not just hidden.
    assert client.get(f"/api/v1/courses/{course['id']}").status_code == 404


def test_deleting_a_course_with_enrollments_archives_it_instead_of_destroying_it(teacher, published_course, student):
    tclient, _ = teacher
    sclient, _ = student
    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})

    resp = tclient.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is False
    assert body["course"]["status"] == "archived"

    # The row still exists (nothing about the student's enrollment was destroyed).
    get_resp = tclient.get(f"/api/v1/courses/{published_course['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "archived"


def test_deleting_a_course_with_lessons_archives_it_instead_of_destroying_it(teacher, published_course):
    client, _ = teacher
    client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Lesson 1", "position": 1, "status": "published"})

    resp = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is False
    assert body["course"]["status"] == "archived"


def test_force_delete_permanently_removes_an_already_archived_course_with_history(teacher, published_course, student):
    tclient, _ = teacher
    sclient, _ = student
    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})

    # First delete archives it (it has an enrollment).
    first = tclient.delete(f"/api/v1/courses/{published_course['id']}")
    assert first.json()["deleted"] is False
    assert first.json()["course"]["status"] == "archived"

    # A second, explicit force delete on the now-archived course actually removes it.
    second = tclient.delete(f"/api/v1/courses/{published_course['id']}", params={"force": "true"})
    assert second.status_code == 200
    body = second.json()
    assert body["deleted"] is True
    assert body["course"] is None
    assert tclient.get(f"/api/v1/courses/{published_course['id']}").status_code == 404


def test_force_is_ignored_on_a_course_that_isnt_archived_yet(teacher, published_course, student):
    """force only ever applies to something already archived — on an active course with
    activity it must still fall back to archiving, never a surprise permanent delete."""
    tclient, _ = teacher
    sclient, _ = student
    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})

    resp = tclient.delete(f"/api/v1/courses/{published_course['id']}", params={"force": "true"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is False
    assert body["course"]["status"] == "archived"
    assert tclient.get(f"/api/v1/courses/{published_course['id']}").status_code == 200


def test_other_teacher_cannot_force_delete_an_archived_course(teacher, published_course, student, make_user):
    tclient, _ = teacher
    sclient, _ = student
    sclient.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
    tclient.delete(f"/api/v1/courses/{published_course['id']}")  # archives it

    other_client, _ = make_user(role="teacher", prefix="other-force-deleter")
    resp = other_client.delete(f"/api/v1/courses/{published_course['id']}", params={"force": "true"})
    assert resp.status_code == 403
    assert tclient.get(f"/api/v1/courses/{published_course['id']}").status_code == 200


def test_archiving_is_idempotent(teacher, published_course, student):
    client, _ = teacher
    student_client, _ = student
    student_client.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})

    first = client.delete(f"/api/v1/courses/{published_course['id']}")
    second = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["deleted"] is False and second.json()["deleted"] is False
    assert first.json()["course"]["status"] == second.json()["course"]["status"] == "archived"


def test_other_teacher_cannot_delete_or_archive_a_course(published_course, make_user):
    other_client, _ = make_user(role="teacher", prefix="other-deleter")
    resp = other_client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 403

    # Confirm nothing happened to the real course: it's still published, still exists.
    unaffected = other_client.get(f"/api/v1/courses/{published_course['id']}")
    assert unaffected.status_code == 200
    assert unaffected.json()["status"] == "published"


def test_student_cannot_delete_a_course(student, published_course):
    client, _ = student
    resp = client.delete(f"/api/v1/courses/{published_course['id']}")
    assert resp.status_code == 403
    # Confirm it still exists.
    assert client.get(f"/api/v1/courses/{published_course['id']}").status_code == 200


def test_course_has_no_discovery_fields_any_more(teacher):
    client, _ = teacher
    course = client.post("/api/v1/courses", json={"title": "Plain Course", "status": "published"}).json()
    for gone in ("grade_level", "language", "institution", "region"):
        assert gone not in course


def test_archived_course_drops_out_of_the_catalog_but_stays_visible_to_its_teacher(teacher, student):
    client, user = teacher
    course = client.post("/api/v1/courses", json={"title": "Soon Archived", "status": "published"}).json()
    assert any(c["id"] == course["id"] for c in client.get("/api/v1/courses/catalog").json())

    # An enrollment forces the archive path rather than a true delete.
    student_client, _ = student
    student_client.post(f"/api/v1/courses/{course['id']}/enrollments", json={})

    delete_resp = client.delete(f"/api/v1/courses/{course['id']}").json()
    assert delete_resp["deleted"] is False

    assert not any(c["id"] == course["id"] for c in client.get("/api/v1/courses/catalog").json())
    assert any(c["id"] == course["id"] for c in client.get("/api/v1/courses").json())

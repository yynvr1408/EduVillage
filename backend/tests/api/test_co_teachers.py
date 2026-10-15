"""Co-teachers: one scarce qualified teacher shared across sections/colleges, or a
backup teacher for continuity when the primary is unavailable — the "limited teachers"
half of the problem statement."""


def test_owner_adds_co_teacher(teacher, published_course, make_user):
    owner_client, _ = teacher
    co_client, co_user = make_user(role="teacher", prefix="co-teacher")

    resp = owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})
    assert resp.status_code == 201
    assert resp.json()["teacher_id"] == co_user["id"]
    assert resp.json()["role"] == "co_teacher"

    listing = owner_client.get(f"/api/v1/courses/{published_course['id']}/teachers").json()
    assert any(t["teacher_id"] == co_user["id"] for t in listing)


def test_co_teacher_can_manage_course_content(teacher, published_course, make_user):
    owner_client, _ = teacher
    co_client, co_user = make_user(role="teacher", prefix="co-teacher")
    owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})

    # Co-teacher can create a lesson on a course they don't own outright
    resp = co_client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Backup Lesson"})
    assert resp.status_code == 201

    # Co-teacher can create and start a class
    cls = co_client.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Covered session", "scheduled_start": "2026-11-05T10:00:00Z"},
    )
    assert cls.status_code == 201

    # And the course shows up in the co-teacher's own course list
    courses = co_client.get("/api/v1/courses").json()
    assert any(c["id"] == published_course["id"] for c in courses)


def test_random_teacher_cannot_manage_course(published_course, make_user):
    outsider_client, _ = make_user(role="teacher", prefix="outsider")
    resp = outsider_client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "Hijack"})
    assert resp.status_code == 403


def test_only_primary_owner_can_add_co_teachers(teacher, published_course, make_user):
    co_client, co_user = make_user(role="teacher", prefix="co-teacher")
    tclient, _ = teacher
    tclient.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})

    another_client, another_user = make_user(role="teacher", prefix="another")
    # A co-teacher (not the original owner) may not grant access to someone else
    resp = co_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": another_user["id"]})
    assert resp.status_code == 403


def test_cannot_add_same_co_teacher_twice(teacher, published_course, make_user):
    owner_client, _ = teacher
    _co_client, co_user = make_user(role="teacher", prefix="co-teacher")
    owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})

    resp = owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})
    assert resp.status_code == 409


def test_owner_removes_co_teacher_revokes_access(teacher, published_course, make_user):
    owner_client, _ = teacher
    co_client, co_user = make_user(role="teacher", prefix="co-teacher")
    owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})

    remove = owner_client.delete(f"/api/v1/courses/{published_course['id']}/teachers/{co_user['id']}")
    assert remove.status_code == 204

    resp = co_client.post(f"/api/v1/courses/{published_course['id']}/lessons", json={"title": "No longer allowed"})
    assert resp.status_code == 403


def test_co_teacher_can_manage_classes_created_by_the_owner(teacher, published_course, make_user):
    """Backup-teacher continuity: a co-teacher should be able to run a class even if the
    originally assigned teacher created it and is now unavailable."""
    owner_client, _ = teacher
    co_client, co_user = make_user(role="teacher", prefix="co-teacher")
    owner_client.post(f"/api/v1/courses/{published_course['id']}/teachers", json={"teacher_id": co_user["id"]})

    cls = owner_client.post(
        f"/api/v1/classes?course_id={published_course['id']}",
        json={"title": "Owner-created session", "scheduled_start": "2026-11-06T10:00:00Z"},
    ).json()

    resp = co_client.patch(f"/api/v1/classes/{cls['id']}", json={"title": "Covered by backup teacher"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Covered by backup teacher"

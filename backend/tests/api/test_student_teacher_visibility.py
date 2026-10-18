"""Student Portal teacher visibility: a student sees real teachers from their own college/section
or branch-wide assignment, never teachers from another college or an unrelated branch/section.
Real API and database, no mocks."""

import secrets

from fastapi.testclient import TestClient

from app.main import app
from tests.api.test_college_registration import BASE, admin, make_college, register_active as register  # noqa: F401  (fixture reuse)

ME_TEACHERS = "/api/v1/users/me/college-teachers"


def test_student_sees_a_teacher_assigned_to_their_own_section(admin):
    college, secs = make_college(admin)
    teacher_client, teacher_resp = register(college, secs[0])
    teacher_id = teacher_resp.json()["user"]["id"]
    teacher_client.post("/api/v1/courses", json={"title": "Algebra", "status": "published"})

    student_client, student_resp = register(college, secs[0], role="student")
    assert student_resp.status_code == 201, student_resp.text
    listed = student_client.get(ME_TEACHERS).json()
    assert len(listed) == 1
    assert listed[0]["id"] == teacher_id
    assert listed[0]["section"]["id"] == secs[0]["id"]
    assert listed[0]["all_sections"] is False
    assert [c["title"] for c in listed[0]["courses"]] == ["Algebra"]


def test_student_does_not_see_a_teacher_in_a_different_section_of_the_same_branch(admin):
    college, secs = make_college(admin)
    register(college, secs[1])  # teacher in Section B
    student_client, _ = register(college, secs[0], role="student")  # student in Section A
    assert student_client.get(ME_TEACHERS).json() == []


def test_student_does_not_see_teachers_from_an_unrelated_college(admin):
    a, a_secs = make_college(admin)
    b, b_secs = make_college(admin)
    register(b, b_secs[0])  # teacher at college B
    student_client, _ = register(a, a_secs[0], role="student")  # student at college A
    assert student_client.get(ME_TEACHERS).json() == []


def test_branch_wide_teacher_is_visible_to_every_section_of_that_branch_but_not_other_branches(admin):
    college, secs = make_college(admin)  # branch "Computer Science" with sections CSE-A, CSE-B
    other_branch = admin.post(f"{BASE}/colleges/{college['id']}/branches", json={"name": "Other Dept", "short_code": "OTH"}).json()
    other_sec = admin.post(f"{BASE}/branches/{other_branch['id']}/sections", json={"name": "Section X"}).json()

    wide_client, wide_resp = register(college, None, role="teacher", all_sections=True)
    assert wide_resp.status_code == 201, wide_resp.text
    wide_teacher_id = wide_resp.json()["user"]["id"]

    student_a, _ = register(college, secs[0], role="student")  # CSE-A: inside the branch-wide teacher's branch
    student_b, _ = register(college, secs[1], role="student")  # CSE-B: also inside that branch
    other_student, _ = register(college, other_sec, role="student")  # a different branch entirely

    for client in (student_a, student_b):
        listed = client.get(ME_TEACHERS).json()
        assert len(listed) == 1
        assert listed[0]["id"] == wide_teacher_id
        assert listed[0]["all_sections"] is True
        assert listed[0]["section"] is None

    assert other_student.get(ME_TEACHERS).json() == []


def test_student_with_no_college_on_their_account_sees_an_empty_list():
    client = TestClient(app)
    r = client.post(
        "/api/v1/auth/register",
        json={"full_name": "No College", "email": f"nocollege-{secrets.token_hex(4)}@example.com", "password": "password123", "role": "student"},
    )
    assert r.status_code == 201
    assert client.get(ME_TEACHERS).json() == []


def test_teachers_cannot_call_the_student_only_endpoint(admin):
    college, secs = make_college(admin)
    teacher_client, _ = register(college, secs[0])
    assert teacher_client.get(ME_TEACHERS).status_code == 403


def test_a_second_teacher_in_the_same_section_is_also_listed(admin):
    college, secs = make_college(admin)
    register(college, secs[0], email=f"t1-{secrets.token_hex(4)}@example.com")
    register(college, secs[0], email=f"t2-{secrets.token_hex(4)}@example.com")
    student_client, _ = register(college, secs[0], role="student")
    listed = student_client.get(ME_TEACHERS).json()
    assert len(listed) == 2

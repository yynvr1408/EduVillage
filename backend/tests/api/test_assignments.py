def test_draft_save_does_not_count_as_submitted(enrolled_student, published_assignment):
    client, _user = enrolled_student
    resp = client.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me",
        json={"answer": {"text": "work in progress"}, "submit": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "draft"
    assert body["submitted_at"] is None


def test_submit_finalizes_submission(enrolled_student, published_assignment):
    client, _user = enrolled_student
    resp = client.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me",
        json={"answer": {"text": "final answer"}, "submit": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "submitted"
    assert body["submitted_at"] is not None


def test_closed_assignment_rejects_new_submissions(teacher, enrolled_student, published_assignment):
    tclient, _ = teacher
    close = tclient.patch(f"/api/v1/assignments/{published_assignment['id']}", json={"status": "closed"})
    assert close.status_code == 200

    sclient, _ = enrolled_student
    resp = sclient.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me",
        json={"answer": {"text": "too late"}, "submit": True},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "ASSIGNMENT_CLOSED"


def test_non_enrolled_student_cannot_submit(student, published_assignment):
    client, _user = student
    resp = client.put(
        f"/api/v1/assignments/{published_assignment['id']}/submissions/me",
        json={"answer": {"text": "sneaky"}, "submit": True},
    )
    assert resp.status_code == 403

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


def _assignment_with_due_at(teacher, published_course, due_at: str) -> dict:
    client, _ = teacher
    resp = client.post(
        f"/api/v1/assignments?course_id={published_course['id']}",
        json={"title": "Timed quiz", "status": "published", "due_at": due_at},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_submission_after_deadline_is_rejected_and_nothing_is_recorded_as_submitted(
    teacher, enrolled_student, published_course
):
    # A tz-aware, "Z"-suffixed deadline — exactly what the frontend's `.toISOString()` sends.
    assignment = _assignment_with_due_at(teacher, published_course, "2020-01-01T00:00:00.000Z")
    sclient, _ = enrolled_student
    resp = sclient.put(
        f"/api/v1/assignments/{assignment['id']}/submissions/me",
        json={"answer": {"text": "too late"}, "submit": True},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "SUBMISSION_EXPIRED"

    # Nothing was recorded as submitted — the rejected attempt left no server-confirmed submission.
    mine = sclient.get(f"/api/v1/assignments/{assignment['id']}/submissions/me")
    assert mine.status_code == 404


def test_draft_save_is_still_allowed_after_the_deadline(teacher, enrolled_student, published_course):
    """Only an actual submit is blocked by the deadline; saving a draft never loses work."""
    assignment = _assignment_with_due_at(teacher, published_course, "2020-01-01T00:00:00.000Z")
    sclient, _ = enrolled_student
    resp = sclient.put(
        f"/api/v1/assignments/{assignment['id']}/submissions/me",
        json={"answer": {"text": "still working on it"}, "submit": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "draft"
    assert body["submitted_at"] is None


def test_submission_before_a_future_deadline_is_accepted(teacher, enrolled_student, published_course):
    # A naive (no offset) future deadline, as stored directly by other call sites.
    assignment = _assignment_with_due_at(teacher, published_course, "2999-01-01T00:00:00")
    sclient, _ = enrolled_student
    resp = sclient.put(
        f"/api/v1/assignments/{assignment['id']}/submissions/me",
        json={"answer": {"text": "on time"}, "submit": True},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "submitted"


def test_offline_sync_submission_after_deadline_is_a_conflict_not_a_crash(teacher, enrolled_student, published_course):
    """The same deadline check runs for the offline sync path (synchronization_service ->
    assignment_service.save_submission), so a queued submission that goes stale while offline is
    rejected cleanly instead of silently accepted or crashing the batch."""
    assignment = _assignment_with_due_at(teacher, published_course, "2020-01-01T00:00:00.000Z")
    sclient, _ = enrolled_student
    resp = sclient.post(
        "/api/v1/sync/operations",
        json={
            "operations": [
                {
                    "operation_id": "op-past-due-1",
                    "operation_type": "assignment_submission",
                    "entity_id": assignment["id"],
                    "payload": {"answer": {"text": "queued while offline, synced after the deadline"}},
                }
            ]
        },
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["error_code"] == "SUBMISSION_EXPIRED"

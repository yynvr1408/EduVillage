"""Scenario D hardening: payload-conflict detection, atomicity, concurrency, eligibility."""

import threading

from fastapi.testclient import TestClient


def _op(op_id, assignment_id, text, op_type="assignment_submission"):
    return {
        "operations": [
            {"operation_id": op_id, "operation_type": op_type, "entity_id": assignment_id, "payload": {"answer": {"text": text}}}
        ]
    }


def _submissions(tclient, assignment_id):
    return tclient.get(f"/api/v1/assignments/{assignment_id}/submissions").json()


def test_reusing_an_operation_id_with_a_different_payload_is_a_conflict_and_not_applied(
    enrolled_student, teacher, published_assignment
):
    client, _ = enrolled_student
    first = client.post("/api/v1/sync/operations", json=_op("op-dup", published_assignment["id"], "original")).json()["results"][0]
    assert first["status"] == "accepted"

    clash = client.post("/api/v1/sync/operations", json=_op("op-dup", published_assignment["id"], "DIFFERENT")).json()["results"][0]
    assert clash["status"] == "conflict" and clash["error_code"] == "OPERATION_ID_REUSED"

    subs = _submissions(teacher[0], published_assignment["id"])
    assert len(subs) == 1 and subs[0]["answer"] == {"text": "original"} and subs[0]["version"] == 1


def test_a_rejected_operation_replays_the_same_rejection(enrolled_student, published_assignment):
    client, _ = enrolled_student
    bad = _op("op-bad", published_assignment["id"], "x")
    bad["operations"][0]["payload"] = {"answer": "not-an-object"}
    first = client.post("/api/v1/sync/operations", json=bad).json()["results"][0]
    again = client.post("/api/v1/sync/operations", json=bad).json()["results"][0]
    assert first["status"] == "rejected" and first["error_code"] == "INVALID_PAYLOAD"
    assert again == first


def test_unsupported_operation_type_is_recorded_and_rejected(enrolled_student, published_assignment):
    client, _ = enrolled_student
    payload = _op("op-weird", published_assignment["id"], "x", op_type="delete_everything")
    first = client.post("/api/v1/sync/operations", json=payload).json()["results"][0]
    assert first["status"] == "rejected" and first["error_code"] == "UNSUPPORTED_OPERATION_TYPE"
    assert client.post("/api/v1/sync/operations", json=payload).json()["results"][0] == first


def test_unenrolled_student_cannot_submit_through_sync(student, published_assignment):
    client, _ = student
    result = client.post("/api/v1/sync/operations", json=_op("op-out", published_assignment["id"], "x")).json()["results"][0]
    assert result["status"] == "rejected" and result["error_code"] == "FORBIDDEN"


def test_draft_assignment_does_not_accept_submissions(enrolled_student, teacher, published_course):
    tclient, _ = teacher
    draft = tclient.post(f"/api/v1/assignments?course_id={published_course['id']}", json={"title": "Not yet", "status": "draft"}).json()
    client, _ = enrolled_student
    result = client.post("/api/v1/sync/operations", json=_op("op-draft", draft["id"], "x")).json()["results"][0]
    assert result["status"] == "conflict" and result["error_code"] == "ASSIGNMENT_NOT_PUBLISHED"


def test_closed_assignment_conflict_is_stable_across_retries(enrolled_student, teacher, published_assignment):
    tclient, _ = teacher
    tclient.patch(f"/api/v1/assignments/{published_assignment['id']}", json={"status": "closed"})
    client, _ = enrolled_student
    first = client.post("/api/v1/sync/operations", json=_op("op-closed", published_assignment["id"], "late")).json()["results"][0]
    assert first["status"] == "conflict" and first["error_code"] == "ASSIGNMENT_CLOSED"
    tclient.patch(f"/api/v1/assignments/{published_assignment['id']}", json={"status": "published"})
    # Reopening must not retroactively change the recorded outcome of the same operation_id.
    assert client.post("/api/v1/sync/operations", json=_op("op-closed", published_assignment["id"], "late")).json()["results"][0] == first
    assert _submissions(tclient, published_assignment["id"]) == []


def test_operation_ids_are_scoped_per_user(make_user, published_course, teacher, published_assignment):
    clients = []
    for prefix in ("one", "two"):
        c, _ = make_user(role="student", prefix=prefix)
        c.post(f"/api/v1/courses/{published_course['id']}/enrollments", json={})
        clients.append(c)
    for c in clients:  # same operation_id, different users: both are processed
        res = c.post("/api/v1/sync/operations", json=_op("shared-id", published_assignment["id"], "mine")).json()["results"][0]
        assert res["status"] == "accepted"
    assert len(_submissions(teacher[0], published_assignment["id"])) == 2


def test_simultaneous_duplicate_requests_create_one_submission(enrolled_student, teacher, published_assignment):
    """Fires the same operation from several threads at once; the DB unique constraint must
    arbitrate, never an in-memory check."""
    from app.main import app

    cookie = enrolled_student[0].cookies.get("eduvillage_session")
    payload = _op("op-race", published_assignment["id"], "racing")
    results, barrier = [], threading.Barrier(6)

    def fire():
        c = TestClient(app)
        c.cookies.set("eduvillage_session", cookie)
        barrier.wait()
        results.append(c.post("/api/v1/sync/operations", json=payload).json()["results"][0])

    threads = [threading.Thread(target=fire) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert len(results) == 6
    assert {r["status"] for r in results} == {"accepted"}
    assert len({r["server_entity_id"] for r in results}) == 1
    assert len({r["server_version"] for r in results}) == 1  # applied once, not six times
    subs = _submissions(teacher[0], published_assignment["id"])
    assert len(subs) == 1 and subs[0]["version"] == 1


def test_pending_lists_only_operations_needing_attention(enrolled_student, published_assignment):
    client, _ = enrolled_student
    client.post("/api/v1/sync/operations", json=_op("ok-1", published_assignment["id"], "fine"))
    client.post("/api/v1/sync/operations", json=_op("weird-1", published_assignment["id"], "x", op_type="nope"))
    pending = client.get("/api/v1/sync/pending").json()
    assert [p["operation_id"] for p in pending] == ["weird-1"]
    assert client.get("/api/v1/sync/operations/ok-1").json()["status"] == "accepted"

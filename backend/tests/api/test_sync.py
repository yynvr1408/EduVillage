"""The most important reliability test in the product: a retried sync operation
must never create a duplicate submission, and the client must see the same result
on retry as on the original (successful-but-dropped-response) attempt."""


def _sync_payload(operation_id: str, assignment_id: str, text: str) -> dict:
    return {
        "operations": [
            {
                "operation_id": operation_id,
                "operation_type": "assignment_submission",
                "entity_id": assignment_id,
                "payload": {"answer": {"text": text}},
            }
        ]
    }


def test_retrying_same_operation_id_does_not_duplicate(enrolled_student, teacher, published_assignment):
    client, _user = enrolled_student
    payload = _sync_payload("op-retry-001", published_assignment["id"], "my answer")

    first = client.post("/api/v1/sync/operations", json=payload)
    assert first.status_code == 200
    first_result = first.json()["results"][0]
    assert first_result["status"] == "accepted"

    second = client.post("/api/v1/sync/operations", json=payload)
    assert second.status_code == 200
    second_result = second.json()["results"][0]

    assert second_result == first_result  # byte-for-byte identical replay, not reprocessed

    tclient, _ = teacher
    submissions = tclient.get(f"/api/v1/assignments/{published_assignment['id']}/submissions").json()
    assert len(submissions) == 1
    assert submissions[0]["version"] == first_result["server_version"]


def test_repeated_retry_many_times_still_one_record(enrolled_student, teacher, published_assignment):
    client, _user = enrolled_student
    payload = _sync_payload("op-retry-many", published_assignment["id"], "stress test answer")

    for _ in range(10):
        resp = client.post("/api/v1/sync/operations", json=payload)
        assert resp.status_code == 200
        assert resp.json()["results"][0]["status"] == "accepted"

    tclient, _ = teacher
    submissions = tclient.get(f"/api/v1/assignments/{published_assignment['id']}/submissions").json()
    assert len(submissions) == 1


def test_different_operation_ids_both_apply(enrolled_student, published_assignment):
    client, _user = enrolled_student
    first = client.post("/api/v1/sync/operations", json=_sync_payload("op-a", published_assignment["id"], "v1"))
    second = client.post("/api/v1/sync/operations", json=_sync_payload("op-b", published_assignment["id"], "v2"))

    assert first.json()["results"][0]["server_version"] < second.json()["results"][0]["server_version"]


def test_sync_on_closed_assignment_is_rejected_not_silently_dropped(teacher, enrolled_student, published_assignment):
    tclient, _ = teacher
    tclient.patch(f"/api/v1/assignments/{published_assignment['id']}", json={"status": "closed"})

    sclient, _ = enrolled_student
    resp = sclient.post(
        "/api/v1/sync/operations", json=_sync_payload("op-closed-1", published_assignment["id"], "too late")
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["error_code"] == "ASSIGNMENT_CLOSED"


def test_unsupported_operation_type_is_rejected_cleanly(enrolled_student, published_assignment):
    client, _user = enrolled_student
    payload = {
        "operations": [
            {
                "operation_id": "op-unsupported",
                "operation_type": "nonexistent_type",
                "entity_id": published_assignment["id"],
                "payload": {},
            }
        ]
    }
    resp = client.post("/api/v1/sync/operations", json=payload)
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "UNSUPPORTED_OPERATION_TYPE"


def test_operation_status_lookup(enrolled_student, published_assignment):
    client, _user = enrolled_student
    client.post("/api/v1/sync/operations", json=_sync_payload("op-lookup-1", published_assignment["id"], "x"))

    status = client.get("/api/v1/sync/operations/op-lookup-1")
    assert status.status_code == 200
    assert status.json()["status"] == "accepted"

    missing = client.get("/api/v1/sync/operations/does-not-exist")
    assert missing.status_code == 404

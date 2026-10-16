import pytest


@pytest.fixture
def mock_livekit(monkeypatch):
    """LiveKit needs real credentials to reach a real server; these tests only need to
    verify EduVillage's own authorization and lifecycle logic, so the SDK calls are faked."""
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    def fake_generate_access_token(*, identity, name, room_name, can_publish, can_subscribe=True, mic_only=False):
        return f"fake-jwt-for-{identity}-in-{room_name}-publish={can_publish}"

    async def fake_remove_participant(room_name: str, identity: str) -> None:
        return None

    async def fake_set_mic_permission(room_name: str, identity: str, *, granted: bool) -> None:
        return None

    async def fake_notify_room(room_name: str, payload: dict) -> None:
        return None

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "generate_access_token", fake_generate_access_token)
    monkeypatch.setattr(livekit, "remove_participant", fake_remove_participant)
    monkeypatch.setattr(livekit, "set_mic_permission", fake_set_mic_permission)
    monkeypatch.setattr(livekit, "notify_room", fake_notify_room)
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://fake.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "fake-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "fake-secret")


def _create_class(client, course_id):
    resp = client.post(
        f"/api/v1/classes?course_id={course_id}",
        json={"title": "Live session 1", "scheduled_start": "2026-11-01T10:00:00Z"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_starting_class_without_livekit_configured_returns_503(teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])
    resp = client.post(f"/api/v1/classes/{cls['id']}/start")
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "LIVEKIT_NOT_CONFIGURED"


def test_full_class_lifecycle_with_mocked_livekit(mock_livekit, teacher, enrolled_student, published_course):
    tclient, tuser = teacher
    cls = _create_class(tclient, published_course["id"])

    start = tclient.post(f"/api/v1/classes/{cls['id']}/start")
    assert start.status_code == 200
    assert start.json()["status"] == "live"

    # idempotent: starting an already-live class again just returns the current state
    start_again = tclient.post(f"/api/v1/classes/{cls['id']}/start")
    assert start_again.status_code == 200

    sclient, suser = enrolled_student
    join = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert join.status_code == 200
    join_body = join.json()
    assert join_body["can_publish"] is False
    assert suser["id"] in join_body["token"]

    teacher_join = tclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert teacher_join.json()["can_publish"] is True

    participants = tclient.get(f"/api/v1/classes/{cls['id']}/participants")
    assert participants.status_code == 200
    by_id = {p["user_id"]: p for p in participants.json()}
    assert suser["id"] in by_id
    assert tuser["id"] in by_id
    assert by_id[suser["id"]]["full_name"] == suser["full_name"]
    assert by_id[suser["id"]]["email"] == suser["email"]

    end = tclient.post(f"/api/v1/classes/{cls['id']}/end")
    assert end.status_code == 200
    assert end.json()["status"] == "ended"


def test_non_enrolled_student_cannot_join(mock_livekit, teacher, student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, _ = student
    resp = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert resp.status_code == 403


def test_cannot_join_a_class_that_is_not_live(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])  # never started

    sclient, _ = enrolled_student
    resp = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert resp.status_code == 409


def test_only_assigned_teacher_can_start_class(mock_livekit, teacher, published_course, make_user):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])

    other_client, _ = make_user(role="teacher", prefix="other-teacher")
    resp = other_client.post(f"/api/v1/classes/{cls['id']}/start")
    assert resp.status_code == 403


def test_ending_a_non_live_class_is_a_conflict(mock_livekit, teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])  # scheduled, never started
    resp = client.post(f"/api/v1/classes/{cls['id']}/end")
    assert resp.status_code == 409


def test_cancelling_a_scheduled_class_succeeds(teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])
    resp = client.post(f"/api/v1/classes/{cls['id']}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


def test_cancelling_an_already_cancelled_class_is_idempotent(teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])
    client.post(f"/api/v1/classes/{cls['id']}/cancel")
    resp = client.post(f"/api/v1/classes/{cls['id']}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


def test_cancelling_a_live_class_is_a_conflict(mock_livekit, teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])
    client.post(f"/api/v1/classes/{cls['id']}/start")
    resp = client.post(f"/api/v1/classes/{cls['id']}/cancel")
    assert resp.status_code == 409


def test_cancelling_an_ended_class_is_a_conflict(mock_livekit, teacher, published_course):
    client, _user = teacher
    cls = _create_class(client, published_course["id"])
    client.post(f"/api/v1/classes/{cls['id']}/start")
    client.post(f"/api/v1/classes/{cls['id']}/end")
    resp = client.post(f"/api/v1/classes/{cls['id']}/cancel")
    assert resp.status_code == 409


def test_only_assigned_teacher_can_cancel_class(teacher, published_course, make_user):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])

    other_client, _ = make_user(role="teacher", prefix="other-teacher")
    resp = other_client.post(f"/api/v1/classes/{cls['id']}/cancel")
    assert resp.status_code == 403


def test_cannot_join_a_cancelled_class(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/cancel")

    sclient, _ = enrolled_student
    resp = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert resp.status_code == 409


def test_teacher_can_remove_a_student_and_they_cannot_rejoin(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, suser = enrolled_student
    join = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert join.status_code == 200

    remove = tclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/remove")
    assert remove.status_code == 204

    participants = tclient.get(f"/api/v1/classes/{cls['id']}/participants")
    removed = next(p for p in participants.json() if p["user_id"] == suser["id"])
    assert removed["participation_status"] == "removed"

    rejoin = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert rejoin.status_code == 403
    assert rejoin.json()["error"]["code"] == "REMOVED_FROM_CLASS"


def test_only_assigned_teacher_can_remove_a_participant(mock_livekit, teacher, enrolled_student, published_course, make_user):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, suser = enrolled_student
    sclient.post(f"/api/v1/classes/{cls['id']}/join-token")

    other_client, _ = make_user(role="teacher", prefix="other-teacher")
    resp = other_client.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/remove")
    assert resp.status_code == 403


def test_a_student_cannot_remove_another_participant(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, suser = enrolled_student
    sclient.post(f"/api/v1/classes/{cls['id']}/join-token")

    resp = sclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/remove")
    assert resp.status_code == 403


def test_removing_a_participant_who_never_joined_is_not_found(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])  # never started, nobody joined

    _sclient, suser = enrolled_student
    resp = tclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/remove")
    assert resp.status_code == 404


def test_student_can_request_to_speak_and_teacher_can_grant_and_revoke_mic(
    mock_livekit, teacher, enrolled_student, published_course
):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, suser = enrolled_student
    sclient.post(f"/api/v1/classes/{cls['id']}/join-token")

    request = sclient.post(f"/api/v1/classes/{cls['id']}/speak-requests")
    assert request.status_code == 204

    participants = tclient.get(f"/api/v1/classes/{cls['id']}/participants").json()
    by_id = {p["user_id"]: p for p in participants}
    assert by_id[suser["id"]]["speak_requested_at"] is not None
    assert by_id[suser["id"]]["mic_granted"] is False

    grant = tclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/grant-mic")
    assert grant.status_code == 204

    participants = tclient.get(f"/api/v1/classes/{cls['id']}/participants").json()
    by_id = {p["user_id"]: p for p in participants}
    assert by_id[suser["id"]]["mic_granted"] is True
    assert by_id[suser["id"]]["speak_requested_at"] is None  # granting clears the pending request

    # A granted student's next join-token reflects the live permission, mic-only.
    rejoin = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert rejoin.json()["can_publish"] is True

    revoke = tclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/revoke-mic")
    assert revoke.status_code == 204

    participants = tclient.get(f"/api/v1/classes/{cls['id']}/participants").json()
    by_id = {p["user_id"]: p for p in participants}
    assert by_id[suser["id"]]["mic_granted"] is False

    rejoin_again = sclient.post(f"/api/v1/classes/{cls['id']}/join-token")
    assert rejoin_again.json()["can_publish"] is False


def test_only_teacher_can_grant_mic(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])
    tclient.post(f"/api/v1/classes/{cls['id']}/start")

    sclient, suser = enrolled_student
    sclient.post(f"/api/v1/classes/{cls['id']}/join-token")

    resp = sclient.post(f"/api/v1/classes/{cls['id']}/participants/{suser['id']}/grant-mic")
    assert resp.status_code == 403


def test_requesting_to_speak_in_a_non_live_class_is_a_conflict(mock_livekit, teacher, enrolled_student, published_course):
    tclient, _ = teacher
    cls = _create_class(tclient, published_course["id"])  # never started

    sclient, _ = enrolled_student
    resp = sclient.post(f"/api/v1/classes/{cls['id']}/speak-requests")
    assert resp.status_code == 409

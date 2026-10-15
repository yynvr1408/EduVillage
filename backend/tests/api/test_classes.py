import pytest


@pytest.fixture
def mock_livekit(monkeypatch):
    """LiveKit needs real credentials to reach a real server; these tests only need to
    verify EduVillage's own authorization and lifecycle logic, so the SDK calls are faked."""
    from app.integrations import livekit

    async def fake_ensure_room(room_name: str) -> None:
        return None

    def fake_generate_access_token(*, identity, name, room_name, can_publish, can_subscribe=True):
        return f"fake-jwt-for-{identity}-in-{room_name}-publish={can_publish}"

    monkeypatch.setattr(livekit, "ensure_room", fake_ensure_room)
    monkeypatch.setattr(livekit, "generate_access_token", fake_generate_access_token)
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
    participant_ids = {p["user_id"] for p in participants.json()}
    assert suser["id"] in participant_ids
    assert tuser["id"] in participant_ids

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

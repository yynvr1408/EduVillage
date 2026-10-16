"""The real LiveKit token (no network involved): who may publish media and data."""

import jwt
import pytest

from app.integrations import livekit


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(livekit.settings, "livekit_url", "wss://example.livekit.test")
    monkeypatch.setattr(livekit.settings, "livekit_api_key", "test-key")
    monkeypatch.setattr(livekit.settings, "livekit_api_secret", "x" * 40)


def claims(token: str) -> dict:
    return jwt.decode(token, "x" * 40, algorithms=["HS256"], options={"verify_aud": False})["video"]


def test_teacher_token_can_publish_media_and_data(configured):
    video = claims(livekit.generate_access_token(identity="t1", name="T", room_name="r", can_publish=True))
    assert video["canPublish"] is True and video["canPublishData"] is True and video["canSubscribe"] is True


def test_student_token_can_listen_but_not_publish_media_or_data(configured):
    video = claims(livekit.generate_access_token(identity="s1", name="S", room_name="r", can_publish=False))
    assert video.get("canPublish") is False
    assert video.get("canPublishData") is False  # a student cannot send whiteboard messages to the class
    assert video["canSubscribe"] is True and video["room"] == "r"

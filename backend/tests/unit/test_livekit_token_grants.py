import jwt

from app.integrations.livekit import generate_access_token


def _video_claims(**kw) -> dict:
    token = generate_access_token(identity="u1", name="U", room_name="room-1", **kw)
    return jwt.decode(token, options={"verify_signature": False})["video"]


def test_mic_only_token_names_the_source_as_a_string(monkeypatch):
    # LiveKit rejects the whole token ("invalid token", 401) when a source is the numeric enum value.
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_api_key", "APIkeykeykey123", raising=False)
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_api_secret", "s" * 43, raising=False)
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_url", "wss://x.livekit.cloud", raising=False)
    claims = _video_claims(can_publish=True, mic_only=True)
    assert claims["canPublishSources"] == ["microphone"]
    assert claims["canPublishData"] is False


def test_student_and_teacher_tokens_have_no_source_restriction(monkeypatch):
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_api_key", "APIkeykeykey123", raising=False)
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_api_secret", "s" * 43, raising=False)
    monkeypatch.setattr("app.integrations.livekit.settings.livekit_url", "wss://x.livekit.cloud", raising=False)
    assert _video_claims(can_publish=True)["canPublishSources"] == []  # empty = unrestricted
    assert _video_claims(can_publish=False)["canPublish"] is False

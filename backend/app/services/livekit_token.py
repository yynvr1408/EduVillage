import os
from datetime import datetime, timedelta
import jwt

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "wss://eduvillage-live.example.com")


def generate_livekit_token(
    room_name: str,
    participant_identity: str,
    participant_name: str,
    is_publisher: bool = False
) -> str:
    """
    Generate short-lived LiveKit access token with role-based permissions.
    Teachers are granted publish permissions (audio/video).
    Students can subscribe and publish audio if permitted.
    """
    if LIVEKIT_API_KEY and LIVEKIT_API_SECRET:
        try:
            from livekit import api
            token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
                .with_identity(participant_identity) \
                .with_name(participant_name) \
                .with_grants(api.VideoGrants(
                    room_join=True,
                    room=room_name,
                    can_publish=is_publisher,
                    can_subscribe=True,
                    can_publish_data=True
                )) \
                .with_ttl(timedelta(hours=2))
            return token.to_jwt()
        except Exception:
            pass

    # Standard LiveKit compliant JWT token generation
    secret = LIVEKIT_API_SECRET or "dev-secret-eduvillage-livekit-token-2026"
    api_key = LIVEKIT_API_KEY or "devkey"

    now = datetime.utcnow()
    payload = {
        "iss": api_key,
        "sub": participant_identity,
        "name": participant_name,
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(hours=2)).timestamp()),
        "video": {
            "roomJoin": True,
            "room": room_name,
            "canPublish": is_publisher,
            "canSubscribe": True,
            "canPublishData": True
        }
    }
    return jwt.encode(payload, secret, algorithm="HS256")

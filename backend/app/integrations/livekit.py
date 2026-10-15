"""Thin wrapper around the LiveKit server SDK.

Token generation needs only API key/secret (no network call), so it works as soon as
credentials are configured. Room lifecycle calls need LIVEKIT_URL reachable; if LiveKit
isn't configured at all we raise a clear, typed error instead of pretending to succeed.
"""

from app.config import get_settings
from app.core.exceptions import ServiceUnavailableError

settings = get_settings()


def _require_configured() -> None:
    if not settings.livekit_configured:
        raise ServiceUnavailableError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
            code="LIVEKIT_NOT_CONFIGURED",
        )


def generate_access_token(
    *, identity: str, name: str, room_name: str, can_publish: bool, can_subscribe: bool = True
) -> str:
    _require_configured()
    from livekit import api

    grants = api.VideoGrants(room_join=True, room=room_name, can_publish=can_publish, can_subscribe=can_subscribe)
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
    )
    return token.to_jwt()


async def ensure_room(room_name: str) -> None:
    """Creates the LiveKit room if it doesn't already exist. Raises ServiceUnavailableError
    (never silently succeeds) if LiveKit isn't configured or the server is unreachable."""
    _require_configured()
    from livekit import api

    client = api.RoomServiceClient(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.create_room(api.CreateRoomRequest(name=room_name))
    except Exception as exc:  # pragma: no cover - network-dependent
        raise ServiceUnavailableError(f"Could not reach LiveKit: {exc}", code="LIVEKIT_UNREACHABLE") from exc
    finally:
        await client.aclose()

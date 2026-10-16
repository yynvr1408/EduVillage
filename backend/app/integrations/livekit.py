"""Thin wrapper around the LiveKit server SDK.

Token generation needs only API key/secret (no network call), so it works as soon as
credentials are configured. Room and egress (recording) calls need LIVEKIT_URL reachable;
if LiveKit isn't configured at all we raise a clear, typed error instead of pretending to
succeed. Recording additionally needs S3-compatible storage configured, because LiveKit's
egress writes directly to an S3 bucket — it cannot write to our own local-disk API.
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


def _require_recording_configured() -> None:
    _require_configured()
    if settings.storage_backend != "s3" or not settings.object_storage_bucket:
        raise ServiceUnavailableError(
            "Recording needs S3-compatible storage configured (STORAGE_BACKEND=s3 + "
            "OBJECT_STORAGE_* settings) because LiveKit egress uploads directly to a bucket.",
            code="RECORDING_NOT_CONFIGURED",
        )


def generate_access_token(
    *, identity: str, name: str, room_name: str, can_publish: bool, can_subscribe: bool = True, mic_only: bool = False
) -> str:
    """`mic_only` restricts publishing to the microphone track only (and withholds data-channel
    publish, which rides the same grant) — used for a student granted permission to speak, who
    must never gain camera/screen-share or whiteboard-forging access alongside it."""
    _require_configured()
    from livekit import api

    grants = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=can_publish,
        can_subscribe=can_subscribe,
        # Only the presenter may send data messages (the whiteboard rides on them): a student cannot forge it.
        can_publish_data=can_publish and not mic_only,
        can_publish_sources=[api.TrackSource.MICROPHONE] if mic_only else [],
    )
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

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.room.create_room(api.CreateRoomRequest(name=room_name))
    except Exception as exc:  # pragma: no cover - network-dependent
        raise ServiceUnavailableError(f"Could not reach LiveKit: {exc}", code="LIVEKIT_UNREACHABLE") from exc
    finally:
        await client.aclose()


async def remove_participant(room_name: str, identity: str) -> None:
    """Kicks a participant out of a live room immediately. Tolerates the participant already
    being gone (disconnected on their own just before the teacher's click) instead of treating
    that race as a failure."""
    _require_configured()
    from livekit import api

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.room.remove_participant(api.RoomParticipantIdentity(room=room_name, identity=identity))
    except Exception as exc:  # pragma: no cover - network-dependent
        if "not found" in str(exc).lower():
            return
        raise ServiceUnavailableError(f"Could not remove participant: {exc}", code="LIVEKIT_UNREACHABLE") from exc
    finally:
        await client.aclose()


async def set_mic_permission(room_name: str, identity: str, *, granted: bool) -> None:
    """Flips a connected student's publish grant live via LiveKit's UpdateParticipant call, so
    they can unmute the instant the teacher allows it — no reconnect or token refresh needed.
    Restricted to the microphone source only; never grants camera, screen-share or data-channel
    (whiteboard) access. Tolerates the student having already left."""
    _require_configured()
    from livekit import api

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.room.update_participant(
            api.UpdateParticipantRequest(
                room=room_name,
                identity=identity,
                permission=api.ParticipantPermission(
                    can_subscribe=True,
                    can_publish=granted,
                    can_publish_data=False,
                    can_publish_sources=[api.TrackSource.MICROPHONE] if granted else [],
                ),
            )
        )
    except Exception as exc:  # pragma: no cover - network-dependent
        if "not found" in str(exc).lower():
            return
        raise ServiceUnavailableError(f"Could not update microphone permission: {exc}", code="LIVEKIT_UNREACHABLE") from exc
    finally:
        await client.aclose()


async def notify_room(room_name: str, payload: dict) -> None:
    """Pushes a small JSON event over LiveKit's reliable data channel from the server itself —
    the only way to reach the teacher instantly for a 'request to speak', since a student's own
    token never grants data-channel publish (see generate_access_token)."""
    _require_configured()
    import json

    from livekit import api

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.room.send_data(
            api.SendDataRequest(
                room=room_name,
                data=json.dumps(payload).encode("utf-8"),
                kind=api.DataPacket.Kind.RELIABLE,
                topic="speak-request",
            )
        )
    except Exception as exc:  # pragma: no cover - network-dependent
        if "not found" in str(exc).lower():
            return  # room already ended; nobody left to notify
        raise ServiceUnavailableError(f"Could not notify the room: {exc}", code="LIVEKIT_UNREACHABLE") from exc
    finally:
        await client.aclose()


def _s3_upload_target(storage_key: str):
    from livekit import api

    return api.S3Upload(
        access_key=settings.object_storage_access_key,
        secret=settings.object_storage_secret_key,
        bucket=settings.object_storage_bucket,
        region=settings.object_storage_region,
        endpoint=settings.object_storage_endpoint or "",
        force_path_style=settings.object_storage_force_path_style,
    ), storage_key


async def start_recording(room_name: str, storage_key: str) -> str:
    """Starts a room-composite (mixed audio+video) recording, uploaded directly to the
    configured S3 bucket at `storage_key`. Returns the LiveKit egress_id."""
    _require_recording_configured()
    from livekit import api

    s3, filepath = _s3_upload_target(storage_key)
    request = api.RoomCompositeEgressRequest(
        room_name=room_name,
        layout="speaker",
        file_outputs=[api.EncodedFileOutput(file_type=api.EncodedFileType.MP4, filepath=filepath, s3=s3)],
    )

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        info = await client.egress.start_room_composite_egress(request)
        return info.egress_id
    except Exception as exc:  # pragma: no cover - network-dependent
        raise ServiceUnavailableError(f"Could not start recording: {exc}", code="RECORDING_START_FAILED") from exc
    finally:
        await client.aclose()


async def stop_recording(egress_id: str) -> None:
    _require_recording_configured()
    from livekit import api

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await client.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
    except Exception as exc:  # pragma: no cover - network-dependent
        raise ServiceUnavailableError(f"Could not stop recording: {exc}", code="RECORDING_STOP_FAILED") from exc
    finally:
        await client.aclose()


async def get_egress_status(egress_id: str):
    """Returns the EgressInfo for one egress job (status, file results, error) so the
    caller can tell whether the uploaded recording is ready yet."""
    _require_recording_configured()
    from livekit import api

    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        response = await client.egress.list_egress(api.ListEgressRequest(egress_id=egress_id))
        return response.items[0] if response.items else None
    except Exception as exc:  # pragma: no cover - network-dependent
        raise ServiceUnavailableError(f"Could not check recording status: {exc}", code="RECORDING_STATUS_FAILED") from exc
    finally:
        await client.aclose()


def verify_webhook(body: str, authorization: str | None):
    """Validates a LiveKit webhook (JWT signed with our API secret, carrying a SHA-256 of the
    body) and returns the parsed event. Raises ValueError on a missing/invalid signature —
    an unauthenticated caller must never be able to flip a recording's state."""
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise ServiceUnavailableError("LiveKit is not configured.", code="LIVEKIT_NOT_CONFIGURED")
    if not authorization:
        raise ValueError("Missing webhook authorization header.")
    from livekit import api

    receiver = api.WebhookReceiver(api.TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret))
    return receiver.receive(body, authorization)

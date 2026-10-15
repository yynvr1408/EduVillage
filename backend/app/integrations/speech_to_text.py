from pathlib import Path

from app.config import get_settings
from app.core.exceptions import ServiceUnavailableError

settings = get_settings()


def ensure_configured() -> None:
    if not settings.speech_to_text_api_key:
        raise ServiceUnavailableError(
            "No speech-to-text provider is configured (SPEECH_TO_TEXT_API_KEY is unset). "
            "Supply a transcript directly instead, or configure a provider.",
            code="STT_NOT_CONFIGURED",
        )


def transcribe(audio_path: Path) -> str:
    ensure_configured()

    from openai import OpenAI

    client = OpenAI(api_key=settings.speech_to_text_api_key)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(model="whisper-1", file=f)
    return result.text

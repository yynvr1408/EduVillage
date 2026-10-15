"""Complete-recording transcription.

Speech-to-text providers cap uploads (Whisper: 25 MB). Recordings are therefore reduced to speech
audio with FFmpeg and, when still too large, cut into fixed-length chunks. Every chunk is
transcribed; finished chunks are persisted on the transcript (`chunk_state`), so a retry after a
crash or provider error resumes at the first missing chunk instead of starting over. The transcript
is only marked complete — and only then can a summary be generated from it — once EVERY chunk is done.
"""

import logging
import time
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import AppError
from app.db.models.summary import LectureTranscript
from app.integrations import speech_to_text
from app.services import media_processing

logger = logging.getLogger(__name__)
settings = get_settings()

MAX_SPLIT_ATTEMPTS = 3
MIN_CHUNK_SECONDS = 0.5  # providers reject near-empty audio; a sub-second leftover from cutting carries no speech


def _plan_chunks(audio: Path, workdir: Path) -> tuple[list[Path], int]:
    """One file when it fits the provider limit, otherwise time-based chunks that each fit."""
    limit = settings.stt_max_upload_bytes
    if audio.stat().st_size <= limit:
        return [audio], 0
    seconds = settings.stt_chunk_seconds
    for attempt in range(MAX_SPLIT_ATTEMPTS):
        out = workdir / f"chunks_{seconds}"
        chunks = media_processing.split_audio(audio, out, segment_seconds=seconds)
        if all(c.stat().st_size <= limit for c in chunks):
            return chunks, seconds
        seconds = max(30, seconds // 2)  # a dense stretch made a chunk too big: cut shorter
    raise media_processing.MediaError("Audio could not be cut into parts small enough to transcribe.", code="MEDIA_INVALID")


def _transcribe_chunk(path: Path, *, sleep=time.sleep, attempts: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return speech_to_text.transcribe(path)
        except AppError:
            raise  # configuration errors (e.g. STT_NOT_CONFIGURED) are not retried
        except Exception as exc:  # noqa: BLE001 - provider/network errors: back off and retry
            last = exc
            logger.warning("transcription attempt %d/%d failed: %s", attempt + 1, attempts, type(exc).__name__)
            if attempt < attempts - 1:
                sleep(2**attempt)
    reason = str(last)[:300] if last else "unknown error"
    raise AppError(
        f"The speech-to-text service failed for part of the recording: {reason}", code="STT_CHUNK_FAILED", status_code=502
    ) from last


def transcribe_recording(db: Session, transcript: LectureTranscript, source: Path, workdir: Path, *, sleep=time.sleep) -> str:
    """Transcribes the whole of `source`, persisting progress per chunk. Returns the full text."""
    speech_to_text.ensure_configured()  # fail fast, before spending time on ffmpeg
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        audio = media_processing.extract_speech_audio(source, workdir / "speech.mp3")
        chunks, segment_seconds = _plan_chunks(audio, workdir)
    except media_processing.MediaError as exc:
        raise AppError(exc.message, code=exc.code, status_code=422) from exc

    state = dict(transcript.chunk_state or {})
    if state.get("total") != len(chunks) or state.get("segment_seconds") != segment_seconds:
        state = {"total": len(chunks), "segment_seconds": segment_seconds, "done": {}}  # different cutting: old parts don't apply
    done: dict[str, str] = dict(state.get("done", {}))

    for index, chunk in enumerate(chunks):
        if str(index) in done:
            continue  # finished in an earlier attempt
        length = media_processing.probe_duration_seconds(chunk) if len(chunks) > 1 else None
        if length is not None and length < MIN_CHUNK_SECONDS:
            done[str(index)] = ""  # counted as processed (there is nothing in it to transcribe)
        else:
            done[str(index)] = _transcribe_chunk(chunk, sleep=sleep)
        state["done"] = done
        transcript.chunk_state = dict(state)  # reassign so SQLAlchemy sees the JSON change
        db.commit()

    if len(done) != len(chunks):  # defensive: never call an incomplete transcript complete
        raise AppError("Transcription did not finish every part of the recording.", code="STT_CHUNK_FAILED", status_code=502)
    return "\n\n".join(done[str(i)].strip() for i in range(len(chunks)) if done[str(i)].strip())


def chunk_summary(transcript: LectureTranscript) -> tuple[int, int]:
    """(chunks completed, chunks total) for progress/completeness reporting."""
    state = transcript.chunk_state or {}
    return len(state.get("done", {})), int(state.get("total", 0))

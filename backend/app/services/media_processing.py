"""FFmpeg wrappers for turning recordings into speech-to-text-sized audio.

Safety: ffmpeg is always started with an argument LIST (never a shell), with `-nostdin`, a hard
timeout and bounded threads, and only on paths the server created. Failures raise MediaError with a
short, secret-free message (ffmpeg's stderr tail is logged, not returned to clients).
"""

import logging
import re
import shutil
import subprocess
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")


class MediaError(Exception):
    """A media-processing failure (missing ffmpeg, unreadable/corrupt input, timeout)."""

    def __init__(self, message: str, *, code: str = "MEDIA_PROCESSING_FAILED"):
        super().__init__(message)
        self.message = message
        self.code = code


def find_ffmpeg() -> str:
    candidate = settings.ffmpeg_path or "ffmpeg"
    resolved = shutil.which(candidate)
    if not resolved:
        raise MediaError(
            "FFmpeg is not installed on the server (set FFMPEG_PATH or install ffmpeg).", code="FFMPEG_NOT_AVAILABLE"
        )
    return resolved


def _run(args: list[str], *, timeout: int | None = None) -> subprocess.CompletedProcess:
    cmd = [find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "2", *args]
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, no shell, server-created paths only
            cmd, capture_output=True, text=True, timeout=timeout or settings.ffmpeg_timeout_seconds, shell=False
        )
    except subprocess.TimeoutExpired as exc:
        raise MediaError("Media processing timed out.", code="MEDIA_TIMEOUT") from exc
    if result.returncode != 0:
        logger.warning("ffmpeg failed rc=%s stderr=%s", result.returncode, (result.stderr or "")[-400:])
        raise MediaError("The media file could not be processed (it may be corrupt or unsupported).", code="MEDIA_INVALID")
    return result


def probe_duration_seconds(path: Path) -> float | None:
    """Duration from ffmpeg's banner (no ffprobe dependency). None if the container doesn't say."""
    proc = subprocess.run(  # noqa: S603
        [find_ffmpeg(), "-nostdin", "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=120, shell=False
    )
    match = _DURATION_RE.search(proc.stderr or "")
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def extract_speech_audio(src: Path, dst: Path) -> Path:
    """Video or audio -> mono 16 kHz 32 kbps MP3: tiny, and what speech-to-text actually needs."""
    _run(["-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", str(dst)])
    if not dst.exists() or dst.stat().st_size == 0:
        raise MediaError("The recording contains no audio track.", code="NO_AUDIO")
    return dst


def split_audio(src: Path, out_dir: Path, *, segment_seconds: int) -> list[Path]:
    """Cuts audio into consecutive fixed-length segments (stream copy: fast and lossless)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = out_dir / "chunk_%04d.mp3"
    _run(["-y", "-i", str(src), "-f", "segment", "-segment_time", str(segment_seconds), "-c", "copy", "-reset_timestamps", "1", str(pattern)])
    chunks = sorted(out_dir.glob("chunk_*.mp3"))
    if not chunks:
        raise MediaError("Audio could not be split into parts.", code="MEDIA_INVALID")
    return chunks

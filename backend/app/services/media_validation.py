"""Content-based file validation. Never trusts the filename extension or the client's MIME type:
the first bytes of the stored object decide what a file really is."""

import os
import re
from dataclasses import dataclass

from app.core.exceptions import ValidationFailedError

# resource_type values (also the DB enum names)
RESOURCE_TYPES = ("video", "audio", "document", "presentation", "notes", "other")

# category the *bytes* belong to -> resource types that may legitimately hold it
_ALLOWED_TYPES_FOR_CATEGORY = {
    "video": {"video"},
    "audio": {"audio"},
    "pdf": {"document", "notes", "presentation", "other"},
    "office_doc": {"document", "notes", "other"},
    "office_slides": {"presentation", "document", "other"},
    "office_zip": {"document", "notes", "presentation", "other"},
    "text": {"notes", "document", "other"},
    "image": {"other", "document"},
}

# extension -> category it must sniff as (extensions not listed here are refused)
_EXTENSION_CATEGORY = {
    ".mp4": "video", ".m4v": "video", ".mov": "video", ".webm": "video", ".mkv": "video",
    ".mp3": "audio", ".m4a": "audio", ".ogg": "audio", ".opus": "audio", ".wav": "audio", ".aac": "audio",
    ".pdf": "pdf",
    ".doc": "office_doc", ".docx": "office_zip", ".odt": "office_zip",
    ".ppt": "office_slides", ".pptx": "office_zip", ".odp": "office_zip",
    ".txt": "text", ".md": "text",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
}

_SAFE_CHARS = re.compile(r"[^A-Za-z0-9._ \-()]+")


@dataclass(frozen=True)
class SniffResult:
    category: str  # a key of _ALLOWED_TYPES_FOR_CATEGORY, or "unknown"
    mime_type: str


def sanitize_filename(filename: str) -> str:
    """Strips directories, control characters and anything outside a conservative character set."""
    name = os.path.basename(filename.replace("\\", "/")).strip().strip(".")
    name = _SAFE_CHARS.sub("_", name)
    name = re.sub(r"\s+", " ", name)
    if not name or name in {".", ".."}:
        raise ValidationFailedError("Invalid filename.", code="INVALID_FILENAME")
    root, ext = os.path.splitext(name)
    return (root[:120] or "file") + ext.lower()[:10]


def extension_of(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def check_extension_allowed(filename: str) -> str:
    ext = extension_of(filename)
    if ext not in _EXTENSION_CATEGORY:
        raise ValidationFailedError(f"Files of type '{ext or 'unknown'}' are not supported.", code="UNSUPPORTED_FILE_TYPE")
    return _EXTENSION_CATEGORY[ext]


def sniff(head: bytes) -> SniffResult:
    """Classifies a file from its leading bytes (pass at least 4 KB when available)."""
    if head.startswith(b"%PDF-"):
        return SniffResult("pdf", "application/pdf")
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return SniffResult("image", "image/png")
    if head.startswith(b"\xff\xd8\xff"):
        return SniffResult("image", "image/jpeg")
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return SniffResult("image", "image/gif")
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"M4A ", b"M4B ", b"M4P "):
            return SniffResult("audio", "audio/mp4")
        return SniffResult("video", "video/mp4")
    if head.startswith(b"\x1a\x45\xdf\xa3"):  # EBML: WebM / Matroska (video; audio-only webm is rare)
        return SniffResult("video", "video/webm")
    if head.startswith(b"OggS"):
        return SniffResult("audio", "audio/ogg")
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xf1", b"\xff\xf9"):
        return SniffResult("audio", "audio/mpeg")
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return SniffResult("audio", "audio/wav")
    if head.startswith(b"PK\x03\x04"):
        return SniffResult("office_zip", "application/zip")
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):  # OLE2: legacy .doc / .ppt
        return SniffResult("office_doc", "application/x-ole-storage")
    if head and b"\x00" not in head[:4096]:
        try:
            head.decode("utf-8")
            return SniffResult("text", "text/plain")
        except UnicodeDecodeError as exc:
            # A multi-byte character cut at the buffer boundary is fine; anything earlier is binary.
            if exc.start >= len(head) - 3:
                return SniffResult("text", "text/plain")
    return SniffResult("unknown", "application/octet-stream")


def default_resource_type(category: str) -> str:
    return {"video": "video", "audio": "audio", "pdf": "document", "office_doc": "document", "office_slides": "presentation",
            "office_zip": "document", "text": "notes", "image": "other"}.get(category, "other")


def validate_content(filename: str, declared_type: str | None, head: bytes) -> tuple[str, SniffResult]:
    """Returns (final resource_type, sniff result) or raises. The bytes must agree with the
    extension and with the declared resource type."""
    if not head:
        raise ValidationFailedError("The uploaded file is empty.", code="EMPTY_FILE")
    expected = check_extension_allowed(filename)
    found = sniff(head)
    ext_ok = found.category == expected or (
        expected in ("office_doc", "office_slides") and found.category == "office_doc"
    ) or (expected == "office_zip" and found.category == "office_zip") or (
        expected == "text" and found.category == "text"
    ) or (expected == "audio" and found.category in ("audio", "video"))  # .m4a/.webm/.ogg containers overlap
    if not ext_ok:
        raise ValidationFailedError(
            "The file's contents do not match its extension; it was rejected.", code="CONTENT_MISMATCH"
        )
    resource_type = declared_type or default_resource_type(found.category)
    if resource_type not in RESOURCE_TYPES:
        raise ValidationFailedError(f"Unknown resource type '{resource_type}'.", code="INVALID_RESOURCE_TYPE")
    if resource_type not in _ALLOWED_TYPES_FOR_CATEGORY.get(found.category, set()) and not (
        found.category == "video" and resource_type == "audio" and extension_of(filename) in (".webm", ".mkv")
    ):
        raise ValidationFailedError(
            f"This file looks like a {found.category}, which can't be stored as '{resource_type}'.", code="RESOURCE_TYPE_MISMATCH"
        )
    return resource_type, found

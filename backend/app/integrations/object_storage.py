"""Object storage behind one interface so the resource service doesn't care whether
files live on local disk (zero-setup hackathon default) or in an S3-compatible bucket."""

import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from app.config import get_settings

settings = get_settings()

MEDIA_ROOT = Path(__file__).resolve().parents[2] / "media"


def make_storage_key(course_id: str, filename: str) -> str:
    safe_name = os.path.basename(filename).replace("/", "_").replace("\\", "_")
    return f"{course_id}/{uuid.uuid4()}-{safe_name}"


class ObjectStorage(ABC):
    @abstractmethod
    def upload_target(self, storage_key: str, content_type: str) -> dict:
        """Returns what the client needs to upload the file (method, url, fields)."""

    @abstractmethod
    def verify_uploaded(self, storage_key: str) -> int | None:
        """Returns the file size in bytes if the upload completed, else None."""

    @abstractmethod
    def download_target(self, storage_key: str, ttl_seconds: int = 900) -> dict:
        """Returns how the client should fetch the file (either a short-lived signed URL or
        a 'stream' marker meaning the API will stream it from local disk)."""

    @abstractmethod
    def fetch_to_path(self, storage_key: str, dest: Path) -> Path:
        """Materializes the object on local disk (used to feed it to speech-to-text)."""

    @abstractmethod
    def delete(self, storage_key: str) -> None: ...

    @abstractmethod
    def read_head(self, storage_key: str, nbytes: int = 8192) -> bytes:
        """The first bytes of an object (for content sniffing) without reading all of it."""

    @abstractmethod
    def checksum_sha256(self, storage_key: str) -> str | None:
        """Hex SHA-256 of the stored bytes, or None if it can't be computed cheaply."""


class LocalObjectStorage(ObjectStorage):
    def _path(self, storage_key: str) -> Path:
        return MEDIA_ROOT / storage_key

    def upload_target(self, storage_key: str, content_type: str) -> dict:
        return {"method": "PUT", "url": f"/api/v1/resources/upload-content/{storage_key}", "fields": {}}

    def verify_uploaded(self, storage_key: str) -> int | None:
        path = self._path(storage_key)
        if not path.exists():
            return None
        return path.stat().st_size

    def download_target(self, storage_key: str, ttl_seconds: int = 900) -> dict:
        return {"method": "GET", "url": f"/api/v1/resources/download-content/{storage_key}", "stream": True}

    def fetch_to_path(self, storage_key: str, dest: Path) -> Path:
        return self._path(storage_key)

    def delete(self, storage_key: str) -> None:
        path = self._path(storage_key)
        if path.exists():
            path.unlink()

    def read_head(self, storage_key: str, nbytes: int = 8192) -> bytes:
        with open(self._path(storage_key), "rb") as f:
            return f.read(nbytes)

    def checksum_sha256(self, storage_key: str) -> str | None:
        import hashlib

        digest = hashlib.sha256()
        with open(self._path(storage_key), "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    async def write_stream(self, storage_key: str, chunks, max_bytes: int) -> int:
        """Streams an upload to disk chunk by chunk (never holding the file in memory) and
        enforces the size cap while writing. Returns the number of bytes written."""
        path = self._path(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        written = 0
        try:
            with open(tmp, "wb") as f:
                async for chunk in chunks:
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError("too_large")
                    f.write(chunk)
            if written == 0:
                raise ValueError("empty")
            tmp.replace(path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return written

    def write(self, storage_key: str, content: bytes) -> None:
        path = self._path(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def read_path(self, storage_key: str) -> Path:
        return self._path(storage_key)


class S3ObjectStorage(ObjectStorage):
    def __init__(self):
        import boto3

        self.bucket = settings.object_storage_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.object_storage_endpoint or None,
            aws_access_key_id=settings.object_storage_access_key,
            aws_secret_access_key=settings.object_storage_secret_key,
            region_name=settings.object_storage_region,
        )

    def upload_target(self, storage_key: str, content_type: str) -> dict:
        presigned = self.client.generate_presigned_post(
            Bucket=self.bucket,
            Key=storage_key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}],
            ExpiresIn=900,
        )
        return {"method": "POST", "url": presigned["url"], "fields": presigned["fields"]}

    def verify_uploaded(self, storage_key: str) -> int | None:
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=storage_key)
            return head["ContentLength"]
        except Exception:
            return None

    def download_target(self, storage_key: str, ttl_seconds: int = 900) -> dict:
        url = self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": storage_key}, ExpiresIn=ttl_seconds
        )
        return {"method": "GET", "url": url, "stream": False}

    def fetch_to_path(self, storage_key: str, dest: Path) -> Path:
        self.client.download_file(self.bucket, storage_key, str(dest))
        return dest

    def delete(self, storage_key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=storage_key)

    def read_head(self, storage_key: str, nbytes: int = 8192) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=storage_key, Range=f"bytes=0-{nbytes - 1}")
        return response["Body"].read()

    def checksum_sha256(self, storage_key: str) -> str | None:
        return None  # hashing a large remote object would mean downloading it; the S3 ETag is not a SHA-256


def get_storage() -> ObjectStorage:
    if settings.storage_backend == "s3":
        return S3ObjectStorage()
    return LocalObjectStorage()

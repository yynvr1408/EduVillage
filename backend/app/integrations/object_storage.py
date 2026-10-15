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
    def download_target(self, storage_key: str) -> dict:
        """Returns how the client should fetch the file (either a direct URL or a
        'stream' marker meaning the API will stream it from local disk)."""

    @abstractmethod
    def delete(self, storage_key: str) -> None: ...


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

    def download_target(self, storage_key: str) -> dict:
        return {"method": "GET", "url": f"/api/v1/resources/download-content/{storage_key}", "stream": True}

    def delete(self, storage_key: str) -> None:
        path = self._path(storage_key)
        if path.exists():
            path.unlink()

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

    def download_target(self, storage_key: str) -> dict:
        url = self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": storage_key}, ExpiresIn=900
        )
        return {"method": "GET", "url": url, "stream": False}

    def delete(self, storage_key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=storage_key)


def get_storage() -> ObjectStorage:
    if settings.storage_backend == "s3":
        return S3ObjectStorage()
    return LocalObjectStorage()

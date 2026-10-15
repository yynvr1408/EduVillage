from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import ResourceStatus, UserRole
from app.db.models.lesson import LearningResource
from app.db.models.user import User
from app.integrations.object_storage import LocalObjectStorage, get_storage
from app.schemas.resource import ResourceOut, UploadInitRequest, UploadInitResponse
from app.schemas.classroom import ShareRequest
from app.services import course_service, resource_service, section_service

router = APIRouter(tags=["resources"])


@router.get("/courses/{course_id}/resources", response_model=list[ResourceOut])
def list_course_resources(
    course_id: str, limit: int = 50, offset: int = 0, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_enrolled(db, user, course)
    resources = resource_service.list_resources(db, course_id, limit=limit, offset=offset)
    return [ResourceOut.model_validate(r) for r in resources]


@router.post("/resources/upload-init", response_model=UploadInitResponse)
def upload_init(payload: UploadInitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    resource, upload_target = resource_service.init_upload(
        db,
        user,
        course_id=payload.course_id,
        lesson_id=payload.lesson_id,
        filename=payload.filename,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
    )
    return UploadInitResponse(resource_id=resource.id, upload=upload_target)


@router.put("/resources/upload-content/{storage_key:path}", status_code=204)
async def upload_content(storage_key: str, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Local-storage upload target: PUT the raw file bytes here. Not used with the S3 backend,
    which uploads directly to the presigned URL returned by upload-init."""
    resource = db.execute(
        select(LearningResource).where(LearningResource.storage_key == storage_key)
    ).scalar_one_or_none()
    if not resource:
        raise NotFoundError("Resource not found.")
    resource_service.get_resource_or_404(db, resource.id)
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, user, course)

    storage = get_storage()
    if not isinstance(storage, LocalObjectStorage):
        raise NotFoundError("This endpoint only applies to local storage.")

    if resource.status != ResourceStatus.pending:
        raise ConflictError("This upload has already been completed.", code="UPLOAD_ALREADY_COMPLETE")
    body = await request.body()
    if len(body) == 0 or len(body) > resource_service.MAX_UPLOAD_BYTES:
        raise ValidationFailedError(f"File size must be between 1 byte and {resource_service.MAX_UPLOAD_BYTES} bytes.")
    storage.write(storage_key, body)
    return None


@router.post("/resources/{resource_id}/complete", response_model=ResourceOut)
def complete(resource_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource = resource_service.complete_upload(db, user, resource)
    return ResourceOut.model_validate(resource)


@router.get("/resources/{resource_id}", response_model=ResourceOut)
def get_resource(resource_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource_service.assert_can_access_resource(db, user, resource)
    return ResourceOut.model_validate(resource)


@router.get("/resources/{resource_id}/download")
def download(resource_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource_service.assert_can_access_resource(db, user, resource)
    target = resource_service.download_info(resource)
    if target.get("stream"):
        return RedirectResponse(url=target["url"])
    return RedirectResponse(url=target["url"])


@router.get("/resources/download-content/{storage_key:path}")
def download_content(storage_key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = db.execute(
        select(LearningResource).where(LearningResource.storage_key == storage_key)
    ).scalar_one_or_none()
    if not resource:
        raise NotFoundError("Resource not found.")
    resource_service.assert_can_access_resource(db, user, resource)

    storage = get_storage()
    if not isinstance(storage, LocalObjectStorage):
        raise NotFoundError("This endpoint only applies to local storage.")
    path = storage.read_path(storage_key)
    if not path.exists():
        raise NotFoundError("File not found in storage.")
    return FileResponse(path, media_type=resource.mime_type, filename=resource.filename)


@router.post("/resources/{resource_id}/sections", response_model=ResourceOut, status_code=201)
def share_resource(resource_id: str, payload: ShareRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource_service.share_with_section(db, user, resource, section_id=payload.section_id)
    return ResourceOut.model_validate(resource)


@router.delete("/resources/{resource_id}/sections/{section_id}", status_code=204)
def unshare_resource(resource_id: str, section_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource_service.unshare_from_section(db, user, resource, section_id=section_id)
    return None


@router.get("/sections/{section_id}/resources", response_model=list[ResourceOut])
def list_section_resources(section_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    section = section_service.get_section_or_404(db, section_id)
    return [ResourceOut.model_validate(r) for r in resource_service.list_section_resources(db, user, section)]


@router.delete("/resources/{resource_id}", status_code=204)
def delete(resource_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    resource = resource_service.get_resource_or_404(db, resource_id)
    resource_service.delete_resource(db, user, resource)
    return None

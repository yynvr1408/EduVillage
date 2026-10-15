import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.db.models.enums import ProcessingStatus, ResourceStatus, ResourceType
from app.db.models.lesson import LearningResource, ResourceSection
from app.db.models.section import Section
from app.db.models.user import User
from app.integrations.object_storage import get_storage, make_storage_key
from app.services import audit_service, course_service, media_validation, section_service

logger = logging.getLogger(__name__)

settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_upload_mb * 1024 * 1024
ALLOWED_MIME_PREFIXES = ("application/pdf", "text/", "image/", "audio/", "video/", "application/msword", "application/vnd.", "application/zip")


def _validate_declared_upload(filename: str, mime_type: str, size_bytes: int) -> str:
    """Early, cheap checks from the client's claims. The bytes are re-checked on complete."""
    if size_bytes <= 0 or size_bytes > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(f"File size must be between 1 byte and {MAX_UPLOAD_BYTES} bytes.", code="FILE_TOO_LARGE")
    if not any(mime_type.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES):
        raise ValidationFailedError(f"File type '{mime_type}' is not permitted.", code="UNSUPPORTED_FILE_TYPE")
    clean = media_validation.sanitize_filename(filename)
    media_validation.check_extension_allowed(clean)
    return clean


def init_upload(
    db: Session,
    teacher: User,
    *,
    course_id: str,
    lesson_id: str | None,
    filename: str,
    mime_type: str,
    size_bytes: int,
    title: str | None = None,
    description: str | None = None,
    resource_type: str | None = None,
) -> tuple[LearningResource, dict]:
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, teacher, course)
    clean_name = _validate_declared_upload(filename, mime_type, size_bytes)
    if resource_type is not None and resource_type not in media_validation.RESOURCE_TYPES:
        raise ValidationFailedError(f"Unknown resource type '{resource_type}'.", code="INVALID_RESOURCE_TYPE")

    storage_key = make_storage_key(course_id, clean_name)
    resource = LearningResource(
        course_id=course_id,
        lesson_id=lesson_id,
        uploaded_by=teacher.id,
        storage_key=storage_key,
        filename=clean_name,
        mime_type=mime_type,
        size_bytes=0,
        status=ResourceStatus.pending,
        title=(title or "").strip()[:255] or os.path.splitext(clean_name)[0],
        description=(description or "").strip() or None,
        resource_type=ResourceType(resource_type) if resource_type else None,
        processing_status=ProcessingStatus.pending,
        is_published=False,
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)

    upload_target = get_storage().upload_target(storage_key, mime_type)
    return resource, upload_target


def get_resource_or_404(db: Session, resource_id: str) -> LearningResource:
    resource = db.get(LearningResource, resource_id)
    if not resource or resource.status == ResourceStatus.deleted:
        raise NotFoundError("Resource not found.")
    return resource


def is_student_visible(resource: LearningResource) -> bool:
    return (
        resource.status == ResourceStatus.available
        and resource.is_published
        and resource.processing_status == ProcessingStatus.ready
    )


def assert_can_access_resource(db: Session, user: User, resource: LearningResource) -> None:
    # Downloading actual course material requires enrollment (or membership of a section the
    # resource was shared with), not just published-course preview access. Students only ever see
    # resources a teacher has published after processing finished.
    course = course_service.get_course_or_404(db, resource.course_id)
    if course_service.is_teaching(db, user, course):
        return
    if not is_student_visible(resource):
        raise NotFoundError("Resource not found.")
    shared = set(db.execute(select(ResourceSection.section_id).where(ResourceSection.resource_id == resource.id)).scalars())
    if shared and section_service.is_member_of_any(db, user.id, shared):
        return
    course_service.assert_enrolled(db, user, course)


def share_with_section(db: Session, teacher: User, resource: LearningResource, *, section_id: str) -> ResourceSection:
    """Reuse without copying the file. The teacher must teach both the resource's course and the
    target section's course."""
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)
    section = db.get(Section, section_id)
    if not section:
        raise NotFoundError("Section not found.")
    section_service.assert_teaches_section(db, teacher, section)
    existing = db.get(ResourceSection, (resource.id, section.id))
    if existing:
        return existing
    link = ResourceSection(resource_id=resource.id, section_id=section.id, shared_by=teacher.id)
    db.add(link)
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="resource_shared", resource_type="resource", resource_id=resource.id)
    return link


def unshare_from_section(db: Session, teacher: User, resource: LearningResource, *, section_id: str) -> None:
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)
    link = db.get(ResourceSection, (resource.id, section_id))
    if not link:
        raise NotFoundError("This resource is not shared with that section.")
    db.delete(link)
    db.commit()


def list_section_resources(db: Session, user: User, section: Section) -> list[LearningResource]:
    """Resources shared into a section, visible to its members and to the section's teachers."""
    course = course_service.get_course_or_404(db, section.course_id)
    if not course_service.is_teaching(db, user, course) and not section_service.is_member_of_any(db, user.id, {section.id}):
        raise NotFoundError("Section not found.")
    stmt = (
        select(LearningResource)
        .join(ResourceSection, ResourceSection.resource_id == LearningResource.id)
        .where(ResourceSection.section_id == section.id, LearningResource.status == ResourceStatus.available)
    )
    items = list(db.execute(stmt).scalars())
    if course_service.is_teaching(db, user, course):
        return items
    return [r for r in items if is_student_visible(r)]


def complete_upload(db: Session, teacher: User, resource: LearningResource) -> LearningResource:
    """Confirms the bytes are in storage and are what they claim to be. Only after the server has
    measured the size, sniffed the content and persisted the metadata does the resource become
    `available`; anything suspicious is removed from storage and rejected."""
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)
    if resource.status == ResourceStatus.available:
        return resource  # idempotent

    storage = get_storage()
    actual_size = storage.verify_uploaded(resource.storage_key)
    if actual_size is None:
        raise ConflictError("The file was not found in storage. Upload it before completing.", code="UPLOAD_INCOMPLETE")
    if actual_size <= 0 or actual_size > MAX_UPLOAD_BYTES:
        _discard(db, resource, storage, "The uploaded file is empty or too large.")
        raise ValidationFailedError(f"File size must be between 1 byte and {MAX_UPLOAD_BYTES} bytes.", code="FILE_TOO_LARGE")

    declared_type = resource.resource_type.value if resource.resource_type else None
    resource.processing_status = ProcessingStatus.processing
    try:
        resource_type, sniffed = media_validation.validate_content(
            resource.filename, declared_type, storage.read_head(resource.storage_key)
        )
    except ValidationFailedError as exc:
        _discard(db, resource, storage, exc.message)
        raise

    resource.size_bytes = actual_size  # authoritative size, not the client's declared value
    resource.resource_type = ResourceType(resource_type)
    resource.detected_mime_type = sniffed.mime_type
    resource.checksum_sha256 = storage.checksum_sha256(resource.storage_key)
    resource.status = ResourceStatus.available
    resource.processing_status = ProcessingStatus.ready
    resource.processing_error = None
    db.commit()
    db.refresh(resource)
    audit_service.record(db, actor_id=teacher.id, action="resource_uploaded", resource_type="resource", resource_id=resource.id)
    return resource


def _discard(db: Session, resource: LearningResource, storage, reason: str) -> None:
    """A rejected upload is removed from storage; the row is kept (deleted) for the audit trail."""
    try:
        storage.delete(resource.storage_key)
    except Exception:  # noqa: BLE001 - the rejection matters more than a cleanup failure
        logger.warning("could not delete rejected upload %s", resource.id)
    resource.status = ResourceStatus.deleted
    resource.processing_status = ProcessingStatus.failed
    resource.processing_error = reason[:500]
    resource.is_published = False
    db.commit()
    logger.warning("upload rejected resource=%s reason=%s", resource.id, reason)


def update_resource(db: Session, teacher: User, resource: LearningResource, *, title=None, description=None, is_published=None) -> LearningResource:
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)
    if resource.status == ResourceStatus.deleted:
        raise NotFoundError("Resource not found.")
    if is_published and not (resource.status == ResourceStatus.available and resource.processing_status == ProcessingStatus.ready):
        raise ConflictError("Only a resource that finished uploading and processing can be published.", code="RESOURCE_NOT_READY")
    if title is not None:
        resource.title = title.strip()[:255] or resource.title
    if description is not None:
        resource.description = description.strip() or None
    if is_published is not None and is_published != resource.is_published:
        resource.is_published = is_published
        audit_service.record(
            db, actor_id=teacher.id, action="resource_published" if is_published else "resource_unpublished",
            resource_type="resource", resource_id=resource.id,
        )
    resource.version += 1  # clients compare this to decide whether a local copy is stale
    db.commit()
    db.refresh(resource)
    return resource


def download_info(resource: LearningResource) -> dict:
    return get_storage().download_target(resource.storage_key)


def delete_resource(db: Session, teacher: User, resource: LearningResource) -> None:
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)
    get_storage().delete(resource.storage_key)
    resource.status = ResourceStatus.deleted
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="resource_deleted", resource_type="resource", resource_id=resource.id)


def list_resources(db: Session, user: User, course_id: str, *, limit: int = 50, offset: int = 0) -> list[LearningResource]:
    """Teachers on the course see everything except removed files (including pending/failed, so they can
    see processing state). Enrolled students see only published, fully processed resources."""
    from app.utils.pagination import paginate

    course = course_service.get_course_or_404(db, course_id)
    stmt = select(LearningResource).where(LearningResource.course_id == course_id)
    if course_service.is_teaching(db, user, course):
        stmt = stmt.where(LearningResource.status != ResourceStatus.deleted)
    else:
        course_service.assert_enrolled(db, user, course)
        stmt = stmt.where(
            LearningResource.status == ResourceStatus.available,
            LearningResource.is_published.is_(True),
            LearningResource.processing_status == ProcessingStatus.ready,
        )
    return paginate(db, stmt.order_by(LearningResource.created_at.desc()), limit=limit, offset=offset)

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.models.enums import ResourceStatus
from app.db.models.lesson import LearningResource, ResourceSection
from app.db.models.section import Section
from app.db.models.user import User
from app.integrations.object_storage import get_storage, make_storage_key
from app.services import audit_service, course_service, section_service

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB — raise once large video/audio needs are confirmed
ALLOWED_MIME_PREFIXES = ("application/pdf", "text/", "image/", "audio/", "video/", "application/msword", "application/vnd.")


def _validate_declared_upload(filename: str, mime_type: str, size_bytes: int) -> None:
    if size_bytes <= 0 or size_bytes > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(f"File size must be between 1 byte and {MAX_UPLOAD_BYTES} bytes.")
    if not any(mime_type.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES):
        raise ValidationFailedError(f"File type '{mime_type}' is not permitted.")
    if not filename or len(filename) > 255:
        raise ValidationFailedError("Invalid filename.")


def init_upload(db: Session, teacher: User, *, course_id: str, lesson_id: str | None, filename: str, mime_type: str, size_bytes: int) -> tuple[LearningResource, dict]:
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, teacher, course)
    _validate_declared_upload(filename, mime_type, size_bytes)

    storage_key = make_storage_key(course_id, filename)
    resource = LearningResource(
        course_id=course_id,
        lesson_id=lesson_id,
        uploaded_by=teacher.id,
        storage_key=storage_key,
        filename=filename,
        mime_type=mime_type,
        size_bytes=0,
        status=ResourceStatus.pending,
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


def assert_can_access_resource(db: Session, user: User, resource: LearningResource) -> None:
    # Downloading actual course material requires enrollment (or membership of a section the
    # resource was shared with), not just published-course preview access.
    course = course_service.get_course_or_404(db, resource.course_id)
    if course_service.is_teaching(db, user, course):
        return
    if resource.status != ResourceStatus.available:
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
    return list(db.execute(stmt).scalars())


def complete_upload(db: Session, teacher: User, resource: LearningResource) -> LearningResource:
    course = course_service.get_course_or_404(db, resource.course_id)
    course_service.assert_owns_course(db, teacher, course)

    actual_size = get_storage().verify_uploaded(resource.storage_key)
    if actual_size is None:
        raise ConflictError("The file was not found in storage. Upload it before completing.", code="UPLOAD_INCOMPLETE")

    resource.size_bytes = actual_size  # authoritative size, not the client's declared value
    resource.status = ResourceStatus.available
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


def list_resources(db: Session, course_id: str, *, limit: int = 50, offset: int = 0) -> list[LearningResource]:
    from app.utils.pagination import paginate

    stmt = select(LearningResource).where(
        LearningResource.course_id == course_id, LearningResource.status == ResourceStatus.available
    )
    return paginate(db, stmt, limit=limit, offset=offset)

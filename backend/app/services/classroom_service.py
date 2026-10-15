from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class, ClassParticipant
from app.db.models.enums import ClassStatus, ParticipationStatus, UserRole
from app.db.models.user import User
from app.integrations import livekit
from app.services import audit_service, course_service


def _room_name_for(class_id: str) -> str:
    return f"eduvillage-class-{class_id}"


def get_class_or_404(db: Session, class_id: str) -> Class:
    cls = db.get(Class, class_id)
    if not cls:
        raise NotFoundError("Class not found.")
    return cls


def assert_can_view_class(db: Session, user: User, cls: Class) -> None:
    course = course_service.get_course_or_404(db, cls.course_id)
    course_service.assert_can_view_course(db, user, course)


def assert_enrolled_in_class(db: Session, user: User, cls: Class) -> None:
    """Stricter than assert_can_view_class: for actions tied to actual class participation
    (joining live media, requesting/viewing a lecture summary), not just published-course preview."""
    course = course_service.get_course_or_404(db, cls.course_id)
    course_service.assert_enrolled(db, user, course)


def assert_teaches_class(db: Session, user: User, cls: Class) -> None:
    """True for the class's originally assigned teacher, and for any co-teacher on the
    course — so a backup/shared teacher can run a session if the primary is unavailable."""
    if user.role != UserRole.teacher:
        raise ForbiddenError("Only a teacher can manage this class.")
    if cls.teacher_id == user.id:
        return
    course = course_service.get_course_or_404(db, cls.course_id)
    if course_service.is_teaching(db, user, course):
        return
    raise ForbiddenError("Only the assigned teacher or a co-teacher on this course can manage this class.")


MAX_COURSES_FOR_CLASS_LOOKUP = 200  # enough to cover any real teacher/student's course load


def list_classes_for_user(db: Session, user: User, *, limit: int = 50, offset: int = 0) -> list[Class]:
    from app.utils.pagination import paginate

    courses = course_service.list_courses_for_user(db, user, limit=MAX_COURSES_FOR_CLASS_LOOKUP)
    course_ids = [c.id for c in courses]
    if not course_ids:
        return []
    stmt = select(Class).where(Class.course_id.in_(course_ids)).order_by(Class.scheduled_start)
    return paginate(db, stmt, limit=limit, offset=offset)


def create_class(db: Session, teacher: User, course_id: str, *, title: str, scheduled_start, scheduled_end) -> Class:
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, teacher, course)
    cls = Class(
        course_id=course_id,
        teacher_id=teacher.id,
        title=title,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        status=ClassStatus.scheduled,
    )
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return cls


def update_class(db: Session, cls: Class, **fields) -> Class:
    for key, value in fields.items():
        if value is not None:
            setattr(cls, key, value)
    db.commit()
    db.refresh(cls)
    return cls


async def start_class(db: Session, teacher: User, cls: Class) -> Class:
    assert_teaches_class(db, teacher, cls)
    if cls.status == ClassStatus.live:
        return cls  # idempotent: already live
    if cls.status not in (ClassStatus.scheduled,):
        raise ConflictError(f"Cannot start a class in status '{cls.status.value}'.")

    room_name = _room_name_for(cls.id)
    await livekit.ensure_room(room_name)

    cls.status = ClassStatus.live
    cls.livekit_room_name = room_name
    db.commit()
    db.refresh(cls)
    audit_service.record(db, actor_id=teacher.id, action="class_started", resource_type="class", resource_id=cls.id)
    return cls


def end_class(db: Session, teacher: User, cls: Class) -> Class:
    assert_teaches_class(db, teacher, cls)
    if cls.status == ClassStatus.ended:
        return cls  # idempotent
    if cls.status != ClassStatus.live:
        raise ConflictError(f"Cannot end a class in status '{cls.status.value}'.")

    cls.status = ClassStatus.ended
    db.commit()
    db.refresh(cls)
    audit_service.record(db, actor_id=teacher.id, action="class_ended", resource_type="class", resource_id=cls.id)
    return cls


def issue_join_token(db: Session, user: User, cls: Class) -> dict:
    from app.config import get_settings

    settings = get_settings()

    course = course_service.get_course_or_404(db, cls.course_id)
    is_teacher = course_service.is_teaching(db, user, course)
    if not is_teacher:
        if user.role != UserRole.student:
            raise ForbiddenError("Only a teacher on this course or an enrolled student may join this class.")
        # Joining live media requires actual enrollment, not just published-course preview access.
        assert_enrolled_in_class(db, user, cls)

    if cls.status != ClassStatus.live:
        raise ConflictError("This class is not currently live.")

    room_name = cls.livekit_room_name or _room_name_for(cls.id)
    token = livekit.generate_access_token(
        identity=user.id, name=user.full_name, room_name=room_name, can_publish=is_teacher, can_subscribe=True
    )

    participant = db.execute(
        select(ClassParticipant).where(ClassParticipant.class_id == cls.id, ClassParticipant.user_id == user.id)
    ).scalar_one_or_none()
    if participant is None:
        participant = ClassParticipant(class_id=cls.id, user_id=user.id)
        db.add(participant)
    participant.joined_at = utcnow()
    participant.left_at = None
    participant.participation_status = ParticipationStatus.joined
    db.commit()

    return {"livekit_url": settings.livekit_url, "token": token, "room_name": room_name, "can_publish": is_teacher}


def list_participants(db: Session, cls: Class) -> list[ClassParticipant]:
    stmt = select(ClassParticipant).where(ClassParticipant.class_id == cls.id)
    return list(db.execute(stmt).scalars())

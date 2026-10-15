from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class, ClassParticipant
from app.db.models.enums import ClassStatus, ParticipationStatus, UserRole
from app.db.models.user import User
from app.integrations import livekit
from app.services import course_service


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


def assert_teaches_class(user: User, cls: Class) -> None:
    if user.role != UserRole.teacher or cls.teacher_id != user.id:
        raise ForbiddenError("Only the assigned teacher can manage this class.")


def list_classes_for_user(db: Session, user: User) -> list[Class]:
    courses = course_service.list_courses_for_user(db, user)
    course_ids = [c.id for c in courses]
    if not course_ids:
        return []
    stmt = select(Class).where(Class.course_id.in_(course_ids)).order_by(Class.scheduled_start)
    return list(db.execute(stmt).scalars())


def create_class(db: Session, teacher: User, course_id: str, *, title: str, scheduled_start, scheduled_end) -> Class:
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(teacher, course)
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
    assert_teaches_class(teacher, cls)
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
    return cls


def end_class(db: Session, teacher: User, cls: Class) -> Class:
    assert_teaches_class(teacher, cls)
    if cls.status == ClassStatus.ended:
        return cls  # idempotent
    if cls.status != ClassStatus.live:
        raise ConflictError(f"Cannot end a class in status '{cls.status.value}'.")

    cls.status = ClassStatus.ended
    db.commit()
    db.refresh(cls)
    return cls


def issue_join_token(db: Session, user: User, cls: Class) -> dict:
    from app.config import get_settings

    settings = get_settings()

    is_teacher = user.role == UserRole.teacher and cls.teacher_id == user.id
    if not is_teacher:
        course = course_service.get_course_or_404(db, cls.course_id)
        course_service.assert_can_view_course(db, user, course)
        if user.role != UserRole.student:
            raise ForbiddenError("Only the teacher or enrolled students may join this class.")

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

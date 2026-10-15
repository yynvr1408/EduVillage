import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, ClassRoom, Summary
from ..schemas.schemas import ClassCreate, ClassOut, JoinTokenResponse
from ..services.auth import get_current_user, require_role
from ..services.livekit_token import generate_livekit_token, LIVEKIT_URL

router = APIRouter(prefix="/api/classes", tags=["classes"])


@router.get("", response_model=List[ClassOut])
def list_classes(db: Session = Depends(get_db)):
    classes = db.query(ClassRoom).all()
    out = []
    for c in classes:
        out.append(ClassOut(
            id=c.id,
            course_id=c.course_id,
            section_id=c.section_id,
            section_name=c.section.name if c.section else None,
            course_title=c.course.title if c.course else "Course",
            course_code=c.course.code if c.course else "EDU",
            teacher_id=c.teacher_id,
            teacher_name=c.course.teacher.full_name if (c.course and c.course.teacher) else "Teacher",
            title=c.title,
            status=c.status,
            scheduled_at=c.scheduled_at,
            livekit_room_name=c.livekit_room_name,
            started_at=c.started_at,
            ended_at=c.ended_at,
        ))
    return out


@router.post("", response_model=ClassOut)
def schedule_class(
    req: ClassCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == req.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    room_name = f"eduvillage-{course.code.lower()}-{uuid.uuid4().hex[:6]}"
    classroom = ClassRoom(
        course_id=req.course_id,
        section_id=req.section_id,
        teacher_id=current_user.id,
        title=req.title,
        status="SCHEDULED",
        scheduled_at=req.scheduled_at,
        livekit_room_name=room_name,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    return ClassOut(
        id=classroom.id,
        course_id=classroom.course_id,
        section_id=classroom.section_id,
        section_name=classroom.section.name if classroom.section else None,
        course_title=course.title,
        course_code=course.code,
        teacher_id=classroom.teacher_id,
        teacher_name=current_user.full_name,
        title=classroom.title,
        status=classroom.status,
        scheduled_at=classroom.scheduled_at,
        livekit_room_name=classroom.livekit_room_name,
        started_at=classroom.started_at,
        ended_at=classroom.ended_at,
    )


@router.get("/{class_id}", response_model=ClassOut)
def get_class(class_id: str, db: Session = Depends(get_db)):
    c = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Class session not found")
    return ClassOut(
        id=c.id,
        course_id=c.course_id,
        section_id=c.section_id,
        section_name=c.section.name if c.section else None,
        course_title=c.course.title if c.course else "Course",
        course_code=c.course.code if c.course else "EDU",
        teacher_id=c.teacher_id,
        teacher_name=c.course.teacher.full_name if (c.course and c.course.teacher) else "Teacher",
        title=c.title,
        status=c.status,
        scheduled_at=c.scheduled_at,
        livekit_room_name=c.livekit_room_name,
        started_at=c.started_at,
        ended_at=c.ended_at,
    )


@router.post("/{class_id}/start", response_model=ClassOut)
def start_class(
    class_id: str,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    c = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Class session not found")
    if c.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only assigned teacher can start this class")

    c.status = "LIVE"
    c.started_at = datetime.utcnow()
    db.commit()
    db.refresh(c)
    return ClassOut(
        id=c.id,
        course_id=c.course_id,
        section_id=c.section_id,
        section_name=c.section.name if c.section else None,
        course_title=c.course.title if c.course else "Course",
        course_code=c.course.code if c.course else "EDU",
        teacher_id=c.teacher_id,
        teacher_name=current_user.full_name,
        title=c.title,
        status=c.status,
        scheduled_at=c.scheduled_at,
        livekit_room_name=c.livekit_room_name,
        started_at=c.started_at,
        ended_at=c.ended_at,
    )


@router.post("/{class_id}/end", response_model=ClassOut)
def end_class(
    class_id: str,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    c = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Class session not found")
    if c.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only assigned teacher can end this class")

    c.status = "ENDED"
    c.ended_at = datetime.utcnow()
    
    # Auto-generate or queue summary for review
    existing_sum = db.query(Summary).filter(Summary.class_id == c.id).first()
    if not existing_sum:
        summary = Summary(
            class_id=c.id,
            course_id=c.course_id,
            status="NEEDS_REVIEW",
            review_status="PENDING",
            overview=f"Lecture recap for '{c.title}'. Covers foundational principles, practical field considerations, and key exam concepts.",
            key_concepts='["Core Principles", "Field Application & Reliability", "Low-power Optimization", "Troubleshooting Guide"]',
            definitions='[{"term": "Adaptive Fallback", "definition": "Automatic transition to audio-only stream when network packet loss exceeds threshold."}, {"term": "Idempotent Sync", "definition": "Safe retrying of network requests without duplicate records."}]',
            examples='["Example 1: Calculating battery storage runtime under variable cloud cover.", "Example 2: Setting up a local store-and-forward mesh buffer."]',
            revision_questions='["What is the primary factor determining solar inverter efficiency?", "How does adaptive audio mode preserve bandwidth during high packet loss?", "Describe two methods to verify local IndexedDB consistency before synchronization."]',
        )
        db.add(summary)

    db.commit()
    db.refresh(c)
    return ClassOut(
        id=c.id,
        course_id=c.course_id,
        section_id=c.section_id,
        section_name=c.section.name if c.section else None,
        course_title=c.course.title if c.course else "Course",
        course_code=c.course.code if c.course else "EDU",
        teacher_id=c.teacher_id,
        teacher_name=current_user.full_name,
        title=c.title,
        status=c.status,
        scheduled_at=c.scheduled_at,
        livekit_room_name=c.livekit_room_name,
        started_at=c.started_at,
        ended_at=c.ended_at,
    )


@router.post("/{class_id}/join-token", response_model=JoinTokenResponse)
def get_join_token(
    class_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    c = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Class session not found")

    # Verification: students can join only if class is LIVE or SCHEDULED (within join window)
    is_teacher = current_user.role == "teacher" and c.teacher_id == current_user.id

    if current_user.role == "student" and c.status not in ["LIVE", "SCHEDULED"]:
        raise HTTPException(
            status_code=403,
            detail="Class session is not currently open for student joining"
        )

    # Publishers are teachers; students join as listeners/subscribers (can request mic)
    is_publisher = is_teacher

    token = generate_livekit_token(
        room_name=c.livekit_room_name,
        participant_identity=current_user.id,
        participant_name=current_user.full_name,
        is_publisher=is_publisher,
    )

    return JoinTokenResponse(
        token=token,
        url=LIVEKIT_URL,
        room_name=c.livekit_room_name,
        participant_identity=current_user.id,
        participant_name=current_user.full_name,
        is_publisher=is_publisher,
    )

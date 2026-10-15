import json
import uuid
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, ClassRoom, Recording, RecordingProgress, Summary
from ..schemas.schemas import (
    RecordingCreate,
    RecordingOut,
    RecordingDetailOut,
    RecordingReuseRequest,
    RecordingProgressUpdate,
    SummaryOut,
)
from ..services.auth import get_current_user, get_optional_current_user, require_role
from .summaries import format_summary

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def format_recording_out(r: Recording, user_id: Optional[str] = None, db: Optional[Session] = None) -> RecordingOut:
    section_ids = json.loads(r.section_ids) if r.section_ids else []
    user_progress_seconds = 0
    user_completed = False

    if user_id and db:
        prog = db.query(RecordingProgress).filter(
            RecordingProgress.recording_id == r.id,
            RecordingProgress.user_id == user_id
        ).first()
        if prog:
            user_progress_seconds = prog.position_seconds
            user_completed = prog.completed

    return RecordingOut(
        id=r.id,
        course_id=r.course_id,
        course_title=r.course.title if r.course else "Course",
        course_code=r.course.code if r.course else "EDU",
        class_id=r.class_id,
        teacher_id=r.teacher_id,
        teacher_name=r.teacher.full_name if r.teacher else "Instructor",
        title=r.title,
        description=r.description,
        duration_seconds=r.duration_seconds,
        video_url=r.video_url,
        download_url=r.download_url,
        file_size_bytes=r.file_size_bytes,
        status=r.status,
        has_transcript=bool(r.transcript and len(r.transcript.strip()) > 0),
        has_summary=bool(r.summary_id or (r.classroom and r.classroom.summaries)),
        summary_id=r.summary_id or (r.classroom.summaries[0].id if (r.classroom and r.classroom.summaries) else None),
        section_ids=section_ids,
        is_published=r.is_published,
        created_at=r.created_at,
        user_progress_seconds=user_progress_seconds,
        user_completed=user_completed,
    )


@router.get("", response_model=List[RecordingOut])
def list_recordings(
    course_id: Optional[str] = None,
    section_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    query = db.query(Recording)
    
    # Students only see published recordings unless teacher
    if not current_user or current_user.role != "teacher":
        query = query.filter(Recording.is_published == True)

    if course_id:
        query = query.filter(Recording.course_id == course_id)
    if status:
        query = query.filter(Recording.status == status)

    recordings = query.order_by(Recording.created_at.desc()).all()
    user_id = current_user.id if current_user else None

    out = []
    for r in recordings:
        sec_ids = json.loads(r.section_ids) if r.section_ids else []
        if section_id and section_id not in sec_ids:
            continue
        out.append(format_recording_out(r, user_id=user_id, db=db))
    return out


@router.get("/{recording_id}", response_model=RecordingDetailOut)
def get_recording(
    recording_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    r = db.query(Recording).filter(Recording.id == recording_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recording not found")

    user_id = current_user.id if current_user else None
    base_out = format_recording_out(r, user_id=user_id, db=db)

    # Attach summary if exists
    summary_out: Optional[SummaryOut] = None
    if r.summary_id:
        sum_obj = db.query(Summary).filter(Summary.id == r.summary_id).first()
        if sum_obj:
            summary_out = format_summary(sum_obj)
    elif r.classroom and r.classroom.summaries:
        summary_out = format_summary(r.classroom.summaries[0])

    return RecordingDetailOut(
        **base_out.dict(),
        transcript=r.transcript,
        summary=summary_out,
    )


@router.post("", response_model=RecordingOut)
def create_recording(
    req: RecordingCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter(Course.id == req.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    rec = Recording(
        course_id=req.course_id,
        class_id=req.class_id,
        teacher_id=current_user.id,
        title=req.title,
        description=req.description,
        duration_seconds=req.duration_seconds,
        video_url=req.video_url,
        download_url=req.download_url,
        file_size_bytes=req.file_size_bytes,
        status="READY",
        transcript=req.transcript,
        summary_id=req.summary_id,
        section_ids=json.dumps(req.section_ids or []),
        is_published=True,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return format_recording_out(rec, user_id=current_user.id, db=db)


@router.post("/{recording_id}/reuse", response_model=RecordingOut)
def reuse_recording(
    recording_id: str,
    req: RecordingReuseRequest,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db),
):
    r = db.query(Recording).filter(Recording.id == recording_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recording not found")

    if r.teacher_id != current_user.id and r.course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized to share this recording")

    # Merge target sections without duplicating
    existing_sections = json.loads(r.section_ids) if r.section_ids else []
    merged = list(set(existing_sections + req.target_section_ids))
    r.section_ids = json.dumps(merged)
    db.commit()
    db.refresh(r)

    return format_recording_out(r, user_id=current_user.id, db=db)


@router.post("/{recording_id}/progress")
def update_playback_progress(
    recording_id: str,
    req: RecordingProgressUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.query(Recording).filter(Recording.id == recording_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recording not found")

    prog = db.query(RecordingProgress).filter(
        RecordingProgress.recording_id == recording_id,
        RecordingProgress.user_id == current_user.id
    ).first()

    if not prog:
        prog = RecordingProgress(
            recording_id=recording_id,
            user_id=current_user.id,
            position_seconds=req.position_seconds,
            completed=req.completed or False,
            updated_at=datetime.utcnow()
        )
        db.add(prog)
    else:
        prog.position_seconds = req.position_seconds
        if req.completed:
            prog.completed = True
        prog.updated_at = datetime.utcnow()

    db.commit()
    return {"status": "ok", "position_seconds": prog.position_seconds, "completed": prog.completed}


@router.post("/{recording_id}/publish", response_model=RecordingOut)
def toggle_publish(
    recording_id: str,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db),
):
    r = db.query(Recording).filter(Recording.id == recording_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recording not found")
    if r.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only recording creator can publish/unpublish")

    r.is_published = not r.is_published
    db.commit()
    db.refresh(r)
    return format_recording_out(r, user_id=current_user.id, db=db)

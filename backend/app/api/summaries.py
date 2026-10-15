import json
import uuid
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, ClassRoom, Summary
from ..schemas.schemas import SummaryOut, SummaryReviewRequest
from ..services.auth import get_current_user, require_role

router = APIRouter(prefix="/api", tags=["summaries"])


def format_summary(s: Summary) -> SummaryOut:
    key_concepts = json.loads(s.key_concepts) if s.key_concepts else []
    definitions = json.loads(s.definitions) if s.definitions else []
    examples = json.loads(s.examples) if s.examples else []
    revision_questions = json.loads(s.revision_questions) if s.revision_questions else []

    return SummaryOut(
        id=s.id,
        class_id=s.class_id,
        course_id=s.course_id,
        status=s.status,
        review_status=s.review_status,
        overview=s.overview,
        key_concepts=key_concepts,
        definitions=definitions,
        examples=examples,
        revision_questions=revision_questions,
        teacher_notes=s.teacher_notes,
        created_at=s.created_at,
    )


@router.get("/classes/{class_id}/summary", response_model=SummaryOut)
def get_class_summary(class_id: str, db: Session = Depends(get_db)):
    summary = db.query(Summary).filter(Summary.class_id == class_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="No summary available for this class session")
    return format_summary(summary)


@router.post("/classes/{class_id}/summary-jobs")
def create_summary_job(
    class_id: str,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    c = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Class session not found")

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    # If summary doesn't exist, create it in PROCESSING status
    summary = db.query(Summary).filter(Summary.class_id == class_id).first()
    if not summary:
        summary = Summary(
            class_id=c.id,
            course_id=c.course_id,
            status="PROCESSING",
            review_status="PENDING",
            overview="Processing lecture audio transcript and extracting key concepts...",
        )
        db.add(summary)
        db.commit()
    return {"job_id": job_id, "status": "QUEUED", "message": "Summary generation job enqueued"}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    return {"job_id": job_id, "status": "COMPLETED", "progress": 100}


@router.get("/summaries", response_model=List[SummaryOut])
def list_summaries(
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    summaries = db.query(Summary).all()
    return [format_summary(s) for s in summaries]


@router.post("/summaries/{summary_id}/review", response_model=SummaryOut)
def review_summary(
    summary_id: str,
    req: SummaryReviewRequest,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    summary = db.query(Summary).filter(Summary.id == summary_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")

    if req.action == "APPROVE":
        summary.review_status = "APPROVED"
        summary.status = "COMPLETED"
    elif req.action == "REVISE":
        summary.review_status = "REVISION_REQUESTED"
        summary.status = "NEEDS_REVIEW"
    
    if req.teacher_notes:
        summary.teacher_notes = req.teacher_notes
    if req.overview:
        summary.overview = req.overview
    if req.key_concepts:
        summary.key_concepts = json.dumps(req.key_concepts)
    if req.revision_questions:
        summary.revision_questions = json.dumps(req.revision_questions)

    db.commit()
    db.refresh(summary)
    return format_summary(summary)

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.summary import JobStatusOut, SummaryEdit, SummaryJobOut, SummaryJobRequest, SummaryOut
from app.services import classroom_service, summary_service

router = APIRouter(tags=["summaries"])


@router.post("/classes/{class_id}/summary-jobs", response_model=SummaryJobOut, status_code=202)
def create_summary_job(
    class_id: str,
    payload: SummaryJobRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cls = classroom_service.get_class_or_404(db, class_id)
    job = summary_service.request_summary(
        db, user, cls, transcript_text=payload.transcript_text, resource_id=payload.resource_id
    )
    background_tasks.add_task(summary_service.process_summary_job, job.id)
    return SummaryJobOut(job_id=job.id, status=job.status)


@router.get("/classes/{class_id}/summary", response_model=SummaryOut)
def get_class_summary(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    summary = summary_service.get_summary_for_class(db, user, cls)
    return SummaryOut.model_validate(summary)


@router.get("/summaries", response_model=list[SummaryOut])
def list_summaries(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [SummaryOut.model_validate(s) for s in summary_service.list_summaries(db, user)]


@router.get("/jobs/{job_id}", response_model=JobStatusOut)
def get_job(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = summary_service.get_job_or_404(db, job_id)
    summary_service.assert_can_view_job(db, user, job)
    return JobStatusOut(
        id=job.id, job_type=job.job_type.value, status=job.status, attempts=job.attempts,
        error_code=job.error_code, completed_at=job.completed_at,
    )


@router.patch("/summaries/{summary_id}", response_model=SummaryOut)
def edit_summary(summary_id: str, payload: SummaryEdit, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.db.models.summary import LectureSummary
    from app.core.exceptions import NotFoundError

    summary = db.get(LectureSummary, summary_id)
    if not summary:
        raise NotFoundError("Summary not found.")
    summary = summary_service.edit_summary(db, user, summary, payload.model_dump())
    return SummaryOut.model_validate(summary)


@router.post("/summaries/{summary_id}/approve", response_model=SummaryOut)
def approve_summary(summary_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.db.models.summary import LectureSummary
    from app.core.exceptions import NotFoundError

    summary = db.get(LectureSummary, summary_id)
    if not summary:
        raise NotFoundError("Summary not found.")
    summary = summary_service.approve_summary(db, user, summary)
    return SummaryOut.model_validate(summary)


@router.post("/summaries/{summary_id}/request-changes", response_model=SummaryOut)
def request_summary_changes(
    summary_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.db.models.summary import LectureSummary
    from app.core.exceptions import NotFoundError

    summary = db.get(LectureSummary, summary_id)
    if not summary:
        raise NotFoundError("Summary not found.")
    summary, job = summary_service.request_changes(db, user, summary)
    background_tasks.add_task(summary_service.process_summary_job, job.id)
    return SummaryOut.model_validate(summary)

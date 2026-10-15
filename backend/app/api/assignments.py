from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, Assignment, Submission
from ..schemas.schemas import AssignmentCreate, AssignmentOut, SubmissionCreate, SubmissionOut
from ..services.auth import get_current_user, require_role

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@router.get("", response_model=List[AssignmentOut])
def list_assignments(
    course_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Assignment)
    if course_id:
        query = query.filter(Assignment.course_id == course_id)
    assignments = query.all()

    out = []
    for a in assignments:
        my_sub = None
        if current_user.role == "student":
            sub = db.query(Submission).filter(
                Submission.assignment_id == a.id,
                Submission.student_id == current_user.id
            ).first()
            if sub:
                my_sub = SubmissionOut.from_orm(sub)

        out.append(AssignmentOut(
            id=a.id,
            course_id=a.course_id,
            course_title=a.course.title if a.course else "Course",
            title=a.title,
            instructions=a.instructions,
            due_date=a.due_date,
            max_score=a.max_score,
            created_at=a.created_at,
            submissions_count=len(a.submissions),
            my_submission=my_sub,
        ))
    return out


@router.post("", response_model=AssignmentOut)
def create_assignment(
    req: AssignmentCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == req.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    assignment = Assignment(
        course_id=req.course_id,
        title=req.title,
        instructions=req.instructions,
        due_date=req.due_date,
        max_score=req.max_score,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    return AssignmentOut(
        id=assignment.id,
        course_id=assignment.course_id,
        course_title=course.title,
        title=assignment.title,
        instructions=assignment.instructions,
        due_date=assignment.due_date,
        max_score=assignment.max_score,
        created_at=assignment.created_at,
        submissions_count=0,
    )


@router.get("/{assignment_id}", response_model=AssignmentOut)
def get_assignment(
    assignment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    a = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")

    my_sub = None
    if current_user.role == "student":
        sub = db.query(Submission).filter(
            Submission.assignment_id == a.id,
            Submission.student_id == current_user.id
        ).first()
        if sub:
            my_sub = SubmissionOut.from_orm(sub)

    return AssignmentOut(
        id=a.id,
        course_id=a.course_id,
        course_title=a.course.title if a.course else "Course",
        title=a.title,
        instructions=a.instructions,
        due_date=a.due_date,
        max_score=a.max_score,
        created_at=a.created_at,
        submissions_count=len(a.submissions),
        my_submission=my_sub,
    )


@router.post("/{assignment_id}/submissions", response_model=SubmissionOut)
def submit_assignment(
    assignment_id: str,
    req: SubmissionCreate,
    current_user: User = Depends(require_role(["student"])),
    db: Session = Depends(get_db)
):
    a = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Idempotency check: if this idempotency key was already submitted, return the existing submission safely
    if req.idempotency_key:
        existing = db.query(Submission).filter(
            Submission.idempotency_key == req.idempotency_key
        ).first()
        if existing:
            return SubmissionOut(
                id=existing.id,
                assignment_id=existing.assignment_id,
                student_id=existing.student_id,
                student_name=current_user.full_name,
                content=existing.content,
                status=existing.status,
                score=existing.score,
                feedback=existing.feedback,
                submitted_at=existing.submitted_at,
                idempotency_key=existing.idempotency_key,
            )

    # Check if student already has a submission for this assignment
    sub = db.query(Submission).filter(
        Submission.assignment_id == assignment_id,
        Submission.student_id == current_user.id
    ).first()

    if sub:
        # Update existing submission
        sub.content = req.content
        sub.submitted_at = datetime.utcnow()
        sub.idempotency_key = req.idempotency_key
        sub.status = "SUBMITTED"
    else:
        sub = Submission(
            assignment_id=assignment_id,
            student_id=current_user.id,
            content=req.content,
            idempotency_key=req.idempotency_key,
            status="SUBMITTED",
        )
        db.add(sub)

    db.commit()
    db.refresh(sub)

    return SubmissionOut(
        id=sub.id,
        assignment_id=sub.assignment_id,
        student_id=sub.student_id,
        student_name=current_user.full_name,
        content=sub.content,
        status=sub.status,
        score=sub.score,
        feedback=sub.feedback,
        submitted_at=sub.submitted_at,
        idempotency_key=sub.idempotency_key,
    )


@router.get("/{assignment_id}/submissions", response_model=List[SubmissionOut])
def get_submissions_for_assignment(
    assignment_id: str,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    subs = db.query(Submission).filter(Submission.assignment_id == assignment_id).all()
    out = []
    for s in subs:
        out.append(SubmissionOut(
            id=s.id,
            assignment_id=s.assignment_id,
            student_id=s.student_id,
            student_name=s.student.full_name if s.student else "Student",
            content=s.content,
            status=s.status,
            score=s.score,
            feedback=s.feedback,
            submitted_at=s.submitted_at,
            idempotency_key=s.idempotency_key,
        ))
    return out

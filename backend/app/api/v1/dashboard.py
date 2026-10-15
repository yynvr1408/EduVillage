from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.dashboard import StudentDashboardOut, TeacherDashboardOut
from app.services import dashboard_service

router = APIRouter(tags=["dashboard"])


@router.get("/student/dashboard", response_model=StudentDashboardOut)
def student_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.student)
    return dashboard_service.student_dashboard(db, user)


@router.get("/teacher/dashboard", response_model=TeacherDashboardOut)
def teacher_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    return dashboard_service.teacher_dashboard(db, user)

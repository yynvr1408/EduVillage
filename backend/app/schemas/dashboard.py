from pydantic import BaseModel

from app.schemas.assignment import AssignmentOut
from app.schemas.classroom import ClassOut
from app.schemas.course import CourseOut
from app.schemas.summary import SummaryOut


class DashboardUser(BaseModel):
    id: str
    full_name: str
    role: str


class StudentDashboardOut(BaseModel):
    user: DashboardUser
    courses: list[CourseOut]
    upcoming_classes: list[ClassOut]
    pending_assignments: list[AssignmentOut]


class TeacherDashboardOut(BaseModel):
    user: DashboardUser
    courses: list[CourseOut]
    upcoming_classes: list[ClassOut]
    review_queue: list[SummaryOut]

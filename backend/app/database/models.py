import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "student" or "teacher"
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    courses = relationship("Course", back_populates="teacher")
    submissions = relationship("Submission", back_populates="student")


class Course(Base):
    __tablename__ = "courses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    code = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    teacher_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    teacher = relationship("User", back_populates="courses")
    lessons = relationship("Lesson", back_populates="course", cascade="all, delete-orphan")
    classes = relationship("ClassRoom", back_populates="course", cascade="all, delete-orphan")
    assignments = relationship("Assignment", back_populates="course", cascade="all, delete-orphan")
    materials = relationship("Material", back_populates="course", cascade="all, delete-orphan")
    sections = relationship("Section", back_populates="course", cascade="all, delete-orphan")
    recordings = relationship("Recording", back_populates="course", cascade="all, delete-orphan")


class Section(Base):
    __tablename__ = "sections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    name = Column(String, nullable=False)  # e.g., "Section A - Campus", "Section B - Rural Field Cohort"
    code = Column(String, nullable=False)  # e.g., "SEC-A"
    student_count = Column(Integer, default=24)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="sections")
    classes = relationship("ClassRoom", back_populates="section")


class Lesson(Base):
    __tablename__ = "lessons"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    order_index = Column(Integer, default=0)
    content = Column(Text, nullable=True)
    offline_ready = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="lessons")
    materials = relationship("Material", back_populates="lesson")


class ClassRoom(Base):
    __tablename__ = "classes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    section_id = Column(String, ForeignKey("sections.id"), nullable=True)
    teacher_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    status = Column(String, default="SCHEDULED")  # SCHEDULED, LIVE, ENDED, CANCELLED
    scheduled_at = Column(DateTime, default=datetime.utcnow)
    livekit_room_name = Column(String, nullable=False)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)

    course = relationship("Course", back_populates="classes")
    section = relationship("Section", back_populates="classes")
    summaries = relationship("Summary", back_populates="classroom", cascade="all, delete-orphan")
    recordings = relationship("Recording", back_populates="classroom")


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    title = Column(String, nullable=False)
    instructions = Column(Text, nullable=False)
    due_date = Column(DateTime, nullable=False)
    max_score = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="assignments")
    submissions = relationship("Submission", back_populates="assignment", cascade="all, delete-orphan")


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    assignment_id = Column(String, ForeignKey("assignments.id"), nullable=False)
    student_id = Column(String, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    status = Column(String, default="SUBMITTED")  # SUBMITTED, GRADED
    score = Column(Integer, nullable=True)
    feedback = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    idempotency_key = Column(String, unique=True, index=True, nullable=True)

    assignment = relationship("Assignment", back_populates="submissions")
    student = relationship("User", back_populates="submissions")


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id = Column(String, ForeignKey("classes.id"), nullable=False)
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    status = Column(String, default="NEEDS_REVIEW")  # QUEUED, PROCESSING, NEEDS_REVIEW, COMPLETED, FAILED
    review_status = Column(String, default="PENDING")  # PENDING, APPROVED, REVISION_REQUESTED
    overview = Column(Text, nullable=True)
    key_concepts = Column(Text, nullable=True)  # JSON string
    definitions = Column(Text, nullable=True)  # JSON string
    examples = Column(Text, nullable=True)  # JSON string
    revision_questions = Column(Text, nullable=True)  # JSON string
    teacher_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    classroom = relationship("ClassRoom", back_populates="summaries")


class Material(Base):
    __tablename__ = "materials"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    lesson_id = Column(String, ForeignKey("lessons.id"), nullable=True)
    title = Column(String, nullable=False)
    file_url = Column(String, nullable=False)
    file_type = Column(String, default="pdf")  # pdf, audio, doc, etc.
    file_size = Column(Integer, default=0)
    is_published = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="materials")
    lesson = relationship("Lesson", back_populates="materials")


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    operation_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    idempotency_key = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="SUCCESS")
    created_at = Column(DateTime, default=datetime.utcnow)


class Recording(Base):
    __tablename__ = "recordings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    class_id = Column(String, ForeignKey("classes.id"), nullable=True)
    teacher_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    duration_seconds = Column(Integer, default=0)
    video_url = Column(String, nullable=True)
    download_url = Column(String, nullable=True)
    file_size_bytes = Column(Integer, default=0)
    status = Column(String, default="READY")  # PROCESSING, READY, FAILED, ARCHIVED
    transcript = Column(Text, nullable=True)
    summary_id = Column(String, ForeignKey("summaries.id"), nullable=True)
    section_ids = Column(Text, nullable=True)  # JSON string of section IDs e.g. ["sec-1"]
    is_published = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="recordings")
    classroom = relationship("ClassRoom", back_populates="recordings")
    teacher = relationship("User")
    summary = relationship("Summary")
    progress = relationship("RecordingProgress", back_populates="recording", cascade="all, delete-orphan")


class RecordingProgress(Base):
    __tablename__ = "recording_progress"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    recording_id = Column(String, ForeignKey("recordings.id"), nullable=False)
    position_seconds = Column(Integer, default=0)
    completed = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow)

    recording = relationship("Recording", back_populates="progress")
    user = relationship("User")


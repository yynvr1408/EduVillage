from app.db.models.assignment import Assignment, AssignmentSubmission, SubmissionAttachment, SubmissionRevision
from app.db.models.classroom import Class, ClassParticipant, ClassRecording, ClassSection, RecordingProgress, RecordingSection
from app.db.models.college import College, CollegeBranch, CollegeCodeHistory, CollegeSection, UserBranchAssignment, UserCollegeSection
from app.db.models.course import Course, CourseEnrollment, CourseTeacher
from app.db.models.lesson import LearningResource, Lesson, ResourceSection
from app.db.models.section import Section, SectionMember
from app.db.models.summary import BackgroundJob, LectureSummary, LectureTranscript
from app.db.models.sync_operation import AuditEvent, SyncOperation
from app.db.models.user import PasswordResetToken, User, UserSession

__all__ = [
    "College",
    "CollegeCodeHistory",
    "CollegeBranch",
    "CollegeSection",
    "UserBranchAssignment",
    "UserCollegeSection",
    "Assignment",
    "AssignmentSubmission",
    "SubmissionAttachment",
    "SubmissionRevision",
    "Class",
    "ClassParticipant",
    "ClassRecording",
    "ClassSection",
    "RecordingProgress",
    "RecordingSection",
    "Section",
    "SectionMember",
    "Course",
    "CourseEnrollment",
    "CourseTeacher",
    "LearningResource",
    "Lesson",
    "ResourceSection",
    "BackgroundJob",
    "LectureSummary",
    "LectureTranscript",
    "AuditEvent",
    "SyncOperation",
    "PasswordResetToken",
    "User",
    "UserSession",
]

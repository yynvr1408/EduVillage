from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import LessonStatus


class LessonCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str | None = None
    position: int = 0
    status: LessonStatus = LessonStatus.draft


class LessonUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    position: int | None = None
    status: LessonStatus | None = None


class LessonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    title: str
    content: str | None
    position: int
    status: LessonStatus


class SyllabusTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


class ProposedLesson(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str | None = None


class SyllabusPreview(BaseModel):
    lessons: list[ProposedLesson]
    pages: int | None = None


class BulkLessonsCreate(BaseModel):
    lessons: list[ProposedLesson] = Field(min_length=1, max_length=200)
    status: LessonStatus = LessonStatus.published

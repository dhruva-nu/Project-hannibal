from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CourseProgressResponse(BaseModel):
    courseId: int
    completedLessonIds: list[int]
    activeLessonId: int | None
    placedNodeIds: list[str]
    enrolledAt: datetime

    model_config = ConfigDict(from_attributes=True)


class ProgressUpdate(BaseModel):
    activeLessonId: int | None = None
    placedNodeIds: list[str] | None = None

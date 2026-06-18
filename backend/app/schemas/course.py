from pydantic import BaseModel

from app.models.course_model import CourseLevel
from app.models.course_related_course_model import RelatedCourseSource


class CourseCreate(BaseModel):
    name: str
    category: list[str]
    tagId: int | None = None
    enrolNum: int = 0
    coverImg: str | None = None
    level: CourseLevel
    description: str
    lessonCount: int = 0


class CourseUpdate(BaseModel):
    name: str | None = None
    category: list[str] | None = None
    tagId: int | None = None
    enrolNum: int | None = None
    coverImg: str | None = None
    level: CourseLevel | None = None
    description: str | None = None
    lessonCount: int | None = None


class RelatedCourseUpdate(BaseModel):
    relatedCourseId: int | None = None
    source: RelatedCourseSource | None = None
    rank: int | None = None
    noOfCalls: int | None = None


class RelatedCourseResponse(BaseModel):
    id: int
    courseId: int
    relatedCourseId: int
    source: RelatedCourseSource
    rank: int | None = None
    noOfCalls: int

    model_config = {"from_attributes": True, "populate_by_name": True}


class CourseResponse(BaseModel):
    id: int
    name: str
    category: list[str]
    tagId: int | None
    enrolNum: int
    coverImg: str
    level: CourseLevel
    description: str
    info: str | None = None
    lessonCount: int

    model_config = {"from_attributes": True, "populate_by_name": True}

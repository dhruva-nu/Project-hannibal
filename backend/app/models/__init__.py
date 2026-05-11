"""Domain and persistence models."""

from app.models.course_model import Course, CourseLevel
from app.models.lesson_model import Lesson, LessonType
from app.models.refresh_token import RefreshToken
from app.models.tags_model import Tags
from app.models.user import User
from app.models.build_block_model import BuildBlock
from app.models.lesson_block_model import LessonBlock

__all__ = [
    "Course",
    "CourseLevel",
    "Lesson",
    "LessonType",
    "RefreshToken",
    "Tags",
    "User",
    "BuildBlock",
    "LessonBlock",
]

MONGO_DOCUMENT_MODELS = [
    BuildBlock,
    LessonBlock,
]

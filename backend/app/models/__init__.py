"""Domain and persistence models."""

from app.models.build_block_model import BuildBlock
from app.models.course_model import Course, CourseLevel
from app.models.lesson_block_model import LessonBlock
from app.models.lesson_model import Lesson, LessonType
from app.models.node_model import Node
from app.models.preference_key_model import PreferenceKey
from app.models.refresh_token import RefreshToken
from app.models.tags_model import Tags
from app.models.user import User
from app.models.user_course_progress_model import UserCourseProgress
from app.models.user_lesson_progress_model import UserLessonProgress
from app.models.user_preference_model import UserPreference

__all__ = [
    "Course",
    "CourseLevel",
    "Lesson",
    "LessonType",
    "Node",
    "PreferenceKey",
    "RefreshToken",
    "Tags",
    "User",
    "BuildBlock",
    "LessonBlock",
    "UserCourseProgress",
    "UserLessonProgress",
    "UserPreference",
]

MONGO_DOCUMENT_MODELS = [
    BuildBlock,
    LessonBlock,
    Node,
    UserPreference,
]

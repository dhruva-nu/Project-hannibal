"""Domain and persistence models."""

from app.models.course_embedding_model import CourseEmbedding
from app.models.course_model import Course, CourseLevel
from app.models.course_related_course_model import (
    CourseRelatedCourse,
    RelatedCourseSource,
)
from app.models.feature_flag_model import FeatureFlag
from app.models.lesson_block_model import LessonBlock
from app.models.lesson_embedding_model import LessonEmbedding
from app.models.lesson_model import Lesson, LessonType
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
    "PreferenceKey",
    "RefreshToken",
    "Tags",
    "User",
    "LessonBlock",
    "UserCourseProgress",
    "UserLessonProgress",
    "UserPreference",
    "CourseEmbedding",
    "LessonEmbedding",
    "CourseRelatedCourse",
    "RelatedCourseSource",
    "FeatureFlag",
]

MONGO_DOCUMENT_MODELS = [
    LessonBlock,
    UserPreference,
]

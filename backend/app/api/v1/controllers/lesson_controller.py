import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.course import get_lesson_block_service, get_lesson_service
from app.schemas.lesson import LessonCreate, LessonResponse, LessonUpdate
from app.services.lesson_block_service import LessonBlockService
from app.services.lesson_service import LessonService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[LessonResponse])
def list_lessons(
    service: LessonService = Depends(get_lesson_service),
) -> list[LessonResponse]:
    try:
        return service.list_lessons()
    except Exception:
        logger.exception("failed to fetch lesson list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lessons. Please try again later.",
        )


@router.get("/course/{course_id}", response_model=list[LessonResponse])
def list_lessons_by_course(
    course_id: int, service: LessonService = Depends(get_lesson_service)
) -> list[LessonResponse]:
    try:
        return service.list_by_course(course_id)
    except Exception:
        logger.exception("failed to fetch lessons for course | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve lessons for course id={course_id}. Please try again later.",
        )


@router.get("/{lesson_id}", response_model=LessonResponse)
def get_lesson(
    lesson_id: int, service: LessonService = Depends(get_lesson_service)
) -> LessonResponse:
    try:
        return service.get_lesson(lesson_id)
    except ValueError:
        logger.warning("lesson not found | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson with id={lesson_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching lesson | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lesson. Please try again later.",
        )


@router.post("/", response_model=LessonResponse, status_code=status.HTTP_201_CREATED)
async def create_lesson(
    body: LessonCreate,
    service: LessonService = Depends(get_lesson_service),
    block_service: LessonBlockService = Depends(get_lesson_block_service),
) -> LessonResponse:
    try:
        lesson = service.create_lesson(
            courseId=body.courseId,
            name=body.name,
            learning=body.learning,
            nosqlId=body.nosqlId,
            lessonType=body.lessonType,
        )
    except Exception:
        logger.exception(
            "failed to create lesson | name=%r course_id=%s", body.name, body.courseId
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create lesson. Please try again later.",
        )

    try:
        await block_service.create_block(content="", summary="", id=lesson.nosqlId)
    except Exception:
        logger.exception(
            "lesson created but block creation failed | lesson_id=%d nosql_id=%s",
            lesson.id,
            lesson.nosqlId,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Lesson id={lesson.id} was created but its content block could not be initialized. "
                "Please contact support."
            ),
        )

    logger.info(
        "lesson created | lesson_id=%d name=%r course_id=%s",
        lesson.id,
        lesson.name,
        body.courseId,
    )
    return lesson


@router.patch("/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: int,
    body: LessonUpdate,
    service: LessonService = Depends(get_lesson_service),
) -> LessonResponse:
    try:
        lesson = service.update_lesson(
            lesson_id,
            **{k: v for k, v in body.model_dump().items() if v is not None},
        )
        logger.info("lesson updated | lesson_id=%d", lesson_id)
        return lesson
    except ValueError:
        logger.warning("lesson not found on update | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson with id={lesson_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error updating lesson | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update lesson. Please try again later.",
        )


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(
    lesson_id: int, service: LessonService = Depends(get_lesson_service)
) -> None:
    try:
        service.delete_lesson(lesson_id)
        logger.info("lesson deleted | lesson_id=%d", lesson_id)
    except ValueError:
        logger.warning("lesson not found on delete | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson with id={lesson_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error deleting lesson | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete lesson. Please try again later.",
        )

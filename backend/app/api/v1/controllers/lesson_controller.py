from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.course import get_lesson_service
from app.schemas.lesson import LessonCreate, LessonResponse, LessonUpdate
from app.services.lesson_service import LessonService

router = APIRouter()


@router.get("/", response_model=list[LessonResponse])
def list_lessons(service: LessonService = Depends(get_lesson_service)) -> list[LessonResponse]:
    return service.list_lessons()


@router.get("/course/{course_id}", response_model=list[LessonResponse])
def list_lessons_by_course(
    course_id: int, service: LessonService = Depends(get_lesson_service)
) -> list[LessonResponse]:
    return service.list_by_course(course_id)


@router.get("/{lesson_id}", response_model=LessonResponse)
def get_lesson(lesson_id: int, service: LessonService = Depends(get_lesson_service)) -> LessonResponse:
    try:
        return service.get_lesson(lesson_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/", response_model=LessonResponse, status_code=status.HTTP_201_CREATED)
def create_lesson(body: LessonCreate, service: LessonService = Depends(get_lesson_service)) -> LessonResponse:
    return service.create_lesson(
        courseId=body.courseId,
        name=body.name,
        learning=body.learning,
        nosqlId=body.nosqlId,
        lessonType=body.lessonType,
    )


@router.patch("/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: int, body: LessonUpdate, service: LessonService = Depends(get_lesson_service)
) -> LessonResponse:
    try:
        return service.update_lesson(
            lesson_id,
            **{k: v for k, v in body.model_dump().items() if v is not None},
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(lesson_id: int, service: LessonService = Depends(get_lesson_service)) -> None:
    try:
        service.delete_lesson(lesson_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

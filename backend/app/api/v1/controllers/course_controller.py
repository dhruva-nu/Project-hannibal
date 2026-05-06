from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.auth import require_admin
from app.dependencies.course import get_course_service
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate
from app.services.course_service import CourseService

router = APIRouter()


@router.get("/", response_model=list[CourseResponse])
def list_courses(
    service: CourseService = Depends(get_course_service),
) -> list[CourseResponse]:
    return service.list_courses()


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: int, service: CourseService = Depends(get_course_service)
) -> CourseResponse:
    try:
        return service.get_course(course_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    body: CourseCreate,
    service: CourseService = Depends(get_course_service),
    _: dict = Depends(require_admin),
) -> CourseResponse:
    return service.create_course(
        name=body.name,
        category=body.category,
        coverImg=body.coverImg,
        level=body.level,
        description=body.description,
        tagId=body.tagId,
        enrolNum=body.enrolNum,
        lessonCount=body.lessonCount,
    )


@router.patch("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: int,
    body: CourseUpdate,
    service: CourseService = Depends(get_course_service),
    _: dict = Depends(require_admin),
) -> CourseResponse:
    try:
        return service.update_course(
            course_id,
            **{k: v for k, v in body.model_dump().items() if v is not None},
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: int,
    service: CourseService = Depends(get_course_service),
    _: dict = Depends(require_admin),
) -> None:
    try:
        service.delete_course(course_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies.auth import AdminUser
from app.dependencies.course import CourseServiceDep
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[CourseResponse])
def list_courses(
    service: CourseServiceDep,
) -> list[CourseResponse]:
    try:
        return service.list_courses()
    except Exception:
        logger.exception("failed to fetch course list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve courses. Please try again later.",
        )


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: int, service: CourseServiceDep) -> CourseResponse:
    try:
        return service.get_course(course_id)
    except ValueError:
        logger.warning("course not found | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with id={course_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching course | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve course. Please try again later.",
        )


@router.post("/", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    body: CourseCreate,
    service: CourseServiceDep,
    _: AdminUser,
) -> CourseResponse:
    try:
        course = service.create_course(
            name=body.name,
            category=body.category,
            coverImg=body.coverImg,
            level=body.level,
            description=body.description,
            tagId=body.tagId,
            enrolNum=body.enrolNum,
            lessonCount=body.lessonCount,
        )
        logger.info("course created | course_id=%d name=%r", course.id, course.name)
        return course
    except Exception:
        logger.exception("failed to create course | name=%r", body.name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create course. Please try again later.",
        )


@router.patch("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: int,
    body: CourseUpdate,
    service: CourseServiceDep,
    _: AdminUser,
) -> CourseResponse:
    try:
        course = service.update_course(
            course_id,
            **{k: v for k, v in body.model_dump().items() if v is not None},
        )
        logger.info("course updated | course_id=%d", course_id)
        return course
    except ValueError:
        logger.warning("course not found on update | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with id={course_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error updating course | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update course. Please try again later.",
        )


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: int,
    service: CourseServiceDep,
    _: AdminUser,
) -> None:
    try:
        service.delete_course(course_id)
        logger.info("course deleted | course_id=%d", course_id)
    except ValueError:
        logger.warning("course not found on delete | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with id={course_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error deleting course | course_id=%d", course_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete course. Please try again later.",
        )

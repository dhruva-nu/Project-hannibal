import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.auth import require_auth
from app.dependencies.progress import get_progress_service
from app.schemas.progress import CourseProgressResponse, ProgressUpdate
from app.services.progress_service import ProgressService

router = APIRouter()
logger = logging.getLogger(__name__)


def _user_id(payload: dict) -> int:
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid auth payload",
        )


@router.get("/courses/{course_id}", response_model=CourseProgressResponse)
def get_progress(
    course_id: int,
    service: ProgressService = Depends(get_progress_service),
    payload: dict = Depends(require_auth),
) -> CourseProgressResponse:
    user_id = _user_id(payload)
    try:
        return service.get_progress(user_id, course_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No progress for course id={course_id}.",
        )
    except Exception:
        logger.exception(
            "unexpected error fetching progress | user_id=%d course_id=%d",
            user_id,
            course_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve progress. Please try again later.",
        )


@router.post(
    "/courses/{course_id}/enroll",
    response_model=CourseProgressResponse,
    status_code=status.HTTP_201_CREATED,
)
def enroll(
    course_id: int,
    service: ProgressService = Depends(get_progress_service),
    payload: dict = Depends(require_auth),
) -> CourseProgressResponse:
    user_id = _user_id(payload)
    try:
        return service.enroll(user_id, course_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with id={course_id} does not exist.",
        )
    except Exception:
        logger.exception(
            "unexpected error enrolling | user_id=%d course_id=%d",
            user_id,
            course_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to enroll. Please try again later.",
        )


@router.patch("/courses/{course_id}", response_model=CourseProgressResponse)
def update_progress(
    course_id: int,
    body: ProgressUpdate,
    service: ProgressService = Depends(get_progress_service),
    payload: dict = Depends(require_auth),
) -> CourseProgressResponse:
    user_id = _user_id(payload)
    try:
        return service.update_progress(
            user_id,
            course_id,
            active_lesson_id=body.activeLessonId,
            placed_node_ids=body.placedNodeIds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception:
        logger.exception(
            "unexpected error updating progress | user_id=%d course_id=%d",
            user_id,
            course_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update progress. Please try again later.",
        )


@router.post(
    "/courses/{course_id}/lessons/{lesson_id}/complete",
    response_model=CourseProgressResponse,
)
def complete_lesson(
    course_id: int,
    lesson_id: int,
    service: ProgressService = Depends(get_progress_service),
    payload: dict = Depends(require_auth),
) -> CourseProgressResponse:
    user_id = _user_id(payload)
    try:
        return service.complete_lesson(user_id, course_id, lesson_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception:
        logger.exception(
            "unexpected error completing lesson | user_id=%d lesson_id=%d",
            user_id,
            lesson_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark lesson complete. Please try again later.",
        )


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def reset_progress(
    course_id: int,
    service: ProgressService = Depends(get_progress_service),
    payload: dict = Depends(require_auth),
) -> None:
    user_id = _user_id(payload)
    try:
        service.reset_progress(user_id, course_id)
    except Exception:
        logger.exception(
            "unexpected error resetting progress | user_id=%d course_id=%d",
            user_id,
            course_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset progress. Please try again later.",
        )

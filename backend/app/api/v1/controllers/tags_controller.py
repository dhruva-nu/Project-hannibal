import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.tags import get_tags_service
from app.schemas.tags import TagCreate, TagResponse, TagUpdate
from app.services.tags_service import TagsService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[TagResponse])
def list_tags(service: TagsService = Depends(get_tags_service)) -> list[TagResponse]:
    try:
        return service.list_tags()
    except Exception:
        logger.exception("failed to fetch tag list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tags. Please try again later.",
        )


@router.get("/{tag_id}", response_model=TagResponse)
def get_tag(tag_id: int, service: TagsService = Depends(get_tags_service)) -> TagResponse:
    try:
        return service.get_tag(tag_id)
    except ValueError:
        logger.warning("tag not found | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tag with id={tag_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching tag | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tag. Please try again later.",
        )


@router.post("/", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, service: TagsService = Depends(get_tags_service)) -> TagResponse:
    try:
        tag = service.create_tag(name=body.name, description=body.description)
        logger.info("tag created | tag_id=%d name=%r", tag.id, tag.name)
        return tag
    except Exception:
        logger.exception("failed to create tag | name=%r", body.name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create tag. Please try again later.",
        )


@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: int, body: TagUpdate, service: TagsService = Depends(get_tags_service)
) -> TagResponse:
    try:
        tag = service.update_tag(tag_id, name=body.name, description=body.description)
        logger.info("tag updated | tag_id=%d", tag_id)
        return tag
    except ValueError:
        logger.warning("tag not found on update | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tag with id={tag_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error updating tag | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update tag. Please try again later.",
        )


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, service: TagsService = Depends(get_tags_service)) -> None:
    try:
        service.delete_tag(tag_id)
        logger.info("tag deleted | tag_id=%d", tag_id)
    except ValueError:
        logger.warning("tag not found on delete | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tag with id={tag_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error deleting tag | tag_id=%d", tag_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete tag. Please try again later.",
        )

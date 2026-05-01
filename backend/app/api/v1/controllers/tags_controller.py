from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.tags import get_tags_service
from app.schemas.tags import TagCreate, TagResponse, TagUpdate
from app.services.tags_service import TagsService

router = APIRouter()


@router.get("/", response_model=list[TagResponse])
def list_tags(service: TagsService = Depends(get_tags_service)) -> list[TagResponse]:
    return service.list_tags()


@router.get("/{tag_id}", response_model=TagResponse)
def get_tag(tag_id: int, service: TagsService = Depends(get_tags_service)) -> TagResponse:
    try:
        return service.get_tag(tag_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, service: TagsService = Depends(get_tags_service)) -> TagResponse:
    return service.create_tag(name=body.name, description=body.description)


@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: int, body: TagUpdate, service: TagsService = Depends(get_tags_service)
) -> TagResponse:
    try:
        return service.update_tag(tag_id, name=body.name, description=body.description)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, service: TagsService = Depends(get_tags_service)) -> None:
    try:
        service.delete_tag(tag_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

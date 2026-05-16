from app.repositories.build_block_repository import BuildBlockRepository
from app.services.build_block_service import BuildBlockService


def get_build_block_service() -> BuildBlockService:
    return BuildBlockService(repository=BuildBlockRepository())

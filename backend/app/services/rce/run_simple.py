from uuid import UUID

from fastapi import Depends

from app.dependencies.build_block import get_build_block_service
from app.services.build_block_service import BuildBlockService
from .docker import run_code


# TODO: This will check where to insert the users code in future
async def add_test_code(
    user_code: str,
    build_block_id: UUID,
    build_block_service: BuildBlockService = Depends(get_build_block_service),
) -> str:

    try:
        block = await build_block_service.get_block(build_block_id)
        test_code = block.test_code
        to_run = user_code + test_code
    except Exception as e:
        raise e  # TODO: need to have log and better error handling

    return to_run


async def run_simple(code: str, language: str, block_id: UUID) -> dict:
    final_code = await add_test_code(code, block_id)
    return run_code(final_code, language)

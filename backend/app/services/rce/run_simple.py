from uuid import UUID
import logging

from app.exception.dsl import TestCodeSyntaxFailure
from app.services.build_block_service import BuildBlockService
from .docker import run_code

logger = logging.getLogger(__name__)


async def add_test_code(
    user_code: str,
    build_block_id: UUID,
    build_block_service: BuildBlockService,
) -> str:
    try:
        block = await build_block_service.get_block(build_block_id)
        test_code = block.test_code
        if "--user-code--" not in test_code:
            raise TestCodeSyntaxFailure(build_block_id, test_code)
        to_run = test_code.replace("--user-code--", user_code)
        logger.info(f"to run code = \n{to_run}")
    except Exception as e:
        raise e

    return to_run


async def run_simple(
    code: str, language: str, block_id: UUID, build_block_service: BuildBlockService
) -> dict:
    final_code = await add_test_code(code, block_id, build_block_service)
    return run_code(final_code, language)

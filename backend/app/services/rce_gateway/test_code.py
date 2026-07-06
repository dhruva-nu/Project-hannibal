"""Splice student code into a build block's test harness.

Stays in the backend (unlike the sandbox itself) because it needs the build
block from MongoDB. The combined script is what gets published to the RCE
worker, so the worker never touches the database.
"""

from uuid import UUID

from app.exception.dsl import TestCodeSyntaxFailure
from app.services.build_block_service import BuildBlockService

_PLACEHOLDER = "--user-code--"


async def add_test_code(
    user_code: str,
    build_block_id: UUID,
    build_block_service: BuildBlockService,
) -> str:
    block = await build_block_service.get_block(build_block_id)
    test_code = block.test_code
    before, sep, after = test_code.partition(_PLACEHOLDER)
    if not sep:
        raise TestCodeSyntaxFailure(build_block_id, test_code)
    return before + user_code + after

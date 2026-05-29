from uuid import UUID


class TestCodeSyntaxFailure(Exception):
    def __init__(self, block_id: UUID, test_code: str):
        self.block_id = block_id
        self.test_code = test_code
        super().__init__(
            f"build block {block_id} test_code is missing the --user-code-- placeholder. "
            f"Received test_code:\n{test_code}"
        )

from uuid import UUID


class TestCodeSyntaxFailure(Exception):
    def __init__(self, block_id: UUID):
        self.block_id = block_id
        super().__init__(
            f"build block {block_id} test_code is missing the --user-code-- placeholder"
        )

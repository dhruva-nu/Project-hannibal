"""add rce_packages deps index

Searchable index of third-party packages known to the code-execution deps
layer: what autocomplete narrows over and what the registry-existence check
records. ``in_cache`` marks the runnable (installed) subset.

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-07-03 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rce_packages",
        sa.Column("language", sa.String(length=20), primary_key=True),
        sa.Column("name", sa.String(length=214), primary_key=True),
        sa.Column("exists", sa.Boolean(), nullable=False),
        sa.Column("in_cache", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_rce_packages_lang_name",
        "rce_packages",
        ["language", "name"],
    )


def downgrade() -> None:
    op.drop_index("ix_rce_packages_lang_name", table_name="rce_packages")
    op.drop_table("rce_packages")

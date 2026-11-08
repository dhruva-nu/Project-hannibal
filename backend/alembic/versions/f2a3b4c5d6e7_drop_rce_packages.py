"""drop rce_packages

The code-execution feature was removed; its package index table goes with it.

Revision ID: f2a3b4c5d6e7
Revises: e8f9a0b1c2d3
Create Date: 2026-11-08 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_rce_packages_lang_name", table_name="rce_packages")
    op.drop_table("rce_packages")


def downgrade() -> None:
    op.create_table(
        "rce_packages",
        sa.Column("language", sa.String(length=20), primary_key=True),
        sa.Column("name", sa.String(length=214), primary_key=True),
        sa.Column("exists", sa.Boolean(), nullable=False),
        sa.Column("in_cache", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_rce_packages_lang_name", "rce_packages", ["language", "name"]
    )

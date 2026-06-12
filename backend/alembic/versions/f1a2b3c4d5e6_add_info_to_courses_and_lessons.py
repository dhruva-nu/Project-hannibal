"""add info to courses and lessons

Revision ID: f1a2b3c4d5e6
Revises: 9ba532e50095
Create Date: 2026-06-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "9ba532e50095"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("info", sa.Text(), nullable=True))
    op.add_column("lessons", sa.Column("info", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "info")
    op.drop_column("lessons", "info")

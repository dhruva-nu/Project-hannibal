"""add preference_keys table and users.preference_id

Revision ID: b3c4d5e6f7a8
Revises: 7271b37d4d63
Create Date: 2026-06-09 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "7271b37d4d63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INITIAL_KEYS = [
    ("lang", "Programming language (e.g. python, typescript)"),
    ("be_framework", "Backend framework (e.g. fastapi, django)"),
    ("ai_framework", "AI/ML framework (e.g. google_adk, langchain)"),
    ("message_queue", "Message queue (e.g. temporal, rabbitmq)"),
    ("fe_framework", "Frontend framework (e.g. react, vue)"),
    ("db", "Database (e.g. postgres, mongodb)"),
]


def upgrade() -> None:
    preference_keys = op.create_table(
        "preference_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(50), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False),
    )
    op.create_index("ix_preference_keys_key", "preference_keys", ["key"], unique=True)
    op.bulk_insert(
        preference_keys,
        [{"key": k, "description": d} for k, d in _INITIAL_KEYS],
    )
    op.add_column("users", sa.Column("preference_id", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preference_id")
    op.drop_index("ix_preference_keys_key", table_name="preference_keys")
    op.drop_table("preference_keys")

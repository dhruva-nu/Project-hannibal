"""add user course and lesson progress

Revision ID: 7271b37d4d63
Revises: 9ba532e50095
Create Date: 2026-06-05 14:47:42.972270

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7271b37d4d63"
down_revision: Union[str, Sequence[str], None] = "9ba532e50095"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_course_progress",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("active_lesson_id", sa.Integer(), nullable=True),
        sa.Column(
            "placed_node_ids",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "enrolled_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["active_lesson_id"], ["lessons.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("user_id", "course_id"),
    )

    op.create_table(
        "user_lesson_progress",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "lesson_id"),
    )
    op.create_index(
        "ix_user_lesson_progress_user_id",
        "user_lesson_progress",
        ["user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_user_lesson_progress_user_id", table_name="user_lesson_progress"
    )
    op.drop_table("user_lesson_progress")
    op.drop_table("user_course_progress")

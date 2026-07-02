"""add course recommendation tables (embeddings + related courses)

Merges the two existing heads, enables pgvector, and creates the
embedding stores plus the usage-tracked related-course table.

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8, f1a2b3c4d5e6
Create Date: 2026-06-16 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = ("b3c4d5e6f7a8", "f1a2b3c4d5e6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIM = 768


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "course_embeddings",
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=False),
    )

    op.create_table(
        "lesson_embeddings",
        sa.Column(
            "lesson_id",
            sa.Integer(),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=False),
    )
    op.create_index(
        "ix_lesson_embeddings_course_id", "lesson_embeddings", ["course_id"]
    )

    related_course_source = sa.Enum(
        "top5", "overflow", name="related_course_source"
    )

    op.create_table(
        "course_related_courses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "related_course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", related_course_source, nullable=False),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("no_of_calls", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint(
            "course_id", "related_course_id", name="uq_course_related_pair"
        ),
    )
    op.create_index(
        "ix_course_related_courses_course_id",
        "course_related_courses",
        ["course_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_course_related_courses_course_id", table_name="course_related_courses"
    )
    op.drop_table("course_related_courses")
    sa.Enum(name="related_course_source").drop(op.get_bind(), checkfirst=True)

    op.drop_index("ix_lesson_embeddings_course_id", table_name="lesson_embeddings")
    op.drop_table("lesson_embeddings")
    op.drop_table("course_embeddings")

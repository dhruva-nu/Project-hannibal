"""adding role to user

Revision ID: ed27b1182b5a
Revises: 810bdb8858ca
Create Date: 2026-05-06 15:37:59.944432

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ed27b1182b5a'
down_revision: Union[str, Sequence[str], None] = '810bdb8858ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    users_level = sa.Enum('admin', 'student', name='users_level')
    users_level.create(op.get_bind())
    op.add_column('users', sa.Column('role', users_level, nullable=False, server_default='student'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'role')
    sa.Enum(name='users_level').drop(op.get_bind())

"""add provider, oauth_id, nullable hashed_password, refresh_tokens table

Revision ID: a1b2c3d4e5f6
Revises: 50478dfd04ca
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '50478dfd04ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('provider', sa.String(), nullable=False, server_default='local'))
    op.add_column('users', sa.Column('oauth_id', sa.String(), nullable=True))
    op.alter_column('users', 'hashed_password', existing_type=sa.String(), nullable=True)

    op.create_table(
        'refresh_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_refresh_tokens_jti'), 'refresh_tokens', ['jti'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_refresh_tokens_jti'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.alter_column('users', 'hashed_password', existing_type=sa.String(), nullable=False)
    op.drop_column('users', 'oauth_id')
    op.drop_column('users', 'provider')

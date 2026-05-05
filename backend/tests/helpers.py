from unittest.mock import MagicMock


def _db():
    return MagicMock()


def _chain(db, return_value):
    """Configure db.query(...).filter(...).first() to return *return_value*."""
    db.query.return_value.filter.return_value.first.return_value = return_value
    return db

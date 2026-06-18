from contextlib import contextmanager

from app.db.session import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_session():
    """Open a DB session outside the request lifecycle (e.g. agent nodes/tools)."""
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()

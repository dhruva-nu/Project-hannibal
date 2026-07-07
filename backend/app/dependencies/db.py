from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_session():
    """Context-manager form of ``get_db`` for use outside FastAPI dependency
    injection (LangGraph nodes, agent tools)."""
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()


DbSession = Annotated[Session, Depends(get_db)]

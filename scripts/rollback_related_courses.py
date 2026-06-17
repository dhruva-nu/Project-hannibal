"""Rollback the 5 "Basic Auth"-related courses and their lessons.

Usage (from repo root):
    uv run python scripts/rollback_related_courses.py

Removes ONLY the data added alongside course 2 ("Basic Auth"):
  - 5 courses (matched by name)
  - their 20 lessons (matched by nosql_id; lesson_embeddings cascade)
  - the 20 MongoDB lesson_blocks (matched by _id)

Scoped and idempotent: matches by stable keys, never truncates, and is safe
to re-run. Does NOT touch the original seed data.

Required: docker compose services 'db' and 'mongo' must be up.
"""

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal
from beanie import init_beanie
from pymongo import AsyncMongoClient

from app.models.lesson_block_model import LessonBlock
from app.models.build_block_model import BuildBlock

COURSE_NAMES = [
    "Session-Based Authentication",
    "OAuth 2.0 and Social Login",
    "Password Security and Hashing",
    "Multi-Factor Authentication",
    "API Authentication and Authorization",
]

# nosql_ids of the 20 lessons added for the courses above.
LESSON_NOSQL_IDS = [
    f"a1b2c3d4-e5f6-4a7b-8c9d-{p}0000000000{i}"
    for p in ("3", "4", "5", "6", "7")
    for i in (1, 2, 3, 4)
]


def rollback_postgres() -> None:
    session = SessionLocal()
    try:
        lessons_deleted = session.execute(
            text(
                "DELETE FROM lessons WHERE nosql_id = ANY(:ids) RETURNING id"
            ),
            {"ids": [str(i) for i in LESSON_NOSQL_IDS]},
        ).rowcount

        courses_deleted = session.execute(
            text("DELETE FROM courses WHERE name = ANY(:names) RETURNING id"),
            {"names": COURSE_NAMES},
        ).rowcount

        session.commit()
        print(
            f"PostgreSQL: deleted {courses_deleted} courses, "
            f"{lessons_deleted} lessons"
        )
    finally:
        session.close()


async def rollback_mongo() -> None:
    client: AsyncMongoClient = AsyncMongoClient(settings.mongo_url)
    db = client[settings.mongo_db]

    await init_beanie(database=db, document_models=[LessonBlock, BuildBlock])

    ids = [uuid.UUID(i) for i in LESSON_NOSQL_IDS]
    result = await LessonBlock.find({"_id": {"$in": ids}}).delete()

    await client.close()
    print(f"MongoDB: deleted {result.deleted_count} lesson_blocks")


def main() -> None:
    rollback_postgres()
    asyncio.run(rollback_mongo())
    print("Rollback complete.")


if __name__ == "__main__":
    main()

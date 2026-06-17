"""Seed runner for Project Hannibal.

Usage (from repo root):
    uv run python scripts/seed.py

Populates PostgreSQL and MongoDB from seed_data.py.
Idempotent: truncates all tables and drops collections before inserting,
so re-running always produces a clean, consistent dataset.

Required: docker compose services 'db' and 'mongo' must be up.
"""

import asyncio
import uuid

import path_setup  # noqa: F401 — side-effect import sets up sys.path

import bcrypt
from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User, Role
from app.models.tags_model import Tags
from app.models.course_model import Course, CourseLevel
from app.models.lesson_model import Lesson, LessonType
from app.models.lesson_block_model import LessonBlock
from app.models.build_block_model import BuildBlock, TestCases
from beanie import init_beanie
from pymongo import AsyncMongoClient

from seed_data import USERS, TAGS, COURSES, LESSONS, LESSON_BLOCKS, BUILD_BLOCKS


def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def seed_postgres() -> None:
    session = SessionLocal()
    try:
        session.execute(
            text(
                "TRUNCATE users, tags, courses, lessons, refresh_tokens "
                "RESTART IDENTITY CASCADE"
            )
        )
        session.commit()

        tag_id_by_name: dict[str, int] = {}
        for t in TAGS:
            tag = Tags(name=t["name"], description=t["description"])
            session.add(tag)
            session.flush()
            tag_id_by_name[t["name"]] = tag.id

        course_id_by_name: dict[str, int] = {}
        for c in COURSES:
            lessons = LESSONS[c["name"]]
            tag_id = tag_id_by_name.get(c["tag"]) if c.get("tag") else None
            course = Course(
                name=c["name"],
                category=c["category"],
                tagId=tag_id,
                enrolNum=c["enrol_num"],
                coverImg=c["cover_img"],
                level=CourseLevel(c["level"]),
                description=c["description"],
                lessonCount=len(lessons),
            )
            session.add(course)
            session.flush()
            course_id_by_name[c["name"]] = course.id

        for course_name, lessons in LESSONS.items():
            course_id = course_id_by_name[course_name]
            for lesson in lessons:
                session.add(
                    Lesson(
                        courseId=course_id,
                        name=lesson["name"],
                        learning=lesson["learning"],
                        nosqlId=uuid.UUID(lesson["nosql_id"]),
                        lessonType=LessonType(lesson["type"]),
                        order=lesson["order"],
                    )
                )

        for u in USERS:
            session.add(
                User(
                    email=u["email"],
                    hashed_password=_hash(u["password"]),
                    role=Role(u["role"]),
                    provider=u["provider"],
                )
            )

        session.commit()

        total_lessons = sum(len(v) for v in LESSONS.values())
        print(
            f"PostgreSQL: {len(TAGS)} tags, {len(COURSES)} courses, "
            f"{total_lessons} lessons, {len(USERS)} users"
        )
    finally:
        session.close()


async def seed_mongo() -> None:
    client: AsyncMongoClient = AsyncMongoClient(settings.mongo_url)
    db = client[settings.mongo_db]

    await init_beanie(database=db, document_models=[LessonBlock, BuildBlock])

    await db.lesson_blocks.drop()
    await db.build_blocks.drop()

    for lb in LESSON_BLOCKS:
        await LessonBlock(
            id=uuid.UUID(lb["id"]),
            content=lb["content"],
            summary=lb["summary"],
        ).insert()

    for bb in BUILD_BLOCKS:
        tests = [
            TestCases(name=t["name"], description=t["description"])
            for t in bb.get("tests", [])
        ]
        await BuildBlock(
            id=bb["id"],
            instructions=bb["instructions"],
            input=bb["input"],
            output=bb["output"],
            test_code=bb["test_code"],
            code_template=bb["code_template"],
            type=bb["type"],
            tests=tests,
        ).insert()

    await client.close()
    print(
        f"MongoDB: {len(LESSON_BLOCKS)} lesson_blocks, {len(BUILD_BLOCKS)} build_blocks"
    )


def main() -> None:
    seed_postgres()
    asyncio.run(seed_mongo())
    print("Seed complete.")


if __name__ == "__main__":
    main()

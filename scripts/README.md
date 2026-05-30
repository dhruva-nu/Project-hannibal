# Scripts

## Seed

Populates PostgreSQL and MongoDB with a realistic, self-consistent dataset so you can explore every feature immediately after `docker compose up`.

### Prerequisites

Docker Compose services `db` and `mongo` must be running:

```bash
docker compose up -d db mongo
```

### Run

From repo root:

```bash
cd backend && uv run python ../scripts/seed.py
```

### What gets created

| Store      | Data                                                                 |
|------------|----------------------------------------------------------------------|
| PostgreSQL | 2 users, 5 tags, 3 courses, 12 lessons (all FK relationships valid) |
| MongoDB    | 12 `lesson_blocks`, 4 `build_blocks`                                |

**Users**

| Email                 | Password     | Role    |
|-----------------------|--------------|---------|
| admin@hannibal.dev    | Admin1234!   | admin   |
| student@hannibal.dev  | Student1234! | student |

### Idempotency

Re-running truncates all tables and drops the MongoDB collections before inserting, so the result is always identical.

### Extending the dataset

Edit `scripts/seed_data.py` — it is plain Python dicts with no runner logic. Add entries to `USERS`, `TAGS`, `COURSES`, `LESSONS`, `LESSON_BLOCKS`, or `BUILD_BLOCKS` and re-run the seed.

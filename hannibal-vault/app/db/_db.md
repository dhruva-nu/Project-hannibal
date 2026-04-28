---
name: db (folder)
description: SQLAlchemy database setup — DeclarativeBase and engine/session factory
type: folder
layer: infra
tags: [folder, database, sqlalchemy]
---

# `app/db/`

Database infrastructure — two small files that all ORM models and repositories depend on.

```mermaid
flowchart LR
    models --> Base[db/base — DeclarativeBase]
    repositories --> SessionLocal[db/session — SessionLocal]
    dependencies --> SessionLocal
```

## Files

- [[app/db/base]] — `Base` — `DeclarativeBase` that all ORM model classes inherit from
- [[app/db/session]] — SQLAlchemy `engine` and `SessionLocal` factory

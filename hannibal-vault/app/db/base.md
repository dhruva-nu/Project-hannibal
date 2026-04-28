---
name: base.py (db)
description: DeclarativeBase — the SQLAlchemy base class all ORM models inherit from
type: file
layer: infra
tags: [database, sqlalchemy, base]
---

# `app/db/base.py`

Defines `Base = DeclarativeBase()`. All ORM model classes in [[app/models/_models]] inherit from this. SQLAlchemy uses it to track the metadata of all mapped tables.

**Imported by:** [[app/models/user]] · [[app/models/refresh_token]]

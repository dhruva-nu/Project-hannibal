---
name: session.py
description: SQLAlchemy engine and SessionLocal factory — the single source of DB connections
type: file
layer: infra
tags: [database, sqlalchemy, session]
---

# `app/db/session.py`

Creates the SQLAlchemy `engine` from `DATABASE_URL` (env var, defaults to `postgresql://hannibal:hannibal@localhost:5432/hannibal`) and the `SessionLocal` session factory.

`SessionLocal` is used in:
- [[app/dependencies/auth#get_db]] — per-request session for all auth routes
- [[app/api/v1/controllers/copilotkit_controller#get_user_profile]] — opens its own session directly for the agent tool

**Imported by:** [[app/dependencies/auth]] · [[app/api/v1/controllers/copilotkit_controller]]

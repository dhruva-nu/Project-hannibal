---
name: models (folder)
description: SQLAlchemy ORM models — one class per DB table, inheriting from Base
type: folder
layer: data
tags: [folder, models, sqlalchemy, orm]
---

# `app/models/`

SQLAlchemy ORM models. Each class maps to one database table and inherits from [[app/db/base#Base]] (`DeclarativeBase`). Models are used exclusively by repositories — services and controllers never import them directly.

## Files

- [[app/models/user]] — `users` table: id, email, hashed_password, provider, oauth_id, created_at
- [[app/models/refresh_token]] — `refresh_tokens` table: id, user_id (FK), jti, expires_at, revoked, created_at

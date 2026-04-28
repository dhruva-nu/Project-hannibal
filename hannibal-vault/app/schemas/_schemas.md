---
name: schemas (folder)
description: Pydantic request/response models — define the shape of HTTP input and output, separate from ORM models
type: folder
layer: api
tags: [folder, schemas, pydantic]
---

# `app/schemas/`

Pydantic models that define the exact shape of HTTP request bodies and response payloads. Kept separate from SQLAlchemy ORM models so the API contract can evolve independently of the DB schema.

Controllers accept schema types as request bodies and return them as responses. Services return schema types to controllers.

## Files

- [[app/schemas/auth]] — `RegisterRequest`, `LoginRequest`, `UserResponse`
- [[app/schemas/health]] — `HealthPayload`, `HealthResponse`

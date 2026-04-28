---
name: repositories (folder)
description: Database access layer — all SQLAlchemy queries live here, no business logic
type: folder
layer: data
tags: [folder, repositories, database, sqlalchemy]
---

# `app/repositories/`

The data access layer. Each repository owns queries for one table or domain. No business rules here — just DB reads and writes via SQLAlchemy sessions.

```mermaid
flowchart LR
    auth_service --> user_repository
    auth_service --> refresh_token_repository
    health_service --> health_repository
    copilotkit_controller --> user_repository
    user_repository --> User[models/user]
    refresh_token_repository --> RefreshToken[models/refresh_token]
```

## Files

- [[app/repositories/user_repository]] — CRUD + OAuth upsert for the `users` table
- [[app/repositories/refresh_token_repository]] — Create, lookup, and revoke refresh tokens
- [[app/repositories/health_repository]] — No-DB health payload (stub)
- [[app/repositories/base]] — `Repository` protocol (structural typing contract)

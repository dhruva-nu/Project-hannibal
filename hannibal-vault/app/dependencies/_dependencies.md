---
name: dependencies (folder)
description: FastAPI dependency injection wiring — constructs services and provides auth guards
type: folder
layer: api
tags: [folder, dependencies, fastapi, di]
---

# `app/dependencies/`

FastAPI's `Depends()` system is wired here. Each function in this folder is a **provider** — FastAPI calls it for every request and injects the result into route handler parameters.

This is where the service and repository layers get assembled with their DB sessions.

```mermaid
flowchart LR
    auth_controller -->|Depends| get_auth_service
    health_controller -->|Depends| get_health_service
    get_auth_service --> AuthService
    get_auth_service --> UserRepository
    get_auth_service --> RefreshTokenRepository
    get_auth_service --> SessionLocal
    get_health_service --> HealthService
    get_health_service --> HealthRepository
```

## Files

- [[app/dependencies/auth]] — `get_db`, `get_auth_service`, `require_auth`
- [[app/dependencies/health]] — `get_health_service`

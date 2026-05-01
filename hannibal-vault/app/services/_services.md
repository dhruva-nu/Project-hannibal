---
name: services (folder)
description: Business logic layer — services contain all domain rules, sitting between controllers and repositories
type: folder
layer: business
tags: [folder, services, business-logic]
---

# `app/services/`

The business logic layer. Services own all domain rules: token creation, password hashing, OAuth flow, validation. Controllers call services; services call repositories — never skip layers.

```mermaid
flowchart LR
    auth_controller --> auth_service
    health_controller --> health_service
    rce_controller --> rce_service
    auth_service --> user_repository
    auth_service --> refresh_token_repository
    health_service --> health_repository
```

## Files

- [[app/services/auth_service]] — Auth logic: register, login, logout, JWT creation, Google OAuth
- [[app/services/health_service]] — Assembles the health status response
- [[app/services/rce_service]] — Sandboxed Docker execution for Python and JavaScript

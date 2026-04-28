---
name: api (folder)
description: HTTP routing layer — assembles all versioned routers under /api/v1
type: folder
layer: api
tags: [folder, api, routing]
---

# `app/api/`

Contains the routing layer. All HTTP routes are assembled here and included into `main.py`.

```mermaid
flowchart LR
    main[main.py] --> router[api/router.py]
    router --> auth[controllers/auth_controller]
    router --> health[controllers/health_controller]
```

## Sub-folders

- [[app/api/v1/_v1]] — Versioned API (`v1`) with controllers

## Files

- [[app/api/router]] — Combines auth and health routers under `/api/v1`

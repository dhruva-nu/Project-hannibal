---
name: pages (folder)
description: Full routed pages — each subfolder is one route, assembles organisms and owns page-level state
type: folder
layer: pages
tags: [folder, pages, routing]
---

# `src/pages/`

Each subfolder is a routed page. Pages are thin orchestrators — they assemble organisms, call hooks for data/state, and handle navigation. No raw fetch calls; those go via [[frontend/src/services/api]].

```mermaid
flowchart LR
    App --> Home[/home]
    App --> Login[/login]
    App --> Courses[/courses]
    Storyboard[Storyboard - not routed]
```

## Sub-folders

- [[frontend/src/pages/Home/Home]] — Main app page: AI tutor, diagram canvas, agent task board
- [[frontend/src/pages/Login/Login]] — Auth page: sign in, create account, Google OAuth
- [[frontend/src/pages/Courses/Courses]] — Courses catalogue: filter chips, learning path, featured grid, AI recommendations
- [[frontend/src/pages/Storyboard/Storyboard]] — Internal component library viewer (not in the router)

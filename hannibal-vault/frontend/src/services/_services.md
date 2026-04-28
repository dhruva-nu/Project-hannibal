---
name: services (folder)
description: API layer — all backend calls go through here, never directly in components
type: folder
layer: data
tags: [folder, services, api]
---

# `src/services/`

All HTTP calls to the backend live here. Components and context never call `fetch` directly.

## Files

- [[frontend/src/services/api]] — `api` object with `get/post/put/delete` methods, cookie auth, auto token refresh

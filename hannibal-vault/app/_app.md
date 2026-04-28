---
name: app (folder)
description: Root application package — contains the FastAPI app factory and all sub-packages
type: folder
layer: entry
tags: [folder, app]
---

# `app/`

The root Python package for the backend. Everything lives under here.

`main.py` is the entry point — it builds the `FastAPI` instance, wires middleware, and registers routers. All sub-packages are imported from here.

## Sub-folders

- [[app/api/_api]] — HTTP routing (`/api/v1/...`)
- [[app/services/_services]] — Business logic layer
- [[app/repositories/_repositories]] — Database access layer
- [[app/models/_models]] — SQLAlchemy ORM table definitions
- [[app/schemas/_schemas]] — Pydantic request / response shapes
- [[app/dependencies/_dependencies]] — FastAPI dependency injection wiring
- [[app/core/_core]] — Config + logging setup
- [[app/db/_db]] — SQLAlchemy engine + session factory

## Files

- [[app/main]] — App factory, CORS, auth middleware, CopilotKit endpoint wiring

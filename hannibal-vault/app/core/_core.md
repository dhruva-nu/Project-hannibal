---
name: core (folder)
description: Application configuration and logging setup — reads .env, exposes a frozen Settings singleton
type: folder
layer: infra
tags: [folder, core, config, logging]
---

# `app/core/`

Infrastructure concerns: configuration and logging. Everything in here is stateless and read at startup.

## Files

- [[app/core/config]] — `Settings` dataclass singleton, reads all env vars from `.env`
- [[app/core/logging]] — `configure_logging()` — sets the global log format

**Used by:** [[app/main]] · [[app/api/v1/controllers/auth_controller]] · [[app/services/auth_service]] · [[app/api/v1/controllers/copilotkit_controller]]

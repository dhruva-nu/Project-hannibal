---
name: logging.py
description: Logging configuration — sets the global format and INFO level for all loggers
type: file
layer: infra
tags: [logging, config]
---

# `app/core/logging.py`

**Used by:** [[app/main#create_app]]

---

## `configure_logging` — lines 4–8

Calls `logging.basicConfig` with `INFO` level and the format `"%(asctime)s | %(levelname)s | %(name)s | %(message)s"`. Called once inside [[app/main#create_app]] before any routes are registered.

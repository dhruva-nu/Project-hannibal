---
name: access.py (dependencies)
description: Access-control DI guards — require_admin (role check) and require_quota (quota check), both stubs returning True
type: file
layer: api
tags: [dependencies, access, rbac, quota, fastapi, di]
imports:
  - "[[app/dependencies/auth]]"
---

# `app/dependencies/access.py`

Access-control guards built on top of `require_auth`. Each takes the JWT payload injected by `require_auth` and enforces a policy.

**Imports:** [[app/dependencies/auth]]

---

## `require_admin` — lines 5–8

Checks that the requesting user has the `admin` role. Currently a pass-through stub — always allows. Wire it into any route that should be admin-only via `Depends(require_admin)`.

**TODO:** raise `HTTP 403` when `payload["role"] != "admin"`

**Calls:** [[app/dependencies/auth#require_auth]]

---

## `require_quota` — lines 11–14

Checks that the requesting user has not exhausted their usage quota. Currently a pass-through stub — always allows. Wire it into any rate-limited route via `Depends(require_quota)`.

**TODO:** raise `HTTP 429` when user quota is exhausted

**Calls:** [[app/dependencies/auth#require_auth]]

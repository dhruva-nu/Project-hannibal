---
name: user.py (models)
description: ORM model for the users table — supports both local password auth and OAuth providers
type: file
layer: data
tags: [model, user, orm, sqlalchemy]
imports:
  - "[[app/db/base]]"
---

# `app/models/user.py`

Maps to the `users` table. Supports both local (password) and OAuth (Google) accounts in a single table via the `provider` and `oauth_id` fields. `hashed_password` is `nullable=True` so OAuth-only users have no password.

**Imports:** [[app/db/base]]

**Table:** `users`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `email` | String | Unique, indexed, not null |
| `hashed_password` | String | Nullable — absent for OAuth-only users |
| `provider` | String | Default `"local"`, e.g. `"google"` |
| `oauth_id` | String | Nullable — Google's user ID |
| `created_at` | DateTime(tz) | UTC timestamp, set on insert |

**Used by:** [[app/repositories/user_repository]]

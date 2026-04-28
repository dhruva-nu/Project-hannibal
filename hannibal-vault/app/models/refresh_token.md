---
name: refresh_token.py (models)
description: ORM model for the refresh_tokens table — stores JTI-based token records for revocation
type: file
layer: data
tags: [model, refresh-token, orm, sqlalchemy]
imports:
  - "[[app/db/base]]"
---

# `app/models/refresh_token.py`

Maps to the `refresh_tokens` table. Enables server-side revocation of refresh tokens — even though JWT is stateless, storing the `jti` lets the server mark a token as revoked on logout.

**Imports:** [[app/db/base]]

**Table:** `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `user_id` | Integer FK | References `users.id` |
| `jti` | String | Unique, indexed — JWT ID from the token payload |
| `expires_at` | DateTime(tz) | UTC expiry matching the JWT `exp` |
| `revoked` | Boolean | Set to `True` on logout |
| `created_at` | DateTime(tz) | UTC timestamp, set on insert |

**Used by:** [[app/repositories/refresh_token_repository]]

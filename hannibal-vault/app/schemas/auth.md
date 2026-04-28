---
name: auth.py (schemas)
description: Pydantic models for auth endpoints — RegisterRequest, LoginRequest, UserResponse
type: file
layer: api
tags: [schema, pydantic, auth]
---

# `app/schemas/auth.py`

Three Pydantic models for the auth API surface.

**Used by:** [[app/api/v1/controllers/auth_controller]] · [[app/services/auth_service]]

---

### `RegisterRequest`
Request body for `POST /auth/register`: `email` (EmailStr), `password` (str).

### `LoginRequest`
Request body for `POST /auth/login`: `email` (EmailStr), `password` (str).

### `UserResponse`
Response shape returned after register, login, and OAuth callback: `id`, `email`, `provider`, `oauth_id` (nullable). `model_config = {"from_attributes": True}` allows construction directly from SQLAlchemy ORM `User` instances.

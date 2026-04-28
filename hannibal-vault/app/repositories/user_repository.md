---
name: user_repository.py
description: All database queries for the users table — lookup by email/id/oauth, create, OAuth upsert
type: file
layer: data
tags: [repository, users, sqlalchemy]
imports:
  - "[[app/models/user]]"
---

# `app/repositories/user_repository.py`

Wraps all SQLAlchemy queries for the `users` table. Takes a `Session` at construction time (injected by [[app/dependencies/auth]]).

**Imports:** [[app/models/user]]

---

## `get_by_email` — lines 10–11

Queries `users` by email. Returns `User | None`. Used by login, register, and the Google OAuth upsert path.

---

## `get_by_id` — lines 13–14

Queries `users` by primary key. Returns `User | None`.

---

## `get_by_oauth_id` — lines 16–17

Queries `users` by `(provider, oauth_id)` composite. Used in the Google OAuth upsert to detect existing OAuth-linked accounts.

---

## `get_or_create_oauth_user` — lines 19–30

Upsert logic for Google OAuth sign-in. Priority:
1. Look up by `(provider, oauth_id)` — return if found
2. Look up by `email` — if found, link the OAuth credentials to the existing account and commit
3. Otherwise, create a brand-new OAuth user

**Calls:** `get_by_oauth_id` · `get_by_email` · `create`

---

## `create` — lines 32–37

Inserts a new `User` row. Accepts optional `hashed_password`, `provider`, and `oauth_id` to support both local and OAuth accounts in a single method.

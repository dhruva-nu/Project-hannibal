---
name: base.py (repositories)
description: Repository protocol — structural typing contract for all repository classes
type: file
layer: data
tags: [repository, protocol, typing]
---

# `app/repositories/base.py`

Defines the `Repository[T]` Protocol using Python's structural typing (`Protocol` + `Generic`). Any class with a `get() -> T` method satisfies this protocol without explicit inheritance.

Used as a type hint to decouple services from concrete repository classes, making them easier to mock in tests.

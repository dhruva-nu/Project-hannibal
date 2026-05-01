---
name: rce.py (schemas)
description: Pydantic request/response models for the RCE execute endpoint
type: file
layer: api
tags: [schema, rce, pydantic]
---

# `app/schemas/rce.py`

Pydantic models for `POST /rce/execute`.

## `ExecuteRequest` — lines 4–6

| Field | Type | Constraint |
|---|---|---|
| `code` | `str` | max 65 536 chars (64 KB) |
| `language` | `str` | validated in controller against `SUPPORTED_LANGUAGES` |

## `ExecuteResponse` — lines 9–16

| Field | Type | Notes |
|---|---|---|
| `exec_id` | `str` | UUID identifying this run |
| `language` | `str` | lowercased language name |
| `exit_code` | `int` | container exit code; `-1` on timeout |
| `stdout` | `str` | capped at 256 KB |
| `stderr` | `str` | capped at 256 KB; timeout message placed here |
| `timed_out` | `bool` | `true` if the 10 s wall-clock limit was hit |
| `duration_ms` | `int` | wall-clock time from start to result |

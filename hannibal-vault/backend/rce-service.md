# rce-service

**File:** `backend/app/services/rce_service.py`  
**Module-level (no class)**

Stateless Docker-based code runner. No DB access.

## Key symbols

| Symbol | Lines | Notes |
|--------|-------|-------|
| `RUNTIME` | 20–31 | Dict of language → `{ image, cmd, ext }` |
| `LIMITS` | 33–37 | `time=10s`, `memory=128MB`, `pids=10` |
| `_semaphore` | 16 | `Semaphore(5)` — max 5 concurrent executions; 6th raises `ValueError` → 429 |
| `run_code(code, language)` | 80–143 | Acquires semaphore, spins up container, waits, returns result dict |
| `_get_client()` | 40–53 | Lazy singleton Docker client; pre-pulls images on first call |
| `_build_result(...)` | 56–71 | Normalises stdout/stderr/exit_code/timing into response shape |
| `_truncate(raw)` | 74–77 | Caps output at 256 KB |

## Supported languages

| Language | Image | Extension |
|----------|-------|-----------|
| `python` | `python:3.11-alpine` | `.py` |
| `javascript` | `node:20-alpine` | `.js` |

## Container security

`network_mode=none` · `read_only=True` · `cap_drop=ALL` · `no-new-privileges` · user `65534:65534` · tmpfs `/tmp 64m`

## Calls

*(none — no repository, no service dependencies)*

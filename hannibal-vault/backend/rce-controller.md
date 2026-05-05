# rce-controller

**File:** `backend/app/api/v1/controllers/rce_controller.py`  
**Router prefix:** `/api/v1/rce`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `POST` | `/execute` | `execute_code` | 15–33 | ✅ `require_auth` |

## execute_code behaviour

1. Validates `language` is in `SUPPORTED_LANGUAGES`
2. Calls `rce_service.run_code` — `ValueError` maps to 429 (semaphore full), generic `Exception` maps to 500
3. Returns `ExecuteResponse`

## Calls

→ [[rce-service]]

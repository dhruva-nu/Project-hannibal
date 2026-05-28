# run-code-controller

**File:** `backend/app/api/v1/controllers/run_code_controller.py`  
**Router prefix:** `/api/v1/run-code`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `POST` | `/run-simple` | `run_simple` | 16–38 | ✅ `require_auth` |

## run_simple behaviour

1. Validates `language` is in `SUPPORTED_LANGUAGES`
2. Calls `run_code_service.run_simple(code, language, block_id)` — `ValueError` maps to 429, `NotImplementedError` maps to 501, generic `Exception` maps to 500
3. Returns `RunSimpleResponse`

## Calls

→ [[run-code-service]]

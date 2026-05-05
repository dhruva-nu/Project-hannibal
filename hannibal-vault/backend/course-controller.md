# course-controller

**File:** `backend/app/api/v1/controllers/course_controller.py`  
**Router prefix:** `/api/v1/courses`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `GET` | `/` | `list_courses` | 10–12 | ❌ |
| `GET` | `/{course_id}` | `get_course` | 15–20 | ❌ |
| `POST` | `/` | `create_course` | 23–37 | ✅ `require_admin` |
| `PATCH` | `/{course_id}` | `update_course` | 40–52 | ✅ `require_admin` |
| `DELETE` | `/{course_id}` | `delete_course` | 55–61 | ✅ `require_admin` |

## Calls

→ [[CourseService]]

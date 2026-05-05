# lesson-controller

**File:** `backend/app/api/v1/controllers/lesson_controller.py`  
**Router prefix:** `/api/v1/lessons`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `GET` | `/` | `list_lessons` | 10–12 | ❌ |
| `GET` | `/course/{course_id}` | `list_lessons_by_course` | 15–19 | ❌ |
| `GET` | `/{lesson_id}` | `get_lesson` | 22–27 | ❌ |
| `POST` | `/` | `create_lesson` | 30–38 | ❌ |
| `PATCH` | `/{lesson_id}` | `update_lesson` | 41–50 | ❌ |
| `DELETE` | `/{lesson_id}` | `delete_lesson` | 53–57 | ❌ |

## Calls

→ [[LessonService]]

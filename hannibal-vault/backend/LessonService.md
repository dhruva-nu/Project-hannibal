# LessonService

**File:** `backend/app/services/lesson_service.py`  
**Class:** `LessonService`

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `list_lessons` | 12–13 | All lessons |
| `list_by_course` | 15–16 | Filtered by `course_id` |
| `get_lesson` | 18–22 | Raises `ValueError` if not found |
| `create_lesson` | 24–39 | Maps params to repository |
| `update_lesson` | 41–46 | Checks existence, partial update |
| `delete_lesson` | 48–52 | Checks existence, delete |

## Calls

→ [[LessonRepository]]

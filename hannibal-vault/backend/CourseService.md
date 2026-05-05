# CourseService

**File:** `backend/app/services/course_service.py`  
**Class:** `CourseService`

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `list_courses` | 10–11 | Returns all courses as `CourseResponse` list |
| `get_course` | 13–17 | Raises `ValueError` if not found (controller maps to 404) |
| `create_course` | 19–40 | Delegates directly to repository |
| `update_course` | 42–47 | Checks existence first, then partial update |
| `delete_course` | 49–53 | Checks existence first, then delete |

## Calls

→ [[CourseRepository]]

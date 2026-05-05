# LessonRepository

**File:** `backend/app/repositories/lesson_repository.py`  
**Model:** `backend/app/models/lesson_model.py` — `Lesson(id, courseId FK, name, learning, nosqlId UUID, lessonType: LessonType)`

`LessonType` enum: `concept | project | challenge`

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `get_all` | 12–13 | `SELECT * FROM lessons` |
| `get_by_id` | 15–16 | `WHERE id = ?` |
| `get_by_course` | 18–19 | `WHERE courseId = ?` |
| `create` | 21–36 | INSERT lesson |
| `update` | 38–44 | setattr loop + commit |
| `delete` | 46–48 | DELETE + commit |

## Called by

← [[LessonService]]

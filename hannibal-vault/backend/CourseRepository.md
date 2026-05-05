# CourseRepository

**File:** `backend/app/repositories/course_repository.py`  
**Model:** `backend/app/models/course_model.py` — `Course(id, name, category[], coverImg, level: CourseLevel, description, tagId FK, enrolNum, lessonCount)`

`CourseLevel` enum: `beginner | intermediate | advanced | next-step`

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `get_all` | 10–11 | `SELECT * FROM courses` |
| `get_by_id` | 13–14 | `WHERE id = ?` |
| `create` | 16–40 | INSERT course |
| `update` | 42–48 | setattr loop + commit |
| `delete` | 50–52 | DELETE + commit |

## Called by

← [[CourseService]]

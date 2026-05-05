# Lessons Feature

← [[00 - Features Index|Back to index]]

Lesson content within a course. `CoursePage` is the interactive build board. Each lesson has a `nosqlId` pointing to MongoDB content (not yet wired). Lessons belong to a course via `courseId` FK.

Related: [[features/courses|Courses]] (parent), [[features/rce|RCE]] (code runner inside CoursePage)

## Data flow

```
[[CoursePage]] ──► [[courseDetail-service]] ──► [[api]] ──► [[lesson-controller]] ──► [[LessonService]] ──► [[LessonRepository]]
[[CoursePage]] ──► [[useCourseState]] (local state, no API)
```

## Nodes in this feature

### Frontend
- [[CoursePage]] — interactive course board, progress tracking, export
- [[useCourseState]] — local state machine (completed, active, revealed nodes)
- [[courseDetail-service]] — `getCourseContent` *(mocked)*

### Backend
- [[lesson-controller]] — CRUD + `/course/{course_id}` filter endpoint
- [[LessonService]] — existence checks, delegates to repo
- [[LessonRepository]] — PostgreSQL CRUD + `get_by_course(course_id)`

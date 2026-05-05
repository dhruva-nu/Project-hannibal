# Courses Feature

← [[00 - Features Index|Back to index]]

Course catalogue with filtering and modal preview. FE currently uses mock data — `api.get` calls are commented in for when BE is confirmed stable.

Related: [[features/lessons|Lessons]] (detail view), [[features/tags|Tags]] (course FK)

## Data flow

```
[[Courses]] ──► [[courses-service]] ──► [[api]] ──► [[course-controller]] ──► [[CourseService]] ──► [[CourseRepository]]
```

## Nodes in this feature

### Frontend
- [[Courses]] — catalogue page with filter bar and AI prompt bar
- [[courses-service]] — `getFeaturedCourses`, `getRecommendedCourses`, `getLearningPath` *(mocked)*

### Backend
- [[course-controller]] — CRUD: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`
- [[CourseService]] — business logic (existence checks before update/delete)
- [[CourseRepository]] — PostgreSQL CRUD for `courses` table

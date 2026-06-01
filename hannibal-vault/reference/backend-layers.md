# Backend Layering: Controller → Service → Repository

A walkthrough of the canonical pattern using one concrete request: `GET /api/v1/courses/{course_id}`. Every feature follows this exact shape.

## The contract

| Layer | Responsibility | Allowed to do | Not allowed to do |
|---|---|---|---|
| **Controller** | HTTP shape | Read request, call exactly one service method, return a schema, raise `HTTPException` | Touch the DB. Contain business rules. Hold state across calls. |
| **Service** | Business logic | Compose repository calls, validate invariants, raise `ValueError` (or typed exception) on domain errors | Know about HTTP, FastAPI, cookies, request bodies. |
| **Repository** | Data access | Run SQL / Beanie queries, return ORM rows or domain objects | Make decisions. Validate. Raise HTTP errors. |

When you see a controller running SQL, or a repository raising `HTTPException`, that's a review-blocker.

## Walkthrough

### 1. Wiring (`dependencies/course.py`)

```python
def get_course_service(db: Session = Depends(get_db)) -> CourseService:
    return CourseService(CourseRepository(db))
```

FastAPI resolves the chain per request: `get_db` yields a session, `CourseRepository(db)` wraps it, `CourseService(repo)` wraps that.

### 2. Controller (`api/v1/controllers/course_controller.py:14-123`)

```python
@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: int,
    service: CourseService = Depends(get_course_service),
) -> CourseResponse:
    try:
        return service.get_course(course_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Course not found")
```

What the controller does: parses the path param, delegates, translates the service's `ValueError` into a 404. Nothing else.

### 3. Service (`services/course_service.py:10-53`)

```python
class CourseService:
    def __init__(self, repo: CourseRepository):
        self.repo = repo

    def get_course(self, course_id: int) -> CourseResponse:
        row = self.repo.get_by_id(course_id)
        if row is None:
            raise ValueError(f"course {course_id} not found")
        return CourseResponse.model_validate(row)
```

What the service does: orchestrates one repo call, enforces existence, validates the ORM row into a response schema. For more complex methods (e.g. `create_lesson` auto-creates a `lesson_blocks` doc), the service is where the cross-store orchestration lives.

### 4. Repository (`repositories/course_repository.py:10-52`)

```python
class CourseRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, course_id: int) -> Course | None:
        return self.db.query(Course).filter(Course.id == course_id).first()
```

What the repository does: runs the query, returns an ORM object or `None`. No interpretation.

### 5. Schemas (`schemas/course.py:6-39`)

```python
class CourseResponse(BaseModel):
    id: int
    name: str
    category: list[str]
    tagId: int | None = None
    enrolNum: int
    coverImg: str
    level: CourseLevel
    description: str
    lessonCount: int

    model_config = ConfigDict(from_attributes=True)
```

`from_attributes=True` lets Pydantic read ORM rows directly. The aliases (`tag_id` → `tagId`, etc.) match the SQL column name to a JSON field; the on-the-wire shape is camelCase even though the DB columns are snake_case.

## Why this layering matters

- **Testing.** The service test mocks the repository; the controller test mocks the service. No layer test needs a real database.
- **Two backends, one shape.** Mongo-backed features (build blocks, lesson blocks, nodes) follow the same controller→service→repo pattern. Only the repo implementation changes (Beanie instead of SQLAlchemy). Services don't care.
- **Cross-store features.** When `LessonService.create_lesson` writes to Postgres and auto-creates a Mongo doc, the orchestration is visible in one method instead of being scattered across controllers.

## Common pitfalls

| Pitfall | Why it bites | Fix |
|---|---|---|
| Calling a repository directly from a controller | Bypasses validation and bumps the chance of `IntegrityError` reaching the HTTP layer | Route through a service. |
| Raising `HTTPException` in a service | Couples business logic to FastAPI | Raise a `ValueError` or typed exception; let the controller translate. |
| Returning ORM rows from a controller | Pydantic on the route can validate, but you lose explicit schema typing | Always return the `*Response` schema. |
| Sharing a single repo instance across requests | The SQLAlchemy session has request-scoped state | Always construct via `Depends`. |
| Service holding state between calls | Two requests interfere with each other | Services are stateless — instance per request. |

## Module map by feature

| Feature | Controller | Service | Repository | Schema |
|---|---|---|---|---|
| Auth | `auth_controller.py` | `auth_service.py` | `user_repository.py`, `refresh_token_repository.py` | `auth.py` |
| Courses | `course_controller.py` | `course_service.py` | `course_repository.py` | `course.py` |
| Lessons | `lesson_controller.py` | `lesson_service.py` | `lesson_repository.py` | `lesson.py` |
| Tags | `tags_controller.py` | `tags_service.py` | `tags_repository.py` | `tags.py` |
| Build blocks | `build_block_controller.py` | `build_block_service.py` | `build_block_repository.py` (Mongo) | `build_block.py` |
| Lesson blocks | `lesson_block_controller.py` | `lesson_block_service.py` | `lesson_block_repository.py` (Mongo) | `lesson_block.py` |
| Nodes | `node_controller.py` | `node_service.py` | `node_repository.py` (Mongo) | `node.py` |
| RCE | `rce_controller.py`, `run_code_controller.py` | `services/rce/*` | (Docker, not DB) | `rce.py`, `run_code.py` |
| CopilotKit | `copilotkit_controller.py` + `copilotkit_routes.py` | embedded in controller | reuses `user_repository` | — |
| Health | `health_controller.py` | `health_service.py` | `health_repository.py` (hardcoded) | `health.py` |

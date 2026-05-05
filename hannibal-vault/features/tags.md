# Tags Feature

← [[00 - Features Index|Back to index]]

Tag taxonomy for courses. No FE page — API-only CRUD. Each course has a `tagId` FK.

Related: [[features/courses|Courses]] (consumer)

## Data flow

```
(admin API call) ──► [[tags-controller]] ──► [[TagsService]] ──► [[TagsRepository]]
```

## Nodes in this feature

### Backend
- [[tags-controller]] — CRUD: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`
- [[TagsService]] — existence checks before update/delete
- [[TagsRepository]] — PostgreSQL CRUD for `tags` table

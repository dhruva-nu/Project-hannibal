# RCE Feature

← [[00 - Features Index|Back to index]]

Docker-sandboxed code execution. One container per run — no network, capped memory (128 MB), capped time (10 s), destroyed immediately after.

Related: [[features/lessons|Lessons]] (CoursePage embeds the code runner)

## Data flow

```
[[CoursePage]] ──► [[api]] ──► [[rce-controller]] ──► [[rce-service]] ──► Docker container
```

## Nodes in this feature

### Frontend
- [[CoursePage]] — hosts the code editor and submit button

### Backend
- [[rce-controller]] — `POST /execute`, validates language, maps semaphore error → 429
- [[rce-service]] — Docker client, semaphore(5), container lifecycle, output truncation

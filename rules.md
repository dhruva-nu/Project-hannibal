# Project Hannibal — Contribution Rules

## Issue templates

Three templates live in `.github/ISSUE_TEMPLATE/`. GitHub surfaces them automatically when you open a new issue.

| Template | Use when |
|----------|----------|
| `feature.md` | Adding new capability or behaviour |
| `bug.md` | Something is broken or wrong |
| `chore.md` | Refactor, tooling, infra, DX work |

Every issue must have:
- A `## Context` section explaining *why* the work exists.
- A `## Acceptance criteria` checklist (see format below).
- At least one label from the label list.

---

## Acceptance criteria format

Each AC item is a single, verifiable statement written in the present tense. It describes an observable outcome, not an implementation step.

**Good**
- [ ] `POST /api/v1/build-blocks/{id}/run` returns 200 with a `results` array when all test cases pass.
- [ ] Re-running the seed script does not create duplicate rows.

**Bad**
- [ ] Implement the run endpoint. ← describes work, not outcome
- [ ] It should work correctly. ← not verifiable

Rules:
- Start each item with a verb (returns, renders, raises, persists, …).
- One observable fact per item — no "and".
- If an AC item cannot be checked by reading code or running a test, rewrite it.

---

## Branch naming

```
<type>/<short-slug>
```

| Type | When to use |
|------|-------------|
| `feat/` | New feature (maps to a `feat:` issue) |
| `fix/` | Bug fix |
| `chore/` | Refactor, tooling, infra, DX |
| `test/` | Test-only changes |
| `docs/` | Documentation only |

Examples:
```
feat/build-block-test-cases
fix/refresh-token-expiry
chore/migrate-to-bun
test/lesson-controller-coverage
```

Rules:
- Slug is lowercase, hyphen-separated, ≤ 40 characters.
- Slug must match the spirit of the issue title — someone reading the branch name should know what it does.
- One branch per issue. Do not bundle unrelated work.
- Branch off `main`. Never branch off another feature branch.

---

## Commit message format

```
<type>(<scope>): <short description>
```

- `type`: `feat`, `fix`, `chore`, `test`, `docs`
- `scope`: the layer or module changed — `auth`, `lessons`, `rce`, `seed`, `dsl`, `frontend`, etc.
- Description: imperative, lowercase, ≤ 72 chars, no period.

Examples:
```
feat(build-blocks): add test-case submission endpoint
fix(auth): clear refresh token cookie on logout
chore(infra): switch package manager to bun
```

---

## PR rules

- Title follows the same `<type>(<scope>): <description>` format as commits.
- PR must close its issue: include `Closes #<n>` in the body.
- No PR merges with failing tests or a coverage drop.

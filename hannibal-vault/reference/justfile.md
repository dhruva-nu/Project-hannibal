# justfile — Task Runner Reference

`just` is a language-agnostic task runner (like `make`, but saner syntax). The `justfile` at the repo root provides a single command interface across the backend and frontend. Run `just` with no arguments to list every recipe.

**Install:** `sudo pacman -S just` (Arch) or `cargo install just`.

---

## Docker / full stack

| Recipe | What it does |
|---|---|
| `just up` | `docker compose up` — start all services |
| `just up-build` | Rebuild images then start |
| `just down` | Stop all services |
| `just down-clean` | Stop + remove DB volumes (wipes all data) |
| `just logs [service]` | Tail logs; omit `service` for all |

---

## Backend (`backend/` · Python · uv)

| Recipe | What it does |
|---|---|
| `just dev-backend` | Uvicorn hot-reload on `:8000` |
| `just test-backend` | pytest + 100% coverage gate |
| `just lint-backend` | ruff + black check |
| `just fix-backend` | ruff --fix + black (auto-format) |
| `just security-backend` | bandit SAST scan |
| `just length-backend` | Enforce ≤150 lines per function |
| `just migrate "msg"` | New Alembic autogenerate migration |
| `just db-upgrade` | Apply all pending migrations |
| `just db-downgrade` | Roll back one migration |

---

## Frontend (`frontend/` · TypeScript · bun)

| Recipe | What it does |
|---|---|
| `just dev-frontend` | Vite dev server on `:5173` |
| `just build-frontend` | Production Vite build |
| `just lint-frontend` | ESLint |
| `just fix-frontend` | ESLint --fix |
| `just typecheck-frontend` | `tsc --noEmit` |
| `just install-frontend` | `bun install` |

---

## Cross-cutting

| Recipe | What it does |
|---|---|
| `just lint` | All linters (backend + frontend) |
| `just fix` | All auto-fixable lint (backend + frontend) |
| `just test` | All tests (backend) |
| `just check` | Full quality gate: lint + test + security + length |
| `just duplication` | jscpd <1% duplication check across repo |

`just check` mirrors what CI runs — use it before pushing to avoid surprises.

---

## Source

`justfile` — repo root. Reads `.env` automatically via `set dotenv-load := true`.

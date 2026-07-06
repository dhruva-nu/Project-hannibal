set dotenv-load := true

# List available recipes
default:
    @just --list

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start all services via Docker Compose
up:
    docker compose up

# Start all services, rebuild images first
up-build:
    docker compose up --build

# Stop all services
down:
    docker compose down

# Stop all services and remove volumes (wipes DB data)
down-clean:
    docker compose down -v

# Tail logs for all services (or pass a service name: just logs backend)
logs service="":
    docker compose logs -f {{ service }}

# ── Backend ───────────────────────────────────────────────────────────────────

# Run backend dev server
dev-backend:
    cd backend && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Run backend tests with coverage
test-backend:
    cd backend && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=100 -v

# Lint backend (ruff + black check)
lint-backend:
    cd backend && uv run ruff check . && uv run black --check .

# Fix backend lint issues
fix-backend:
    cd backend && uv run ruff check --fix . && uv run black .

# Run bandit security scan
security-backend:
    cd backend && uv run bandit -r app/ -ll -ii

# Check no backend function exceeds 150 lines
length-backend:
    cd backend && uv run python ../scripts/check_function_length.py app/

# Run a new Alembic migration (usage: just migrate "add user table")
migrate msg:
    cd backend && uv run alembic revision --autogenerate -m "{{ msg }}"

# Apply all pending migrations
db-upgrade:
    cd backend && uv run alembic upgrade head

# Rollback one migration
db-downgrade:
    cd backend && uv run alembic downgrade -1

# ── Frontend ──────────────────────────────────────────────────────────────────

# Run frontend dev server
dev-frontend:
    cd frontend && bun dev

# Build frontend for production
build-frontend:
    cd frontend && bun run build

# Lint frontend
lint-frontend:
    cd frontend && bun run lint

# Fix frontend lint issues
fix-frontend:
    cd frontend && bun run lint:fix

# Type-check frontend
typecheck-frontend:
    cd frontend && bunx tsc --noEmit

# Install frontend dependencies
install-frontend:
    cd frontend && bun install

# ── DSL Service ───────────────────────────────────────────────────────────────

# Run DSL service dev server
dev-dsl:
    cd dsl-service && cargo run

# Run DSL service tests
test-dsl:
    cd dsl-service && cargo test --all-features

# Lint DSL service
lint-dsl:
    cd dsl-service && cargo clippy --all-targets --all-features -- -D warnings

# Format DSL service
fix-dsl:
    cd dsl-service && cargo fmt

# Check DSL service formatting without changing files
fmt-check-dsl:
    cd dsl-service && cargo fmt --all -- --check

# Run cargo security audit
security-dsl:
    cd dsl-service && cargo audit

# ── RCE Service ───────────────────────────────────────────────────────────────

# Run the RCE worker (needs RabbitMQ + Docker socket)
dev-rce:
    cd rce-service && uv run python -m rce_service.main

# Seed the package caches from the allowlists
prewarm-rce:
    cd rce-service && uv run python -m rce_service.prewarm

# Run RCE service tests with coverage
test-rce:
    cd rce-service && uv run pytest --cov=rce_service --cov-report=term-missing -v

# Lint RCE service (ruff + black check)
lint-rce:
    cd rce-service && uv run ruff check . && uv run black --check .

# Fix RCE service lint issues
fix-rce:
    cd rce-service && uv run ruff check --fix . && uv run black .

# Run bandit security scan on the RCE service
security-rce:
    cd rce-service && uv run bandit -r rce_service/ -ll -ii

# Check no RCE service function exceeds 150 lines
length-rce:
    cd rce-service && uv run python ../scripts/check_function_length.py rce_service/

# ── Cross-cutting ─────────────────────────────────────────────────────────────

# Run all linters across every service
lint: lint-backend lint-frontend lint-dsl lint-rce

# Fix all auto-fixable lint issues across every service
fix: fix-backend fix-frontend fix-dsl fix-rce

# Run all tests across every service
test: test-backend test-dsl test-rce

# Run all quality checks (lint + tests + security + length)
check: lint test security-backend security-dsl security-rce length-backend length-rce

# Check code duplication across the repo (<1%)
duplication:
    bunx jscpd . \
        --threshold 1 \
        --min-lines 5 \
        --min-tokens 50 \
        --ignore-pattern "**/.git/**,**/node_modules/**,**/target/**,**/__pycache__/**,**/dist/**,**/alembic/versions/**,**/uv.lock,**/bun.lock,**/Cargo.lock,**/coverage.xml,**/*.css,**/*.yml,**/*.yaml,**/*.md,**/tests/**,**/*.test.*,**/*.spec.*" \
        --reporters console

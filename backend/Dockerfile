# ── Stage 1: base image ──────────────────────────────────────────────────────
# Start from an official Python image. We pin to 3.14-slim to keep it small.
FROM python:3.14-rc-slim

# ── Stage 2: system setup ────────────────────────────────────────────────────
# Install curl so we can download uv (the fast Python package manager).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv — same tool used locally for managing deps.
RUN curl -Ls https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# ── Stage 3: working directory ───────────────────────────────────────────────
# All subsequent commands run from /app inside the container.
WORKDIR /app

# ── Stage 4: install dependencies ────────────────────────────────────────────
# Copy only the dependency files first — Docker caches this layer separately.
# If your code changes but deps don't, Docker reuses this cached layer (faster builds).
COPY pyproject.toml uv.lock ./

# Install dependencies into the system Python (no venv needed inside Docker).
RUN uv sync --frozen --no-dev

# ── Stage 5: copy source code ────────────────────────────────────────────────
COPY . .

# ── Stage 6: expose & run ────────────────────────────────────────────────────
# Tell Docker this container listens on port 8000.
# (This is documentation — you still need -p 8000:8000 when running.)
EXPOSE 8000

# Run the app. We call uvicorn directly (no reload in production).
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

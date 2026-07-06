# ── Stage 1: base image ──────────────────────────────────────────────────────
FROM python:3.14-rc-slim

# ── Stage 2: system setup ────────────────────────────────────────────────────
# curl to fetch uv; the Docker CLI is not needed — we talk to the daemon over
# the mounted socket via the Python SDK.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -Ls https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# ── Stage 3: install dependencies ────────────────────────────────────────────
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ── Stage 4: copy source ─────────────────────────────────────────────────────
COPY . .

# ── Stage 5: run the worker ──────────────────────────────────────────────────
# --no-dev: the runtime image ships only prod deps (matches the build sync), so
# `uv run` doesn't pull lint/test tooling into a production container at boot.
CMD ["uv", "run", "--no-dev", "python", "-m", "rce_service.main"]

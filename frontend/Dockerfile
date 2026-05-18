# ── Stage 1: build stage ─────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# ── Stage 2: production stage ────────────────────────────────────────────────
# nginx is a tiny, fast static file server — perfect for serving built React apps.
FROM nginx:alpine

# Remove the default nginx welcome page.
RUN rm -rf /usr/share/nginx/html/*

# Copy ONLY the compiled output from Stage 1 — nothing else.
COPY --from=builder /app/dist /usr/share/nginx/html

# Use our custom nginx config (API proxy + React Router fallback).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 (nginx's default port).
EXPOSE 80

# nginx starts automatically — no CMD needed, it's baked into the nginx image.

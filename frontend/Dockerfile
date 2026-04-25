# ── Stage 1: build stage ─────────────────────────────────────────────────────
# We use a "multi-stage build". Stage 1 has Node to compile the app.
# Stage 2 copies only the compiled output — Node is NOT in the final image.
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependency files first (cache optimization — same idea as the backend).
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies needed to build).
RUN npm ci

# Copy the rest of the source code.
COPY . .

# Build the production bundle. Output goes to /app/dist.
RUN npm run build

# ── Stage 2: production stage ────────────────────────────────────────────────
# nginx is a tiny, fast static file server — perfect for serving built React apps.
FROM nginx:alpine

# Remove the default nginx welcome page.
RUN rm -rf /usr/share/nginx/html/*

# Copy ONLY the compiled output from Stage 1 — nothing else.
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80 (nginx's default port).
EXPOSE 80

# nginx starts automatically — no CMD needed, it's baked into the nginx image.

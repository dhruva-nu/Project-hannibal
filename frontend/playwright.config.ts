import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests run against the full Docker Compose stack (frontend + backend
// + Postgres + Mongo + RabbitMQ + rce-service) with the seed dataset loaded —
// never a mocked backend. Bring the stack up (`docker compose up`) and seed it
// before running `bun run test:e2e`.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

import { test, expect, type Page } from "@playwright/test";

// Golden-path smoke tests (issue #88): login → course → lesson → run code.
// These run against the full Docker Compose stack with the seed dataset loaded,
// so they catch regressions unit tests can't — the API contract, auth cookies,
// routing, and the RCE round-trip (backend → RabbitMQ → rce-service → Docker).

const EMAIL = "admin@hannibal.dev";
const PASSWORD = "Admin1234!";

// Seeded course whose second lesson is a `build` lesson — the shortest route to
// the code-execution path (scripts/seed_data.py → "Basic Auth": learn, build, …).
const BUILD_COURSE = "Basic Auth";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  // InputField renders the label uppercased, so match case-insensitively and
  // anchor the regex so /password/ doesn't also grab the show/hide eye button.
  await page.getByLabel(/^email$/i).fill(EMAIL);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

// Opens the seeded build course via the real UI: card → modal → "start build".
// Lands on the /courses/:id detail page.
async function openBuildCourse(page: Page): Promise<void> {
  await page.goto("/courses");
  await page.getByText(BUILD_COURSE, { exact: true }).first().click();
  await page.getByRole("link", { name: /start build/i }).click();
  await page.waitForURL(/\/courses\/\d+$/, { timeout: 15_000 });
}

test("golden path: sign-in lands on the dashboard", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/home/);
});

test("golden path: course list loads and a course opens", async ({ page }) => {
  await login(page);
  await openBuildCourse(page);
  // The course detail page's lesson sidebar has rendered.
  await expect(page.getByRole("heading", { name: /lessons/i })).toBeVisible();
});

test("golden path: a lesson opens and its content renders", async ({ page }) => {
  await login(page);
  await openBuildCourse(page);
  // The first lesson is a `theory` lesson (unlocked). Click its kind badge.
  await page.getByText("theory", { exact: true }).first().click();
  // The board's tab toggle is rendered only while a lesson panel is open, so
  // its "design" tab appearing proves the theory lesson opened.
  await expect(page.getByRole("button", { name: "design" })).toBeVisible();
});

test("golden path: build lesson code runs and returns a verdict", async ({ page }) => {
  test.setTimeout(180_000); // allows for a cold sandbox + RabbitMQ round-trip
  await login(page);
  await openBuildCourse(page);

  // Complete the intro theory lesson to unlock the build lesson that follows.
  await page.getByText("theory", { exact: true }).first().click();
  await page.getByRole("button", { name: /got it/i }).click();

  // Open the build lesson → code editor + test runner.
  await page.getByText("build", { exact: true }).first().click();
  const runButton = page.getByRole("button", { name: /run tests/i });
  await expect(runButton).toBeVisible();
  await runButton.click();

  // The full RCE pipeline returns a pass/fail verdict. The seed's starter code
  // is a stub, so tests come back failing; /all green/ keeps the assertion valid
  // if the seed ever ships a passing solution.
  await expect(page.getByText(/failing|all green/i)).toBeVisible({ timeout: 150_000 });
});

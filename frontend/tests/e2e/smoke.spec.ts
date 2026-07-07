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

// A correct solution for that build lesson. The seed harness only catches
// AssertionError, so the starter stub's KeyError crashes the run — a real
// solution makes the sandbox return an all-pass verdict instead.
const SOLUTION = `def register(username: str, password: str) -> None:
    db.store(username, password)


def authenticate(username: str, password: str) -> bool:
    try:
        return db.get(username) == password
    except KeyError:
        return False
`;

// The CopilotKit tutor isn't part of the golden path, and without a real Gemini
// key its runtime returns 422, which renders a full-viewport <cpk-web-inspector>
// dev overlay that intercepts pointer events and blocks every click. Hide it so
// the smoke tests exercise the app, not CopilotKit's error state.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const install = () => {
      const removeInspector = () =>
        document.querySelectorAll("cpk-web-inspector").forEach((el) => el.remove());
      removeInspector();
      new MutationObserver(removeInspector).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    // Init scripts run before the document is parsed, so documentElement may not
    // exist yet — defer until the DOM is ready.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install);
    } else {
      install();
    }
  });
});

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

  // Progress persists in the backend across runs, so a prior run may have
  // already completed lessons (which flips the theory button to "close" and
  // pre-unlocks lessons). Reset to a known state: nothing done, first unlocked.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^reset$/i }).click();

  // Complete the intro theory lesson to unlock the build lesson that follows.
  await page.getByText("theory", { exact: true }).first().click();
  await page.getByRole("button", { name: /got it/i }).click();

  // Open the build lesson → code editor + test runner.
  await page.getByText("build", { exact: true }).first().click();

  // Wait for the starter code to load (async translate call) before replacing
  // it — otherwise a late translate response would overwrite our solution.
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("register", { timeout: 20_000 });

  // Replace the stub with a correct solution. insertText inserts verbatim (no
  // CodeMirror auto-indent, unlike keyboard.type), so the Python whitespace is
  // preserved.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(SOLUTION);
  await expect(editor).toContainText("db.store");

  await page.getByRole("button", { name: /run tests/i }).click();

  // The full RCE pipeline (backend → RabbitMQ → rce-service → Docker sandbox)
  // runs the solution and returns an all-pass verdict.
  await expect(page.getByText(/all green/i)).toBeVisible({ timeout: 150_000 });
});

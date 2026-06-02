import { test, expect, type Page } from "@playwright/test";

const EMAIL = "admin@hannibal.dev";
const PASSWORD = "Admin1234!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
}

test("login → home", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/home/);
});

test("courses list loads", async ({ page }) => {
  await login(page);
  await page.goto("/courses");
  await expect(page.locator("body")).toContainText(/course/i);
});

test("design board renders", async ({ page }) => {
  await login(page);
  await page.goto("/design-board");
  await expect(page.locator("body")).toBeVisible();
});

test("storyboard renders", async ({ page }) => {
  await login(page);
  await page.goto("/storyboard");
  await expect(page.locator("body")).toBeVisible();
});

test("course page renders", async ({ page }) => {
  await login(page);
  await page.goto("/courses");
  const firstCard = page.locator('a[href*="/courses/"]').first();
  if (await firstCard.count() > 0) {
    await firstCard.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  }
});

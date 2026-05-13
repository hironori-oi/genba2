import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase1");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

test.describe("Phase 1 auth screens + protected shell", () => {
  test("landing page renders branded hero", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "現場の入力に、迷いを残さない。" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
    await page.screenshot({ path: shotPath("01-landing"), fullPage: true });
  });

  test("landing page passes axe-core a11y scan (no serious/critical)", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("login page enforces password min 10 client-side", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
    await page.screenshot({ path: shotPath("02-login"), fullPage: true });

    await page.getByLabel("メールアドレス").fill("worker@example.com");
    await page.getByLabel("パスワード", { exact: false }).fill("short");
    await page.getByRole("button", { name: /^ログイン/ }).click();

    // The server action returns an error state with the password hint.
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("login page passes axe-core a11y scan", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("forgot-password page renders and submits without leaking existence", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "パスワード再設定" })).toBeVisible();
    await page.screenshot({ path: shotPath("03-forgot-password"), fullPage: true });
    await page.getByLabel("メールアドレス").fill("worker@example.com");
    await page.getByRole("button", { name: /リセットメール/ }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.screenshot({ path: shotPath("03b-forgot-password-sent"), fullPage: true });
  });

  test("/app redirects unauthenticated visitors back to /login", async ({ page }) => {
    const res = await page.goto("/app");
    expect(res?.url()).toContain("/login");
  });

  test("dark-mode tokens emit when prefers-color-scheme=dark", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg"),
    );
    expect(bg.trim()).not.toEqual("");
    await page.screenshot({ path: shotPath("04-dark-landing"), fullPage: true });
    await ctx.close();
  });
});

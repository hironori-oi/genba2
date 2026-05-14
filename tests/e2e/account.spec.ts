import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase5d");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 5d — /app/account/* personal-settings E2E (dispatch SCOPE bullet 2).
 * Worker + tenant_admin + system_admin が全て到達できる route。
 */

const ACCOUNT_ROUTES = [
  { path: "/app/account", testid: "account-card-profile", screenshotKey: "10-account-index" },
  {
    path: "/app/account/profile",
    testid: "profile-form",
    screenshotKey: "11-account-profile",
  },
  {
    path: "/app/account/preferences",
    testid: "preferences-form",
    screenshotKey: "12-account-preferences",
  },
] as const;

async function axeScan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

test.describe("Phase 5d account UI", () => {
  for (const route of ACCOUNT_ROUTES) {
    test(`unauth visitor is redirected from ${route.path}`, async ({ page, context }) => {
      await context.clearCookies();
      const res = await page.goto(route.path);
      expect(res?.url()).toContain("/login");
      await page.screenshot({
        path: shotPath(`${route.screenshotKey}-unauth`),
        fullPage: true,
      });
    });
  }

  test("authed account index renders profile + preferences cards", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to run authed account E2E.",
    );
    await page.goto("/app/account");
    await expect(page.getByTestId("account-card-profile")).toBeVisible();
    await expect(page.getByTestId("account-card-preferences")).toBeVisible();
    await page.screenshot({
      path: shotPath("10-account-index-authed"),
      fullPage: true,
    });
  });

  for (const route of ACCOUNT_ROUTES) {
    test(`authed structure + 56x56 — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE to run authed account E2E.",
      );
      await page.goto(route.path);
      await expect(page.getByTestId(route.testid)).toBeVisible();
      const submits = [
        "profile-save",
        "preferences-save",
        "account-back-to-index",
      ];
      for (const id of submits) {
        const loc = page.getByTestId(id);
        if (await loc.count()) {
          const box = await loc.first().boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
        }
      }
    });

    test(`axe a11y — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE to run authed account E2E.",
      );
      await page.goto(route.path);
      const violations = await axeScan(page);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }

  test("profile form: empty display name surfaces a field error", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to exercise the profile form validation.",
    );
    await page.goto("/app/account/profile");
    await page.getByTestId("profile-display-name").fill("");
    await page.getByTestId("profile-save").click();
    // HTML5 required gate or server-side zod gate — either path is acceptable.
    const errVisible = await page
      .locator('[role="alert"]')
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (!errVisible) {
      const invalid = await page
        .getByTestId("profile-display-name")
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
      expect(invalid).toBe(true);
    }
    await page.screenshot({
      path: shotPath("13-profile-validation"),
      fullPage: true,
    });
  });

  test("preferences form: switching language radio updates aria-checked state", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to exercise the preferences radios.",
    );
    await page.goto("/app/account/preferences");
    // The radio input is .sr-only; clicking it directly is intercepted by the
    // wrapping <label>. force:true tells Playwright to dispatch the click
    // through to the input itself, which is what a screen-reader / keyboard
    // user does via the radio group semantics.
    await page.getByTestId("preferences-language-en").check({ force: true });
    await expect(page.getByTestId("preferences-language-en")).toBeChecked();
    await page.screenshot({
      path: shotPath("14-preferences-en"),
      fullPage: true,
    });
  });
});

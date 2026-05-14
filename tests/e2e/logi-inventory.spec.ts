import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase3b");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 3b — 棚卸 (Inventory) E2E.
 *
 * Verifies the auth redirect, the CSV upload button is visible, and the
 * location-QR scanner area renders. Authed scenarios are skipped without
 * an E2E_LOGI_AUTH_COOKIE so this file remains green in CI before the
 * test tenant is provisioned.
 */
test.describe("Phase 3b 棚卸 unauth contract", () => {
  // Phase 6b carry-over hardening: clean storage state so unauth redirect
  // assertion runs even when global-setup primed tenant_admin cookies.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/app/logi/inventory redirects unauthenticated visitors back to /login", async ({
    page,
  }) => {
    const res = await page.goto("/app/logi/inventory");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("01-inventory-unauth-redirect"),
      fullPage: true,
    });
  });
});

test.describe("Phase 3b 棚卸 flow", () => {
  test("authed structure — CSV upload button + location scanner area render", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/inventory");
    await expect(page.getByTestId("step-header")).toBeVisible();
    await expect(page.getByTestId("inv-plan-code")).toBeVisible();
    await expect(
      page.getByTestId("csv-upload-inventory-plan-line"),
    ).toBeVisible();
    // The scanner-frame renders once the location step is reached. We don't
    // need a scan to happen — the frame element is enough for a structural
    // assertion.
    await expect(page.getByTestId("scanner-frame").first()).toBeVisible();

    const csvBtn = page.getByTestId("csv-upload-inventory-plan-line");
    const csvBtnBox = await csvBtn.boundingBox();
    expect(csvBtnBox?.height ?? 0).toBeGreaterThanOrEqual(56);

    await page.screenshot({
      path: shotPath("02-inventory-authed"),
      fullPage: true,
    });
  });

  test("inventory page passes axe-core a11y scan (when authed)", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/inventory");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

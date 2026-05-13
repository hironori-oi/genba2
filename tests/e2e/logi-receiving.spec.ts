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
 * Phase 3b — 入庫 (Receiving) E2E.
 *
 * Live auth flows require a Supabase test tenant; when that env is missing
 * we still verify (a) the auth redirect on unauthenticated access and
 * (b) the spec file parses + reports its test-skip state so QA can see
 * structurally what shape was expected.
 */
test.describe("Phase 3b 入庫 flow", () => {
  test("/app/logi/receiving redirects unauthenticated visitors back to /login", async ({
    page,
  }) => {
    const res = await page.goto("/app/logi/receiving");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("01-receiving-unauth-redirect"),
      fullPage: true,
    });
  });

  test("authed structure — StepHeader + Scanner + ngflow toggle render", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/receiving");
    await expect(page.getByTestId("step-header")).toBeVisible();
    await expect(page.getByTestId("scanner-frame")).toBeVisible();

    // 56×56 touch target sanity check on the abort button.
    const abortBtn = page.getByTestId("step-header-abort");
    await expect(abortBtn).toBeVisible();
    const box = await abortBtn.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(56);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);

    // ng_flow toggle is visible and switches the label.
    const toggle = page.getByTestId("ngflow-toggle");
    await expect(toggle).toBeVisible();
    await toggle.getByLabel(/warn/).check();
    await expect(page.getByTestId("ngflow-label")).toContainText("warn");
    await page.screenshot({
      path: shotPath("02-receiving-authed"),
      fullPage: true,
    });
  });

  test("receiving page passes axe-core a11y scan (when authed)", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/receiving");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

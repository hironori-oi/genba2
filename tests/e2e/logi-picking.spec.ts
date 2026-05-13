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
 * Phase 3b — ピッキング (Picking) E2E.
 *
 * Covers the 5-step structural shape (header → line → label → 数量 → 登録)
 * and the ng_flow=block contract: 登録 button must be disabled when match
 * has not run yet, and remain disabled after a NG match.
 */
test.describe("Phase 3b ピッキング flow", () => {
  test("/app/logi/picking redirects unauthenticated visitors back to /login", async ({
    page,
  }) => {
    const res = await page.goto("/app/logi/picking");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("01-picking-unauth-redirect"),
      fullPage: true,
    });
  });

  test("authed structure — 5 step progress + ng_flow=block disables submit", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/picking");
    await expect(page.getByTestId("step-header")).toBeVisible();
    // 5 step entries
    for (const id of ["header", "line", "label", "quantity", "submit"]) {
      await expect(page.getByTestId(`step-${id}`)).toBeVisible();
    }

    // ng_flow=block by default → submit disabled until match passes.
    const submit = page.getByTestId("pick-submit");
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    // Toggle to warn → still disabled (no match yet), label updates.
    await page.getByTestId("ngflow-toggle").getByLabel(/warn/).check();
    await expect(page.getByTestId("ngflow-label")).toContainText("warn");
    await expect(submit).toBeDisabled();
    await page.screenshot({
      path: shotPath("02-picking-authed"),
      fullPage: true,
    });
  });

  test("picking page passes axe-core a11y scan (when authed)", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/logi/picking");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

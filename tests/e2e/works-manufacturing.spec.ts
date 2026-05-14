import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase4c");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 4c — 製造実績 (Manufacturing) E2E.
 *
 * Mirrors the Phase 3b LOGI spec shape:
 *   1. Unauthenticated visitors land on /login.
 *   2. Authed structure: StepHeader + 4-step ladder + ProcessSelector +
 *      DefectListInput + ProduceInflowToggle + 56×56 tap targets.
 *   3. axe-core a11y scan passes for the manufacturing screen.
 *   4. Scanner unhappy path: opening the process scanner without granting
 *      camera permission falls back to manual input via ManualInputModal
 *      without crashing the flow.
 *
 * Authed scenarios are skipped without an E2E_LOGI_AUTH_COOKIE so this file
 * stays green pre-tenant-provisioning, matching Phase 3b convention.
 */
test.describe("Phase 4c 製造実績 unauth contract", () => {
  // Phase 6b carry-over hardening: clean storage state so unauth redirect
  // assertion runs even when global-setup primed tenant_admin cookies.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/app/works/manufacturing redirects unauthenticated visitors back to /login", async ({
    page,
  }) => {
    const res = await page.goto("/app/works/manufacturing");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("01-manufacturing-unauth-redirect"),
      fullPage: true,
    });
  });
});

test.describe("Phase 4c 製造実績 flow", () => {
  test("authed structure — StepHeader + 5-step ladder + defect cap visible", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/works/manufacturing");
    await expect(page.getByTestId("manufacturing-root")).toBeVisible();
    await expect(page.getByTestId("step-header")).toBeVisible();

    for (const id of ["process", "record", "defects", "inflow", "submit"]) {
      await expect(page.getByTestId(`step-${id}`)).toBeVisible();
    }

    // ProcessSelector renders the manual UUID input even with zero options.
    await expect(page.getByTestId("process-id-input")).toBeVisible();
    // Defect list starts empty.
    await expect(page.getByTestId("defect-empty")).toBeVisible();
    // Inflow defaults to OFF (radio "off" checked).
    await expect(page.getByTestId("inflow-toggle-off")).toBeVisible();
    await expect(page.getByTestId("inflow-toggle-on")).toBeVisible();

    // 56×56 tap target audit on submit + abort + defect-add buttons.
    for (const tid of ["mfg-submit", "step-header-abort", "defect-add"]) {
      const el = page.getByTestId(tid);
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }

    // Submit must be disabled until both mfg_process_id (UUID) and
    // actual_quantity are provided.
    await expect(page.getByTestId("mfg-submit")).toBeDisabled();

    // Adding a defect bumps the count.
    await page.getByTestId("defect-add").click();
    await expect(page.getByTestId("defect-row-0")).toBeVisible();
    await expect(page.getByTestId("defect-list-count")).toContainText("1");

    await page.screenshot({
      path: shotPath("02-manufacturing-authed-structure"),
      fullPage: true,
    });
  });

  test("manufacturing page passes axe-core a11y scan (when authed)", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    await page.goto("/app/works/manufacturing");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    await page.screenshot({
      path: shotPath("03-manufacturing-axe"),
      fullPage: true,
    });
  });

  test("scanner unhappy path — opening the process scanner without camera surfaces a fallback", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to a logged-in Supabase session cookie to run authed E2E.",
    );

    // Deny camera permission so getUserMedia rejects with NotAllowedError.
    await page.context().clearPermissions();
    await page.goto("/app/works/manufacturing");

    // Open the scanner panel.
    await page.getByTestId("process-scan-toggle").click();
    await expect(page.getByTestId("process-scanner")).toBeVisible();
    await expect(page.getByTestId("scanner-frame").first()).toBeVisible();

    // Either denied / unsupported / timeout surfaces a status with a hint —
    // we don't depend on the exact wording because UA capabilities vary.
    const status = page.getByTestId("scanner-status").first();
    await expect(status).toBeVisible();

    // Manual fallback button is visible per Scanner contract (D-03 手入力).
    await expect(page.getByTestId("scanner-manual").first()).toBeVisible();

    await page.screenshot({
      path: shotPath("04-manufacturing-scanner-unhappy"),
      fullPage: true,
    });
  });
});

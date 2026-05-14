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
 * Phase 5d — /app/correct/* correction UI E2E (architect §3.5 + dispatch
 * SCOPE bullet 1). Worker route — middleware does NOT redirect /app/correct/*
 * to /app/logi (dispatch SCOPE: "worker 到達可"). Authenticated CRUD requires
 * a real session cookie (E2E_LOGI_AUTH_COOKIE); without it, the structural
 * specs still execute the unauth-redirect contract.
 */

const CORRECT_ROUTES = [
  { path: "/app/correct", testid: "correct-card-movements", screenshotKey: "00-correct-index" },
  {
    path: "/app/correct/movements",
    testid: "movements-corrections",
    screenshotKey: "01-correct-movements",
  },
  {
    path: "/app/correct/inventory",
    testid: "inventory-corrections",
    screenshotKey: "02-correct-inventory",
  },
  {
    path: "/app/correct/manufacturing",
    testid: "manufacturing-corrections",
    screenshotKey: "03-correct-manufacturing",
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

test.describe("Phase 5d correction UI", () => {
  for (const route of CORRECT_ROUTES) {
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

  test("authed correction index renders three business cards", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (worker / tenant_admin session) to run authed correction E2E.",
    );
    await page.goto("/app/correct");
    await expect(page.getByTestId("correct-card-movements")).toBeVisible();
    await expect(page.getByTestId("correct-card-inventory")).toBeVisible();
    await expect(page.getByTestId("correct-card-manufacturing")).toBeVisible();
    await page.screenshot({
      path: shotPath("00-correct-index-authed"),
      fullPage: true,
    });
  });

  for (const route of CORRECT_ROUTES) {
    test(`authed structure — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE to run authed correction E2E.",
      );
      await page.goto(route.path);
      // index page uses the card testid, sub-pages use the list container testid.
      await expect(page.getByTestId(route.testid)).toBeVisible();

      // Touch target check for any back-to-index link present.
      const back = page.getByTestId("correct-back-to-index");
      if (await back.count()) {
        const box = await back.first().boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      }
    });

    test(`axe a11y — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE to run authed correction E2E.",
      );
      await page.goto(route.path);
      const violations = await axeScan(page);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }

  test("worker is NOT redirected from /app/correct/* (middleware allows worker)", async ({ page }) => {
    test.skip(
      !process.env.E2E_WORKER_AUTH_COOKIE,
      "Set E2E_WORKER_AUTH_COOKIE (worker session) to verify worker access to /app/correct/*.",
    );
    const res = await page.goto("/app/correct");
    expect(res?.url()).toContain("/app/correct");
    expect(res?.url()).not.toContain("/login");
    expect(res?.url()).not.toContain("/app/logi");
  });

  test("manufacturing rollback-inflow checkbox toggles danger confirm dialog", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE to exercise the manufacturing correction confirm step.",
    );
    await page.goto("/app/correct/manufacturing");
    // Wait until the manufacturing list (or empty state) is mounted; without a
    // record we cannot open a form. Skip rest of the assertion if no rows.
    await expect(page.getByTestId("manufacturing-corrections")).toBeVisible();
    const firstRow = page
      .locator('[data-testid^="manufacturing-correct-"]')
      .first();
    if (!(await firstRow.count())) {
      test.skip(true, "No manufacturing rows under this user; cannot exercise confirm.");
    }
    await firstRow.click();
    await expect(page.getByTestId("manufacturing-correction-form")).toBeVisible();
    // Default: rollback_inflow is OFF.
    const rollback = page.getByTestId("manufacturing-correction-rollback-inflow");
    await expect(rollback).not.toBeChecked();
    await rollback.check();
    await page
      .getByTestId("manufacturing-correction-reason")
      .fill("自動テスト訂正");
    await page.getByTestId("manufacturing-correction-submit").click();
    // Confirm dialog title flips to the rollback wording when rollback is on.
    await expect(
      page.getByText(/製造入庫を取り消して訂正しますか/),
    ).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: shotPath("04-manufacturing-rollback-confirm"),
      fullPage: true,
    });
  });
});

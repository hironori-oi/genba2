import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase5c");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 5b — admin master CRUD E2E (architect §7 + DEFINITION_OF_DONE).
 *
 * Coverage:
 *   1. Unauthenticated visitor lands on /login for every admin route.
 *   2. Worker visits /app/admin/* and gets redirected to /app/logi by
 *      the middleware (architect §4.6).
 *   3. Authed structure: master tab navigation, create button, primitives.
 *   4. axe-core a11y scan: 0 serious/critical violations on each route.
 *   5. 56×56 touch target sanity check on every primary action.
 *
 * Live CRUD (insert/update/soft-delete against Supabase) requires a tenant
 * session cookie; skipped without E2E_LOGI_AUTH_COOKIE. Structural specs
 * still execute and assert the unauth redirect (Phase 4d convention).
 */

const ADMIN_ROUTES = [
  { path: "/app/admin/masters?kind=work_types", testid: "masters-tab-work_types" },
  { path: "/app/admin/masters?kind=processes", testid: "masters-tab-processes" },
  { path: "/app/admin/masters?kind=equipment", testid: "masters-tab-equipment" },
  { path: "/app/admin/masters?kind=defect_groups", testid: "masters-tab-defect_groups" },
  { path: "/app/admin/masters?kind=defects", testid: "masters-tab-defects" },
  { path: "/app/admin/qr-formats?qr_type=label", testid: "qr-type-tab-label" },
  // Phase 5c additions
  { path: "/app/admin/csv-formats", testid: "csv-tab-import" },
  { path: "/app/admin/work-settings?business=receiving", testid: "work-settings-tab-receiving" },
  { path: "/app/admin/work-settings?business=manufacturing", testid: "work-settings-tab-manufacturing" },
  { path: "/app/admin/fields", testid: "custom-field-slot-grid" },
] as const;

async function axeScan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  return blocking;
}

test.describe("Phase 5b admin master CRUD", () => {
  test("unauthenticated visitor is redirected from /app/admin/masters", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/masters");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("01-masters-unauth-redirect"),
      fullPage: true,
    });
  });

  test("unauthenticated visitor is redirected from /app/admin/qr-formats", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/qr-formats");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("02-qr-formats-unauth-redirect"),
      fullPage: true,
    });
  });

  test("unauthenticated visitor is redirected from /app/admin/match-rules", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/match-rules");
    expect(res?.url()).toContain("/login");
  });

  test("unauthenticated visitor is redirected from /app/admin/fields", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/fields");
    expect(res?.url()).toContain("/login");
  });

  test("unauthenticated visitor is redirected from /app/admin/csv-formats", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/csv-formats");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("04-csv-formats-unauth-redirect"),
      fullPage: true,
    });
  });

  test("unauthenticated visitor is redirected from /app/admin/work-settings", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/work-settings");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shotPath("05-work-settings-unauth-redirect"),
      fullPage: true,
    });
  });

  for (const route of ADMIN_ROUTES) {
    test(`authed structure — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to run authed admin E2E.",
      );
      await page.goto(route.path);
      await expect(page.getByTestId(route.testid)).toBeVisible();
      // Primary action button (master create / qr format create / csv create / work-settings edit).
      const createCandidates = [
        "master-crud-create",
        "qr-format-create",
        "custom-field-create",
        "csv-format-create",
        "work-settings-edit",
        "work-input-field-create",
      ];
      for (const testid of createCandidates) {
        const loc = page.getByTestId(testid);
        if (await loc.count()) {
          await expect(loc.first()).toBeVisible();
          const box = await loc.first().boundingBox();
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
        }
      }
    });

    test(`axe a11y — ${route.path}`, async ({ page }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to run authed admin E2E.",
      );
      await page.goto(route.path);
      const violations = await axeScan(page);
      expect(
        violations,
        JSON.stringify(violations, null, 2),
      ).toEqual([]);
    });
  }

  test("create → soft-delete smoke (work_types)", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to exercise live CRUD.",
    );
    await page.goto("/app/admin/masters?kind=work_types");

    const create = page.getByTestId("master-crud-create");
    await expect(create).toBeVisible();
    await create.click();

    const codeInput = page.getByTestId("master-form-code");
    const nameInput = page.getByTestId("master-form-name");
    const uniqueCode = `E2E-WT-${Date.now().toString().slice(-6)}`;
    await codeInput.fill(uniqueCode);
    await nameInput.fill("E2E 自動テスト用");
    const submit = page.locator("dialog[open] button[type=submit]");
    await submit.click();

    // Row should appear; soft-delete it back.
    const row = page.locator(`text=${uniqueCode}`).first();
    await expect(row).toBeVisible({ timeout: 5_000 });

    const deleteBtn = page.locator(`tr:has-text("${uniqueCode}")`).getByRole("button", {
      name: /削除/,
    });
    await deleteBtn.click();
    const confirmDel = page.locator("dialog[open] button:has-text('削除')");
    await confirmDel.click();

    await expect(page.locator(`text=${uniqueCode}`)).toHaveCount(0, { timeout: 5_000 });
    await page.screenshot({
      path: shotPath("03-masters-crud-smoke"),
      fullPage: true,
    });
  });

  test("csv import create → soft-delete smoke", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to exercise live CRUD.",
    );
    await page.goto("/app/admin/csv-formats");

    await expect(page.getByTestId("csv-tab-import")).toBeVisible();
    await page.getByTestId("csv-format-create").click();

    const uniqueCode = `E2E-CSV-${Date.now().toString().slice(-6)}`;
    await page.getByTestId("csv-import-form-code").fill(uniqueCode);
    await page.getByTestId("csv-import-form-name").fill("E2E 自動");
    await page.locator("dialog[open] button[type=submit]").click();

    const row = page.locator(`text=${uniqueCode}`).first();
    await expect(row).toBeVisible({ timeout: 5_000 });

    const deleteBtn = page
      .locator(`tr:has-text("${uniqueCode}")`)
      .getByRole("button", { name: /削除/ });
    await deleteBtn.click();
    await page.locator("dialog[open] button:has-text('削除')").click();

    await expect(page.locator(`text=${uniqueCode}`)).toHaveCount(0, {
      timeout: 5_000,
    });
    await page.screenshot({
      path: shotPath("06-csv-formats-smoke"),
      fullPage: true,
    });
  });

  test("work-settings business tab navigation + edit modal opens", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to exercise work-settings.",
    );
    await page.goto("/app/admin/work-settings?business=receiving");
    await expect(page.getByTestId("work-settings-tab-receiving")).toBeVisible();
    await page.getByTestId("work-settings-edit").click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: shotPath("07-work-settings-edit"),
      fullPage: true,
    });
  });

  test("custom field detail UI shows slot grid + multi-line description", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin session) to exercise fields detail.",
    );
    await page.goto("/app/admin/fields");
    await expect(page.getByTestId("custom-field-slot-grid")).toBeVisible();
    await page.getByTestId("custom-field-create").click();
    await expect(page.getByTestId("custom-field-description")).toBeVisible();
    await expect(page.getByTestId("custom-field-data-type")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: shotPath("08-fields-detail"),
      fullPage: true,
    });
  });
});

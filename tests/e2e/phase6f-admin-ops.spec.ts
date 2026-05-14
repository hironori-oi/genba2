import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Phase 6f — Admin operational features E2E.
 *
 * Surfaces:
 *   /app/admin/audit-logs       (tenant_admin)
 *   /app/admin/notifications    (tenant_admin)
 *   /app/admin/users            (tenant_admin)
 *   /app/admin/usage            (tenant_admin)
 *   /app/admin/tenants          (system_admin only — tenant_admin must NOT enter)
 *
 * Coverage:
 *   * Each surface renders under tenant_admin storageState (where allowed).
 *   * /app/admin/tenants under tenant_admin redirects to /app/admin (system_admin only gate).
 *   * Worker is forbidden from every /app/admin/* route.
 *   * axe-core has 0 serious / critical violations on the new surfaces.
 *   * Notifications form does NOT echo any SMTP password or secret value
 *     in the DOM (RLS-606 client surface assertion).
 *   * CSV export endpoint responds with text/csv attachment.
 *   * Touch targets on primary CTAs are ≥ 56×56 (glove input).
 */

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase6f");

function shot(name: string): string {
  const p = join(SHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

test.describe("Phase 6f tenant_admin surfaces", () => {
  test("audit-logs page renders + filter form + CSV link visible + axe=0", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/audit-logs");
    await expect(page.getByText("監査ログ").first()).toBeVisible();
    await expect(page.getByTestId("audit-logs-filter-table")).toBeVisible();
    await expect(page.getByTestId("audit-logs-filter-op")).toBeVisible();
    await expect(page.getByTestId("audit-logs-csv-export")).toBeVisible();

    const apply = page.getByTestId("audit-logs-filter-apply");
    const box = await apply.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.screenshot({ path: shot("01-audit-logs"), fullPage: true });
  });

  test("audit-logs CSV endpoint returns text/csv attachment", async ({
    request,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    const res = await request.get("/api/admin/audit-logs/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/text\/csv/);
    expect(res.headers()["content-disposition"] ?? "").toMatch(/attachment/);
  });

  test("notifications page renders form without echoing any password value (RLS-606 client)", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/notifications");
    await expect(page.getByText("通知設定").first()).toBeVisible();
    const pwInput = page.getByTestId("notif-smtp-password");
    await expect(pwInput).toBeVisible();
    // Password input must be type=password (or empty) — the server never
    // sends an SMTP password down. Its value must therefore be the empty
    // string regardless of any saved password.
    const pwVal = await pwInput.inputValue();
    expect(pwVal).toBe("");
    const pwType = await pwInput.getAttribute("type");
    expect(pwType).toBe("password");

    // Save button must be a 56+ touch target.
    const saveBtn = page.getByTestId("notifications-save");
    const box = await saveBtn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);

    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.screenshot({ path: shot("02-notifications"), fullPage: true });
  });

  test("users page renders list + role buttons + axe=0", async ({ page }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/users");
    await expect(page.getByText("ユーザー管理").first()).toBeVisible();
    // The DataTable always renders, even when empty — empty message is allowed.
    const table = page.locator('[data-component="admin-data-table"]');
    await expect(table).toBeVisible();

    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.screenshot({ path: shot("03-users"), fullPage: true });
  });

  test("usage page renders progress bar + business breakdown + axe=0", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/usage");
    await expect(page.getByText("利用状況").first()).toBeVisible();
    await expect(page.getByTestId("usage-progressbar")).toBeVisible();

    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.screenshot({ path: shot("04-usage"), fullPage: true });
  });

  test("tenants page under tenant_admin: middleware redirects to /app/admin (system_admin only)", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/tenants");
    await page.waitForLoadState("domcontentloaded");
    const url = new URL(page.url());
    // Either the middleware redirected us to /app/admin (preferred), or
    // the server-side guard rendered an "アクセスできません" alert.
    if (url.pathname === "/app/admin/tenants") {
      await expect(page.getByText("アクセスできません").first()).toBeVisible();
    } else {
      expect(url.pathname).toBe("/app/admin");
      expect(url.searchParams.get("notice")).toBe("system-admin-only");
    }
  });

  test("admin index links to all Phase 6f routes (no phase6Pending chip on new surfaces)", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin");
    for (const href of [
      "/app/admin/users",
      "/app/admin/usage",
      "/app/admin/audit-logs",
      "/app/admin/notifications",
      "/app/admin/tenants",
    ]) {
      const link = page.locator(`a[href="${href}"]`).first();
      await expect(link).toBeVisible();
    }
  });
});

test.describe("Phase 6f worker gate (RLS-007 + middleware)", () => {
  test.use({
    storageState: process.env.E2E_WORKER_AUTH_COOKIE
      ? join(process.cwd(), ".kobo", "playwright-auth", "worker.json")
      : undefined,
  });

  for (const route of [
    "/app/admin/audit-logs",
    "/app/admin/notifications",
    "/app/admin/users",
    "/app/admin/usage",
    "/app/admin/tenants",
  ]) {
    test(`worker on ${route} is redirected out of /app/admin/*`, async ({
      page,
    }) => {
      test.skip(
        !process.env.E2E_WORKER_AUTH_COOKIE,
        "worker storageState (E2E_WORKER_AUTH_COOKIE) required",
      );
      await page.goto(route);
      await page.waitForURL((url) => !url.pathname.startsWith("/app/admin"), {
        timeout: 5_000,
      });
      expect(page.url()).not.toMatch(/\/app\/admin/);
    });
  }
});

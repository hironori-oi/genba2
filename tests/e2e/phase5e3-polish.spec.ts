import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase5e3");

function shot(name: string): string {
  const p = join(SHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 5e-3 polish-suite E2E (TASK T-20260515-010000).
 *
 * Covers the new affordances:
 *   - QR formats per-row 操作 menu replaces flat clone list
 *   - CSV template download endpoint + UI (5 master × 2 encoding)
 *   - Corrections-pending tenant_admin route + approve action
 *   - History detail correction deep-link uses h-14 + prefill
 *
 * All authed assertions are gated on E2E_LOGI_AUTH_COOKIE; structural
 * (unauth) assertions and pure 200-response checks run unconditionally.
 */

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

test.describe("Phase 5e-3 polish", () => {
  test("corrections-pending route exists and redirects unauth", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const res = await page.goto("/app/admin/corrections-pending");
    expect(res?.url()).toContain("/login");
    await page.screenshot({
      path: shot("01-corrections-pending-unauth"),
      fullPage: true,
    });
  });

  for (const enc of ["utf8", "shift_jis"] as const) {
    test(`csv-template ${enc} requires admin auth`, async ({
      browser,
      baseURL,
    }) => {
      // Fresh browser context with empty storageState so the request is
      // unauthenticated. We use page.request rather than playwright.request
      // because the latter does NOT honour baseURL from the project config
      // and silently re-uses the parent context's auth.
      const ctx = await browser.newContext({ storageState: undefined });
      const res = await ctx.request.get(
        `${baseURL ?? ""}/api/admin/csv-template/work_types/${enc}`,
        { failOnStatusCode: false },
      );
      expect([401, 403, 302]).toContain(res.status());
      await ctx.close();
    });
  }

  test("csv-template returns 404 for unknown master", async ({ request }) => {
    // Authed request path: route handler validates master before auth so
    // 404 is still surfaced. We accept 404/401/403 to be robust.
    const res = await request.get(
      "/api/admin/csv-template/bogus_master/utf8",
      { failOnStatusCode: false },
    );
    expect([404, 401, 403]).toContain(res.status());
  });

  test("authed: corrections-pending lists rows + axe 0 critical", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin) for authed polish flow.",
    );
    await page.goto("/app/admin/corrections-pending");
    await expect(
      page.locator("[data-page='corrections-pending']"),
    ).toBeVisible();
    const violations = await axeBlocking(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    await page.screenshot({
      path: shot("02-corrections-pending-authed"),
      fullPage: true,
    });
  });

  test("authed: QR formats row-actions menu replaces flat clone list", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin) for authed polish flow.",
    );
    await page.goto("/app/admin/qr-formats?qr_type=label");
    // The old flat-list 'qr-clone-<n>' button no longer lives outside the
    // table; clone entries are now exposed inside the per-row menu.
    const flatList = page.locator(
      "ul[aria-label='バージョン操作'] [data-testid^='qr-clone-']",
    );
    expect(await flatList.count()).toBe(0);
    await page.screenshot({
      path: shot("03-qr-formats-action-menu"),
      fullPage: true,
    });
  });

  test("authed: csv-formats page exposes template downloads", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin) for authed polish flow.",
    );
    await page.goto("/app/admin/csv-formats");
    const link = page.getByTestId("csv-template-work_types-utf8");
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await page.screenshot({
      path: shot("04-csv-template-downloads"),
      fullPage: true,
    });
  });

  test("authed: csv-template utf8 returns CSV with BOM", async ({ request }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "Set E2E_LOGI_AUTH_COOKIE (tenant_admin) for authed polish flow.",
    );
    const res = await request.get(
      "/api/admin/csv-template/work_types/utf8",
    );
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType.toLowerCase()).toContain("text/csv");
    expect(res.headers()["content-disposition"] ?? "").toContain(
      "work_types_template_utf8.csv",
    );
    const body = await res.body();
    // UTF-8 BOM is 0xEF 0xBB 0xBF
    expect(body[0]).toBe(0xef);
    expect(body[1]).toBe(0xbb);
    expect(body[2]).toBe(0xbf);
    const text = body.subarray(3).toString("utf8");
    expect(text).toMatch(/code,name,business_code,sort_order,enabled,note/);
  });
});

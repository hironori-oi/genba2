import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Phase 6d — 報告書 / 集計ダッシュボード (daily/weekly/monthly) E2E.
 *
 * Verifies the dashboard added by TASK T-20260515-090000:
 *
 *   /app/admin/reports?tab=daily
 *   /app/admin/reports?tab=weekly
 *   /app/admin/reports?tab=monthly
 *   /api/reports/{daily,weekly,monthly}/csv
 *
 * Coverage:
 *   - All 3 tabs render under tenant_admin storageState with charts.
 *   - Tab nav targets are ≥ 56×56 (glove input).
 *   - axe-core has 0 serious / critical violations on each tab.
 *   - CSV download responds with text/csv + content-disposition attachment.
 *   - tenant_admin gate works (architect route /app/reports/daily redirects
 *     into /app/admin/reports).
 *   - Worker is redirected away from /app/admin/reports (admin layout
 *     forwards them to /app?notice=admin-forbidden).
 */

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase6d");

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

const TABS = [
  { kind: "daily", label: "日次", paneTestId: "report-pane-daily" },
  { kind: "weekly", label: "週次", paneTestId: "report-pane-weekly" },
  { kind: "monthly", label: "月次", paneTestId: "report-pane-monthly" },
] as const;

test.describe("Phase 6d 報告書ダッシュボード", () => {
  for (const t of TABS) {
    test(`/app/admin/reports?tab=${t.kind} renders with chart + 56x56 + axe=0`, async ({
      page,
    }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
      );
      await page.goto(`/app/admin/reports?tab=${t.kind}`);
      await expect(page.getByTestId("reports-dashboard")).toBeVisible();
      await expect(page.getByTestId(t.paneTestId)).toBeVisible();

      // Active tab indicator (aria-current="page").
      const activeTab = page.getByTestId(`report-tab-${t.kind}`);
      await expect(activeTab).toHaveAttribute("aria-current", "page");

      // Touch targets: every tab link + CSV link ≥ 56×56.
      for (const tid of [
        "report-tab-daily",
        "report-tab-weekly",
        "report-tab-monthly",
        `report-csv-${t.kind}`,
      ]) {
        const el = page.getByTestId(tid);
        await expect(el).toBeVisible();
        const box = await el.boundingBox();
        expect(
          box?.height ?? 0,
          `${tid} height must be ≥ 56 for glove input`,
        ).toBeGreaterThanOrEqual(56);
        expect(
          box?.width ?? 0,
          `${tid} width must be ≥ 56 for glove input`,
        ).toBeGreaterThanOrEqual(56);
      }

      // Chart presence — at least one chart container with role=img.
      const charts = page.locator('[data-testid^="report-chart-"]');
      await expect(charts.first()).toBeVisible();
      const chartCount = await charts.count();
      expect(chartCount, "at least one chart per tab").toBeGreaterThan(0);

      // axe-core a11y (serious / critical only).
      const blocking = await axeBlocking(page);
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

      await page.screenshot({ path: shot(`01-${t.kind}`), fullPage: true });
    });
  }

  test("CSV endpoint returns text/csv attachment for each kind", async ({
    request,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    for (const t of TABS) {
      const res = await request.get(`/api/reports/${t.kind}/csv`);
      expect(res.status(), `csv ${t.kind}`).toBe(200);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct).toMatch(/text\/csv/);
      const cd = res.headers()["content-disposition"] ?? "";
      expect(cd).toMatch(/attachment/);
      expect(cd).toMatch(new RegExp(`genba-report-${t.kind}-`));
      const body = await res.text();
      // BOM + at least one header line.
      expect(body.length).toBeGreaterThan(8);
    }
  });

  test("invalid CSV kind returns 400 validation", async ({ request }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    const res = await request.get(`/api/reports/yearly/csv`);
    expect(res.status()).toBe(400);
  });

  test("/app/reports/{kind} architect-compat routes redirect into /app/admin/reports", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    for (const t of TABS) {
      await page.goto(`/app/reports/${t.kind}`);
      await expect(page).toHaveURL(new RegExp(`/app/admin/reports\\?tab=${t.kind}`));
      await expect(page.getByTestId(t.paneTestId)).toBeVisible();
    }
  });
});

test.describe("Phase 6d worker gate", () => {
  test.use({
    storageState: process.env.E2E_WORKER_AUTH_COOKIE
      ? join(process.cwd(), ".kobo", "playwright-auth", "worker.json")
      : undefined,
  });

  test("worker is redirected away from /app/admin/reports", async ({ page }) => {
    test.skip(
      !process.env.E2E_WORKER_AUTH_COOKIE,
      "worker storageState (E2E_WORKER_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin/reports");
    // Admin layout pushes workers to /app?notice=admin-forbidden; the
    // /app router then forwards workers to /app/logi by default. Either
    // is a valid "not allowed in admin" outcome — the only requirement
    // is that the worker never lands on /app/admin/*.
    await page.waitForURL((url) => !url.pathname.startsWith("/app/admin"), {
      timeout: 5_000,
    });
    expect(page.url()).not.toMatch(/\/app\/admin/);
  });
});

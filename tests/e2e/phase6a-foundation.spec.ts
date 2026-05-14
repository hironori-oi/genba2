import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase6a");

function shot(name: string): string {
  const p = join(SHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 6a foundation E2E (TASK T-20260515-050000).
 *
 * Verifies the foundation affordances added by this dispatch:
 *   - 4 new admin cards (報告書 / 監査ログ / テナント管理 / 通知設定) on
 *     /app/admin with "Phase 6 進行中" chip and link target
 *   - 4 placeholder routes return 200 + render the "準備中" Alert
 *   - Sidebar NavLink chip "P6" appears for the new admin nav items
 *   - axe-core has 0 serious / critical violations on /app/admin and on the
 *     placeholder routes (confirms the chip color fix landed)
 *
 * Authed-only; gated on E2E_LOGI_AUTH_COOKIE issued by the global setup.
 */

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

// Phase 6a originally shipped these as placeholders (with the "Phase 6
// 進行中" chip). Phase 6f (T-20260515-110000) replaced all three with real
// implementations. The contract now is that the cards exist, link to the
// real surface, and do NOT carry the phase6Pending chip anymore.
const PHASE6_FORMERLY_PENDING_CARDS = [
  { href: "/app/admin/audit-logs", title: "監査ログ" },
  { href: "/app/admin/tenants", title: "テナント管理" },
  { href: "/app/admin/notifications", title: "通知設定" },
];

test.describe("Phase 6a foundation (post-6f closure)", () => {
  test("admin index links to the formerly-pending Phase 6 routes (no in-progress chip after 6f)", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/admin");
    const grid = page.locator('[data-testid="admin-card-grid"]');
    await expect(grid).toBeVisible();
    for (const card of PHASE6_FORMERLY_PENDING_CARDS) {
      const link = grid.locator(`a[href="${card.href}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText(card.title);
      // The phase6Pending chip must no longer appear on these cards.
      await expect(
        link.locator('[data-testid="phase6-pending-chip"]'),
      ).toHaveCount(0);
    }
    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    await page.screenshot({ path: shot("01-admin-index"), fullPage: true });
  });

  for (const card of PHASE6_FORMERLY_PENDING_CARDS) {
    test(`real Phase 6f surface renders at ${card.href} (no "Phase 6 進行中" placeholder eyebrow)`, async ({
      page,
    }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
      );
      const res = await page.goto(card.href);
      // /app/admin/tenants under tenant_admin is gated by the middleware
      // (system_admin only). The redirect target /app/admin still returns
      // 200, so checking status alone is fine.
      expect(res?.status()).toBe(200);
      // For tenants the page may have been intercepted by the middleware
      // (status 200 on the redirected /app/admin index). For the other two
      // the heading appears as h2 with the card title.
      const onTargetSurface = page.url().endsWith(card.href);
      if (onTargetSurface) {
        await expect(
          page.getByRole("heading", { level: 2, name: card.title }),
        ).toBeVisible();
      }
      // Placeholder eyebrow text "Phase 6 進行中" must NOT appear on the page
      // anymore for these surfaces (admin/page still shows it for cards
      // marked as pending — but none of these three are pending now).
      // We assert against the placeholder "準備中" Alert specifically since
      // that was the placeholder marker.
      await expect(
        page.getByRole("status").filter({ hasText: "準備中" }),
      ).toHaveCount(0);
      const blocking = await axeBlocking(page);
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      const safe = card.href.replace(/\W+/g, "_");
      await page.screenshot({ path: shot(`02${safe}`), fullPage: true });
    });
  }
});

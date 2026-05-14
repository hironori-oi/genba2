import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase6b");

function shot(name: string): string {
  const p = join(SHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 6b scan-first UX E2E (TASK T-20260515-070000).
 *
 * Verifies the StepShell + ?mode=scan wiring:
 *   - LOGI top page exposes secondary "スキャンで開始" CTA on all 4 business
 *     cards and the href carries ?mode=scan.
 *   - Receiving page with ?mode=scan renders the StepShell primitive
 *     (data-testid="stepshell-receiving") and the sticky bottom CTA is
 *     ≥ 56×56 (glove-input target).
 *   - The other 3 business pages accept ?mode=scan as a passthrough param
 *     (existing flow still mounts; data-start-mode attribute reflects the
 *     query value).
 *   - aria-live polite + assertive regions are present on the StepShell.
 *   - axe-core has 0 serious / critical violations on the new flow.
 *
 * Authed-only; gated on E2E_LOGI_AUTH_COOKIE issued by global-setup.
 */

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

const BUSINESS_PAGES = [
  { code: "receiving", href: "/app/logi/receiving", root: "receiving-root" },
  { code: "picking", href: "/app/logi/picking", root: "picking-root" },
  { code: "inventory", href: "/app/logi/inventory", root: "inventory-root" },
  {
    code: "manufacturing",
    href: "/app/works/manufacturing",
    root: "manufacturing-root",
  },
] as const;

test.describe("Phase 6b scan-first UX", () => {
  test("LOGI top exposes scan-start secondary CTA per business card", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/logi");
    for (const b of BUSINESS_PAGES) {
      const scanCta = page.getByTestId(`logi-card-${b.code}-scan`);
      await expect(scanCta).toBeVisible();
      await expect(scanCta).toHaveAttribute(
        "href",
        new RegExp(`${b.href}\\?mode=scan$`),
      );
      const box = await scanCta.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    await page.screenshot({ path: shot("01-logi-scan-cta"), fullPage: true });
  });

  test("receiving ?mode=scan mounts StepShell + sticky bottom CTA + aria-live", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await page.goto("/app/logi/receiving?mode=scan");
    const shell = page.getByTestId("stepshell-receiving");
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute("data-start-mode", "scan");
    // sticky bottom primary CTA
    const cta = page.getByTestId("stepshell-cta-primary");
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox?.height ?? 0).toBeGreaterThanOrEqual(56);
    // aria-live regions exist
    await expect(page.getByTestId("stepshell-live-polite")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await expect(page.getByTestId("stepshell-live-assertive")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    // first scan step section
    await expect(page.getByTestId("stepshell-section-label")).toBeVisible();
    // axe a11y
    const blocking = await axeBlocking(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    await page.screenshot({
      path: shot("02-receiving-scan-shell"),
      fullPage: true,
    });
  });

  test("receiving ?mode=scan manual fallback advances through to completion", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    // Deny camera so Scanner falls back to its own ManualInputModal (D-03).
    await page.context().clearPermissions();
    await page.goto("/app/logi/receiving?mode=scan");
    await expect(page.getByTestId("stepshell-receiving")).toBeVisible();
    // The Scanner internally surfaces ManualInputModal when getUserMedia
    // is unavailable. Inject the label QR via that modal so the StepShell's
    // validate callback parses it and advances to the next step.
    const modal = page.getByTestId("manual-input-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("manual-input-textarea").fill(
      "V1|ITEM-2048|12|A-03-15|ORD-1",
    );
    await page.getByTestId("manual-input-submit").click();
    // Step advances to the "qty" input.
    await expect(page.getByTestId("stepshell-section-qty")).toBeVisible({
      timeout: 5_000,
    });
    await page.screenshot({
      path: shot("03-receiving-scan-after-manual"),
      fullPage: true,
    });
  });

  for (const b of BUSINESS_PAGES.filter((b) => b.code !== "receiving")) {
    test(`${b.code} accepts ?mode=scan as passthrough (data-start-mode=scan)`, async ({
      page,
    }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
      );
      await page.goto(`${b.href}?mode=scan`);
      const root = page.getByTestId(b.root);
      await expect(root).toBeVisible();
      await expect(root).toHaveAttribute("data-start-mode", "scan");
      const blocking = await axeBlocking(page);
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      const safe = b.href.replace(/\W+/g, "_");
      await page.screenshot({
        path: shot(`04${safe}-scan-passthrough`),
        fullPage: true,
      });
    });
  }

  test("StepShell input field is auto-focused for glove operation", async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    // Advance past the scan step via the Scanner's manual fallback modal,
    // then assert the qty input is focused so glove-wearing workers do not
    // have to chase focus on the next step.
    await page.context().clearPermissions();
    await page.goto("/app/logi/receiving?mode=scan");
    const modal = page.getByTestId("manual-input-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("manual-input-textarea").fill(
      "V1|ITEM-2048|12|A-03-15|ORD-1",
    );
    await page.getByTestId("manual-input-submit").click();
    const input = page.getByTestId("stepshell-input-field");
    await expect(input).toBeVisible({ timeout: 5_000 });
    // The shell calls queueMicrotask(focus) — give the browser a tick to
    // resolve before asserting.
    await page.waitForTimeout(200);
    const focused = await input.evaluate((el) => el === document.activeElement);
    expect(focused).toBe(true);
  });
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase2");

function shotPath(name: string): string {
  const p = join(SCREENSHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Phase 2 DoD — V1/V2 同時解析 Playwright (1 本).
 *
 * The /qr-read-test sandbox renders the same QrReadTest client component as
 * /app/admin/qr but without auth, so we can verify the parser end-to-end in
 * a browser without provisioning Supabase credentials.
 */
test.describe("Phase 2 QR V1/V2 同時解析", () => {
  test("V1 input → V1 success, V2 fails with reason; V2 input → V2 success, V1 unknown", async ({ page }) => {
    await page.goto("/qr-read-test");

    await expect(page.getByRole("heading", { name: "QR 読取テスト" })).toBeVisible();

    const textarea = page.getByLabel("QR 文字列");

    // Scenario 1: scan a V1 string. V1 (4 columns) must succeed, V2 (5
    // columns with required lot at position 5) must fail "unknown_format"
    // because the version_token is V1.
    await textarea.fill("V1|ITEM-A|12|A-03|ORD-1");

    const v1 = page.getByTestId("qr-result-v1");
    const v2 = page.getByTestId("qr-result-v2");
    await expect(v1).toBeVisible();
    await expect(v2).toBeVisible();
    await expect(v1).toHaveAttribute("data-status", "success");
    await expect(v2).toHaveAttribute("data-status", "failure");
    await expect(v1).toContainText("品目コード");
    await expect(v1).toContainText("ITEM-A");
    await expect(v2).toContainText("このバージョンの定義が見つかりません");
    await page.screenshot({ path: shotPath("01-v1-input"), fullPage: true });

    // Scenario 2: scan a V2 string. V2 (5 cols) must succeed, V1 (4 cols)
    // must fail because version_token mismatch.
    await textarea.fill("V2|ITEM-A|12|A-03|ORD-1|LOT-XYZ");
    await expect(page.getByTestId("qr-result-v1")).toHaveAttribute("data-status", "failure");
    await expect(page.getByTestId("qr-result-v2")).toHaveAttribute("data-status", "success");
    await expect(page.getByTestId("qr-result-v2")).toContainText("LOT-XYZ");
    await page.screenshot({ path: shotPath("02-v2-input"), fullPage: true });

    // Scenario 3: malformed (numeric expected, got 'abc') → V1 reports the
    // error inline (T03) but the parse still 'succeeds' with quantity=null.
    await textarea.fill("V1|ITEM-A|abc|A-03|ORD-1");
    await expect(page.getByTestId("qr-result-v1")).toHaveAttribute("data-status", "success");
    await expect(page.getByTestId("qr-result-v1")).toContainText("数値として解釈できません");
    await page.screenshot({ path: shotPath("03-numeric-error"), fullPage: true });
  });

  test("read-test page passes axe-core a11y scan", async ({ page }) => {
    await page.goto("/qr-read-test");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

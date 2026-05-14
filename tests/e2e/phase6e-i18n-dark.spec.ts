import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Phase 6e — i18n + dark mode E2E (TASK T-20260515-100000).
 *
 * Covers ADR-P6-06 §B.4 + §B.5 DoD: 4 modes (ja-light / ja-dark / en-light /
 * en-dark) × axe-core contrast = 0 against authed app routes. Verifies:
 *   1. <html lang> reflects the user_metadata locale (cookie-mirrored)
 *   2. <html data-theme> reflects the manual theme (omitted only for "auto")
 *   3. AppShell + dashboard render localised strings — no JA leakage in EN
 *   4. axe-core flags zero serious / critical violations per mode × route
 *
 * The locale + theme cookies are seeded directly so the test does not depend
 * on the live preferences action mutating Supabase auth data; the runtime
 * still exercises the same getRequestConfig + globals.css cascade.
 */

const SHOT_DIR = join(process.cwd(), ".kobo", "screenshots", "phase6e");
const APP_ROUTES = ["/app", "/app/admin", "/app/account/preferences"] as const;

function shot(name: string): string {
  const p = join(SHOT_DIR, `${name}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

async function seedPreferenceCookies(
  context: BrowserContext,
  baseURL: string,
  locale: "ja" | "en",
  theme: "light" | "dark" | "auto",
): Promise<void> {
  const url = new URL(baseURL);
  const domain = url.hostname;
  await context.addCookies([
    {
      name: "genba_locale",
      value: locale,
      domain,
      path: "/",
      sameSite: "Lax",
      httpOnly: false,
      secure: false,
    },
    {
      name: "genba_theme",
      value: theme,
      domain,
      path: "/",
      sameSite: "Lax",
      httpOnly: false,
      secure: false,
    },
  ]);
}

async function axeBlocking(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

const MODES = [
  { locale: "ja", theme: "light" },
  { locale: "ja", theme: "dark" },
  { locale: "en", theme: "light" },
  { locale: "en", theme: "dark" },
] as const;

test.describe("Phase 6e — i18n + dark mode (4 modes)", () => {
  for (const mode of MODES) {
    test(`${mode.locale}-${mode.theme}: <html> attributes + axe + contrast`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(
        !process.env.E2E_LOGI_AUTH_COOKIE,
        "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
      );
      await seedPreferenceCookies(context, baseURL!, mode.locale, mode.theme);

      for (const route of APP_ROUTES) {
        await page.goto(route);
        const lang = await page.locator("html").getAttribute("lang");
        expect(lang).toBe(mode.locale);
        const dataTheme = await page.locator("html").getAttribute("data-theme");
        expect(dataTheme).toBe(mode.theme);

        // Skip-to-content link verifies the locale-driven message catalog
        // is loaded into the root layout.
        const skip = await page.locator("a[href='#main']").innerText();
        if (mode.locale === "ja") {
          expect(skip).toContain("メインコンテンツ");
        } else {
          expect(skip.toLowerCase()).toContain("skip to main");
        }

        // axe-core's color-contrast rule (wcag2aa, wcag143) computes the
        // 4.5:1 threshold against actual rendered colors (handles oklch
        // tokens). A non-empty `blocking` array therefore captures any
        // foreground/background pair below 4.5:1 across the entire route.
        const blocking = await axeBlocking(page);
        expect(
          blocking,
          JSON.stringify(blocking, null, 2),
        ).toEqual([]);

        const safe = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
        await page.screenshot({
          path: shot(`${mode.locale}-${mode.theme}-${safe}`),
          fullPage: true,
        });
      }
    });
  }

  test("English mode replaces JA nav labels — no Japanese leakage", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await seedPreferenceCookies(context, baseURL!, "en", "light");
    await page.goto("/app");
    // Sidebar nav uses `nav` namespace; ja-only words like 入庫 / ピッキング /
    // 棚卸 must not leak. (Single-character badge glyphs 入/ピ/棚 are aria-
    // hidden decorations and are still allowed.)
    const navHtml = await page.locator("aside[aria-label]").innerHTML();
    expect(navHtml).toContain("Receiving");
    expect(navHtml).toContain("Picking");
    expect(navHtml).toContain("Inventory");
    // The label spans are flex-1, so they include the full word — assert that
    // these specific JA words do NOT appear inside any visible label span.
    const visibleNavText = await page
      .locator("aside[aria-label] span.flex-1")
      .allInnerTexts();
    const joined = visibleNavText.join(" ");
    expect(joined).not.toMatch(/入庫|ピッキング|棚卸/);
  });

  test("Auto theme: <html data-theme> attribute is omitted", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(
      !process.env.E2E_LOGI_AUTH_COOKIE,
      "tenant_admin storageState (E2E_LOGI_AUTH_COOKIE) required",
    );
    await seedPreferenceCookies(context, baseURL!, "ja", "auto");
    await page.goto("/app");
    const dataTheme = await page.locator("html").getAttribute("data-theme");
    expect(dataTheme).toBeNull();
    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("ja");
  });
});

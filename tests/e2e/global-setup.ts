/**
 * Phase 5e Playwright global setup (dispatch T-20260514-220000 SCOPE A bullet 1).
 *
 * Seeds two synthetic users (tenant_admin + worker) under fresh tenants,
 * drives the real /login flow with Chromium, and persists the resulting
 * @supabase/ssr cookies as storageState JSON so authed specs can run.
 *
 * On success exports E2E_LOGI_AUTH_COOKIE / E2E_WORKER_AUTH_COOKIE = "1" so
 * the test bodies' `test.skip(!process.env.E2E_..._AUTH_COOKIE)` guard turns
 * into active execution. If any prerequisite is missing (Supabase env, dev
 * server unreachable), we leave the flags unset so the specs fall back to
 * the unauth-redirect contract instead of failing the whole suite.
 *
 * Live by default for Phase 5e dispatch; can be opted out by setting
 * SKIP_E2E_GLOBAL_SETUP=1.
 */

import { chromium, type FullConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adminClient,
  authStatePath,
  ensureAuthStateDir,
  provisionTenant,
  provisionUser,
  writePlaywrightCredentials,
  type AuthRole,
  type SeededUser,
} from "./fixtures/auth";

function detectBaseURL(config: FullConfig): string {
  const fromUse =
    (config.projects[0]?.use as { baseURL?: string } | undefined)?.baseURL ?? null;
  if (typeof fromUse === "string" && fromUse.length > 0) return fromUse;
  if (process.env.PLAYWRIGHT_BASE_URL) return process.env.PLAYWRIGHT_BASE_URL;
  const portFile = join(process.cwd(), ".kobo", "dev-port.json");
  if (existsSync(portFile)) {
    try {
      const json = JSON.parse(readFileSync(portFile, "utf8")) as { port?: number };
      if (typeof json.port === "number") return `http://127.0.0.1:${json.port}`;
    } catch {
      // fall through
    }
  }
  return "http://127.0.0.1:3100";
}

async function signInAndSaveState(
  baseURL: string,
  user: SeededUser,
  role: AuthRole,
): Promise<boolean> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const loginResp = await page.goto("/login");
    if (!loginResp || loginResp.status() >= 400) {
      console.error(`[phase5e-auth] /login unreachable for ${role}; baseURL=${baseURL}`);
      return false;
    }
    await page.locator("input[name=email]").fill(user.email);
    await page.locator("input[name=password]").fill(user.password);
    await Promise.all([
      page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 }),
      page.locator("button[type=submit]").click(),
    ]);
    await context.storageState({ path: authStatePath(role) });
    return true;
  } catch (e) {
    console.error(`[phase5e-auth] sign-in failed for ${role}:`, (e as Error).message);
    return false;
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.SKIP_E2E_GLOBAL_SETUP === "1") {
    console.log("[phase5e-auth] SKIP_E2E_GLOBAL_SETUP=1 → skipping auth fixture.");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    console.log(
      "[phase5e-auth] Supabase env missing → leaving authed E2E gated (no E2E_*_AUTH_COOKIE set).",
    );
    return;
  }
  const baseURL = detectBaseURL(config);
  ensureAuthStateDir();

  const admin = adminClient();
  let tenant_admin: SeededUser | null = null;
  let worker: SeededUser | null = null;
  let tenantId: string | null = null;

  try {
    tenantId = await provisionTenant(admin, "E2E5e tenant");
    tenant_admin = await provisionUser(admin, tenantId, "tenant_admin");
    worker = await provisionUser(admin, tenantId, "worker");
    writePlaywrightCredentials("tenant_admin", tenant_admin);
    writePlaywrightCredentials("worker", worker);
  } catch (e) {
    console.error("[phase5e-auth] user provisioning failed:", (e as Error).message);
    return;
  }

  const okAdmin = await signInAndSaveState(baseURL, tenant_admin, "tenant_admin");
  const okWorker = await signInAndSaveState(baseURL, worker, "worker");
  if (okAdmin) {
    process.env.E2E_LOGI_AUTH_COOKIE = "1";
  }
  if (okWorker) {
    process.env.E2E_WORKER_AUTH_COOKIE = "1";
  }
  console.log(
    `[phase5e-auth] tenant_admin auth: ${okAdmin ? "OK" : "FAIL"}, worker auth: ${okWorker ? "OK" : "FAIL"}, tenant=${tenantId}`,
  );
}

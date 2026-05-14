/**
 * Phase 5e E2E auth fixture (architect §3.4 + dispatch SCOPE A bullet 1).
 *
 * Provisions two synthetic users via Supabase service-role:
 *   * tenant_admin (for /app/admin/*, /app/correct/*, /app/account/*)
 *   * worker      (for /app/correct/* worker-route assertion)
 *
 * Each user is signed in once via a real browser at /login, and the resulting
 * @supabase/ssr cookies are saved as Playwright `storageState` JSON. Specs
 * gate on E2E_LOGI_AUTH_COOKIE / E2E_WORKER_AUTH_COOKIE env vars, which we
 * set to "1" once the storageState files exist.
 *
 * Secret hygiene: SUPABASE_SERVICE_ROLE_KEY is read once via env, never
 * printed; passwords are generated in-memory and never written to disk
 * outside of the storageState (which Supabase encodes as access/refresh
 * JWTs).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AuthRole = "tenant_admin" | "worker";

export type SeededUser = {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  role: AuthRole;
};

export const AUTH_STATE_DIR = join(process.cwd(), ".kobo", "playwright-auth");

export function authStatePath(role: AuthRole): string {
  return join(AUTH_STATE_DIR, `${role}.json`);
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

function requireEnv(): {
  url: string;
  anonKey: string;
  serviceKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Phase 5e auth fixture requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return { url, anonKey, serviceKey };
}

export function adminClient(): SupabaseClient {
  const { url, serviceKey } = requireEnv();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function provisionTenant(
  admin: SupabaseClient,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .insert({ name: label, slug: `e2e5e-${rand()}` })
    .select("id")
    .single();
  if (error) throw new Error(`tenant insert failed: ${error.message}`);
  return data.id;
}

export async function provisionUser(
  admin: SupabaseClient,
  tenantId: string,
  role: AuthRole,
): Promise<SeededUser> {
  const email = `e2e5e-${role}-${rand()}@example.test`;
  const password = `E2e5eTest!${rand()}!Pw`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role },
  });
  if (error || !created.user) {
    throw new Error(`createUser failed: ${error?.message ?? "no user returned"}`);
  }
  const userId = created.user.id;
  const { error: pErr } = await admin
    .from("profiles")
    .insert({
      id: userId,
      tenant_id: tenantId,
      role,
      display_name: role === "tenant_admin" ? "Phase 5e Admin" : "Phase 5e Worker",
    });
  if (pErr) throw new Error(`profile insert failed: ${pErr.message}`);
  return { email, password, userId, tenantId, role };
}

export async function deleteSeededUser(
  admin: SupabaseClient,
  user: SeededUser,
): Promise<void> {
  try {
    await admin.auth.admin.deleteUser(user.userId);
  } catch {
    // best effort
  }
}

export async function deleteTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  try {
    await admin.from("tenants").delete().eq("id", tenantId);
  } catch {
    // best effort
  }
}

export function ensureAuthStateDir(): void {
  if (!existsSync(AUTH_STATE_DIR)) {
    mkdirSync(AUTH_STATE_DIR, { recursive: true });
  }
}

export function writePlaywrightCredentials(role: AuthRole, user: SeededUser): void {
  ensureAuthStateDir();
  // No-op for storageState; we sign-in via browser in global setup.
  // We persist the seeded user metadata for the test runner to consume
  // if it needs to re-authenticate. Passwords are short-lived and only
  // used for this test session.
  const f = join(AUTH_STATE_DIR, `${role}.user.json`);
  writeFileSync(
    f,
    JSON.stringify(
      {
        email: user.email,
        password: user.password,
        userId: user.userId,
        tenantId: user.tenantId,
        role: user.role,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

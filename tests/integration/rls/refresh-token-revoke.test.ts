/**
 * Live refresh-token revoke verification (Phase 1 carry-over).
 *
 * AC-AUTH-01: when a user's role / tenant changes via the role-change RPC,
 * the existing refresh tokens are revoked so the *old* JWT cannot keep
 * operating with stale claims.
 *
 * This test:
 *   1. provisions a user with role=worker.
 *   2. signs them in (anon client) and captures the access + refresh tokens.
 *   3. invokes the admin role-change path (service_role) to upgrade the user
 *      to tenant_admin AND call signOut('global').
 *   4. asserts that the old refresh token can no longer obtain a new session.
 *
 * Skipped when env vars are missing. Same gate as rls-live.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && process.env.RUN_LIVE_RLS_TESTS === "1");

const describeLive = LIVE ? describe : describe.skip;

describeLive("Refresh-token revoke on role change", () => {
  let admin: SupabaseClient;
  let userId: string;
  let tenantId: string;
  let userEmail: string;
  let userPassword: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const slug = `revoke-${Math.random().toString(36).slice(2, 10)}`;
    const { data: t } = await admin
      .from("tenants")
      .insert({ name: "Revoke T", slug })
      .select("id")
      .single();
    if (!t) throw new Error("tenant insert failed");
    tenantId = t.id;
    userEmail = `revoke-${Math.random().toString(36).slice(2, 10)}@example.test`;
    userPassword = `RevokeTest!${Math.random().toString(36).slice(2, 10)}!`; // 10+
    const { data: u, error } = await admin.auth.admin.createUser({
      email: userEmail,
      password: userPassword,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: "worker" },
    });
    if (error || !u.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = u.user.id;
    await admin
      .from("profiles")
      .insert({ id: userId, tenant_id: tenantId, role: "worker", display_name: "revoke" });
  }, 60_000);

  afterAll(async () => {
    try { await admin.auth.admin.deleteUser(userId); } catch {}
    try { await admin.from("tenants").delete().eq("id", tenantId); } catch {}
  }, 60_000);

  it("old refresh token fails after role-change + global signOut", async () => {
    // Step 1: sign in as worker, capture refresh token.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: signIn, error: siErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: userPassword,
    });
    expect(siErr).toBeNull();
    expect(signIn?.session?.refresh_token).toBeDefined();
    expect(signIn?.session?.access_token).toBeDefined();
    const oldRefreshToken = signIn!.session!.refresh_token!;
    const oldAccessToken = signIn!.session!.access_token!;

    // Step 2: server-side role change. The admin role-change path is
    // updateUserById (claims) + signOut(scope='global') (revoke refresh
    // tokens). NOTE: `admin.auth.admin.signOut(jwt, scope)` takes the
    // *user's access-token JWT*, not their user id — passing a UUID here
    // makes GoTrue reject the request with "token contains an invalid
    // number of segments" and the revoke silently no-ops. See
    // docs/SECURITY-AUDIT-2026-05-12-ac-auth-01.md (AC-AUTH-01).
    const newMeta = { tenant_id: tenantId, role: "tenant_admin" } as const;
    const { error: upErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: newMeta,
    });
    expect(upErr).toBeNull();
    const { error: soErr } = await admin.auth.admin.signOut(oldAccessToken, "global");
    expect(soErr).toBeNull();

    // Step 3: try to refresh with the old token — must fail.
    const probe = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: refreshData, error: refreshErr } = await probe.auth.refreshSession({
      refresh_token: oldRefreshToken,
    });
    // Either refreshErr is set, OR refreshData.session is null.
    if (refreshErr) {
      expect(refreshErr).not.toBeNull();
    } else {
      expect(refreshData.session).toBeNull();
    }

    // Step 4: a fresh sign-in works and the new JWT claims role=tenant_admin.
    const reSignIn = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: newSession, error: rsErr } = await reSignIn.auth.signInWithPassword({
      email: userEmail,
      password: userPassword,
    });
    expect(rsErr).toBeNull();
    const claims = parseJwtAppMetadata(newSession?.session?.access_token);
    expect(claims?.role).toBe("tenant_admin");
  }, 30_000);
});

describe("Refresh-token revoke live test gating", () => {
  it("acknowledges skip reason when env vars missing", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_RLS_TESTS !== "1") reasons.push("RUN_LIVE_RLS_TESTS=1");
      expect(reasons.length, `refresh-token revoke skipped: missing ${reasons.join(", ")}`).toBeGreaterThan(0);
    }
  });
});

function parseJwtAppMetadata(jwt?: string): Record<string, unknown> | null {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return (decoded.app_metadata ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

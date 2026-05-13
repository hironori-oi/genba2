/**
 * Live AC-AUTH-01 production-path verification (Phase 5).
 *
 * Validates the prod fix landed by
 * `T-20260513-200000-genba-ac-auth-01-prod-fix`:
 *   - migration `20260513000000_phase5_admin_revoke_refresh_tokens.sql`
 *     creates `public.admin_revoke_refresh_tokens(uuid)` and grants
 *     execute to service_role only.
 *   - `src/lib/auth/role-change.ts` now invokes
 *     `admin.rpc('admin_revoke_refresh_tokens', { p_user_id })` instead
 *     of the broken `admin.auth.admin.signOut(userId, 'global')` SDK
 *     form (audit §4, §7-1).
 *
 * Scenario A — end-to-end via `changeUserRole(...)` (the production
 * call site). The caller-side session module, the cookie-based server
 * client, and the `next/headers` + `server-only` runtime hooks are
 * stubbed because the tested code lives behind `import "server-only"`
 * + `next/headers`. After the change, the captured old refresh-token
 * can no longer mint a new session.
 *
 * Scenario B — direct RPC. Confirms `admin_revoke_refresh_tokens`
 * deletes rows from `auth.refresh_tokens` for the target user
 * (deletion count > 0 on first call, 0 on second call) and the
 * captured refresh token is invalidated as a result.
 *
 * Gated identically to `tests/integration/rls/refresh-token-revoke.test.ts`.
 * No secret values are echoed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// vi.mock calls are hoisted above imports by vitest. They land BEFORE the
// `@/lib/auth/role-change` static import below, so the SUT picks up the
// stubs during its module evaluation.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signOut: async () => ({ error: null }) },
  }),
}));

const CALLER_TENANT_ADMIN = {
  kind: "ok" as const,
  session: {
    userId: "00000000-0000-0000-0000-000000000001",
    email: "caller@example.test",
    tenantId: "__placeholder__",
    role: "tenant_admin" as const,
    displayName: "Caller",
  },
};

vi.mock("@/lib/auth/session", () => ({
  getAppSession: async () => CALLER_TENANT_ADMIN,
}));

import { changeUserRole } from "@/lib/auth/role-change";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const LIVE = Boolean(
  SUPABASE_URL && ANON_KEY && SERVICE_KEY && process.env.RUN_LIVE_RLS_TESTS === "1",
);

const describeLive = LIVE ? describe : describe.skip;

describeLive("AC-AUTH-01 prod fix — admin_revoke_refresh_tokens", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let userId: string;
  let userEmail: string;
  let userPassword: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const slug = `prod-revoke-${Math.random().toString(36).slice(2, 10)}`;
    const { data: t, error: tErr } = await admin
      .from("tenants")
      .insert({ name: "Prod Revoke T", slug })
      .select("id")
      .single();
    if (tErr || !t) throw new Error(`tenant insert failed: ${tErr?.message}`);
    tenantId = t.id;

    userEmail = `prod-revoke-${Math.random().toString(36).slice(2, 10)}@example.test`;
    userPassword = `ProdRevoke!${Math.random().toString(36).slice(2, 10)}!`;
    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password: userPassword,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: "worker" },
    });
    if (uErr || !u.user) throw new Error(`createUser failed: ${uErr?.message}`);
    userId = u.user.id;
    await admin
      .from("profiles")
      .insert({ id: userId, tenant_id: tenantId, role: "worker", display_name: "prod-revoke" });

    // Align the synthetic caller tenant so the tenant_admin guard in
    // role-change.ts permits the cross-user mutation.
    CALLER_TENANT_ADMIN.session.tenantId = tenantId;
  }, 60_000);

  afterAll(async () => {
    try { await admin.auth.admin.deleteUser(userId); } catch {}
    try { await admin.from("tenants").delete().eq("id", tenantId); } catch {}
  }, 60_000);

  it("Scenario A: changeUserRole() invalidates the user's old refresh token", async () => {
    // Sign in as the target user and capture the old refresh token.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: signIn, error: siErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: userPassword,
    });
    expect(siErr).toBeNull();
    expect(signIn?.session?.refresh_token).toBeTruthy();
    const oldRefreshToken = signIn!.session!.refresh_token!;

    // Exercise the production role-change path. This must succeed AND
    // revoke the captured refresh token.
    const result = await changeUserRole({
      targetUserId: userId,
      newRole: "tenant_admin",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    // The captured refresh token must now be invalid. Supabase returns
    // HTTP 400 "Invalid Refresh Token: Refresh Token Not Found" once the
    // server-side row is gone. We accept either an error or a null
    // session — both prove the revoke happened.
    const probe = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: refreshData, error: refreshErr } = await probe.auth.refreshSession({
      refresh_token: oldRefreshToken,
    });
    if (refreshErr) {
      expect(refreshErr).not.toBeNull();
      const msg = refreshErr.message ?? "";
      expect(
        /refresh token/i.test(msg) || /not found/i.test(msg) || /invalid/i.test(msg),
        `unexpected error message: ${msg}`,
      ).toBe(true);
    } else {
      expect(refreshData.session).toBeNull();
    }
  }, 60_000);

  it("Scenario B: direct admin_revoke_refresh_tokens RPC deletes auth.refresh_tokens rows", async () => {
    // Fresh sign-in to create a new refresh-token row.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: signIn, error: siErr } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: userPassword,
    });
    expect(siErr).toBeNull();
    const refreshToken = signIn!.session!.refresh_token!;

    // First RPC call: must report at least one row deleted.
    const { data: firstCount, error: firstErr } = await admin.rpc(
      "admin_revoke_refresh_tokens",
      { p_user_id: userId },
    );
    expect(firstErr, JSON.stringify(firstErr)).toBeNull();
    expect(typeof firstCount).toBe("number");
    expect(firstCount as number).toBeGreaterThanOrEqual(1);

    // Second RPC call (no new sign-in in between): must report zero,
    // proving the first call really removed the rows from the table.
    const { data: secondCount, error: secondErr } = await admin.rpc(
      "admin_revoke_refresh_tokens",
      { p_user_id: userId },
    );
    expect(secondErr, JSON.stringify(secondErr)).toBeNull();
    expect(secondCount).toBe(0);

    // Behavioral confirmation: the captured refresh-token no longer works.
    const probe = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: refreshData, error: refreshErr } = await probe.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (refreshErr) {
      expect(refreshErr).not.toBeNull();
    } else {
      expect(refreshData.session).toBeNull();
    }
  }, 60_000);
});

describe("AC-AUTH-01 prod fix live test gating", () => {
  it("acknowledges skip reason when env vars missing", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_RLS_TESTS !== "1") reasons.push("RUN_LIVE_RLS_TESTS=1");
      expect(reasons.length, `prod-revoke skipped: missing ${reasons.join(", ")}`).toBeGreaterThan(0);
    }
  });
});

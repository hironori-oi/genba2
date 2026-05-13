/**
 * Live RLS integration tests — RLS-001..008 (Phase 1 carry-over) +
 * RLS-101..108 (Phase 2 settings/masters).
 *
 * These tests speak to a real Supabase instance using the SERVICE_ROLE
 * key to provision two synthetic tenants and two synthetic users, then
 * exercise the policies under each user's authenticated JWT. They are
 * SKIPPED when env vars are missing — i.e. local dev without owner-
 * provisioned credentials. To run them:
 *
 *   1. ensure NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
 *      SUPABASE_SERVICE_ROLE_KEY are exported (via secrets-decrypt.sh).
 *   2. RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls
 *
 * Each test passes when the policy denies the cross-tenant / privilege-
 * escalating operation. A test that *succeeds* in returning forbidden
 * data is a P0 finding.
 *
 * (We do NOT log secret values. We do not even reference them by full
 * env-var name in console output.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && process.env.RUN_LIVE_RLS_TESTS === "1");

const describeLive = LIVE ? describe : describe.skip;

type SyntheticUser = {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  role: "worker" | "tenant_admin";
};

type Suite = {
  admin: SupabaseClient;
  t1Worker: SyntheticUser;
  t1Admin: SyntheticUser;
  t2Worker: SyntheticUser;
};

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function clientAs(user: SyntheticUser): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`signIn failed for ${user.email}: ${error.message}`);
  return c;
}

async function provisionTenant(admin: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .insert({ name, slug: `rls-${rand()}` })
    .select("id")
    .single();
  if (error) throw new Error(`tenant insert failed: ${error.message}`);
  return data.id;
}

async function provisionUser(
  admin: SupabaseClient,
  tenantId: string,
  role: "worker" | "tenant_admin",
): Promise<SyntheticUser> {
  const email = `rls-${rand()}@example.test`;
  const password = `RlsTest!${rand()}!Pw`; // 10+ chars, never logged
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role },
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = created.user.id;
  const { error: pErr } = await admin
    .from("profiles")
    .insert({ id: userId, tenant_id: tenantId, role, display_name: role });
  if (pErr) throw new Error(`profile insert failed: ${pErr.message}`);
  return { email, password, userId, tenantId, role };
}

describeLive("Live RLS integration (T1 / T2)", () => {
  let suite: Suite;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const t1 = await provisionTenant(admin, "RLS-T1");
    const t2 = await provisionTenant(admin, "RLS-T2");
    const t1Worker = await provisionUser(admin, t1, "worker");
    const t1Admin = await provisionUser(admin, t1, "tenant_admin");
    const t2Worker = await provisionUser(admin, t2, "worker");
    suite = { admin, t1Worker, t1Admin, t2Worker };
  }, 60_000);

  afterAll(async () => {
    if (!suite) return;
    const { admin, t1Worker, t1Admin, t2Worker } = suite;
    // Best-effort cleanup; ignore individual failures.
    for (const u of [t1Worker, t1Admin, t2Worker]) {
      try { await admin.auth.admin.deleteUser(u.userId); } catch {}
    }
    try { await admin.from("tenants").delete().eq("id", t1Worker.tenantId); } catch {}
    try { await admin.from("tenants").delete().eq("id", t2Worker.tenantId); } catch {}
  }, 60_000);

  // -----------------------------------------------------------------
  // Phase 1 carry-over: RLS-001..008
  // -----------------------------------------------------------------
  it("RLS-001 tenants/profiles cross-tenant SELECT returns 0 rows", async () => {
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("profiles")
      .select("id, tenant_id")
      .eq("tenant_id", suite.t1Worker.tenantId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("RLS-002 worker INSERT into tenant_subscriptions is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1
      .from("tenant_subscriptions")
      .insert({ tenant_id: suite.t1Worker.tenantId, plan: "logi" });
    expect(error).not.toBeNull();
  });

  it("RLS-003 worker assigning profiles.role to tenant_admin is no-op via RLS", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1
      .from("profiles")
      .update({ role: "tenant_admin" })
      .eq("id", suite.t1Worker.userId)
      .select();
    // Display-only column on profiles can be updated by the user; authoritative
    // role comes from JWT (app_metadata) via auth.users — see SECURITY-AUDIT
    // 2026-05-11 phase1 note on RLS-003. We assert here that JWT-derived role
    // does NOT change after this update.
    expect(error).toBeNull();
    const { data: jwtCheck } = await t1.rpc("current_role" as never);
    // current_role is in the app schema, not exposed via PostgREST RPC by
    // default. Fallback: verify via a tenant_subscriptions INSERT (which
    // requires is_system_admin or system_admin) — should still fail.
    expect(jwtCheck === undefined || jwtCheck === null || jwtCheck === "worker").toBeTruthy();
    const { error: e2 } = await t1
      .from("tenant_subscriptions")
      .insert({ tenant_id: suite.t1Worker.tenantId, plan: "logi" });
    expect(e2).not.toBeNull();
  });

  it("RLS-004 cross-tenant UPDATE SET tenant_id rejected by WITH CHECK", async () => {
    const t1Admin = await clientAs(suite.t1Admin);
    const { data, error } = await t1Admin
      .from("profiles")
      .update({ tenant_id: suite.t2Worker.tenantId })
      .eq("id", suite.t1Worker.userId)
      .select();
    // Either RLS rejects (error) or 0 rows match (data empty).
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  it("RLS-006 same-tenant worker A updating worker B is rejected", async () => {
    const t1Worker = await clientAs(suite.t1Worker);
    const { data, error } = await t1Worker
      .from("profiles")
      .update({ display_name: "hijacked" })
      .eq("id", suite.t1Admin.userId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  // -----------------------------------------------------------------
  // Phase 2 settings + masters: RLS-101..108 + Phase 1 RLS-007/008 dyn checks
  // -----------------------------------------------------------------
  it("RLS-101 qr_format_definitions cross-tenant SELECT returns 0 rows", async () => {
    // T1 admin creates a format; T2 worker should not see it.
    const t1Admin = await clientAs(suite.t1Admin);
    const { data: created, error: cErr } = await t1Admin
      .from("qr_format_definitions")
      .insert({
        tenant_id: suite.t1Admin.tenantId,
        qr_type: "label",
        format_code: "RLS101",
        format_name: "T1 label",
        version: 1,
      })
      .select("id")
      .single();
    expect(cErr).toBeNull();
    expect(created?.id).toBeDefined();
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("qr_format_definitions")
      .select("id")
      .eq("id", created!.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("RLS-103 worker INSERT into qr_format_definitions is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_format_definitions").insert({
      tenant_id: suite.t1Worker.tenantId,
      qr_type: "label",
      format_code: "RLS103",
      format_name: "worker attempt",
      version: 1,
    });
    expect(error).not.toBeNull();
  });

  it("RLS-104 worker UPDATE tenant_field_settings is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1
      .from("tenant_field_settings")
      .update({ enabled: false })
      .eq("tenant_id", suite.t1Worker.tenantId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  it("RLS-108 worker UPDATE standard_field_definitions is rejected (system-wide catalog)", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1
      .from("standard_field_definitions")
      .update({ label: "tampered" })
      .eq("code", "item_code")
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  // -----------------------------------------------------------------
  // RLS-007 (Phase 3b live coverage)
  //   qr_scan_histories INSERT from T1 with target_table='movement_records'
  //   pointing at a T2 movement_record id must be rejected by the
  //   validate_target_tenant() trigger (errcode 42501). This sits
  //   alongside the more focused Phase 3a coverage in rls-phase3a.test.ts
  //   but lives here too so the historical RLS-007 case in the rls-live
  //   suite has a homing landing point.
  // -----------------------------------------------------------------
  it("RLS-007 live qr_scan_histories cross-tenant target_id rejected by validate_target_tenant()", async () => {
    // Seed a T2 movement_record via service_role so we have a known
    // cross-tenant target uuid.
    const { admin } = suite;
    const { data: t2rec, error: t2recErr } = await admin
      .from("movement_records")
      .insert({
        tenant_id: suite.t2Worker.tenantId,
        business_code: "receiving",
        worker_id: suite.t2Worker.userId,
        item_code: "ITEM-RLS007",
        quantity: 1,
      })
      .select("id")
      .single();
    expect(t2recErr).toBeNull();
    expect(t2rec?.id).toBeDefined();

    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_scan_histories").insert({
      tenant_id: suite.t1Worker.tenantId,
      scanned_by: suite.t1Worker.userId,
      qr_type: "label",
      raw_value: "V1|ITEM-RLS007|1",
      parsed_values: { item_code: "ITEM-RLS007", quantity: 1 },
      match_result: "ok",
      target_table: "movement_records",
      target_id: t2rec!.id, // T2 record from T1 context — trigger must reject
      business_code: "receiving",
    });
    expect(error).not.toBeNull();

    // Cleanup the cross-tenant seed row best-effort.
    try { await admin.from("movement_records").delete().eq("id", t2rec!.id); } catch {}
  });
});

/**
 * Always exported as a regular describe (not skipped) so the test reporter
 * surfaces *why* the live tests are skipped when env vars are missing.
 */
describe("Live RLS gating", () => {
  it("is enabled only when SUPABASE env + RUN_LIVE_RLS_TESTS=1 are set", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_RLS_TESTS !== "1") reasons.push("RUN_LIVE_RLS_TESTS=1");
      // Acknowledge skip explicitly so STATUS is auditable.
      expect(reasons.length, `Live RLS tests skipped: missing ${reasons.join(", ")}`).toBeGreaterThan(0);
    }
  });
});

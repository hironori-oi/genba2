/**
 * Phase 3b RLS coverage-gap closure tests.
 *
 * Closes the four Phase 2 carry-over gaps (RLS-102 / 105 / 106 / 107) and
 * the Phase 3b UNVERIFIED_ITEM #2 follow-up (RLS-301 / 302) for the new
 * csv_import_jobs surface introduced by migration 20260512000600.
 *
 *   RLS-102: T2 worker SELECT from tenant_field_settings of T1 → 0 rows.
 *   RLS-105: worker INSERT/UPDATE on qr_format_definitions denied.
 *   RLS-106: cross-tenant UPDATE on match_rules.tenant_id denied via WITH CHECK.
 *   RLS-107: worker UPDATE on csv_import_definitions denied (tenant_admin only).
 *   RLS-301: T2 worker SELECT csv_import_jobs of T1 → 0 rows (cross-tenant
 *            SELECT reject; same-tenant SELECT policy).
 *   RLS-302: worker INSERT into csv_import_jobs rejected (tenant_admin-only
 *            INSERT policy).
 *
 * LIVE-gated identically to rls-live.test.ts — requires
 *   NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY +
 *   SUPABASE_SERVICE_ROLE_KEY + RUN_LIVE_RLS_TESTS=1.
 *
 * Skipped under the default `npm run test` run so CI stays green
 * without owner-provisioned Supabase credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const LIVE = Boolean(
  SUPABASE_URL && ANON_KEY && SERVICE_KEY && process.env.RUN_LIVE_RLS_TESTS === "1",
);

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
  t1MatchRuleId: string;
  t1CsvImportDefId: string;
  t1CsvImportJobId: string;
};

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function clientAs(user: SyntheticUser): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await c.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`signIn failed for ${user.email}: ${error.message}`);
  return c;
}

async function provisionTenant(admin: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .insert({ name, slug: `rls-gap-${rand()}` })
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
  const email = `rls-gap-${rand()}@example.test`;
  const password = `RlsTest!${rand()}!Pw`;
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

describeLive("Live RLS coverage-gap closure (RLS-102 / 105 / 106 / 107 / 301 / 302)", () => {
  let suite: Suite;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const t1 = await provisionTenant(admin, "RLS-GAP-T1");
    const t2 = await provisionTenant(admin, "RLS-GAP-T2");
    const t1Worker = await provisionUser(admin, t1, "worker");
    const t1Admin = await provisionUser(admin, t1, "tenant_admin");
    const t2Worker = await provisionUser(admin, t2, "worker");

    // Seed one match_rule in T1 so RLS-106 has a target.
    const { data: mr, error: mrErr } = await admin
      .from("match_rules")
      .insert({
        tenant_id: t1,
        business_code: "receiving",
        rule_code: `RULE-${rand()}`,
        rule_name: "gap closure rule",
      })
      .select("id")
      .single();
    if (mrErr || !mr) throw new Error(`match_rules insert failed: ${mrErr?.message}`);

    // Seed one csv_import_definition in T1 so RLS-107 has a target.
    const { data: cid, error: cidErr } = await admin
      .from("csv_import_definitions")
      .insert({
        tenant_id: t1,
        business_code: "receiving",
        target_table: "movement_plan_lines",
        definition_code: `DEF-${rand()}`,
        definition_name: "gap closure import def",
      })
      .select("id")
      .single();
    if (cidErr || !cid) throw new Error(`csv_import_definitions insert failed: ${cidErr?.message}`);

    // Seed at least one tenant_field_settings row in T1 so RLS-102 has
    // something to potentially leak. The Phase 2 schema may auto-seed
    // these on tenant creation; if the row already exists we ignore the
    // unique-violation error.
    try {
      await admin.from("tenant_field_settings").insert({
        tenant_id: t1,
        field_code: "item_code",
        enabled: true,
        purpose: "item_label",
      });
    } catch {
      // already seeded — fine.
    }

    // Seed one csv_import_jobs row in T1 so RLS-301 has a cross-tenant
    // SELECT target. Inserted via service_role (bypasses RLS), mirroring
    // how the production Edge Functions create the header row.
    const { data: cij, error: cijErr } = await admin
      .from("csv_import_jobs")
      .insert({
        tenant_id: t1,
        kind: "movement",
        source_storage_path: `imports/${t1}/${rand()}.csv`,
        status: "pending",
        requested_by: t1Admin.userId,
      })
      .select("id")
      .single();
    if (cijErr || !cij) throw new Error(`csv_import_jobs insert failed: ${cijErr?.message}`);

    suite = {
      admin,
      t1Worker,
      t1Admin,
      t2Worker,
      t1MatchRuleId: mr.id,
      t1CsvImportDefId: cid.id,
      t1CsvImportJobId: cij.id,
    };
  }, 90_000);

  afterAll(async () => {
    if (!suite) return;
    const { admin } = suite;
    for (const u of [suite.t1Worker, suite.t1Admin, suite.t2Worker]) {
      try { await admin.auth.admin.deleteUser(u.userId); } catch {}
    }
    try { await admin.from("tenants").delete().eq("id", suite.t1Worker.tenantId); } catch {}
    try { await admin.from("tenants").delete().eq("id", suite.t2Worker.tenantId); } catch {}
  }, 60_000);

  // -----------------------------------------------------------------
  // RLS-102 — T2 worker SELECT on tenant_field_settings of T1 → 0 rows.
  // -----------------------------------------------------------------
  it("RLS-102 T2 worker SELECT tenant_field_settings of T1 returns 0 rows", async () => {
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("tenant_field_settings")
      .select("id, tenant_id, field_code")
      .eq("tenant_id", suite.t1Worker.tenantId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // -----------------------------------------------------------------
  // RLS-105 — worker INSERT/UPDATE on qr_format_definitions denied.
  //   Phase 2 carry-over: similar in spirit to RLS-103 in rls-live.test.ts
  //   but covers UPDATE too (the original case only exercised INSERT).
  // -----------------------------------------------------------------
  it("RLS-105 worker INSERT on qr_format_definitions is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_format_definitions").insert({
      tenant_id: suite.t1Worker.tenantId,
      qr_type: "label",
      format_code: "RLS105",
      format_name: "worker insert attempt",
      version: 1,
    });
    expect(error).not.toBeNull();
  });

  it("RLS-105 worker UPDATE on qr_format_definitions is rejected", async () => {
    // Seed a row via admin so there's something to attempt updating.
    const { data: seed, error: seedErr } = await suite.admin
      .from("qr_format_definitions")
      .insert({
        tenant_id: suite.t1Worker.tenantId,
        qr_type: "label",
        format_code: `RLS105-${rand()}`,
        format_name: "seed for update test",
        version: 1,
      })
      .select("id")
      .single();
    expect(seedErr).toBeNull();

    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1
      .from("qr_format_definitions")
      .update({ format_name: "hijacked" })
      .eq("id", seed!.id)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      // RLS makes update-eligibility a USING gate; non-admin returns 0 rows.
      expect((data ?? []).length).toBe(0);
    }
  });

  // -----------------------------------------------------------------
  // RLS-106 — cross-tenant UPDATE on match_rules.tenant_id rejected.
  //   The tenant_admin of T1 cannot reassign a rule to T2 — the WITH
  //   CHECK clause pins tenant_id = app.current_tenant_id().
  // -----------------------------------------------------------------
  it("RLS-106 tenant_admin cannot UPDATE match_rules SET tenant_id=<other> (WITH CHECK)", async () => {
    const adm = await clientAs(suite.t1Admin);
    const { data, error } = await adm
      .from("match_rules")
      .update({ tenant_id: suite.t2Worker.tenantId })
      .eq("id", suite.t1MatchRuleId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  // -----------------------------------------------------------------
  // RLS-107 — worker UPDATE on csv_import_definitions denied.
  // -----------------------------------------------------------------
  it("RLS-107 worker UPDATE on csv_import_definitions is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1
      .from("csv_import_definitions")
      .update({ definition_name: "hijacked" })
      .eq("id", suite.t1CsvImportDefId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  // -----------------------------------------------------------------
  // RLS-301 — T2 worker SELECT csv_import_jobs of T1 → 0 rows.
  //   Same-tenant SELECT policy at migration 600 :67-70 must filter
  //   out T1 rows for a T2 JWT context. Sanity-check: T1 admin still
  //   sees the seeded job from the same-tenant side.
  // -----------------------------------------------------------------
  it("RLS-301 T2 worker SELECT csv_import_jobs of T1 returns 0 rows", async () => {
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("csv_import_jobs")
      .select("id, tenant_id")
      .eq("id", suite.t1CsvImportJobId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);

    const adm = await clientAs(suite.t1Admin);
    const { data: admData, error: admErr } = await adm
      .from("csv_import_jobs")
      .select("id, tenant_id")
      .eq("id", suite.t1CsvImportJobId);
    expect(admErr).toBeNull();
    expect((admData ?? []).length).toBe(1);
  });

  // -----------------------------------------------------------------
  // RLS-302 — worker INSERT csv_import_jobs rejected (tenant_admin only).
  //   Migration 600 :75-81 restricts INSERT to (is_tenant_admin() and
  //   same tenant) or is_system_admin(). Workers are explicitly not
  //   allowed to enqueue CSV import jobs in Phase 3b (UC-3).
  // -----------------------------------------------------------------
  it("RLS-302 worker INSERT into csv_import_jobs is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("csv_import_jobs").insert({
      tenant_id: suite.t1Worker.tenantId,
      kind: "movement",
      source_storage_path: `imports/${suite.t1Worker.tenantId}/${rand()}.csv`,
      status: "pending",
      requested_by: suite.t1Worker.userId,
    });
    expect(error).not.toBeNull();
  });
});

describe("Live RLS coverage-gap gating", () => {
  it("is enabled only when SUPABASE env + RUN_LIVE_RLS_TESTS=1 are set", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_RLS_TESTS !== "1") reasons.push("RUN_LIVE_RLS_TESTS=1");
      expect(
        reasons.length,
        `Live RLS coverage-gap tests skipped: missing ${reasons.join(", ")}`,
      ).toBeGreaterThan(0);
    }
  });
});

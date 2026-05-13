/**
 * Live RLS integration tests — Phase 3a (RLS-007 + RLS-201..208).
 *
 * Mirrors the gating + provisioning style of rls-live.test.ts:
 *   * Skipped unless NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
 *     SUPABASE_SERVICE_ROLE_KEY are set AND RUN_LIVE_RLS_TESTS=1.
 *   * Provisions two synthetic tenants (T1, T2) and three users
 *     (T1 worker, T1 admin, T2 worker) via service_role.
 *   * Provisions a movement_plan + plan_line in T1 + an inventory_plan /
 *     line in T1 so the scenarios have well-defined target IDs.
 *
 * The test file is self-contained — it does NOT modify rls-live.test.ts.
 * Synthetic users / tenants are best-effort cleaned up in afterAll.
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
  t1WorkerB: SyntheticUser; // second T1 worker for RLS-203
  t2Worker: SyntheticUser;
  t1MovementPlanId: string;
  t1MovementPlanLineId: string;
  t1MovementRecordId: string; // recorded by t1Worker
  t2MovementRecordId: string; // recorded by t2Worker
  t1InventoryPlanId: string;
  t1InventoryPlanLineId: string;
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
  const password = `RlsTest!${rand()}!Pw`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role },
  });
  if (error || !created.user) {
    throw new Error(`createUser failed: ${error?.message}`);
  }
  const userId = created.user.id;
  const { error: pErr } = await admin
    .from("profiles")
    .insert({ id: userId, tenant_id: tenantId, role, display_name: role });
  if (pErr) throw new Error(`profile insert failed: ${pErr.message}`);
  return { email, password, userId, tenantId, role };
}

describeLive("Live RLS Phase 3a (movement_records / inventory_records / qr_scan_histories)", () => {
  let suite: Suite;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const t1 = await provisionTenant(admin, "RLS-T1-P3a");
    const t2 = await provisionTenant(admin, "RLS-T2-P3a");
    const t1Worker = await provisionUser(admin, t1, "worker");
    const t1WorkerB = await provisionUser(admin, t1, "worker");
    const t1Admin = await provisionUser(admin, t1, "tenant_admin");
    const t2Worker = await provisionUser(admin, t2, "worker");

    // Seed a movement_plan + plan_line + record in T1 via service_role
    // so cross-tenant SELECT tests have well-defined target IDs.
    const { data: plan, error: planErr } = await admin
      .from("movement_plans")
      .insert({
        tenant_id: t1,
        business_code: "receiving",
        plan_code: `PLAN-${rand()}`,
        plan_name: "RLS-Phase3a plan",
      })
      .select("id")
      .single();
    if (planErr || !plan) throw new Error(`movement_plans insert failed: ${planErr?.message}`);

    const { data: line, error: lineErr } = await admin
      .from("movement_plan_lines")
      .insert({
        movement_plan_id: plan.id,
        tenant_id: t1,
        line_no: 1,
        item_code: "ITEM-A",
        planned_quantity: 10,
      })
      .select("id")
      .single();
    if (lineErr || !line) throw new Error(`movement_plan_lines insert failed: ${lineErr?.message}`);

    const { data: rec, error: recErr } = await admin
      .from("movement_records")
      .insert({
        tenant_id: t1,
        business_code: "receiving",
        movement_plan_line_id: line.id,
        worker_id: t1Worker.userId,
        item_code: "ITEM-A",
        quantity: 10,
      })
      .select("id")
      .single();
    if (recErr || !rec) throw new Error(`movement_records insert failed: ${recErr?.message}`);

    // T2 movement_record provisioned by the T2 worker so we have a remote
    // target id for the cross-tenant qr_scan_histories test.
    const { data: rec2, error: rec2Err } = await admin
      .from("movement_records")
      .insert({
        tenant_id: t2,
        business_code: "receiving",
        worker_id: t2Worker.userId,
        item_code: "ITEM-A",
        quantity: 1,
      })
      .select("id")
      .single();
    if (rec2Err || !rec2) throw new Error(`movement_records T2 insert failed: ${rec2Err?.message}`);

    const { data: inv, error: invErr } = await admin
      .from("inventory_plans")
      .insert({
        tenant_id: t1,
        plan_code: `INV-${rand()}`,
        plan_name: "RLS-Phase3a inv",
      })
      .select("id")
      .single();
    if (invErr || !inv) throw new Error(`inventory_plans insert failed: ${invErr?.message}`);

    const { data: invLine, error: invLineErr } = await admin
      .from("inventory_plan_lines")
      .insert({
        inventory_plan_id: inv.id,
        tenant_id: t1,
        line_no: 1,
        item_code: "ITEM-A",
        expected_quantity: 5,
      })
      .select("id")
      .single();
    if (invLineErr || !invLine) {
      throw new Error(`inventory_plan_lines insert failed: ${invLineErr?.message}`);
    }

    // Seed one inventory_record in T1 for the RLS-204 cross-tenant SELECT test.
    const { error: invRecErr } = await admin.from("inventory_records").insert({
      tenant_id: t1,
      inventory_plan_line_id: invLine.id,
      worker_id: t1Worker.userId,
      item_code: "ITEM-A",
      counted_quantity: 5,
    });
    if (invRecErr) throw new Error(`inventory_records insert failed: ${invRecErr.message}`);

    suite = {
      admin,
      t1Worker,
      t1Admin,
      t1WorkerB,
      t2Worker,
      t1MovementPlanId: plan.id,
      t1MovementPlanLineId: line.id,
      t1MovementRecordId: rec.id,
      t2MovementRecordId: rec2.id,
      t1InventoryPlanId: inv.id,
      t1InventoryPlanLineId: invLine.id,
    };
  }, 90_000);

  afterAll(async () => {
    if (!suite) return;
    const { admin } = suite;
    for (const u of [suite.t1Worker, suite.t1Admin, suite.t1WorkerB, suite.t2Worker]) {
      try { await admin.auth.admin.deleteUser(u.userId); } catch {}
    }
    // tenant cascades delete movement_*, inventory_*, qr_scan_histories rows.
    try { await admin.from("tenants").delete().eq("id", suite.t1Worker.tenantId); } catch {}
    try { await admin.from("tenants").delete().eq("id", suite.t2Worker.tenantId); } catch {}
  }, 60_000);

  // -----------------------------------------------------------------
  // RLS-007 — qr_scan_histories cross-tenant target_id rejected by trigger
  // -----------------------------------------------------------------
  it("RLS-007 qr_scan_histories INSERT with cross-tenant target_id is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_scan_histories").insert({
      tenant_id: suite.t1Worker.tenantId,
      scanned_by: suite.t1Worker.userId,
      qr_type: "label",
      raw_value: "V1|ITEM-A|1",
      parsed_values: { item_code: "ITEM-A", quantity: 1 },
      match_result: "ok",
      target_table: "movement_records",
      target_id: suite.t2MovementRecordId, // T2 record from T1 context
      business_code: "receiving",
    });
    expect(error).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // RLS-201 — movement_records cross-tenant SELECT returns 0 rows
  // -----------------------------------------------------------------
  it("RLS-201 movement_records cross-tenant SELECT returns 0 rows", async () => {
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("movement_records")
      .select("id, tenant_id")
      .eq("id", suite.t1MovementRecordId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // -----------------------------------------------------------------
  // RLS-202 — worker INSERT with worker_id != auth.uid() rejected
  // -----------------------------------------------------------------
  it("RLS-202 worker INSERT into movement_records with worker_id != auth.uid() is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("movement_records").insert({
      tenant_id: suite.t1Worker.tenantId,
      business_code: "receiving",
      worker_id: suite.t1Admin.userId, // not the caller
      item_code: "ITEM-A",
      quantity: 1,
    });
    expect(error).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // RLS-203 — worker UPDATE of another worker's movement_record rejected
  //           unless tenant_admin.
  // -----------------------------------------------------------------
  it("RLS-203 worker UPDATE of another worker's movement_record (same tenant) is rejected", async () => {
    const t1B = await clientAs(suite.t1WorkerB);
    const { data, error } = await t1B
      .from("movement_records")
      .update({ notes: "hijacked" })
      .eq("id", suite.t1MovementRecordId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  it("RLS-203 tenant_admin CAN update another worker's movement_record (same tenant)", async () => {
    const adm = await clientAs(suite.t1Admin);
    const { data, error } = await adm
      .from("movement_records")
      .update({ notes: "admin-edit" })
      .eq("id", suite.t1MovementRecordId)
      .select("id, notes");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(data?.[0]?.notes).toBe("admin-edit");
  });

  // -----------------------------------------------------------------
  // RLS-204 — inventory_records cross-tenant SELECT returns 0 rows
  // -----------------------------------------------------------------
  it("RLS-204 inventory_records cross-tenant SELECT returns 0 rows", async () => {
    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("inventory_records")
      .select("id, tenant_id")
      .eq("tenant_id", suite.t1Worker.tenantId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // -----------------------------------------------------------------
  // RLS-205 — SELECT raw_value FROM qr_scan_histories AS authenticated worker
  //           rejected by the column-grant layer (or returns empty via view).
  // -----------------------------------------------------------------
  it("RLS-205 worker direct SELECT(raw_value) on base table is rejected by column grant", async () => {
    // Seed a row first (so we know one exists in T1).
    const adm = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: seedErr } = await adm.from("qr_scan_histories").insert({
      tenant_id: suite.t1Worker.tenantId,
      scanned_by: suite.t1Worker.userId,
      qr_type: "label",
      raw_value: "V1|ITEM-A|1",
      parsed_values: { item_code: "ITEM-A", quantity: 1 },
      match_result: "ok",
      business_code: "receiving",
    });
    expect(seedErr).toBeNull();

    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1
      .from("qr_scan_histories")
      .select("id, raw_value")
      .eq("tenant_id", suite.t1Worker.tenantId);
    // Either the request fails with a column-permission error OR raw_value
    // is filtered out at the API edge. We accept either outcome — both
    // satisfy QR_SPEC §7.
    if (error) {
      expect(error).not.toBeNull();
    } else {
      // If PostgREST elected to silently drop the disallowed column we still
      // ensure no row returned raw_value.
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>;
        expect(r.raw_value === undefined || r.raw_value === null).toBe(true);
      }
    }
  });

  // -----------------------------------------------------------------
  // RLS-206 — v_qr_scan_histories_admin
  //   * tenant_admin sees rows including raw_value
  //   * worker sees 0 rows
  // -----------------------------------------------------------------
  it("RLS-206 v_qr_scan_histories_admin: admin sees rows, worker sees 0 rows", async () => {
    const adm = await clientAs(suite.t1Admin);
    const { data: admRows, error: admErr } = await adm
      .from("v_qr_scan_histories_admin")
      .select("id, raw_value, tenant_id")
      .eq("tenant_id", suite.t1Admin.tenantId);
    expect(admErr).toBeNull();
    expect((admRows ?? []).length).toBeGreaterThan(0);
    for (const row of admRows ?? []) {
      const r = row as Record<string, unknown>;
      expect(typeof r.raw_value).toBe("string");
    }

    const wkr = await clientAs(suite.t1Worker);
    const { data: wkrRows, error: wkrErr } = await wkr
      .from("v_qr_scan_histories_admin")
      .select("id")
      .eq("tenant_id", suite.t1Worker.tenantId);
    expect(wkrErr).toBeNull();
    expect((wkrRows ?? []).length).toBe(0);
  });

  // -----------------------------------------------------------------
  // RLS-207 — raw_value at 4097 rejected by CHECK
  // -----------------------------------------------------------------
  it("RLS-207 raw_value 4097-char INSERT rejected by CHECK", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_scan_histories").insert({
      tenant_id: suite.t1Worker.tenantId,
      scanned_by: suite.t1Worker.userId,
      qr_type: "label",
      raw_value: "x".repeat(4097),
      parsed_values: {},
      match_result: "none",
    });
    expect(error).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // RLS-208 — target_table outside allow-list rejected by CHECK
  // -----------------------------------------------------------------
  it("RLS-208 target_table='users' INSERT rejected by CHECK constraint", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("qr_scan_histories").insert({
      tenant_id: suite.t1Worker.tenantId,
      scanned_by: suite.t1Worker.userId,
      qr_type: "label",
      raw_value: "V1|FOO",
      parsed_values: {},
      match_result: "none",
      target_table: "users",
      target_id: suite.t1Worker.userId,
    });
    expect(error).not.toBeNull();
  });
});

describe("Live RLS Phase 3a gating", () => {
  it("is enabled only when SUPABASE env + RUN_LIVE_RLS_TESTS=1 are set", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_RLS_TESTS !== "1") reasons.push("RUN_LIVE_RLS_TESTS=1");
      expect(reasons.length, `Live RLS Phase 3a skipped: missing ${reasons.join(", ")}`).toBeGreaterThan(0);
    }
  });
});

// =====================================================================
// Phase 4d — RLS-401..408 live exec (manufacturing_plans / mfg_processes /
//            manufacturing_records / manufacturing_record_defects +
//            qr_scan_histories WORKS-path)
// =====================================================================
// docs/ARCHITECTURE-phase4-manufacturing.md §7.1 / §8.2 deferred live exec
// of Phase 4 RLS coverage to the Phase 4d polish + 二重監査 dispatch. This
// stanza provisions a self-contained Phase 4d seed (two tenants T1P4 /
// T2P4 with worker + admin pairs + a second T1 worker, plus one
// manufacturing_plans / mfg_processes / manufacturing_records /
// manufacturing_record_defects row per tenant + one defects master row
// per tenant) via service_role and exercises the 8 declared cases under
// each user's authenticated JWT.
//
// The Phase 3a / coverage-gap suites above use shared tenants but
// segregate their own seed data; this block follows the same pattern so
// a partial test run cannot cross-contaminate.
// =====================================================================

type Phase4Suite = {
  admin: SupabaseClient;
  t1Worker: SyntheticUser;
  t1WorkerB: SyntheticUser;
  t1Admin: SyntheticUser;
  t2Worker: SyntheticUser;
  t2Admin: SyntheticUser;
  // Cached authenticated clients so the 8 it() cases share one signIn per
  // user. With 28 RLS tests running in one vitest invocation Supabase's
  // /token endpoint hits its 30-req/5-min rate limit; caching the JWT
  // session eliminates the redundant signIns inside this describe.
  t1WorkerClient: SupabaseClient;
  t1WorkerBClient: SupabaseClient;
  t1AdminClient: SupabaseClient;
  t2WorkerClient: SupabaseClient;
  t1ManufacturingPlanId: string;
  t2ManufacturingPlanId: string;
  t1MfgProcessId: string;
  t2MfgProcessId: string;
  t1ManufacturingRecordId: string;
  t2ManufacturingRecordId: string;
  t1ManufacturingRecordDefectId: string;
  t1DefectId: string;
  t2DefectId: string;
};

describeLive(
  "Live RLS Phase 4d (manufacturing_plans / mfg_processes / manufacturing_records / record_defects)",
  () => {
    let p4: Phase4Suite;

    beforeAll(async () => {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const t1 = await provisionTenant(admin, "RLS-T1-P4d");
      const t2 = await provisionTenant(admin, "RLS-T2-P4d");
      const t1Worker = await provisionUser(admin, t1, "worker");
      const t1WorkerB = await provisionUser(admin, t1, "worker");
      const t1Admin = await provisionUser(admin, t1, "tenant_admin");
      const t2Worker = await provisionUser(admin, t2, "worker");
      const t2Admin = await provisionUser(admin, t2, "tenant_admin");

      // Defects masters (FK target for manufacturing_record_defects).
      const { data: d1, error: d1Err } = await admin
        .from("defects")
        .insert({
          tenant_id: t1,
          code: `DEF-${rand()}`,
          name: "scratch",
          severity: "minor",
        })
        .select("id")
        .single();
      if (d1Err || !d1) throw new Error(`defects T1 insert failed: ${d1Err?.message}`);

      const { data: d2, error: d2Err } = await admin
        .from("defects")
        .insert({
          tenant_id: t2,
          code: `DEF-${rand()}`,
          name: "scratch",
          severity: "minor",
        })
        .select("id")
        .single();
      if (d2Err || !d2) throw new Error(`defects T2 insert failed: ${d2Err?.message}`);

      // manufacturing_plans + mfg_processes per tenant.
      const { data: p1, error: p1Err } = await admin
        .from("manufacturing_plans")
        .insert({
          tenant_id: t1,
          order_no: `ORD-${rand()}`,
          item_code: "ITEM-MFG-A",
          planned_quantity: 10,
        })
        .select("id")
        .single();
      if (p1Err || !p1) throw new Error(`manufacturing_plans T1 insert failed: ${p1Err?.message}`);

      const { data: p2, error: p2Err } = await admin
        .from("manufacturing_plans")
        .insert({
          tenant_id: t2,
          order_no: `ORD-${rand()}`,
          item_code: "ITEM-MFG-B",
          planned_quantity: 5,
        })
        .select("id")
        .single();
      if (p2Err || !p2) throw new Error(`manufacturing_plans T2 insert failed: ${p2Err?.message}`);

      const { data: mp1, error: mp1Err } = await admin
        .from("mfg_processes")
        .insert({
          manufacturing_plan_id: p1.id,
          tenant_id: t1,
          process_order: 1,
        })
        .select("id")
        .single();
      if (mp1Err || !mp1) throw new Error(`mfg_processes T1 insert failed: ${mp1Err?.message}`);

      const { data: mp2, error: mp2Err } = await admin
        .from("mfg_processes")
        .insert({
          manufacturing_plan_id: p2.id,
          tenant_id: t2,
          process_order: 1,
        })
        .select("id")
        .single();
      if (mp2Err || !mp2) throw new Error(`mfg_processes T2 insert failed: ${mp2Err?.message}`);

      // manufacturing_records per tenant (T1 = t1Worker, T2 = t2Worker).
      const { data: r1, error: r1Err } = await admin
        .from("manufacturing_records")
        .insert({
          tenant_id: t1,
          mfg_process_id: mp1.id,
          worker_id: t1Worker.userId,
          work_date: new Date().toISOString().slice(0, 10),
          actual_quantity: 10,
        })
        .select("id")
        .single();
      if (r1Err || !r1) throw new Error(`manufacturing_records T1 insert failed: ${r1Err?.message}`);

      const { data: r2, error: r2Err } = await admin
        .from("manufacturing_records")
        .insert({
          tenant_id: t2,
          mfg_process_id: mp2.id,
          worker_id: t2Worker.userId,
          work_date: new Date().toISOString().slice(0, 10),
          actual_quantity: 5,
        })
        .select("id")
        .single();
      if (r2Err || !r2) throw new Error(`manufacturing_records T2 insert failed: ${r2Err?.message}`);

      // manufacturing_record_defects for T1 (RLS-407 cross-tenant SELECT target).
      const { data: rd1, error: rd1Err } = await admin
        .from("manufacturing_record_defects")
        .insert({
          manufacturing_record_id: r1.id,
          tenant_id: t1,
          defect_id: d1.id,
          defect_quantity: 1,
        })
        .select("id")
        .single();
      if (rd1Err || !rd1)
        throw new Error(`manufacturing_record_defects T1 insert failed: ${rd1Err?.message}`);

      // Sign in each user once and cache the authenticated client.
      const t1WorkerClient = await clientAs(t1Worker);
      const t1WorkerBClient = await clientAs(t1WorkerB);
      const t1AdminClient = await clientAs(t1Admin);
      const t2WorkerClient = await clientAs(t2Worker);

      p4 = {
        admin,
        t1Worker,
        t1WorkerB,
        t1Admin,
        t2Worker,
        t2Admin,
        t1WorkerClient,
        t1WorkerBClient,
        t1AdminClient,
        t2WorkerClient,
        t1ManufacturingPlanId: p1.id,
        t2ManufacturingPlanId: p2.id,
        t1MfgProcessId: mp1.id,
        t2MfgProcessId: mp2.id,
        t1ManufacturingRecordId: r1.id,
        t2ManufacturingRecordId: r2.id,
        t1ManufacturingRecordDefectId: rd1.id,
        t1DefectId: d1.id,
        t2DefectId: d2.id,
      };
    }, 90_000);

    afterAll(async () => {
      if (!p4) return;
      const { admin } = p4;
      for (const u of [p4.t1Worker, p4.t1WorkerB, p4.t1Admin, p4.t2Worker, p4.t2Admin]) {
        try { await admin.auth.admin.deleteUser(u.userId); } catch {}
      }
      // tenant CASCADE removes manufacturing_*, defects rows.
      try { await admin.from("tenants").delete().eq("id", p4.t1Worker.tenantId); } catch {}
      try { await admin.from("tenants").delete().eq("id", p4.t2Worker.tenantId); } catch {}
    }, 60_000);

    // -----------------------------------------------------------------
    // RLS-401 manufacturing_plans cross-tenant SELECT returns 0 rows.
    // -----------------------------------------------------------------
    it("RLS-401 manufacturing_plans cross-tenant SELECT returns 0 rows", async () => {
      const t2 = p4.t2WorkerClient;
      const { data, error } = await t2
        .from("manufacturing_plans")
        .select("id, tenant_id")
        .eq("id", p4.t1ManufacturingPlanId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });

    // -----------------------------------------------------------------
    // RLS-402 mfg_processes worker INSERT rejected (tenant_admin only).
    // -----------------------------------------------------------------
    it("RLS-402 mfg_processes worker INSERT is rejected (tenant_admin only)", async () => {
      const t1 = p4.t1WorkerClient;
      const { error } = await t1.from("mfg_processes").insert({
        manufacturing_plan_id: p4.t1ManufacturingPlanId,
        tenant_id: p4.t1Worker.tenantId,
        process_order: 99,
      });
      expect(error).not.toBeNull();
    });

    // -----------------------------------------------------------------
    // RLS-403 mfg_processes parent tenant drift rejected by trigger.
    //   T1 admin attempts to attach a child mfg_processes row with a
    //   parent manufacturing_plan that lives in T2. The denormalised
    //   tenant_id is T1, so the RLS policy admits the row; the
    //   enforce_mfg_process_tenant() trigger then rejects with 42501.
    // -----------------------------------------------------------------
    it("RLS-403 mfg_processes parent tenant drift INSERT rejected by enforce_mfg_process_tenant", async () => {
      const adm = p4.t1AdminClient;
      const { error } = await adm.from("mfg_processes").insert({
        manufacturing_plan_id: p4.t2ManufacturingPlanId, // T2 parent
        tenant_id: p4.t1Admin.tenantId, // denormalised as T1 → drift
        process_order: 100,
      });
      expect(error).not.toBeNull();
    });

    // -----------------------------------------------------------------
    // RLS-404 manufacturing_records worker INSERT with worker_id !=
    //          auth.uid() rejected by WITH CHECK on insert policy.
    // -----------------------------------------------------------------
    it("RLS-404 manufacturing_records worker INSERT with worker_id != auth.uid() is rejected", async () => {
      const t1 = p4.t1WorkerClient;
      const { error } = await t1.from("manufacturing_records").insert({
        tenant_id: p4.t1Worker.tenantId,
        mfg_process_id: p4.t1MfgProcessId,
        worker_id: p4.t1Admin.userId, // not the caller
        work_date: new Date().toISOString().slice(0, 10),
        actual_quantity: 1,
      });
      expect(error).not.toBeNull();
    });

    // -----------------------------------------------------------------
    // RLS-405 manufacturing_records worker A updating worker B's row
    //          (same tenant) is rejected by USING (worker_id = auth.uid()
    //          OR is_tenant_admin()).
    // -----------------------------------------------------------------
    it("RLS-405 manufacturing_records worker A updating worker B's row (same tenant) is rejected", async () => {
      const t1B = p4.t1WorkerBClient;
      const { data, error } = await t1B
        .from("manufacturing_records")
        .update({ notes: "hijacked" })
        .eq("id", p4.t1ManufacturingRecordId)
        .select();
      if (error) {
        expect(error).not.toBeNull();
      } else {
        expect((data ?? []).length).toBe(0);
      }
    });

    // -----------------------------------------------------------------
    // RLS-406 manufacturing_record_defects parent tenant drift INSERT
    //          rejected by enforce_manufacturing_record_defect_tenant.
    //   T1 worker tries to attach a defect row to the T2 manufacturing_-
    //   record. RLS policy admits because tenant_id=T1 + created_by =
    //   auth.uid(); the trigger then rejects with 42501.
    // -----------------------------------------------------------------
    it("RLS-406 manufacturing_record_defects parent tenant drift INSERT rejected by enforce_manufacturing_record_defect_tenant", async () => {
      const t1 = p4.t1WorkerClient;
      const { error } = await t1.from("manufacturing_record_defects").insert({
        manufacturing_record_id: p4.t2ManufacturingRecordId, // T2 parent
        tenant_id: p4.t1Worker.tenantId,
        defect_id: p4.t1DefectId,
        defect_quantity: 1,
      });
      expect(error).not.toBeNull();
    });

    // -----------------------------------------------------------------
    // RLS-407 manufacturing_record_defects cross-tenant SELECT 0 rows.
    // -----------------------------------------------------------------
    it("RLS-407 manufacturing_record_defects cross-tenant SELECT returns 0 rows", async () => {
      const t2 = p4.t2WorkerClient;
      const { data, error } = await t2
        .from("manufacturing_record_defects")
        .select("id, tenant_id")
        .eq("id", p4.t1ManufacturingRecordDefectId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });

    // -----------------------------------------------------------------
    // RLS-408 qr_scan_histories target_table='manufacturing_records'
    //          cross-tenant target_id rejected by validate_target_tenant.
    //   T1 worker inserts qr_scan_histories pointing at the T2
    //   manufacturing_records row; the Phase 3a polymorphic FK trigger
    //   (allow-list already includes manufacturing_records) rejects it.
    // -----------------------------------------------------------------
    it("RLS-408 qr_scan_histories target_table=manufacturing_records cross-tenant target_id rejected by validate_target_tenant", async () => {
      const t1 = p4.t1WorkerClient;
      const { error } = await t1.from("qr_scan_histories").insert({
        tenant_id: p4.t1Worker.tenantId,
        scanned_by: p4.t1Worker.userId,
        qr_type: "label",
        raw_value: "V1|ITEM-MFG-A|1",
        parsed_values: { item_code: "ITEM-MFG-A", quantity: 1 },
        match_result: "ok",
        target_table: "manufacturing_records",
        target_id: p4.t2ManufacturingRecordId, // T2 record from T1 context
        business_code: "manufacturing",
      });
      expect(error).not.toBeNull();
    });
  },
);

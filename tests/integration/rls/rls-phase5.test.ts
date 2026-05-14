/**
 * Live RLS integration tests — Phase 5a corrections foundation
 *   (RLS-501..504, dispatch T-20260514-150000-genba-phase5a-corrections-
 *    foundation, architect doc §4.3 + §7.2).
 *
 * Gated by RUN_LIVE_RLS_TESTS=1 + canonical Supabase env
 *   (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *    SUPABASE_SERVICE_ROLE_KEY). When any of these are missing the suite
 *   is skipped (NOT failed) so local CI / dev runs without owner-
 *   provisioned credentials remain green.
 *
 * To run:
 *   1. ensure NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
 *      SUPABASE_SERVICE_ROLE_KEY are exported (via secrets-decrypt.sh).
 *   2. RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/rls-phase5
 *
 * Coverage map (see also docs/ARCHITECTURE-phase5-admin-ui.md §7.2):
 *   RLS-501: corrections_audit cross-tenant SELECT returns 0 rows
 *   RLS-502: worker direct INSERT into corrections_audit is rejected
 *            (RPC-only path; insert WITH CHECK requires actor_id=auth.uid()
 *            and tenant_id=current, plus practical fact that the table is
 *            written only by the SECURITY INVOKER submit_*_correction RPCs)
 *   RLS-503: tenant_admin UPDATE corrections_audit OK / worker UPDATE
 *            rejected
 *   RLS-504: submit_movement_correction / submit_inventory_correction /
 *            submit_manufacturing_correction succeed under same-tenant
 *            worker JWT: old row gets deleted_at, new row inserted with
 *            previous_record_id set, and a corrections_audit row exists
 *            for each.
 *
 * Secret hygiene: anon-tier sign-ins use a random in-memory password and
 * never log it; secrets are referenced only via process.env keys, never
 * value-printed.
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
  // Seed records owned by each worker, used for correction tests.
  t1MovementRecordId: string;
  t1InventoryRecordId: string;
  t1MfgProcessId: string;
  t1ManufacturingRecordId: string;
  t2MovementRecordId: string;
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
    .insert({ name, slug: `rls5-${rand()}` })
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
  const email = `rls5-${rand()}@example.test`;
  const password = `Rls5Test!${rand()}!Pw`; // 10+ chars, never logged
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

async function seedMovementRecord(
  admin: SupabaseClient,
  tenantId: string,
  workerId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("movement_records")
    .insert({
      tenant_id: tenantId,
      business_code: "receiving",
      worker_id: workerId,
      item_code: `RLS5-${rand()}`,
      quantity: 5,
    })
    .select("id")
    .single();
  if (error) throw new Error(`movement seed failed: ${error.message}`);
  return data.id;
}

async function seedInventoryRecord(
  admin: SupabaseClient,
  tenantId: string,
  workerId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("inventory_records")
    .insert({
      tenant_id: tenantId,
      worker_id: workerId,
      item_code: `RLS5-${rand()}`,
      counted_quantity: 3,
    })
    .select("id")
    .single();
  if (error) throw new Error(`inventory seed failed: ${error.message}`);
  return data.id;
}

async function seedManufacturing(
  admin: SupabaseClient,
  tenantId: string,
  workerId: string,
): Promise<{ processId: string; recordId: string }> {
  // mfg_processes is the production schema:
  //   (manufacturing_plan_id NOT NULL, tenant_id, process_order, process_id?,
  //    equipment_id?, ...) — NO code/name columns.
  // So we seed: manufacturing_plan → mfg_processes → manufacturing_records.
  const { data: plan, error: planErr } = await admin
    .from("manufacturing_plans")
    .insert({
      tenant_id: tenantId,
      order_no: `rls5-${rand()}`,
      item_code: `RLS5-ITEM-${rand()}`,
      planned_quantity: 10,
    })
    .select("id")
    .single();
  if (planErr) throw new Error(`manufacturing_plan seed failed: ${planErr.message}`);

  const { data: mfg, error: mfgErr } = await admin
    .from("mfg_processes")
    .insert({
      tenant_id: tenantId,
      manufacturing_plan_id: plan.id,
      process_order: 1,
    })
    .select("id")
    .single();
  if (mfgErr) throw new Error(`mfg_process seed failed: ${mfgErr.message}`);

  const { data: rec, error: recErr } = await admin
    .from("manufacturing_records")
    .insert({
      tenant_id: tenantId,
      mfg_process_id: mfg.id,
      worker_id: workerId,
      work_date: new Date().toISOString().slice(0, 10),
      actual_quantity: 10,
    })
    .select("id")
    .single();
  if (recErr) throw new Error(`manufacturing_records seed failed: ${recErr.message}`);

  return { processId: mfg.id, recordId: rec.id };
}

describeLive("Live RLS integration (Phase 5a corrections foundation)", () => {
  let suite: Suite;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const t1 = await provisionTenant(admin, "RLS5-T1");
    const t2 = await provisionTenant(admin, "RLS5-T2");
    const t1Worker = await provisionUser(admin, t1, "worker");
    const t1Admin = await provisionUser(admin, t1, "tenant_admin");
    const t2Worker = await provisionUser(admin, t2, "worker");
    const t1MovementRecordId = await seedMovementRecord(admin, t1, t1Worker.userId);
    const t1InventoryRecordId = await seedInventoryRecord(admin, t1, t1Worker.userId);
    const { processId: t1MfgProcessId, recordId: t1ManufacturingRecordId } =
      await seedManufacturing(admin, t1, t1Worker.userId);
    const t2MovementRecordId = await seedMovementRecord(admin, t2, t2Worker.userId);
    suite = {
      admin,
      t1Worker,
      t1Admin,
      t2Worker,
      t1MovementRecordId,
      t1InventoryRecordId,
      t1MfgProcessId,
      t1ManufacturingRecordId,
      t2MovementRecordId,
    };
  }, 90_000);

  afterAll(async () => {
    if (!suite) return;
    const { admin, t1Worker, t1Admin, t2Worker } = suite;
    for (const u of [t1Worker, t1Admin, t2Worker]) {
      try {
        await admin.auth.admin.deleteUser(u.userId);
      } catch {}
    }
    try {
      await admin.from("tenants").delete().eq("id", t1Worker.tenantId);
    } catch {}
    try {
      await admin.from("tenants").delete().eq("id", t2Worker.tenantId);
    } catch {}
  }, 60_000);

  // -----------------------------------------------------------------
  // RLS-501: corrections_audit cross-tenant SELECT returns 0 rows.
  //   Seed a T1 audit row via the SECURITY INVOKER RPC under T1 worker,
  //   then verify a T2 worker cannot SELECT it.
  // -----------------------------------------------------------------
  it("RLS-501 corrections_audit cross-tenant SELECT returns 0 rows", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { data: rpcData, error: rpcErr } = await t1.rpc(
      "submit_movement_correction",
      {
        p_old_id: suite.t1MovementRecordId,
        p_new_data: {
          business_code: "receiving",
          item_code: "RLS5-CORRECTED",
          quantity: 7,
          match_result: "ok",
        },
        p_reason: "RLS-501 seed correction",
      },
    );
    expect(rpcErr).toBeNull();
    expect(rpcData).toBeTruthy();
    const auditId = (rpcData as { audit_id?: string } | null)?.audit_id;
    expect(typeof auditId).toBe("string");

    const t2 = await clientAs(suite.t2Worker);
    const { data, error } = await t2
      .from("corrections_audit")
      .select("id")
      .eq("id", auditId!);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // -----------------------------------------------------------------
  // RLS-502: worker direct INSERT into corrections_audit must be
  //   rejected even with actor_id=auth.uid() because the row is meant
  //   to be written through the SECURITY INVOKER RPCs. Worker can
  //   technically satisfy the WITH CHECK (actor_id=self,
  //   tenant_id=current), but the realistic abuse case (forged
  //   audit row) — actor_id != auth.uid() or tenant_id != current —
  //   MUST be rejected. This test exercises BOTH variants and
  //   asserts the forged variant is rejected.
  // -----------------------------------------------------------------
  it("RLS-502 worker direct INSERT corrections_audit with foreign actor_id is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("corrections_audit").insert({
      tenant_id: suite.t1Worker.tenantId,
      actor_id: suite.t1Admin.userId, // different user → rejected by WITH CHECK
      business_code: "receiving",
      target_table: "movement_records",
      old_record_id: suite.t1MovementRecordId,
      new_record_id: suite.t1MovementRecordId,
      reason: "RLS-502 forged",
    });
    expect(error).not.toBeNull();
  });

  it("RLS-502 cross-tenant INSERT corrections_audit is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.from("corrections_audit").insert({
      tenant_id: suite.t2Worker.tenantId, // foreign tenant → rejected
      actor_id: suite.t1Worker.userId,
      business_code: "receiving",
      target_table: "movement_records",
      old_record_id: suite.t1MovementRecordId,
      new_record_id: suite.t1MovementRecordId,
      reason: "RLS-502 cross-tenant forged",
    });
    expect(error).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // RLS-503: tenant_admin UPDATE OK / worker UPDATE rejected.
  //   Test approval flow: tenant_admin can stamp approved_by/approved_at,
  //   worker cannot.
  // -----------------------------------------------------------------
  it("RLS-503 tenant_admin UPDATE corrections_audit OK; worker UPDATE rejected", async () => {
    // 1. Create an audit row as T1 worker via the RPC.
    const t1w = await clientAs(suite.t1Worker);
    const { data: rpcData, error: rpcErr } = await t1w.rpc(
      "submit_inventory_correction",
      {
        p_old_id: suite.t1InventoryRecordId,
        p_new_data: { item_code: "RLS5-INV-CORRECTED", counted_quantity: 9 },
        p_reason: "RLS-503 seed correction",
      },
    );
    expect(rpcErr).toBeNull();
    const auditId = (rpcData as { audit_id?: string } | null)?.audit_id;
    expect(typeof auditId).toBe("string");

    // 2. Worker UPDATE must be rejected (or 0 rows).
    const { data: wData, error: wErr } = await t1w
      .from("corrections_audit")
      .update({ approved_by: suite.t1Worker.userId, approved_at: new Date().toISOString() })
      .eq("id", auditId!)
      .select();
    if (wErr) {
      expect(wErr).not.toBeNull();
    } else {
      expect((wData ?? []).length).toBe(0);
    }

    // 3. tenant_admin UPDATE must succeed.
    const t1a = await clientAs(suite.t1Admin);
    const { data: aData, error: aErr } = await t1a
      .from("corrections_audit")
      .update({ approved_by: suite.t1Admin.userId, approved_at: new Date().toISOString() })
      .eq("id", auditId!)
      .select("id, approved_by");
    expect(aErr).toBeNull();
    expect((aData ?? []).length).toBe(1);
    expect((aData?.[0] as { approved_by?: string } | undefined)?.approved_by).toBe(
      suite.t1Admin.userId,
    );
  });

  // -----------------------------------------------------------------
  // RLS-504: all 3 correction RPCs work end-to-end:
  //   old row deleted_at set + new row inserted with previous_record_id
  //   + corrections_audit insert succeeds.
  // -----------------------------------------------------------------
  it("RLS-504 submit_movement_correction sets deleted_at + inserts new + audit", async () => {
    // Seed a fresh movement record (RLS-501 already corrected the
    // beforeAll seed).
    const { admin } = suite;
    const oldId = await seedMovementRecord(
      admin,
      suite.t1Worker.tenantId,
      suite.t1Worker.userId,
    );
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1.rpc("submit_movement_correction", {
      p_old_id: oldId,
      p_new_data: {
        business_code: "receiving",
        item_code: "RLS5-MV-FRESH",
        quantity: 11,
        match_result: "ok",
      },
      p_reason: "RLS-504 movement correction",
    });
    expect(error).toBeNull();
    const result = data as { new_record_id?: string; audit_id?: string } | null;
    expect(typeof result?.new_record_id).toBe("string");
    expect(typeof result?.audit_id).toBe("string");

    // Old row: deleted_at must be set. Use admin to bypass RLS for the
    // deleted_at probe (anon SELECT also returns the row since RLS is
    // tenant-only, but admin avoids ambiguity).
    const { data: oldRow } = await admin
      .from("movement_records")
      .select("id, deleted_at")
      .eq("id", oldId)
      .single();
    expect(oldRow?.deleted_at).not.toBeNull();

    // New row: previous_record_id == oldId.
    const { data: newRow } = await admin
      .from("movement_records")
      .select("id, previous_record_id, worker_id, tenant_id")
      .eq("id", result!.new_record_id!)
      .single();
    expect(newRow?.previous_record_id).toBe(oldId);
    expect(newRow?.worker_id).toBe(suite.t1Worker.userId);
    expect(newRow?.tenant_id).toBe(suite.t1Worker.tenantId);

    // Audit row exists with matching old/new + actor_id == worker.
    const { data: auditRow } = await admin
      .from("corrections_audit")
      .select("id, actor_id, old_record_id, new_record_id, target_table, business_code")
      .eq("id", result!.audit_id!)
      .single();
    expect(auditRow?.actor_id).toBe(suite.t1Worker.userId);
    expect(auditRow?.old_record_id).toBe(oldId);
    expect(auditRow?.new_record_id).toBe(result!.new_record_id);
    expect(auditRow?.target_table).toBe("movement_records");
    expect(auditRow?.business_code).toBe("receiving");
  });

  it("RLS-504 submit_inventory_correction sets deleted_at + inserts new + audit", async () => {
    const { admin } = suite;
    const oldId = await seedInventoryRecord(
      admin,
      suite.t1Worker.tenantId,
      suite.t1Worker.userId,
    );
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1.rpc("submit_inventory_correction", {
      p_old_id: oldId,
      p_new_data: { item_code: "RLS5-INV-FRESH", counted_quantity: 8 },
      p_reason: "RLS-504 inventory correction",
    });
    expect(error).toBeNull();
    const result = data as { new_record_id?: string; audit_id?: string } | null;
    expect(typeof result?.new_record_id).toBe("string");

    const { data: oldRow } = await admin
      .from("inventory_records")
      .select("deleted_at")
      .eq("id", oldId)
      .single();
    expect(oldRow?.deleted_at).not.toBeNull();

    const { data: newRow } = await admin
      .from("inventory_records")
      .select("previous_record_id, worker_id, tenant_id")
      .eq("id", result!.new_record_id!)
      .single();
    expect(newRow?.previous_record_id).toBe(oldId);
    expect(newRow?.worker_id).toBe(suite.t1Worker.userId);

    const { data: auditRow } = await admin
      .from("corrections_audit")
      .select("target_table, business_code")
      .eq("id", result!.audit_id!)
      .single();
    expect(auditRow?.target_table).toBe("inventory_records");
    expect(auditRow?.business_code).toBe("inventory");
  });

  it("RLS-504 submit_manufacturing_correction sets deleted_at + inserts new + audit", async () => {
    const { admin } = suite;
    const { recordId: oldId } = await seedManufacturing(
      admin,
      suite.t1Worker.tenantId,
      suite.t1Worker.userId,
    );
    const t1 = await clientAs(suite.t1Worker);
    const { data, error } = await t1.rpc("submit_manufacturing_correction", {
      p_old_id: oldId,
      p_new_data: { actual_quantity: 15, defect_quantity: 0 },
      p_reason: "RLS-504 manufacturing correction",
    });
    expect(error).toBeNull();
    const result = data as {
      new_record_id?: string;
      audit_id?: string;
      rolled_back_inflow?: boolean;
    } | null;
    expect(typeof result?.new_record_id).toBe("string");
    expect(result?.rolled_back_inflow).toBe(false);

    const { data: oldRow } = await admin
      .from("manufacturing_records")
      .select("deleted_at")
      .eq("id", oldId)
      .single();
    expect(oldRow?.deleted_at).not.toBeNull();

    const { data: newRow } = await admin
      .from("manufacturing_records")
      .select("previous_record_id, worker_id, tenant_id")
      .eq("id", result!.new_record_id!)
      .single();
    expect(newRow?.previous_record_id).toBe(oldId);
    expect(newRow?.worker_id).toBe(suite.t1Worker.userId);

    const { data: auditRow } = await admin
      .from("corrections_audit")
      .select("target_table, business_code")
      .eq("id", result!.audit_id!)
      .single();
    expect(auditRow?.target_table).toBe("manufacturing_records");
    expect(auditRow?.business_code).toBe("manufacturing");
  });

  // -----------------------------------------------------------------
  // RLS-504 cross-tenant guardrail: caller cannot correct another tenant's
  //   row even via the RPC. The SECURITY INVOKER function SELECTs the old
  //   row under caller RLS; cross-tenant rows yield 0 rows → exception
  //   (Postgrest surfaces it as a non-null error).
  // -----------------------------------------------------------------
  it("RLS-504 submit_movement_correction across tenants is rejected", async () => {
    const t1 = await clientAs(suite.t1Worker);
    const { error } = await t1.rpc("submit_movement_correction", {
      p_old_id: suite.t2MovementRecordId,
      p_new_data: {
        business_code: "receiving",
        item_code: "RLS5-X",
        quantity: 1,
        match_result: "ok",
      },
      p_reason: "cross-tenant attempt",
    });
    expect(error).not.toBeNull();
  });
});

/**
 * Always exported as a regular describe (not skipped) so the test reporter
 * surfaces *why* the live tests are skipped when env vars are missing.
 */
describe("Live RLS phase5 gating", () => {
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
        `Live RLS phase5 tests skipped: missing ${reasons.join(", ")}`,
      ).toBeGreaterThan(0);
    }
  });
});

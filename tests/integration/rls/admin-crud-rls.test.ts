/**
 * Live RLS integration tests — Phase 6a foundation (RLS-505 / RLS-506).
 *
 * Closes P2-AUDIT-PHASE5-01 by exercising the admin-only RLS boundaries on
 *   * csv_import_definitions  (RLS-505)
 *   * profiles                (RLS-506)
 * which Phase 5b/5c shipped policies for but never live-asserted under a
 * worker JWT.
 *
 * Coverage map (see also docs/ARCHITECTURE-phase6-operational-features.md
 * §C.6a):
 *   RLS-505a worker INSERT into csv_import_definitions is rejected
 *   RLS-505b worker UPDATE of an existing csv_import_definitions row is
 *            rejected (returns 0 rows or error)
 *   RLS-505c tenant_admin INSERT into csv_import_definitions succeeds for
 *            their own tenant
 *   RLS-505d tenant_admin INSERT into another tenant's csv_import_definitions
 *            is rejected
 *   RLS-506a worker INSERT into profiles is rejected
 *   RLS-506b worker UPDATE of another user's profile row is rejected
 *            (returns 0 rows or error)
 *   RLS-506c tenant_admin UPDATE of a same-tenant profile succeeds
 *   RLS-506d tenant_admin UPDATE of a foreign-tenant profile is rejected
 *
 * Gating: identical to other live RLS suites — skipped unless
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
 *   SUPABASE_SERVICE_ROLE_KEY AND RUN_LIVE_RLS_TESTS=1.
 *
 * Secret hygiene: passwords are random in-memory; values are never logged.
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
  t2Admin: SyntheticUser;
  // Pre-seeded csv_import_definitions row in T1 used for the worker UPDATE probe
  t1CsvDefId: string;
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
    .insert({ name, slug: `rls6a-${rand()}` })
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
  const email = `rls6a-${role}-${rand()}@example.test`;
  const password = `Rls6aTest!${rand()}!Pw`;
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

async function seedCsvImportDefinition(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("csv_import_definitions")
    .insert({
      tenant_id: tenantId,
      business_code: "receiving",
      target_table: "movement_records",
      definition_code: `RLS6A-${rand()}`,
      definition_name: "RLS6A seed import",
    })
    .select("id")
    .single();
  if (error) throw new Error(`csv_import_definitions seed failed: ${error.message}`);
  return data.id;
}

describeLive("Live RLS Phase 6a admin-CRUD boundaries (RLS-505 / RLS-506)", () => {
  let suite: Suite;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const t1 = await provisionTenant(admin, "RLS6A-T1");
    const t2 = await provisionTenant(admin, "RLS6A-T2");
    const t1Worker = await provisionUser(admin, t1, "worker");
    const t1Admin = await provisionUser(admin, t1, "tenant_admin");
    const t2Admin = await provisionUser(admin, t2, "tenant_admin");
    const t1CsvDefId = await seedCsvImportDefinition(admin, t1);
    suite = { admin, t1Worker, t1Admin, t2Admin, t1CsvDefId };
  }, 90_000);

  afterAll(async () => {
    if (!suite) return;
    const { admin, t1Worker, t1Admin, t2Admin } = suite;
    for (const u of [t1Worker, t1Admin, t2Admin]) {
      try {
        await admin.auth.admin.deleteUser(u.userId);
      } catch {}
    }
    try {
      await admin.from("tenants").delete().eq("id", t1Worker.tenantId);
    } catch {}
    try {
      await admin.from("tenants").delete().eq("id", t2Admin.tenantId);
    } catch {}
  }, 60_000);

  // ---------------------------------------------------------------
  // RLS-505: csv_import_definitions admin-only modify boundary.
  //   Policy:
  //     SELECT: same tenant authenticated user
  //     ALL (insert/update/delete): tenant_admin (same tenant) or system_admin
  // ---------------------------------------------------------------
  it("RLS-505a worker INSERT csv_import_definitions is rejected", async () => {
    const t1w = await clientAs(suite.t1Worker);
    const { data, error } = await t1w
      .from("csv_import_definitions")
      .insert({
        tenant_id: suite.t1Worker.tenantId,
        business_code: "receiving",
        target_table: "movement_records",
        definition_code: `RLS6A-WORKER-${rand()}`,
        definition_name: "RLS-505a worker attempt",
      })
      .select();
    // Either an explicit error, or 0 returning rows (PostgREST surfaces the
    // RLS denial both ways depending on the row representation header).
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  it("RLS-505b worker UPDATE csv_import_definitions is rejected", async () => {
    const t1w = await clientAs(suite.t1Worker);
    const { data, error } = await t1w
      .from("csv_import_definitions")
      .update({ definition_name: "RLS-505b worker tamper" })
      .eq("id", suite.t1CsvDefId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
    // Sanity: the underlying row was not mutated (admin SELECT bypasses RLS).
    const { data: row } = await suite.admin
      .from("csv_import_definitions")
      .select("definition_name")
      .eq("id", suite.t1CsvDefId)
      .single();
    expect(row?.definition_name).toBe("RLS6A seed import");
  });

  it("RLS-505c tenant_admin INSERT csv_import_definitions in own tenant succeeds", async () => {
    const t1a = await clientAs(suite.t1Admin);
    const code = `RLS6A-ADMIN-${rand()}`;
    const { data, error } = await t1a
      .from("csv_import_definitions")
      .insert({
        tenant_id: suite.t1Admin.tenantId,
        business_code: "receiving",
        target_table: "movement_records",
        definition_code: code,
        definition_name: "RLS-505c tenant_admin allowed",
      })
      .select("id, definition_code")
      .single();
    expect(error).toBeNull();
    expect(data?.definition_code).toBe(code);
    // best-effort cleanup
    if (data?.id) {
      try {
        await suite.admin.from("csv_import_definitions").delete().eq("id", data.id);
      } catch {}
    }
  });

  it("RLS-505d tenant_admin INSERT csv_import_definitions for foreign tenant is rejected", async () => {
    const t1a = await clientAs(suite.t1Admin);
    const { data, error } = await t1a
      .from("csv_import_definitions")
      .insert({
        tenant_id: suite.t2Admin.tenantId, // cross-tenant attempt
        business_code: "receiving",
        target_table: "movement_records",
        definition_code: `RLS6A-XTENANT-${rand()}`,
        definition_name: "RLS-505d cross-tenant",
      })
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
  });

  // ---------------------------------------------------------------
  // RLS-506: profiles admin-only modify boundary.
  //   Policy:
  //     SELECT: same tenant or system_admin
  //     UPDATE: self OR (same tenant tenant_admin) OR system_admin
  //     INSERT: tenant_admin (same tenant) or system_admin
  //     DELETE: tenant_admin (same tenant) or system_admin
  // ---------------------------------------------------------------
  it("RLS-506a worker INSERT profiles (foreign row) is rejected", async () => {
    // Create a brand-new auth user as service_role so we have a target uuid
    // that does not yet have a profile row, then attempt to insert as worker.
    const targetEmail = `rls6a-target-${rand()}@example.test`;
    const targetPassword = `Rls6aT!${rand()}!Pw`;
    const { data: created, error: createErr } = await suite.admin.auth.admin.createUser(
      {
        email: targetEmail,
        password: targetPassword,
        email_confirm: true,
        app_metadata: { tenant_id: suite.t1Worker.tenantId, role: "worker" },
      },
    );
    expect(createErr).toBeNull();
    const targetId = created!.user!.id;
    try {
      const t1w = await clientAs(suite.t1Worker);
      const { data, error } = await t1w
        .from("profiles")
        .insert({
          id: targetId,
          tenant_id: suite.t1Worker.tenantId,
          role: "worker",
          display_name: "RLS-506a worker forged",
        })
        .select();
      if (error) {
        expect(error).not.toBeNull();
      } else {
        expect((data ?? []).length).toBe(0);
      }
    } finally {
      try {
        await suite.admin.auth.admin.deleteUser(targetId);
      } catch {}
    }
  });

  it("RLS-506b worker UPDATE of another user's profile is rejected", async () => {
    const t1w = await clientAs(suite.t1Worker);
    const { data, error } = await t1w
      .from("profiles")
      .update({ display_name: "RLS-506b worker tamper" })
      .eq("id", suite.t1Admin.userId) // attempting to mutate the admin's profile
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
    const { data: row } = await suite.admin
      .from("profiles")
      .select("display_name")
      .eq("id", suite.t1Admin.userId)
      .single();
    expect(row?.display_name).toBe("tenant_admin");
  });

  it("RLS-506c tenant_admin UPDATE of same-tenant profile succeeds", async () => {
    const t1a = await clientAs(suite.t1Admin);
    const newName = `worker-${rand()}`;
    const { data, error } = await t1a
      .from("profiles")
      .update({ display_name: newName })
      .eq("id", suite.t1Worker.userId)
      .select("id, display_name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect((data?.[0] as { display_name?: string } | undefined)?.display_name).toBe(
      newName,
    );
  });

  it("RLS-506d tenant_admin UPDATE of foreign-tenant profile is rejected", async () => {
    const t1a = await clientAs(suite.t1Admin);
    const { data, error } = await t1a
      .from("profiles")
      .update({ display_name: "RLS-506d cross-tenant" })
      .eq("id", suite.t2Admin.userId)
      .select();
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect((data ?? []).length).toBe(0);
    }
    const { data: row } = await suite.admin
      .from("profiles")
      .select("display_name")
      .eq("id", suite.t2Admin.userId)
      .single();
    expect(row?.display_name).toBe("tenant_admin");
  });
});

/**
 * Always exported as a regular describe (not skipped) so the test reporter
 * surfaces *why* the live tests are skipped when env vars are missing.
 */
describe("Live RLS phase6a gating", () => {
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
        `Live RLS phase6a tests skipped: missing ${reasons.join(", ")}`,
      ).toBeGreaterThan(0);
    }
  });
});

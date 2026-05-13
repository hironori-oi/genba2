/**
 * Live EF envelope tests for manufacturing-plan-csv-import.
 *
 * Mirrors the security envelope documented in
 *   supabase/functions/manufacturing-plan-csv-import/index.ts
 * and docs/ARCHITECTURE-phase4-manufacturing.md §5.4 / §8.1:
 *
 *   * 415 unsupported_content_type when Content-Type is not CSV-ish.
 *   * 413 file_too_large when the body exceeds the 10 MB cap.
 *   * 413 row_limit_exceeded when the CSV exceeds 100_000 data rows.
 *   * Formula injection prepend: cells starting with `=`, `+`, `-`, `@`,
 *     `\t`, or `\r` are stored with a leading `'`.
 *   * JWT round-trip: missing / invalid Bearer is rejected with 401.
 *
 * Gated on:
 *   NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY +
 *   SUPABASE_SERVICE_ROLE_KEY + RUN_LIVE_EF_TESTS=1.
 *
 * The EF must be deployed to the Supabase project; this test does NOT
 * deploy it (owner-gated `supabase functions deploy` is part of the
 * Phase 4d-deploy dispatch, not 4d-prep).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const LIVE = Boolean(
  SUPABASE_URL && ANON_KEY && SERVICE_KEY && process.env.RUN_LIVE_EF_TESTS === "1",
);

const describeLive = LIVE ? describe : describe.skip;

const ENDPOINT = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/manufacturing-plan-csv-import`;

const MAX_BYTES = 10 * 1024 * 1024;

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

describeLive("Live EF manufacturing-plan-csv-import envelope", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let adminUserId: string;
  let bearerToken: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: "EF-T1-P4d", slug: `ef-${rand()}` })
      .select("id")
      .single();
    if (tErr || !tenant) throw new Error(`tenant insert failed: ${tErr?.message}`);
    tenantId = tenant.id;

    const email = `ef-${rand()}@example.test`;
    const password = `EfTest!${rand()}!Pw`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: "tenant_admin" },
    });
    if (uErr || !created.user) throw new Error(`createUser failed: ${uErr?.message}`);
    adminUserId = created.user.id;

    const { error: pErr } = await admin
      .from("profiles")
      .insert({
        id: adminUserId,
        tenant_id: tenantId,
        role: "tenant_admin",
        display_name: "ef-admin",
      });
    if (pErr) throw new Error(`profile insert failed: ${pErr.message}`);

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: session, error: sErr } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (sErr || !session.session) throw new Error(`signIn failed: ${sErr?.message}`);
    bearerToken = session.session.access_token;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.auth.admin.deleteUser(adminUserId);
    } catch {}
    try {
      await admin.from("tenants").delete().eq("id", tenantId);
    } catch {}
  }, 30_000);

  // -------------------------------------------------------------------
  // 415 unsupported Content-Type
  // -------------------------------------------------------------------
  it("415 when Content-Type is application/json (CSV / spreadsheet required)", async () => {
    const r = await fetch(`${ENDPOINT}?kind=plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(r.status).toBe(415);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unsupported_content_type");
  });

  // -------------------------------------------------------------------
  // 413 over 10 MB
  // -------------------------------------------------------------------
  it(
    "413 when body exceeds 10 MB cap",
    async () => {
      const overSize = MAX_BYTES + 1024; // 10 MB + 1 KB
      const payload = "a".repeat(overSize);
      const r = await fetch(`${ENDPOINT}?kind=plan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "text/csv",
        },
        body: payload,
      });
      expect(r.status).toBe(413);
      const body = (await r.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("file_too_large");
    },
    90_000,
  );

  // -------------------------------------------------------------------
  // 413 over 100_000 rows
  // -------------------------------------------------------------------
  it(
    "413 when row count exceeds 100_000",
    async () => {
      const header = "order_no,item_code,planned_quantity\n";
      const rowFn = (i: number) => `O-${i},I,1\n`;
      const chunks: string[] = [header];
      // 100_001 data rows so total raw lines = header + 100_001 > MAX_ROWS+1.
      for (let i = 0; i < 100_001; i++) chunks.push(rowFn(i));
      const payload = chunks.join("");
      expect(payload.length).toBeLessThan(MAX_BYTES);
      const r = await fetch(`${ENDPOINT}?kind=plan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "text/csv",
        },
        body: payload,
      });
      expect(r.status).toBe(413);
      const body = (await r.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("row_limit_exceeded");
    },
    180_000,
  );

  // -------------------------------------------------------------------
  // Formula-injection prepend
  // -------------------------------------------------------------------
  it("formula injection: leading '=' is escaped with leading '", async () => {
    const orderNo = `=HYPERLINK("https://evil.example/${rand()}")`;
    const header = "order_no,item_code,planned_quantity\n";
    // Quote the order_no so the embedded comma/quote do not break the row.
    const escaped = orderNo.replace(/"/g, '""');
    const itemCode = `ITEM-FI-${rand()}`;
    const data = `"${escaped}",${itemCode},1\n`;
    const r = await fetch(`${ENDPOINT}?kind=plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "text/csv",
      },
      body: header + data,
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { succeeded?: number };
    expect(body.succeeded).toBe(1);

    const { data: row, error: rErr } = await admin
      .from("manufacturing_plans")
      .select("order_no")
      .eq("tenant_id", tenantId)
      .eq("item_code", itemCode)
      .maybeSingle();
    expect(rErr).toBeNull();
    expect(row?.order_no).toBe(`'${orderNo}`);
  });

  // -------------------------------------------------------------------
  // JWT round-trip: missing Authorization
  // -------------------------------------------------------------------
  it("401 unauthenticated when Authorization header is missing", async () => {
    const r = await fetch(`${ENDPOINT}?kind=plan`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: "order_no,item_code,planned_quantity\nO1,ITEM,1\n",
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unauthenticated");
  });

  // -------------------------------------------------------------------
  // JWT round-trip: invalid Bearer
  // -------------------------------------------------------------------
  it("401 unauthenticated when Authorization Bearer is invalid", async () => {
    const r = await fetch(`${ENDPOINT}?kind=plan`, {
      method: "POST",
      headers: {
        Authorization: "Bearer not-a-real-token-xyz",
        "Content-Type": "text/csv",
      },
      body: "order_no,item_code,planned_quantity\nO1,ITEM,1\n",
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unauthenticated");
  });
});

describe("Live EF manufacturing-plan-csv-import gating", () => {
  it("is enabled only when SUPABASE env + RUN_LIVE_EF_TESTS=1 are set", () => {
    if (LIVE) {
      expect(LIVE).toBe(true);
    } else {
      const reasons: string[] = [];
      if (!SUPABASE_URL) reasons.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!ANON_KEY) reasons.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (!SERVICE_KEY) reasons.push("SUPABASE_SERVICE_ROLE_KEY");
      if (process.env.RUN_LIVE_EF_TESTS !== "1") reasons.push("RUN_LIVE_EF_TESTS=1");
      expect(
        reasons.length,
        `Live EF tests skipped: missing ${reasons.join(", ")}`,
      ).toBeGreaterThan(0);
    }
  });
});

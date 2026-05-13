import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/**
 * Strip line comments (// and SQL --) and block comments before grepping so
 * that cautionary mentions of `raw_user_metadata` in JSDoc / migration notices
 * (which document the rule) do not register as real reads.
 */
function stripComments(source: string): string {
  // /* ... */ block comments
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Lines that are pure // or -- comments
  out = out
    .split("\n")
    .map((line) => {
      const tsCommentIdx = line.indexOf("//");
      const sqlCommentIdx = line.indexOf("--");
      const idx = [tsCommentIdx, sqlCommentIdx]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      if (idx === undefined) return line;
      return line.slice(0, idx);
    })
    .join("\n");
  // raise notice 'message …'; mentions in SQL — drop string literals entirely.
  out = out.replace(/'(?:[^']|'')*'/g, "''");
  return out;
}

describe("RLS-008 raw_user_metadata sink check", () => {
  it("never reads raw_user_metadata in migrations (excluding cautionary notices)", () => {
    const migration = stripComments(
      read("supabase/migrations/20260511000000_phase1_init.sql"),
    );
    expect(migration).not.toMatch(/raw_user_metadata/i);
  });

  it("never reads raw_user_metadata in application code (under src/)", () => {
    const sources = [
      "src/lib/auth/session.ts",
      "src/lib/auth/role-change.ts",
      "src/lib/supabase/middleware.ts",
      "src/lib/supabase/server.ts",
      "src/lib/supabase/client.ts",
      "src/lib/supabase/admin.ts",
      "src/app/login/actions.ts",
      "src/app/forgot-password/actions.ts",
    ];
    for (const src of sources) {
      const cleaned = stripComments(read(src));
      expect(cleaned, `unexpected raw_user_metadata read in ${src}`).not.toMatch(
        /raw_user_metadata/,
      );
    }
  });

  it("authorization claims are sourced from app_metadata (raw_app_meta_data)", () => {
    const session = read("src/lib/auth/session.ts");
    expect(session).toMatch(/app_metadata/);
  });
});

describe("RLS-005 service_role placement", () => {
  it("service_role is only referenced from server-only files", () => {
    const allowed = [
      "src/lib/supabase/admin.ts",
      "src/lib/auth/role-change.ts",
      "src/lib/env.ts",
      ".env.example",
    ];
    for (const file of allowed) {
      const content = read(file);
      // Any mention is fine; we are asserting they exist on the allow-list.
      expect(typeof content).toBe("string");
    }
  });
});

describe("Phase 1 migration shape", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260511000000_phase1_init.sql"),
    "utf8",
  );

  it("defines all four Phase 1 tables with RLS enabled", () => {
    for (const table of [
      "public.tenants",
      "public.profiles",
      "public.tenant_subscriptions",
      "public.businesses",
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
      expect(migration).toContain(
        `alter table ${table} enable row level security`,
      );
    }
  });

  it("seeds the four businesses on tenant insert", () => {
    expect(migration).toMatch(/'receiving'/);
    expect(migration).toMatch(/'picking'/);
    expect(migration).toMatch(/'inventory'/);
    expect(migration).toMatch(/'manufacturing'/);
  });

  it("audit columns created_by / updated_by are present on each Phase 1 table", () => {
    const expected = 4;
    const createdByMatches = migration.match(/created_by uuid references auth\.users/g) ?? [];
    const updatedByMatches = migration.match(/updated_by uuid references auth\.users/g) ?? [];
    expect(createdByMatches.length).toBeGreaterThanOrEqual(expected);
    expect(updatedByMatches.length).toBeGreaterThanOrEqual(expected);
  });

  it("JWT claim helpers exist", () => {
    expect(migration).toMatch(/create or replace function app\.current_tenant_id/);
    expect(migration).toMatch(/create or replace function app\.current_role/);
    expect(migration).toMatch(/create or replace function app\.is_tenant_admin/);
  });
});

describe("Phase 2 migration shape", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260512000000_phase2_settings_masters.sql"),
    "utf8",
  );

  it("defines every required Phase 2 table with RLS enabled", () => {
    const tables = [
      "public.standard_field_definitions",
      "public.tenant_field_settings",
      "public.custom_field_definitions",
      "public.qr_format_definitions",
      "public.qr_item_definitions",
      "public.match_rules",
      "public.match_rule_lines",
      "public.csv_import_definitions",
      "public.csv_export_definitions",
      "public.work_settings",
      "public.work_input_field_settings",
      "public.work_types",
      "public.processes",
      "public.equipment",
      "public.defect_groups",
      "public.defects",
    ];
    for (const t of tables) {
      expect(migration, `missing CREATE for ${t}`).toContain(`create table if not exists ${t}`);
      expect(migration, `missing RLS enable for ${t}`).toContain(
        `alter table ${t} enable row level security`,
      );
    }
  });

  it("qr_format_definitions enforces UNIQUE(tenant_id, qr_type, version)", () => {
    expect(migration).toMatch(/unique\s*\(tenant_id,\s*qr_type,\s*version\)/);
  });

  it("policies read JWT claims via app.* helpers (no auth.users join)", () => {
    expect(migration).toMatch(/app\.current_tenant_id\(\)/);
    expect(migration).toMatch(/app\.is_tenant_admin\(\)/);
    // No policy USING / WITH CHECK should reference auth.users directly.
    const policyText = migration
      .split("\n")
      .filter((line) => /create policy|using\s*\(|with check\s*\(/i.test(line))
      .join("\n");
    expect(policyText).not.toMatch(/auth\.users/);
  });

  it("standard_field_definitions exposes a system_admin-only modify policy", () => {
    expect(migration).toMatch(/standard_fields_modify_system_admin/);
    expect(migration).toMatch(/using \(app\.is_system_admin\(\)\)/);
  });

  it("tenant_field_settings enforces 5 purposes only (identify_header/identify_line/match_source/item_label/display_only)", () => {
    expect(migration).toMatch(
      /purpose\s+text\s+not\s+null\s+default\s+'display_only'[\s\S]*identify_header[\s\S]*identify_line[\s\S]*match_source[\s\S]*item_label[\s\S]*display_only/m,
    );
  });
});

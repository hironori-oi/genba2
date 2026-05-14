import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  source: "admin_audit_log" | "corrections_audit";
  id: string;
  tableName: string;
  op: string;
  actorId: string | null;
  createdAt: string;
  summary: string;
  reason?: string | null;
};

export type AuditFilter = {
  table?: string | null;
  op?: string | null;
  limit?: number;
};

const DEFAULT_LIMIT = 100;

export async function selectAuditEntries(
  supabase: SupabaseClient,
  tenantId: string,
  filter: AuditFilter = {},
): Promise<{ rows: AuditEntry[]; error: string | null }> {
  const limit = Math.max(1, Math.min(filter.limit ?? DEFAULT_LIMIT, 500));
  const halfLimit = Math.ceil(limit / 2);

  let adminQuery = supabase
    .from("admin_audit_log")
    .select("id, table_name, op, actor_id, before, after, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(halfLimit);

  if (filter.table) adminQuery = adminQuery.eq("table_name", filter.table);
  if (filter.op) adminQuery = adminQuery.eq("op", filter.op);

  const correctionsQuery = supabase
    .from("corrections_audit")
    .select(
      "id, target_table, business_code, actor_id, reason, created_at, approved_by, approved_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(halfLimit);

  const [adminRes, correctionsRes] = await Promise.all([
    adminQuery,
    correctionsQuery,
  ]);

  if (adminRes.error) return { rows: [], error: adminRes.error.message };
  if (correctionsRes.error)
    return { rows: [], error: correctionsRes.error.message };

  const adminRows: AuditEntry[] = (adminRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      source: "admin_audit_log",
      id: String(row.id),
      tableName: String(row.table_name ?? ""),
      op: String(row.op ?? ""),
      actorId: row.actor_id ? String(row.actor_id) : null,
      createdAt: String(row.created_at ?? ""),
      summary: summarizeAdmin(row),
    };
  });

  const correctionRows: AuditEntry[] = (correctionsRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      source: "corrections_audit",
      id: String(row.id),
      tableName: String(row.target_table ?? ""),
      op: row.approved_by ? "APPROVE" : "CORRECT",
      actorId: row.actor_id ? String(row.actor_id) : null,
      createdAt: String(row.created_at ?? ""),
      summary: String(row.business_code ?? "") || String(row.target_table ?? ""),
      reason: row.reason ? String(row.reason) : null,
    };
  });

  const rows = [...adminRows, ...correctionRows]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);

  return { rows, error: null };
}

function summarizeAdmin(row: Record<string, unknown>): string {
  const before = row.before as Record<string, unknown> | null;
  const after = row.after as Record<string, unknown> | null;
  const target = after ?? before ?? null;
  if (target && typeof target.id === "string") {
    return `${row.op} id=${(target.id as string).slice(0, 8)}…`;
  }
  if (target && typeof target.code === "string") {
    return `${row.op} code=${target.code}`;
  }
  return String(row.op ?? "");
}

export function toCsv(rows: AuditEntry[]): string {
  const header = [
    "source",
    "id",
    "table_name",
    "op",
    "actor_id",
    "created_at",
    "summary",
    "reason",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.source,
      r.id,
      r.tableName,
      r.op,
      r.actorId ?? "",
      r.createdAt,
      escapeCsv(r.summary),
      escapeCsv(r.reason ?? ""),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function escapeCsv(value: string): string {
  if (value === "") return "";
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

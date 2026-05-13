import "server-only";

/**
 * Server-only helpers for reading QR scan history. The Phase 3a foundation
 * layer ships only the READ side — mutation server actions land in Phase 3b
 * alongside the Scanner UI.
 *
 * Both helpers use the standard anon-JWT Supabase client (createClient from
 * @/lib/supabase/server). RLS + view filters in the database decide what the
 * caller actually sees:
 *
 *   * fetchScanHistoryForWorker  → v_qr_scan_histories       (no raw_value)
 *   * fetchScanHistoryForAdmin   → v_qr_scan_histories_admin (with raw_value;
 *                                  WHERE is_tenant_admin())
 *
 * Direct SELECT from public.qr_scan_histories is NOT used here — the column
 * grants set in migration 20260512000400 deliberately strip SELECT(raw_value)
 * from `authenticated`, so the base table is only safely queryable via the
 * two views (or the service_role client in admin scripts).
 */

import { createClient } from "@/lib/supabase/server";
import type {
  AnyBusinessCode,
  QrScanHistoryAdminRow,
  QrScanHistoryRow,
} from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type ScanHistoryFilters = {
  businessCode?: AnyBusinessCode;
  /** Inclusive ISO timestamp (UTC). */
  from?: string;
  /** Exclusive ISO timestamp (UTC). */
  to?: string;
  /** Max 200; defaults to 50. */
  limit?: number;
};

export type ScanHistoryResult<T> = {
  data: T[];
  error: { message: string; code?: string } | null;
};

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

// ---------------------------------------------------------------------
// Row mappers — DB rows are snake_case, domain types are camelCase.
// ---------------------------------------------------------------------
type RawHistoryRow = {
  id: string;
  tenant_id: string;
  scanned_by: string;
  qr_type: QrScanHistoryRow["qrType"];
  qr_format_definition_id: string | null;
  parsed_values: QrScanHistoryRow["parsedValues"] | null;
  warnings: string[] | null;
  match_result: QrScanHistoryRow["matchResult"];
  match_detail: unknown[] | null;
  target_table: QrScanHistoryRow["targetTable"];
  target_id: string | null;
  error_reason: string | null;
  business_code: QrScanHistoryRow["businessCode"];
  created_at: string;
};

function mapWorkerRow(r: RawHistoryRow): QrScanHistoryRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    scannedBy: r.scanned_by,
    qrType: r.qr_type,
    qrFormatDefinitionId: r.qr_format_definition_id,
    parsedValues: r.parsed_values ?? {},
    warnings: r.warnings ?? [],
    matchResult: r.match_result,
    matchDetail: r.match_detail ?? [],
    targetTable: r.target_table,
    targetId: r.target_id,
    errorReason: r.error_reason,
    businessCode: r.business_code,
    createdAt: r.created_at,
  };
}

function mapAdminRow(r: RawHistoryRow & { raw_value: string }): QrScanHistoryAdminRow {
  return { ...mapWorkerRow(r), rawValue: r.raw_value };
}

// ---------------------------------------------------------------------
// Worker read surface (no raw_value).
// ---------------------------------------------------------------------
export async function fetchScanHistoryForWorker(
  filters: ScanHistoryFilters = {},
): Promise<ScanHistoryResult<QrScanHistoryRow>> {
  const limit = clampLimit(filters.limit);
  const supabase = await createClient();
  let q = supabase
    .from("v_qr_scan_histories")
    .select(
      "id, tenant_id, scanned_by, qr_type, qr_format_definition_id, parsed_values, warnings, match_result, match_detail, target_table, target_id, error_reason, business_code, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.businessCode) q = q.eq("business_code", filters.businessCode);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lt("created_at", filters.to);

  const { data, error } = await q;
  if (error) {
    return { data: [], error: { message: error.message, code: error.code } };
  }
  return {
    data: (data ?? []).map((row) => mapWorkerRow(row as RawHistoryRow)),
    error: null,
  };
}

// ---------------------------------------------------------------------
// Per-id lookup — detail page support.
//
// Two flavours mirror the list helpers:
//
//   * fetchScanHistoryByIdForWorker → v_qr_scan_histories       (no raw_value)
//   * fetchScanHistoryByIdForAdmin  → v_qr_scan_histories_admin (with raw_value)
//
// Both return either {data: row, error: null} on hit, or {data: null, error}
// otherwise. RLS + the view filters decide what the caller actually sees;
// a row that exists for a different tenant will surface as a not-found via
// maybeSingle(). Callers MUST treat data === null as "not authorised / not
// found" indistinguishably (the worker UI must never differentiate to avoid
// leaking row existence across tenants).
// ---------------------------------------------------------------------
export type ScanHistoryByIdResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

export async function fetchScanHistoryByIdForWorker(
  id: string,
): Promise<ScanHistoryByIdResult<QrScanHistoryRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_qr_scan_histories")
    .select(
      "id, tenant_id, scanned_by, qr_type, qr_format_definition_id, parsed_values, warnings, match_result, match_detail, target_table, target_id, error_reason, business_code, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { data: null, error: { message: error.message, code: error.code } };
  }
  if (!data) return { data: null, error: null };
  return { data: mapWorkerRow(data as RawHistoryRow), error: null };
}

export async function fetchScanHistoryByIdForAdmin(
  id: string,
): Promise<ScanHistoryByIdResult<QrScanHistoryAdminRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_qr_scan_histories_admin")
    .select(
      "id, tenant_id, scanned_by, qr_type, qr_format_definition_id, raw_value, parsed_values, warnings, match_result, match_detail, target_table, target_id, error_reason, business_code, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { data: null, error: { message: error.message, code: error.code } };
  }
  if (!data) return { data: null, error: null };
  return {
    data: mapAdminRow(data as RawHistoryRow & { raw_value: string }),
    error: null,
  };
}

// ---------------------------------------------------------------------
// Admin read surface (with raw_value). The view's WHERE clause + the
// underlying column grant both gate non-admin callers to 0 rows.
// ---------------------------------------------------------------------
export async function fetchScanHistoryForAdmin(
  filters: ScanHistoryFilters = {},
): Promise<ScanHistoryResult<QrScanHistoryAdminRow>> {
  const limit = clampLimit(filters.limit);
  const supabase = await createClient();
  let q = supabase
    .from("v_qr_scan_histories_admin")
    .select(
      "id, tenant_id, scanned_by, qr_type, qr_format_definition_id, raw_value, parsed_values, warnings, match_result, match_detail, target_table, target_id, error_reason, business_code, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.businessCode) q = q.eq("business_code", filters.businessCode);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lt("created_at", filters.to);

  const { data, error } = await q;
  if (error) {
    return { data: [], error: { message: error.message, code: error.code } };
  }
  return {
    data: (data ?? []).map((row) =>
      mapAdminRow(row as RawHistoryRow & { raw_value: string }),
    ),
    error: null,
  };
}

import "server-only";

/**
 * Server-only read helpers for manufacturing history.
 *
 * Phase 4b focuses on the WORKS-specific surfaces; the 4-業務統合履歴 (which
 * spans LOGI receiving/picking/inventory + WORKS manufacturing) is wired
 * up in Phase 4c via the existing fetchScanHistoryFor* helpers in
 * src/lib/logi/history.ts (the `business_code` filter already accepts
 * "manufacturing" — no new query is needed for the scan trail).
 *
 * What lives here:
 *
 *   * fetchManufacturingHistory  — recent manufacturing_records rows for
 *                                  the caller's tenant, optionally filtered
 *                                  by worker / date range.
 *   * fetchManufacturingRecordById — single-row lookup (detail page).
 *
 * Both helpers use the anon-JWT Supabase client and rely on RLS to scope
 * rows to the caller's tenant. The worker view never reads raw_value
 * (that lives in qr_scan_histories and is gated by the existing
 * v_qr_scan_histories / v_qr_scan_histories_admin split — see
 * src/lib/logi/history.ts).
 *
 * Architecture: docs/ARCHITECTURE-phase4-manufacturing.md §5.2 / §6.
 */

import { createClient } from "@/lib/supabase/server";
import type { ManufacturingRecord } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type ManufacturingHistoryFilters = {
  /** Limit results to a specific worker (admin path). */
  workerId?: string;
  /** Inclusive ISO timestamp (UTC). */
  from?: string;
  /** Exclusive ISO timestamp (UTC). */
  to?: string;
  /** Max 200; defaults to 50. */
  limit?: number;
};

export type ManufacturingHistoryResult<T> = {
  data: T[];
  error: { message: string; code?: string } | null;
};

export type ManufacturingHistoryByIdResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

// ---------------------------------------------------------------------
// Row mapping helpers.
// ---------------------------------------------------------------------
type RawManufacturingRow = {
  id: string;
  tenant_id: string;
  mfg_process_id: string;
  worker_id: string;
  work_date: string;
  actual_quantity: number | string;
  good_quantity: number | string | null;
  defect_quantity: number | string;
  lot: string | null;
  equipment_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  work_minutes: number | string | null;
  match_result: ManufacturingRecord["matchResult"];
  match_detail: unknown[] | null;
  recorded_at: string;
  previous_record_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
};

function toNumberOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: RawManufacturingRow): ManufacturingRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    mfgProcessId: r.mfg_process_id,
    workerId: r.worker_id,
    workDate: r.work_date,
    actualQuantity: toNumberOrNull(r.actual_quantity) ?? 0,
    goodQuantity: toNumberOrNull(r.good_quantity),
    defectQuantity: toNumberOrNull(r.defect_quantity) ?? 0,
    lot: r.lot,
    equipmentId: r.equipment_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    workMinutes: toNumberOrNull(r.work_minutes),
    matchResult: r.match_result,
    matchDetail: r.match_detail ?? [],
    recordedAt: r.recorded_at,
    previousRecordId: r.previous_record_id,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    deletedAt: r.deleted_at,
  };
}

const SELECT_COLS =
  "id, tenant_id, mfg_process_id, worker_id, work_date, actual_quantity, good_quantity, defect_quantity, lot, equipment_id, started_at, ended_at, work_minutes, match_result, match_detail, recorded_at, previous_record_id, notes, created_at, updated_at, created_by, updated_by, deleted_at";

// ---------------------------------------------------------------------
// List read.
// ---------------------------------------------------------------------
export async function fetchManufacturingHistory(
  filters: ManufacturingHistoryFilters = {},
): Promise<ManufacturingHistoryResult<ManufacturingRecord>> {
  const limit = clampLimit(filters.limit);
  const supabase = await createClient();
  let q = supabase
    .from("manufacturing_records")
    .select(SELECT_COLS)
    .is("deleted_at", null)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (filters.workerId) q = q.eq("worker_id", filters.workerId);
  if (filters.from) q = q.gte("recorded_at", filters.from);
  if (filters.to) q = q.lt("recorded_at", filters.to);

  const { data, error } = await q;
  if (error) {
    return { data: [], error: { message: error.message, code: error.code } };
  }
  return {
    data: (data ?? []).map((row) => mapRow(row as RawManufacturingRow)),
    error: null,
  };
}

// ---------------------------------------------------------------------
// Detail read.
//
// A row that exists for a different tenant surfaces as not-found via
// maybeSingle(). Callers MUST treat data === null as "not authorised /
// not found" indistinguishably so the UI cannot leak row existence
// across tenants (same contract as fetchScanHistoryByIdForWorker).
// ---------------------------------------------------------------------
export async function fetchManufacturingRecordById(
  id: string,
): Promise<ManufacturingHistoryByIdResult<ManufacturingRecord>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manufacturing_records")
    .select(SELECT_COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    return { data: null, error: { message: error.message, code: error.code } };
  }
  if (!data) return { data: null, error: null };
  return { data: mapRow(data as RawManufacturingRow), error: null };
}

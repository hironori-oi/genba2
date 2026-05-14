import "server-only";

/**
 * Phase 6c — server-only fetchers for the 4 print reports.
 *
 * RLS-only path: every query uses the anon-JWT supabase client and tenant_id
 * is pinned by the policies already in place (Phase 3a/4). worker callers
 * intentionally get scoped to their own records via the `workerId` filter
 * (information_exposure minimisation per ADR-P6-07); tenant_admin sees the
 * full tenant.
 *
 * No new view/RPC is created. The inventory diff is computed inline by
 * joining inventory_records with inventory_plan_lines (item_code +
 * location_code) — the Phase 3a `v_inventory_diff` view referenced in the
 * architecture is not yet present in migrations.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  DefectReportRow,
  InventoryResultRow,
  ManufacturingDailyRow,
  PickingListRow,
  PrintFilter,
} from "./types";

const DEFAULT_LIMIT = 500;

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), 2000);
}

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function toNumber(v: number | string | null | undefined): number {
  return toNumberOrNull(v) ?? 0;
}

export type FetchOptions = {
  workerId?: string;
};

export async function fetchManufacturingDaily(
  filter: PrintFilter,
  opts: FetchOptions = {},
): Promise<ManufacturingDailyRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("manufacturing_records")
    .select(
      "id, work_date, recorded_at, actual_quantity, good_quantity, defect_quantity, lot, notes, worker_id, " +
        "mfg_processes:mfg_processes!manufacturing_records_mfg_process_id_fkey(" +
        "  process_id, equipment_id, " +
        "  manufacturing_plan_id," +
        "  processes:processes!mfg_processes_process_id_fkey(code, name)," +
        "  equipment:equipment!mfg_processes_equipment_id_fkey(code, name)," +
        "  manufacturing_plans:manufacturing_plans!mfg_processes_manufacturing_plan_id_fkey(order_no, item_code, planned_quantity)" +
        ")",
    )
    .is("deleted_at", null)
    .order("recorded_at", { ascending: false })
    .limit(clampLimit(undefined));

  if (filter.from) q = q.gte("recorded_at", filter.from);
  if (filter.to) q = q.lt("recorded_at", filter.to);
  if (filter.recordId) q = q.eq("id", filter.recordId);
  if (opts.workerId) q = q.eq("worker_id", opts.workerId);

  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchManufacturingDaily: ${error.message}`);
  }

  type Row = {
    id: string;
    work_date: string;
    recorded_at: string;
    actual_quantity: number | string;
    good_quantity: number | string | null;
    defect_quantity: number | string;
    lot: string | null;
    notes: string | null;
    worker_id: string;
    mfg_processes: {
      processes: { code: string; name: string } | null;
      equipment: { code: string; name: string } | null;
      manufacturing_plans: {
        order_no: string;
        item_code: string;
        planned_quantity: number | string;
      } | null;
    } | null;
  };

  return (data ?? []).map((row): ManufacturingDailyRow => {
    const r = row as unknown as Row;
    const plan = r.mfg_processes?.manufacturing_plans ?? null;
    const actual = toNumber(r.actual_quantity);
    const planned = toNumberOrNull(plan?.planned_quantity);
    const mismatch = planned !== null && planned !== actual;
    return {
      id: r.id,
      workDate: r.work_date,
      recordedAt: r.recorded_at,
      itemCode: plan?.item_code ?? null,
      orderNo: plan?.order_no ?? null,
      plannedQuantity: planned,
      actualQuantity: actual,
      goodQuantity: toNumberOrNull(r.good_quantity),
      defectQuantity: toNumber(r.defect_quantity),
      processCode: r.mfg_processes?.processes?.code ?? null,
      processName: r.mfg_processes?.processes?.name ?? null,
      equipmentCode: r.mfg_processes?.equipment?.code ?? null,
      equipmentName: r.mfg_processes?.equipment?.name ?? null,
      lot: r.lot,
      workerLabel: r.worker_id.slice(0, 8),
      notes: r.notes,
      mismatch,
    };
  });
}

export async function fetchDefectReport(
  filter: PrintFilter,
  opts: FetchOptions = {},
): Promise<DefectReportRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("manufacturing_record_defects")
    .select(
      "id, manufacturing_record_id, defect_quantity, notes, recorded_at, " +
        "defects:defects!manufacturing_record_defects_defect_id_fkey(code, name, severity)," +
        "manufacturing_records:manufacturing_records!manufacturing_record_defects_manufacturing_record_id_fkey(" +
        "  work_date, worker_id, mfg_process_id, " +
        "  mfg_processes:mfg_processes!manufacturing_records_mfg_process_id_fkey(" +
        "    manufacturing_plans:manufacturing_plans!mfg_processes_manufacturing_plan_id_fkey(item_code)" +
        "  )" +
        ")",
    )
    .is("deleted_at", null)
    .order("recorded_at", { ascending: false })
    .limit(clampLimit(undefined));

  if (filter.from) q = q.gte("recorded_at", filter.from);
  if (filter.to) q = q.lt("recorded_at", filter.to);
  if (filter.recordId) q = q.eq("manufacturing_record_id", filter.recordId);
  if (opts.workerId) {
    q = q.eq("manufacturing_records.worker_id", opts.workerId);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchDefectReport: ${error.message}`);
  }

  type Row = {
    id: string;
    manufacturing_record_id: string;
    defect_quantity: number | string;
    notes: string | null;
    recorded_at: string;
    defects: { code: string; name: string; severity: string } | null;
    manufacturing_records: {
      work_date: string | null;
      worker_id: string | null;
      mfg_processes: {
        manufacturing_plans: { item_code: string } | null;
      } | null;
    } | null;
  };

  const rows = (data ?? [])
    .filter((row) => {
      // Inner-join enforcement: if worker filter dropped manufacturing_records,
      // PostgREST returns the row with manufacturing_records=null — exclude it.
      if (!opts.workerId) return true;
      const r = row as unknown as { manufacturing_records: unknown };
      return r.manufacturing_records !== null;
    })
    .map((row): DefectReportRow => {
      const r = row as unknown as Row;
      return {
        id: r.id,
        recordedAt: r.recorded_at,
        manufacturingRecordId: r.manufacturing_record_id,
        workDate: r.manufacturing_records?.work_date ?? null,
        itemCode:
          r.manufacturing_records?.mfg_processes?.manufacturing_plans?.item_code ??
          null,
        defectCode: r.defects?.code ?? "-",
        defectName: r.defects?.name ?? "-",
        severity: r.defects?.severity ?? "minor",
        defectQuantity: toNumber(r.defect_quantity),
        notes: r.notes,
      };
    });

  return rows;
}

export async function fetchInventoryResult(
  filter: PrintFilter,
  opts: FetchOptions = {},
): Promise<InventoryResultRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("inventory_records")
    .select(
      "id, recorded_at, item_code, location_code, lot, counted_quantity, match_result, worker_id, notes, " +
        "inventory_plan_lines:inventory_plan_lines!inventory_records_inventory_plan_line_id_fkey(" +
        "  expected_quantity, item_code, location_code" +
        ")",
    )
    .is("deleted_at", null)
    .order("recorded_at", { ascending: false })
    .limit(clampLimit(undefined));

  if (filter.from) q = q.gte("recorded_at", filter.from);
  if (filter.to) q = q.lt("recorded_at", filter.to);
  if (filter.recordId) q = q.eq("id", filter.recordId);
  if (opts.workerId) q = q.eq("worker_id", opts.workerId);

  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchInventoryResult: ${error.message}`);
  }

  type Row = {
    id: string;
    recorded_at: string;
    item_code: string;
    location_code: string | null;
    lot: string | null;
    counted_quantity: number | string;
    match_result: string;
    worker_id: string;
    notes: string | null;
    inventory_plan_lines: {
      expected_quantity: number | string;
      item_code: string;
      location_code: string | null;
    } | null;
  };

  return (data ?? []).map((row): InventoryResultRow => {
    const r = row as unknown as Row;
    const counted = toNumber(r.counted_quantity);
    const expected = toNumberOrNull(r.inventory_plan_lines?.expected_quantity);
    const diff = expected === null ? null : counted - expected;
    return {
      id: r.id,
      recordedAt: r.recorded_at,
      itemCode: r.item_code,
      locationCode: r.location_code,
      lot: r.lot,
      countedQuantity: counted,
      expectedQuantity: expected,
      diff,
      matchResult: r.match_result,
      workerLabel: r.worker_id.slice(0, 8),
      notes: r.notes,
    };
  });
}

export async function fetchPickingList(
  filter: PrintFilter,
  opts: FetchOptions = {},
): Promise<PickingListRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("movement_records")
    .select(
      "id, recorded_at, item_code, location_code, lot, quantity, match_result, worker_id, notes, " +
        "movement_plan_lines:movement_plan_lines!movement_records_movement_plan_line_id_fkey(" +
        "  planned_quantity, item_code, location_code, " +
        "  movement_plans:movement_plans!movement_plan_lines_movement_plan_id_fkey(plan_code, plan_name)" +
        ")",
    )
    .eq("business_code", "picking")
    .is("deleted_at", null)
    .order("recorded_at", { ascending: false })
    .limit(clampLimit(undefined));

  if (filter.from) q = q.gte("recorded_at", filter.from);
  if (filter.to) q = q.lt("recorded_at", filter.to);
  if (filter.recordId) q = q.eq("id", filter.recordId);
  if (opts.workerId) q = q.eq("worker_id", opts.workerId);

  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchPickingList: ${error.message}`);
  }

  type Row = {
    id: string;
    recorded_at: string;
    item_code: string;
    location_code: string | null;
    lot: string | null;
    quantity: number | string;
    match_result: string;
    worker_id: string;
    notes: string | null;
    movement_plan_lines: {
      planned_quantity: number | string;
      item_code: string;
      location_code: string | null;
      movement_plans: { plan_code: string; plan_name: string } | null;
    } | null;
  };

  return (data ?? []).map((row): PickingListRow => {
    const r = row as unknown as Row;
    const actual = toNumber(r.quantity);
    const expected = toNumberOrNull(r.movement_plan_lines?.planned_quantity);
    const mismatch = expected !== null && expected !== actual;
    return {
      id: r.id,
      recordedAt: r.recorded_at,
      itemCode: r.item_code,
      locationCode: r.location_code,
      lot: r.lot,
      quantity: actual,
      expectedQuantity: expected,
      planCode: r.movement_plan_lines?.movement_plans?.plan_code ?? null,
      planName: r.movement_plan_lines?.movement_plans?.plan_name ?? null,
      workerLabel: r.worker_id.slice(0, 8),
      matchResult: r.match_result,
      notes: r.notes,
      mismatch,
    };
  });
}

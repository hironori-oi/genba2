/**
 * Phase 4 WORKS (manufacturing) TypeScript types.
 *
 * Pure types only — safe to import from client OR server code. Mirrors the
 * Phase 4a migrations:
 *
 *   * 20260520000200_phase4_manufacturing_plans.sql
 *   * 20260520000300_phase4_manufacturing_records.sql
 *   * 20260520000500_phase4_submit_manufacturing_rpc.sql
 *
 * Database columns are snake_case; we keep camelCase on the TS side.
 * Helpers in src/lib/works/history.ts handle the row-to-domain mapping.
 *
 * Naming note (ADR-P4-01): we use `mfg_processes` rather than the spec's
 * `manufacturing_plan_processes`. The Phase 3a allow-list and trigger
 * already hard-code `mfg_processes`, and renaming would force a migration
 * + RLS regression sweep with no MVP gain. See
 * docs/ARCHITECTURE-phase4-manufacturing.md §3.6.
 */

import type {
  AuditFields,
  MatchResult,
  PlanStatus,
} from "@/lib/logi/types";

// ---------------------------------------------------------------------
// manufacturing_plans (order header) + mfg_processes (per-step plan)
// ---------------------------------------------------------------------
export type ManufacturingPlan = AuditFields & {
  id: string;
  tenantId: string;
  orderNo: string;
  itemCode: string;
  plannedQuantity: number;
  lot: string | null;
  startDate: string | null;
  endDate: string | null;
  status: PlanStatus;
  notes: string | null;
  importedFileName: string | null;
  importedAt: string | null;
};

export type MfgProcessStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "canceled";

export type MfgProcess = AuditFields & {
  id: string;
  manufacturingPlanId: string;
  tenantId: string;
  processOrder: number;
  processId: string | null;
  equipmentId: string | null;
  assignedWorkerId: string | null;
  status: MfgProcessStatus;
  notes: string | null;
};

// ---------------------------------------------------------------------
// manufacturing_records — one row per process completion
// ---------------------------------------------------------------------
export type ManufacturingRecord = AuditFields & {
  id: string;
  tenantId: string;
  mfgProcessId: string;
  workerId: string;
  workDate: string;
  actualQuantity: number;
  goodQuantity: number | null;
  defectQuantity: number;
  lot: string | null;
  equipmentId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Generated column: minutes between started_at and ended_at. */
  workMinutes: number | null;
  matchResult: MatchResult;
  matchDetail: unknown[];
  recordedAt: string;
  previousRecordId: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------
// manufacturing_record_defects — N rows per record
// ---------------------------------------------------------------------
export type ManufacturingRecordDefect = AuditFields & {
  id: string;
  manufacturingRecordId: string;
  tenantId: string;
  defectId: string;
  defectQuantity: number;
  notes: string | null;
  recordedAt: string;
  previousRecordId: string | null;
};

// ---------------------------------------------------------------------
// submit_manufacturing_record RPC result
// ---------------------------------------------------------------------
export type SubmitManufacturingResult = {
  manufacturingRecordId: string;
  defectIds: string[];
  /** Present only when produce_inflow was included in the payload. */
  movementRecordId: string | null;
};

// ---------------------------------------------------------------------
// Discriminator helpers
// ---------------------------------------------------------------------
export type WorksBusinessCode = "manufacturing";

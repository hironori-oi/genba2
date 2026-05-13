/**
 * Phase 3a LOGI foundation TypeScript types.
 *
 * Pure types only — safe to import from client OR server code. These mirror
 * the Phase 3a tables introduced in supabase/migrations/20260512000200_*.sql.
 * Database columns are snake_case; we keep camelCase on the TS side. Helpers
 * in src/lib/logi/history.ts handle the row-to-domain mapping.
 *
 * UI-bound types (form state, scanner step state, etc.) are NOT defined here
 * — those land in Phase 3b alongside the Scanner / ResultOverlay components.
 */

import type { ParsedValues } from "@/lib/qr/types";

// ---------------------------------------------------------------------
// Shared discriminators
// ---------------------------------------------------------------------
export type LogiBusinessCode = "receiving" | "picking";
export type AnyBusinessCode = LogiBusinessCode | "inventory" | "manufacturing";
export type PlanStatus = "draft" | "active" | "closed";
export type MatchResult = "ok" | "ng" | "warning" | "skipped";
export type QrScanMatchResult = MatchResult | "none";
export type QrType = "header" | "line" | "label";

/**
 * Allow-list for qr_scan_histories.target_table. Kept in lockstep with the
 * CHECK constraint in migration 20260512000200 and the trigger guard in
 * 20260512000300. Adding an entry here without updating both SQL files is a
 * bug — the trigger will reject the row.
 */
export const QR_SCAN_TARGET_TABLES = [
  "movement_records",
  "movement_plans",
  "movement_plan_lines",
  "inventory_records",
  "inventory_plans",
  "inventory_plan_lines",
  "manufacturing_records",
  "manufacturing_plans",
  "mfg_processes",
] as const;
export type QrScanTargetTable = (typeof QR_SCAN_TARGET_TABLES)[number];

// ---------------------------------------------------------------------
// Audit columns shared by every tenant-owned table.
// ---------------------------------------------------------------------
export type AuditFields = {
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
};

// ---------------------------------------------------------------------
// movement_plans / movement_plan_lines (receiving + picking)
// ---------------------------------------------------------------------
export type MovementPlan = AuditFields & {
  id: string;
  tenantId: string;
  businessCode: LogiBusinessCode;
  planCode: string;
  planName: string;
  sourceLocation: string | null;
  destinationLocation: string | null;
  planDate: string | null;
  status: PlanStatus;
  notes: string | null;
};

export type MovementPlanLine = AuditFields & {
  id: string;
  movementPlanId: string;
  tenantId: string;
  lineNo: number;
  itemCode: string;
  plannedQuantity: number;
  locationCode: string | null;
  lot: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------
// movement_records
// ---------------------------------------------------------------------
export type MovementRecord = AuditFields & {
  id: string;
  tenantId: string;
  businessCode: LogiBusinessCode;
  movementPlanLineId: string | null;
  workerId: string;
  itemCode: string;
  quantity: number;
  lot: string | null;
  locationCode: string | null;
  matchResult: MatchResult;
  matchDetail: unknown[];
  recordedAt: string;
  previousRecordId: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------
// inventory_plans / inventory_plan_lines / inventory_records
// ---------------------------------------------------------------------
export type InventoryPlan = AuditFields & {
  id: string;
  tenantId: string;
  planCode: string;
  planName: string;
  planDate: string | null;
  status: PlanStatus;
  notes: string | null;
};

export type InventoryPlanLine = AuditFields & {
  id: string;
  inventoryPlanId: string;
  tenantId: string;
  lineNo: number;
  itemCode: string;
  locationCode: string | null;
  expectedQuantity: number;
  notes: string | null;
};

export type InventoryRecord = AuditFields & {
  id: string;
  tenantId: string;
  inventoryPlanLineId: string | null;
  workerId: string;
  itemCode: string;
  countedQuantity: number;
  locationCode: string | null;
  lot: string | null;
  matchResult: MatchResult;
  matchDetail: unknown[];
  recordedAt: string;
  previousRecordId: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------
// qr_scan_histories — append-only, no audit columns beyond created_at.
// raw_value is intentionally optional: the worker-facing view strips it.
// ---------------------------------------------------------------------
export type QrScanHistoryBase = {
  id: string;
  tenantId: string;
  scannedBy: string;
  qrType: QrType;
  qrFormatDefinitionId: string | null;
  parsedValues: ParsedValues;
  warnings: string[];
  matchResult: QrScanMatchResult;
  matchDetail: unknown[];
  targetTable: QrScanTargetTable | null;
  targetId: string | null;
  errorReason: string | null;
  businessCode: AnyBusinessCode | null;
  createdAt: string;
};

/** Read shape from v_qr_scan_histories (no raw_value). */
export type QrScanHistoryRow = QrScanHistoryBase;

/** Read shape from v_qr_scan_histories_admin (raw_value present). */
export type QrScanHistoryAdminRow = QrScanHistoryBase & {
  rawValue: string;
};

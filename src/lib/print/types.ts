/**
 * Phase 6c — print report shared types.
 *
 * Pure types only; safe to import from client OR server.
 */

export type PrintReportKind =
  | "manufacturing-daily"
  | "defect-report"
  | "inventory-result"
  | "picking-list";

export const PRINT_REPORT_KINDS: readonly PrintReportKind[] = [
  "manufacturing-daily",
  "defect-report",
  "inventory-result",
  "picking-list",
] as const;

export const PRINT_REPORT_TITLES: Record<PrintReportKind, string> = {
  "manufacturing-daily": "製造実績日報",
  "defect-report": "不適合報告",
  "inventory-result": "棚卸結果",
  "picking-list": "出荷一覧",
};

export type PaperSize = "a4" | "80mm";

export function parsePaper(raw: string | string[] | undefined): PaperSize {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  return v === "80mm" ? "80mm" : "a4";
}

export function isPrintReportKind(s: string): s is PrintReportKind {
  return (PRINT_REPORT_KINDS as readonly string[]).includes(s);
}

export type PrintFilter = {
  from?: string;
  to?: string;
  recordId?: string;
  planId?: string;
};

export type ManufacturingDailyRow = {
  id: string;
  workDate: string;
  recordedAt: string;
  itemCode: string | null;
  orderNo: string | null;
  plannedQuantity: number | null;
  actualQuantity: number;
  goodQuantity: number | null;
  defectQuantity: number;
  processCode: string | null;
  processName: string | null;
  equipmentCode: string | null;
  equipmentName: string | null;
  lot: string | null;
  workerLabel: string;
  notes: string | null;
  mismatch: boolean;
};

export type DefectReportRow = {
  id: string;
  recordedAt: string;
  manufacturingRecordId: string;
  workDate: string | null;
  itemCode: string | null;
  defectCode: string;
  defectName: string;
  severity: string;
  defectQuantity: number;
  notes: string | null;
};

export type InventoryResultRow = {
  id: string;
  recordedAt: string;
  itemCode: string;
  locationCode: string | null;
  lot: string | null;
  countedQuantity: number;
  expectedQuantity: number | null;
  diff: number | null;
  matchResult: string;
  workerLabel: string;
  notes: string | null;
};

export type PickingListRow = {
  id: string;
  recordedAt: string;
  itemCode: string;
  locationCode: string | null;
  lot: string | null;
  quantity: number;
  expectedQuantity: number | null;
  planCode: string | null;
  planName: string | null;
  workerLabel: string;
  matchResult: string;
  notes: string | null;
  mismatch: boolean;
};

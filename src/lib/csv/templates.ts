/**
 * Phase 5e-3 CSV template column catalog (architect §3.6).
 *
 * Hard-codes the column names exposed by each importable master so the
 * /api/admin/csv-template/[master]/[encoding] route handler can stream a
 * header-only CSV without hitting the database. The columns mirror the
 * Phase 2 `public.<master>` table shape minus the system columns
 * (id, tenant_id, created_at, updated_at, deleted_at) which the importer
 * back-fills automatically.
 *
 * Keep the list in sync with supabase/migrations/20260512000000_phase2_settings_masters.sql
 * (work_types / processes / equipment / defect_groups / defects) and
 * 20260520000100_phase4_works_masters.sql (idempotent `note text` add).
 */

export type CsvTemplateMaster =
  | "work_types"
  | "processes"
  | "equipment"
  | "defect_groups"
  | "defects";

export const CSV_TEMPLATE_MASTERS: ReadonlyArray<CsvTemplateMaster> = [
  "work_types",
  "processes",
  "equipment",
  "defect_groups",
  "defects",
];

export const CSV_TEMPLATE_LABELS: Record<CsvTemplateMaster, string> = {
  work_types: "作業区分",
  processes: "工程",
  equipment: "設備",
  defect_groups: "不適合グループ",
  defects: "不適合",
};

export const CSV_TEMPLATE_COLUMNS: Record<
  CsvTemplateMaster,
  ReadonlyArray<string>
> = {
  work_types: ["code", "name", "business_code", "sort_order", "enabled", "note"],
  processes: ["code", "name", "sort_order", "enabled", "note"],
  equipment: ["code", "name", "process_code", "sort_order", "enabled", "note"],
  defect_groups: ["code", "name", "sort_order", "enabled", "note"],
  defects: [
    "code",
    "name",
    "defect_group_code",
    "severity",
    "sort_order",
    "enabled",
    "note",
  ],
};

export function isCsvTemplateMaster(value: string): value is CsvTemplateMaster {
  return (CSV_TEMPLATE_MASTERS as ReadonlyArray<string>).includes(value);
}

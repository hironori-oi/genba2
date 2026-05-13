/**
 * Phase 4b WORKS (manufacturing) zod validators.
 *
 * Strict input contracts for the manufacturing server actions
 * (src/lib/works/actions.ts) and the manufacturing-plan-csv-import Edge
 * Function. Mirrors the Phase 3a/3b LOGI pattern: schemas reject control
 * chars in scannable text, enforce bounded lengths, and use the shared
 * helpers in src/lib/validation/shared.ts so policy stays in lockstep
 * across LOGI and WORKS.
 *
 * Safe to import from client form code (no server-only imports).
 *
 * Architecture: docs/ARCHITECTURE-phase4-manufacturing.md §3.3, §5.2.
 */

import { z } from "zod";
import {
  itemCodeSchema,
  matchDetailSchema,
  matchResultSchema,
  optionalLongText,
  optionalShortText,
  planStatusSchema,
  requiredShortText,
  uuidSchema,
} from "@/lib/validation/shared";

/** mfg_processes.status enum (Phase 4a migration 20260520000200). */
const mfgProcessStatusSchema = z.enum([
  "pending",
  "in_progress",
  "done",
  "canceled",
]);

// ---------------------------------------------------------------------
// manufacturing_plans (order header). Used by the CSV import EF and by
// admin server actions (Phase 5+). Worker UI never inserts these.
// ---------------------------------------------------------------------
export const manufacturingPlanInsertSchema = z
  .object({
    tenant_id: uuidSchema,
    order_no: requiredShortText(64, "order_no"),
    item_code: itemCodeSchema,
    planned_quantity: z
      .number()
      .nonnegative("planned_quantity は0以上です")
      .finite(),
    lot: optionalShortText(64, "lot"),
    start_date: z.string().date().optional().nullable(),
    end_date: z.string().date().optional().nullable(),
    status: planStatusSchema.default("active"),
    notes: optionalLongText(512, "notes"),
    imported_file_name: optionalShortText(256, "imported_file_name"),
    imported_at: z.string().datetime().optional().nullable(),
  })
  .strict();
export type ManufacturingPlanInsertInput = z.infer<
  typeof manufacturingPlanInsertSchema
>;

// ---------------------------------------------------------------------
// mfg_processes (per-step plan). Imported alongside manufacturing_plans
// via the CSV EF; admin-only mutation.
// ---------------------------------------------------------------------
export const mfgProcessInsertSchema = z
  .object({
    manufacturing_plan_id: uuidSchema,
    tenant_id: uuidSchema,
    process_order: z.number().int().min(1),
    process_id: uuidSchema.nullable().optional(),
    equipment_id: uuidSchema.nullable().optional(),
    assigned_worker_id: uuidSchema.nullable().optional(),
    status: mfgProcessStatusSchema.default("pending"),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type MfgProcessInsertInput = z.infer<typeof mfgProcessInsertSchema>;

// ---------------------------------------------------------------------
// manufacturing_record_defects insert payload — one defect row.
// Used both standalone (e.g. correction flows in Phase 5) and as the
// `defects[]` element inside submitManufacturingRecord.
// ---------------------------------------------------------------------
export const manufacturingRecordDefectInsertSchema = z
  .object({
    defect_id: uuidSchema,
    defect_quantity: z
      .number()
      .nonnegative("defect_quantity は0以上です")
      .finite(),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type ManufacturingRecordDefectInsertInput = z.infer<
  typeof manufacturingRecordDefectInsertSchema
>;

/**
 * Defect list cap (R-P4-15): UX 想定 < 20 件 / DoS-defence 上限 32 件。
 */
export const MANUFACTURING_DEFECT_MAX = 32;

// ---------------------------------------------------------------------
// produce_inflow — optional 製造入庫 (movement_records receiving row)
// recorded in the same transaction as the manufacturing_records insert.
// ---------------------------------------------------------------------
export const produceInflowInsertSchema = z
  .object({
    item_code: itemCodeSchema,
    quantity: z
      .number()
      .nonnegative("quantity は0以上です")
      .finite(),
    location_code: optionalShortText(64, "location_code"),
    lot: optionalShortText(64, "lot"),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type ProduceInflowInsertInput = z.infer<
  typeof produceInflowInsertSchema
>;

// ---------------------------------------------------------------------
// submit_manufacturing_record RPC payload. tenant_id / worker_id are
// pinned by the RPC from JWT app_metadata + auth.uid() — never accepted
// from the client. Same for created_by / updated_by.
// ---------------------------------------------------------------------
export const submitManufacturingRecordSchema = z
  .object({
    mfg_process_id: uuidSchema,
    work_date: z.string().date().optional(),
    actual_quantity: z
      .number()
      .nonnegative("actual_quantity は0以上です")
      .finite(),
    good_quantity: z
      .number()
      .nonnegative("good_quantity は0以上です")
      .finite()
      .nullable()
      .optional(),
    defect_quantity: z
      .number()
      .nonnegative("defect_quantity は0以上です")
      .finite()
      .default(0),
    lot: optionalShortText(64, "lot"),
    equipment_id: uuidSchema.nullable().optional(),
    started_at: z.string().datetime().nullable().optional(),
    ended_at: z.string().datetime().nullable().optional(),
    match_result: matchResultSchema.default("ok"),
    match_detail: matchDetailSchema,
    previous_record_id: uuidSchema.nullable().optional(),
    notes: optionalLongText(512, "notes"),
    defects: z
      .array(manufacturingRecordDefectInsertSchema)
      .max(
        MANUFACTURING_DEFECT_MAX,
        `defects は最大${MANUFACTURING_DEFECT_MAX}件です`,
      )
      .default([]),
    produce_inflow: produceInflowInsertSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => {
      if (!v.started_at || !v.ended_at) return true;
      return new Date(v.ended_at).getTime() >= new Date(v.started_at).getTime();
    },
    {
      message: "ended_at は started_at 以降にしてください",
      path: ["ended_at"],
    },
  );
export type SubmitManufacturingRecordInput = z.infer<
  typeof submitManufacturingRecordSchema
>;

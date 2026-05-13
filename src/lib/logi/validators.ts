/**
 * Phase 3a LOGI zod validators.
 *
 * These schemas are the *input contract* for server-side mutation helpers
 * that will ship in Phase 3b. They are deliberately strict on the things
 * that show up in QR_SPEC §7 and SECURITY-AUDIT (no control chars, fixed
 * allow-lists, bounded lengths) so the UI layer and any future server
 * actions share a single source of truth.
 *
 * No server-only imports — safe to use from client form code (e.g. via
 * @hookform/resolvers/zod) too.
 */

import { z } from "zod";
import { QR_MAX_LENGTH } from "@/lib/qr/types";
import { QR_SCAN_TARGET_TABLES } from "./types";

// Disallow CR / LF / NUL anywhere in scannable text fields. These break
// CSV exports and indicate either copy-paste bugs or injection attempts.
const CONTROL_CHARS = /[\r\n\u0000]/;
const noControlChars = (v: string) => !CONTROL_CHARS.test(v);

const itemCodeSchema = z
  .string()
  .min(1, "item_code は必須です")
  .max(64, "item_code は64文字以内です")
  .refine(noControlChars, "item_code に改行や NUL を含めることはできません");

const optionalShortText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} は${max}文字以内です`)
    .refine(noControlChars, `${label} に改行や NUL を含めることはできません`)
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v));

const optionalLongText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} は${max}文字以内です`)
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v));

const matchResultSchema = z.enum(["ok", "ng", "warning", "skipped"]);
const qrScanMatchResultSchema = z.enum(["ok", "ng", "warning", "skipped", "none"]);
const businessCodeSchema = z.enum(["receiving", "picking", "inventory", "manufacturing"]);
const logiBusinessCodeSchema = z.enum(["receiving", "picking"]);
const planStatusSchema = z.enum(["draft", "active", "closed"]);
const qrTypeSchema = z.enum(["header", "line", "label"]);

// match_detail is a JSON-passthrough array — we only enforce the upper
// bound (one entry per match_rule_line is reasonable; 64 is a safety net).
const matchDetailSchema = z
  .array(z.unknown())
  .max(64, "match_detail は最大64件です")
  .default([]);

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------
// movement_plans
// ---------------------------------------------------------------------
export const movementPlanInsertSchema = z
  .object({
    tenant_id: uuidSchema,
    business_code: logiBusinessCodeSchema,
    plan_code: z
      .string()
      .min(1, "plan_code は必須です")
      .max(64, "plan_code は64文字以内です")
      .refine(noControlChars, "plan_code に改行や NUL を含めることはできません"),
    plan_name: z.string().min(1).max(128),
    source_location: optionalShortText(64, "source_location"),
    destination_location: optionalShortText(64, "destination_location"),
    plan_date: z.string().date().optional().nullable(),
    status: planStatusSchema.default("active"),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type MovementPlanInsertInput = z.infer<typeof movementPlanInsertSchema>;

export const movementPlanLineInsertSchema = z
  .object({
    movement_plan_id: uuidSchema,
    tenant_id: uuidSchema,
    line_no: z.number().int().min(1),
    item_code: itemCodeSchema,
    planned_quantity: z
      .number()
      .nonnegative("planned_quantity は0以上です")
      .finite(),
    location_code: optionalShortText(64, "location_code"),
    lot: optionalShortText(64, "lot"),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type MovementPlanLineInsertInput = z.infer<typeof movementPlanLineInsertSchema>;

// ---------------------------------------------------------------------
// movement_records
// ---------------------------------------------------------------------
export const movementRecordInsertSchema = z
  .object({
    business_code: logiBusinessCodeSchema,
    movement_plan_line_id: uuidSchema.nullable().optional(),
    item_code: itemCodeSchema,
    quantity: z.number().nonnegative("quantity は0以上です").finite(),
    lot: optionalShortText(64, "lot"),
    location_code: optionalShortText(64, "location_code"),
    match_result: matchResultSchema.default("ok"),
    match_detail: matchDetailSchema,
    recorded_at: z.string().datetime().optional(),
    previous_record_id: uuidSchema.nullable().optional(),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type MovementRecordInsertInput = z.infer<typeof movementRecordInsertSchema>;

// ---------------------------------------------------------------------
// inventory_plans
// ---------------------------------------------------------------------
export const inventoryPlanInsertSchema = z
  .object({
    tenant_id: uuidSchema,
    plan_code: z
      .string()
      .min(1)
      .max(64)
      .refine(noControlChars, "plan_code に改行や NUL を含めることはできません"),
    plan_name: z.string().min(1).max(128),
    plan_date: z.string().date().optional().nullable(),
    status: planStatusSchema.default("active"),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type InventoryPlanInsertInput = z.infer<typeof inventoryPlanInsertSchema>;

export const inventoryPlanLineInsertSchema = z
  .object({
    inventory_plan_id: uuidSchema,
    tenant_id: uuidSchema,
    line_no: z.number().int().min(1),
    item_code: itemCodeSchema,
    location_code: optionalShortText(64, "location_code"),
    expected_quantity: z.number().nonnegative().finite().default(0),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type InventoryPlanLineInsertInput = z.infer<typeof inventoryPlanLineInsertSchema>;

// ---------------------------------------------------------------------
// inventory_records
// ---------------------------------------------------------------------
export const inventoryRecordInsertSchema = z
  .object({
    inventory_plan_line_id: uuidSchema.nullable().optional(),
    item_code: itemCodeSchema,
    counted_quantity: z
      .number()
      .nonnegative("counted_quantity は0以上です")
      .finite(),
    location_code: optionalShortText(64, "location_code"),
    lot: optionalShortText(64, "lot"),
    match_result: matchResultSchema.default("ok"),
    match_detail: matchDetailSchema,
    recorded_at: z.string().datetime().optional(),
    previous_record_id: uuidSchema.nullable().optional(),
    notes: optionalLongText(512, "notes"),
  })
  .strict();
export type InventoryRecordInsertInput = z.infer<typeof inventoryRecordInsertSchema>;

// ---------------------------------------------------------------------
// qr_scan_histories
// ---------------------------------------------------------------------
const targetTableSchema = z.enum(QR_SCAN_TARGET_TABLES);

export const qrScanHistoryInsertSchema = z
  .object({
    qr_type: qrTypeSchema,
    qr_format_definition_id: uuidSchema.nullable().optional(),
    raw_value: z
      .string()
      .min(1, "raw_value は必須です")
      .max(QR_MAX_LENGTH, `raw_value は${QR_MAX_LENGTH}文字以内です`)
      .refine(noControlChars, "raw_value に改行や NUL を含めることはできません"),
    parsed_values: z
      .record(z.union([z.string(), z.number(), z.null()]))
      .refine((v) => Object.keys(v).length <= 64, "parsed_values は最大 64 キーです")
      .default({}),
    warnings: z.array(z.string().max(256)).max(64).default([]),
    match_result: qrScanMatchResultSchema.default("none"),
    match_detail: matchDetailSchema,
    target_table: targetTableSchema.nullable().optional(),
    target_id: uuidSchema.nullable().optional(),
    error_reason: optionalLongText(256, "error_reason"),
    business_code: businessCodeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => {
      // If one of target_table / target_id is provided, the other must be too.
      const hasTable = v.target_table !== null && v.target_table !== undefined;
      const hasId = v.target_id !== null && v.target_id !== undefined;
      return hasTable === hasId;
    },
    {
      message: "target_table と target_id は同時に指定するか、両方とも省略してください",
      path: ["target_id"],
    },
  );
export type QrScanHistoryInsertInput = z.infer<typeof qrScanHistoryInsertSchema>;

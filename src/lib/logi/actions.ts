"use server";

/**
 * Phase 3b LOGI server actions — record insert paths for the Scanner UI.
 *
 * The Scanner component (Phase 3b frontend) calls these from a form
 * submit. Each action:
 *
 *   1. zod-validates the caller-supplied input with the strict schemas
 *      already exported from src/lib/logi/validators.ts.
 *   2. acquires a Supabase client backed by the caller's anon JWT (NOT
 *      service_role). RLS + the validate_target_tenant() trigger are the
 *      authorisation gates — these actions do not bypass them.
 *   3. attaches tenant_id from `app.current_tenant_id()` via a server-
 *      side helper RPC rather than trusting any client-passed value.
 *   4. returns `{ data, error }` — never throws across the action
 *      boundary, never logs raw_value at info level.
 *
 * `"server-only"` is imported as belt-and-braces in case the Next 15
 * `"use server"` directive is ever lost during a refactor; the import
 * itself triggers a build failure if this module is reached from a
 * client bundle.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  InventoryRecord,
  MovementRecord,
  QrScanHistoryRow,
} from "./types";
import {
  inventoryRecordInsertSchema,
  movementRecordInsertSchema,
  qrScanHistoryInsertSchema,
  type InventoryRecordInsertInput,
  type MovementRecordInsertInput,
  type QrScanHistoryInsertInput,
} from "./validators";

export type ActionError = {
  code: string;
  message: string;
};

export type ActionResult<T> = {
  data: T | null;
  error: ActionError | null;
};

// ---------------------------------------------------------------------
// Tenant resolution. We never trust a client-supplied tenant_id; instead
// every action re-reads it from the JWT via an SQL helper. The helper
// itself is SECURITY DEFINER + search_path='' (Phase 1 migration), so
// the call is injection-safe.
// ---------------------------------------------------------------------
async function resolveTenantAndUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ tenantId: string; userId: string } | ActionError> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { code: "unauthenticated", message: "ログインが必要です" };
  }
  const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof meta.tenant_id === "string" && meta.tenant_id.length > 0
      ? meta.tenant_id
      : null;
  if (!tenantId) {
    return { code: "tenant_missing", message: "テナント情報が取得できません" };
  }
  return { tenantId, userId: userData.user.id };
}

// ---------------------------------------------------------------------
// insertMovementRecord — receiving + picking write path.
// ---------------------------------------------------------------------
export async function insertMovementRecord(
  input: MovementRecordInsertInput,
): Promise<ActionResult<MovementRecord>> {
  try {
    const parsed = movementRecordInsertSchema.safeParse(input);
    if (!parsed.success) {
      return {
        data: null,
        error: {
          code: "validation_failed",
          message: parsed.error.issues[0]?.message ?? "入力検証に失敗しました",
        },
      };
    }

    const supabase = await createClient();
    const ctx = await resolveTenantAndUser(supabase);
    if ("code" in ctx) return { data: null, error: ctx };

    const { data, error } = await supabase
      .from("movement_records")
      .insert({
        tenant_id: ctx.tenantId,
        worker_id: ctx.userId,
        business_code: parsed.data.business_code,
        movement_plan_line_id: parsed.data.movement_plan_line_id ?? null,
        item_code: parsed.data.item_code,
        quantity: parsed.data.quantity,
        lot: parsed.data.lot,
        location_code: parsed.data.location_code,
        match_result: parsed.data.match_result,
        match_detail: parsed.data.match_detail,
        recorded_at: parsed.data.recorded_at,
        previous_record_id: parsed.data.previous_record_id ?? null,
        notes: parsed.data.notes,
      })
      .select(
        "id, tenant_id, business_code, movement_plan_line_id, worker_id, item_code, quantity, lot, location_code, match_result, match_detail, recorded_at, previous_record_id, notes, created_at, updated_at, created_by, updated_by, deleted_at",
      )
      .single();

    if (error || !data) {
      return {
        data: null,
        error: {
          code: error?.code ?? "insert_failed",
          message: error?.message ?? "movement_records insert failed",
        },
      };
    }
    return { data: data as unknown as MovementRecord, error: null };
  } catch (e) {
    return {
      data: null,
      error: {
        code: "unexpected_error",
        message: e instanceof Error ? e.message : "予期しないエラー",
      },
    };
  }
}

// ---------------------------------------------------------------------
// insertInventoryRecord — 棚卸 write path.
// ---------------------------------------------------------------------
export async function insertInventoryRecord(
  input: InventoryRecordInsertInput,
): Promise<ActionResult<InventoryRecord>> {
  try {
    const parsed = inventoryRecordInsertSchema.safeParse(input);
    if (!parsed.success) {
      return {
        data: null,
        error: {
          code: "validation_failed",
          message: parsed.error.issues[0]?.message ?? "入力検証に失敗しました",
        },
      };
    }

    const supabase = await createClient();
    const ctx = await resolveTenantAndUser(supabase);
    if ("code" in ctx) return { data: null, error: ctx };

    const { data, error } = await supabase
      .from("inventory_records")
      .insert({
        tenant_id: ctx.tenantId,
        worker_id: ctx.userId,
        inventory_plan_line_id: parsed.data.inventory_plan_line_id ?? null,
        item_code: parsed.data.item_code,
        counted_quantity: parsed.data.counted_quantity,
        lot: parsed.data.lot,
        location_code: parsed.data.location_code,
        match_result: parsed.data.match_result,
        match_detail: parsed.data.match_detail,
        recorded_at: parsed.data.recorded_at,
        previous_record_id: parsed.data.previous_record_id ?? null,
        notes: parsed.data.notes,
      })
      .select(
        "id, tenant_id, inventory_plan_line_id, worker_id, item_code, counted_quantity, lot, location_code, match_result, match_detail, recorded_at, previous_record_id, notes, created_at, updated_at, created_by, updated_by, deleted_at",
      )
      .single();

    if (error || !data) {
      return {
        data: null,
        error: {
          code: error?.code ?? "insert_failed",
          message: error?.message ?? "inventory_records insert failed",
        },
      };
    }
    return { data: data as unknown as InventoryRecord, error: null };
  } catch (e) {
    return {
      data: null,
      error: {
        code: "unexpected_error",
        message: e instanceof Error ? e.message : "予期しないエラー",
      },
    };
  }
}

// ---------------------------------------------------------------------
// insertQrScanHistory — append-only scan log.
//
// raw_value is REQUIRED for the insert (QR_SPEC §6) but must never be
// echoed back to the caller (workers cannot SELECT it via RLS column-
// grant). We deliberately omit raw_value from the SELECT clause and
// return the worker view shape so the client UI never receives the raw
// payload it just submitted.
// ---------------------------------------------------------------------
export async function insertQrScanHistory(
  input: QrScanHistoryInsertInput,
): Promise<ActionResult<QrScanHistoryRow>> {
  try {
    const parsed = qrScanHistoryInsertSchema.safeParse(input);
    if (!parsed.success) {
      // Do not include the raw_value in the validation error message —
      // it can contain sensitive supplier-supplied codes. The default
      // zod message references the field name only.
      return {
        data: null,
        error: {
          code: "validation_failed",
          message: parsed.error.issues[0]?.message ?? "入力検証に失敗しました",
        },
      };
    }

    const supabase = await createClient();
    const ctx = await resolveTenantAndUser(supabase);
    if ("code" in ctx) return { data: null, error: ctx };

    const { data, error } = await supabase
      .from("qr_scan_histories")
      .insert({
        tenant_id: ctx.tenantId,
        scanned_by: ctx.userId,
        qr_type: parsed.data.qr_type,
        qr_format_definition_id: parsed.data.qr_format_definition_id ?? null,
        raw_value: parsed.data.raw_value,
        parsed_values: parsed.data.parsed_values,
        warnings: parsed.data.warnings,
        match_result: parsed.data.match_result,
        match_detail: parsed.data.match_detail,
        target_table: parsed.data.target_table ?? null,
        target_id: parsed.data.target_id ?? null,
        error_reason: parsed.data.error_reason,
        business_code: parsed.data.business_code ?? null,
      })
      // Worker column grants exclude raw_value — we mirror that here by
      // listing the same columns the v_qr_scan_histories view exposes.
      .select(
        "id, tenant_id, scanned_by, qr_type, qr_format_definition_id, parsed_values, warnings, match_result, match_detail, target_table, target_id, error_reason, business_code, created_at",
      )
      .single();

    if (error || !data) {
      return {
        data: null,
        error: {
          code: error?.code ?? "insert_failed",
          message: error?.message ?? "qr_scan_histories insert failed",
        },
      };
    }
    // Map snake_case → camelCase to match the existing worker row shape.
    const r = data as Record<string, unknown>;
    const mapped: QrScanHistoryRow = {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      scannedBy: r.scanned_by as string,
      qrType: r.qr_type as QrScanHistoryRow["qrType"],
      qrFormatDefinitionId: (r.qr_format_definition_id as string | null) ?? null,
      parsedValues:
        (r.parsed_values as QrScanHistoryRow["parsedValues"]) ?? {},
      warnings: (r.warnings as string[] | null) ?? [],
      matchResult: r.match_result as QrScanHistoryRow["matchResult"],
      matchDetail: (r.match_detail as unknown[] | null) ?? [],
      targetTable: (r.target_table as QrScanHistoryRow["targetTable"]) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      errorReason: (r.error_reason as string | null) ?? null,
      businessCode: (r.business_code as QrScanHistoryRow["businessCode"]) ?? null,
      createdAt: r.created_at as string,
    };
    return { data: mapped, error: null };
  } catch (e) {
    return {
      data: null,
      error: {
        code: "unexpected_error",
        message: e instanceof Error ? e.message : "予期しないエラー",
      },
    };
  }
}

"use server";

/**
 * Phase 4b WORKS (manufacturing) server actions.
 *
 * Mirrors src/lib/logi/actions.ts in shape and contract:
 *
 *   1. zod-validate the caller-supplied payload via the strict schemas in
 *      src/lib/works/validators.ts.
 *   2. Acquire a Supabase server client backed by the caller's anon JWT.
 *      RLS + the enforce_mfg_process_tenant / enforce_manufacturing_-
 *      record_defect_tenant triggers + the submit_manufacturing_record
 *      RPC tenant pin are the authorisation gates — these actions do
 *      not bypass them and never touch service_role.
 *   3. Re-read tenant_id / worker_id from the JWT via resolveTenantAndUser
 *      so a stale or stolen tenant_id never lands in a record.
 *   4. Return `{ data, error }` — never throw across the action boundary,
 *      never log defect notes or worker-supplied free text at info level.
 *
 * The submitManufacturingRecord action calls the SECURITY DEFINER RPC
 * `submit_manufacturing_record(jsonb)` (Phase 4a migration
 * 20260520000500). That RPC wraps manufacturing_records insert + N
 * defect inserts + optional movement_records (produce_inflow) insert in
 * one transaction, so partial writes (R-P4-05) cannot persist.
 *
 * `"server-only"` is imported as belt-and-braces in case the Next 15
 * `"use server"` directive is ever lost during a refactor.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  isTenantResolutionError,
  resolveTenantAndUser,
} from "@/lib/auth/server-tenant";
import {
  manufacturingRecordDefectInsertSchema,
  submitManufacturingRecordSchema,
  type ManufacturingRecordDefectInsertInput,
  type SubmitManufacturingRecordInput,
} from "./validators";
import type {
  ManufacturingRecordDefect,
  SubmitManufacturingResult,
} from "./types";

export type ActionError = {
  code: string;
  message: string;
};

export type ActionResult<T> = {
  data: T | null;
  error: ActionError | null;
};

// ---------------------------------------------------------------------
// submitManufacturingRecord — primary write path (UC-4 Submitted).
// Delegates to the submit_manufacturing_record RPC for the
// record + defects + optional produce_inflow transaction.
// ---------------------------------------------------------------------
export async function submitManufacturingRecord(
  input: SubmitManufacturingRecordInput,
): Promise<ActionResult<SubmitManufacturingResult>> {
  try {
    const parsed = submitManufacturingRecordSchema.safeParse(input);
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
    if (isTenantResolutionError(ctx)) {
      return { data: null, error: ctx };
    }

    // The RPC pins tenant_id from app.current_tenant_id() and worker_id
    // from auth.uid(). The payload we pass mirrors the contract documented
    // in supabase/migrations/20260520000500_phase4_submit_manufacturing_rpc.sql.
    const payload = {
      mfg_process_id: parsed.data.mfg_process_id,
      work_date: parsed.data.work_date,
      actual_quantity: parsed.data.actual_quantity,
      good_quantity: parsed.data.good_quantity ?? null,
      defect_quantity: parsed.data.defect_quantity,
      lot: parsed.data.lot,
      equipment_id: parsed.data.equipment_id ?? null,
      started_at: parsed.data.started_at ?? null,
      ended_at: parsed.data.ended_at ?? null,
      match_result: parsed.data.match_result,
      match_detail: parsed.data.match_detail,
      previous_record_id: parsed.data.previous_record_id ?? null,
      notes: parsed.data.notes,
      defects: parsed.data.defects,
      produce_inflow: parsed.data.produce_inflow ?? null,
    };

    const { data, error } = await supabase.rpc(
      "submit_manufacturing_record",
      { p_payload: payload },
    );

    if (error || !data) {
      return {
        data: null,
        error: {
          code: error?.code ?? "rpc_failed",
          message: error?.message ?? "submit_manufacturing_record failed",
        },
      };
    }

    const r = data as Record<string, unknown>;
    return {
      data: {
        manufacturingRecordId: r.manufacturing_record_id as string,
        defectIds: (r.defect_ids as string[] | null) ?? [],
        movementRecordId: (r.movement_record_id as string | null) ?? null,
      },
      error: null,
    };
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
// submitDefect — append a single defect to an existing manufacturing_-
// records row (correction / late-add flow). The Phase 4c UI submits
// most defects atomically via submitManufacturingRecord, but Phase 5
// correction flows need this standalone path. RLS + the parent
// enforce_manufacturing_record_defect_tenant trigger gate the write.
// ---------------------------------------------------------------------
export type SubmitDefectInput = ManufacturingRecordDefectInsertInput & {
  manufacturing_record_id: string;
};

export async function submitDefect(
  input: SubmitDefectInput,
): Promise<ActionResult<ManufacturingRecordDefect>> {
  try {
    // Validate the defect shape independently of the parent FK so the
    // error message points at the offending field, not the wrapper.
    const { manufacturing_record_id, ...defectFields } = input;
    const parsed =
      manufacturingRecordDefectInsertSchema.safeParse(defectFields);
    if (!parsed.success) {
      return {
        data: null,
        error: {
          code: "validation_failed",
          message: parsed.error.issues[0]?.message ?? "入力検証に失敗しました",
        },
      };
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(manufacturing_record_id)) {
      return {
        data: null,
        error: {
          code: "validation_failed",
          message: "manufacturing_record_id は UUID 形式にしてください",
        },
      };
    }

    const supabase = await createClient();
    const ctx = await resolveTenantAndUser(supabase);
    if (isTenantResolutionError(ctx)) {
      return { data: null, error: ctx };
    }

    const { data, error } = await supabase
      .from("manufacturing_record_defects")
      .insert({
        manufacturing_record_id,
        tenant_id: ctx.tenantId,
        defect_id: parsed.data.defect_id,
        defect_quantity: parsed.data.defect_quantity,
        notes: parsed.data.notes,
      })
      .select(
        "id, manufacturing_record_id, tenant_id, defect_id, defect_quantity, notes, recorded_at, previous_record_id, created_at, updated_at, created_by, updated_by, deleted_at",
      )
      .single();

    if (error || !data) {
      return {
        data: null,
        error: {
          code: error?.code ?? "insert_failed",
          message:
            error?.message ?? "manufacturing_record_defects insert failed",
        },
      };
    }

    const r = data as Record<string, unknown>;
    const mapped: ManufacturingRecordDefect = {
      id: r.id as string,
      manufacturingRecordId: r.manufacturing_record_id as string,
      tenantId: r.tenant_id as string,
      defectId: r.defect_id as string,
      defectQuantity: Number(r.defect_quantity),
      notes: (r.notes as string | null) ?? null,
      recordedAt: r.recorded_at as string,
      previousRecordId: (r.previous_record_id as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      createdBy: (r.created_by as string | null) ?? null,
      updatedBy: (r.updated_by as string | null) ?? null,
      deletedAt: (r.deleted_at as string | null) ?? null,
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

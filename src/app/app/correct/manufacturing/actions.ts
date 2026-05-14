"use server";

import { revalidatePath } from "next/cache";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  submitManufacturingCorrectionInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import { ensureAuthenticatedSession } from "@/lib/corrections/ensure-authenticated";
import { mapCorrectionRpcError } from "@/lib/corrections/rpc-error";

export type SubmitManufacturingCorrectionInput = {
  previousRecordId: string;
  reason: string;
  payload: {
    work_date: string;
    actual_quantity: number;
    good_quantity: number | null;
    defect_quantity: number;
    lot: string | null;
    started_at: string | null;
    ended_at: string | null;
    notes: string | null;
    rollback_inflow: boolean;
  };
};

export type ManufacturingCorrectionResult = AdminActionResult<{
  newRecordId: string;
  auditId: string;
  rolledBackInflow: boolean;
}>;

export async function submitManufacturingCorrectionAction(
  input: SubmitManufacturingCorrectionInput,
): Promise<ManufacturingCorrectionResult> {
  const parsed = submitManufacturingCorrectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parsed.error),
    );
  }
  const gate = await ensureAuthenticatedSession();
  if (isErr(gate)) return gate;
  const { supabase } = gate.data;

  const { previousRecordId, reason, payload } = parsed.data;
  const { data, error } = await supabase.rpc("submit_manufacturing_correction", {
    p_old_id: previousRecordId,
    p_new_data: payload,
    p_reason: reason,
  });
  if (error) {
    return mapCorrectionRpcError(error.code, error.message);
  }
  const result = data as
    | {
        new_record_id?: string;
        audit_id?: string;
        rolled_back_inflow?: boolean;
      }
    | null;
  if (!result?.new_record_id || !result.audit_id) {
    return err("unexpected", "訂正処理の戻り値が不正でした。");
  }
  revalidatePath("/app/correct/manufacturing");
  revalidatePath("/app/logi/history");
  return ok({
    newRecordId: result.new_record_id,
    auditId: result.audit_id,
    rolledBackInflow: Boolean(result.rolled_back_inflow),
  });
}

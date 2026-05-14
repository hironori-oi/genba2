"use server";

import { revalidatePath } from "next/cache";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  submitInventoryCorrectionInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import { ensureAuthenticatedSession } from "@/lib/corrections/ensure-authenticated";
import { mapCorrectionRpcError } from "@/lib/corrections/rpc-error";

export type SubmitInventoryCorrectionInput = {
  previousRecordId: string;
  reason: string;
  payload: {
    item_code: string;
    counted_quantity: number;
    lot: string | null;
    location_code: string | null;
    notes: string | null;
  };
};

export type InventoryCorrectionResult = AdminActionResult<{
  newRecordId: string;
  auditId: string;
}>;

export async function submitInventoryCorrectionAction(
  input: SubmitInventoryCorrectionInput,
): Promise<InventoryCorrectionResult> {
  const parsed = submitInventoryCorrectionInputSchema.safeParse(input);
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
  const { data, error } = await supabase.rpc("submit_inventory_correction", {
    p_old_id: previousRecordId,
    p_new_data: payload,
    p_reason: reason,
  });
  if (error) {
    return mapCorrectionRpcError(error.code, error.message);
  }
  const result = data as
    | { new_record_id?: string; audit_id?: string }
    | null;
  if (!result?.new_record_id || !result.audit_id) {
    return err("unexpected", "訂正処理の戻り値が不正でした。");
  }
  revalidatePath("/app/correct/inventory");
  revalidatePath("/app/logi/history");
  return ok({ newRecordId: result.new_record_id, auditId: result.audit_id });
}

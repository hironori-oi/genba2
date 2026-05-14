"use server";

import { revalidatePath } from "next/cache";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  submitMovementCorrectionInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import { ensureAuthenticatedSession } from "@/lib/corrections/ensure-authenticated";
import { mapCorrectionRpcError } from "@/lib/corrections/rpc-error";

/**
 * Phase 5d 訂正 server action — movement_records.
 *
 * Architect §3.5.3: submit_movement_correction(p_old_id, p_new_data, p_reason)
 * SECURITY INVOKER RPC を呼ぶ。RPC が 1 transaction 内で:
 *   1. 旧 row SELECT (RLS で gate)
 *   2. 旧 row UPDATE (deleted_at)
 *   3. 新 row INSERT (previous_record_id = 旧 id)
 *   4. corrections_audit INSERT
 * を実施する。本 action はクライアント入力の zod 検証 + envelope 変換のみ。
 */

export type SubmitMovementCorrectionInput = {
  previousRecordId: string;
  reason: string;
  payload: {
    business_code: "receiving" | "picking";
    item_code: string;
    quantity: number;
    lot: string | null;
    location_code: string | null;
    notes: string | null;
  };
};

export type MovementCorrectionResult = AdminActionResult<{
  newRecordId: string;
  auditId: string;
}>;

export async function submitMovementCorrectionAction(
  input: SubmitMovementCorrectionInput,
): Promise<MovementCorrectionResult> {
  const parsed = submitMovementCorrectionInputSchema.safeParse(input);
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

  const { data, error } = await supabase.rpc("submit_movement_correction", {
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

  revalidatePath("/app/correct/movements");
  revalidatePath("/app/logi/history");
  return ok({ newRecordId: result.new_record_id, auditId: result.audit_id });
}

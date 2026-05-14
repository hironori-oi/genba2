"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import {
  err,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";

/**
 * Phase 5e-3 corrections-pending approval action (architect §3.5.5).
 *
 * Marks a corrections_audit row as approved by the calling tenant_admin.
 * The schema does NOT model "pending vs applied" explicitly: per the
 * Phase 5a corrections RPCs, the new record is INSERTed eagerly and the
 * corresponding corrections_audit row carries `approved_by` / `approved_at`
 * only when `work_settings.correction_approval=true`. This action fills
 * those two columns in-place so the audit log doubles as a "needs-review"
 * inbox for tenants that opted-in (P-3 "minimum/optional" per dispatch).
 *
 * RLS guards:
 *   * SELECT: same tenant — listing is filtered server-side by tenantId.
 *   * UPDATE: `corrections_audit_update_tenant_admin` policy from
 *     supabase/migrations/20260528000100_phase5_corrections_audit.sql
 *     restricts UPDATE to tenant_admin / system_admin of the same tenant.
 *
 * No new migration; no service_role; no DELETE (audit log is immutable).
 */

const approveInputSchema = z.object({
  id: z.string().uuid({ message: "監査 id が不正です。" }),
});

export type ApproveCorrectionInput = z.input<typeof approveInputSchema>;

export async function approveCorrectionAuditAction(
  input: ApproveCorrectionInput,
): Promise<AdminActionResult<{ id: string; approvedAt: string }>> {
  const parsed = approveInputSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "入力値が不正です。";
    return err("validation", message);
  }

  const guard = await ensureTenantAdmin();
  if (guard.status === "error") return guard;
  const { supabase, userId, tenantId } = guard.data;

  const approvedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("corrections_audit")
    .update({ approved_by: userId, approved_at: approvedAt })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .is("approved_by", null)
    .select("id, approved_at")
    .maybeSingle();

  if (error) {
    return err(
      "unexpected",
      `承認に失敗しました: ${error.message}`,
    );
  }
  if (!data) {
    return err(
      "not_found",
      "対象が見つからないか、既に承認済みです。",
    );
  }

  revalidatePath("/app/admin/corrections-pending");
  return ok({ id: String(data.id), approvedAt: String(data.approved_at) });
}

"use server";

import { revalidatePath } from "next/cache";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, ok, isErr, type AdminActionResult } from "@/lib/admin/shared/result";
import {
  notificationPreferencesSchema,
  type NotificationPreferencesInput,
} from "@/lib/admin/notifications/validation";

export type UpsertResult = AdminActionResult<{ updated: boolean }>;

/**
 * Phase 6f-3 notifications upsert. The smtp_password / webhook_secret
 * columns are write-only for the client — they have column-level SELECT
 * revoked for authenticated/anon. We never read them back and never echo
 * them in the response.
 *
 * Empty-string payload values for those secrets mean "do not change",
 * so an admin who only flips a toggle does not have to retype the SMTP
 * password.
 */
export async function upsertNotificationPreferencesAction(
  input: NotificationPreferencesInput,
): Promise<UpsertResult> {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) return guard;
  const { supabase, tenantId, userId } = guard.data;

  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") fieldErrors[key] = issue.message;
    }
    return err("validation", "入力内容を確認してください。", fieldErrors);
  }
  const v = parsed.data;

  // Pull the current row id (existence check) so we can pick insert vs update.
  // SELECT explicit columns — never `*` — so the column-level revoke on
  // smtp_password / webhook_secret cannot raise a permission error.
  const existing = await supabase
    .from("notification_preferences")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing.error) {
    return err("unexpected", existing.error.message);
  }

  const writableBase = {
    smtp_host: v.smtpHost ?? null,
    smtp_port: v.smtpPort ?? null,
    smtp_username: v.smtpUsername ?? null,
    smtp_from_email: v.smtpFromEmail ?? null,
    smtp_from_name: v.smtpFromName ?? null,
    notify_correction_approval: v.notifyCorrectionApproval,
    notify_correction_completed: v.notifyCorrectionCompleted,
    notify_monthly_cap: v.notifyMonthlyCap,
    webhook_url: v.webhookUrl ?? null,
    enabled_recipients: [],
  } as const;

  if (!existing.data) {
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      ...writableBase,
      created_by: userId,
      updated_by: userId,
    };
    if (v.smtpPassword && v.smtpPassword.length > 0) {
      payload.smtp_password = v.smtpPassword;
    }
    if (v.webhookSecret && v.webhookSecret.length > 0) {
      payload.webhook_secret = v.webhookSecret;
    }
    const ins = await supabase.from("notification_preferences").insert(payload);
    if (ins.error) {
      // RLS denials in Supabase typically surface as 42501 / "new row
      // violates row-level security policy"; everything else is treated
      // as unexpected to avoid mislabeling unrelated failures.
      const code = /row-level security|42501|permission denied/i.test(
        ins.error.message,
      )
        ? "rls"
        : "unexpected";
      return err(code, ins.error.message);
    }
  } else {
    const payload: Record<string, unknown> = {
      ...writableBase,
      updated_by: userId,
    };
    if (v.smtpPassword && v.smtpPassword.length > 0) {
      payload.smtp_password = v.smtpPassword;
    }
    if (v.webhookSecret && v.webhookSecret.length > 0) {
      payload.webhook_secret = v.webhookSecret;
    }
    const upd = await supabase
      .from("notification_preferences")
      .update(payload)
      .eq("tenant_id", tenantId);
    if (upd.error) {
      const code = /row-level security|42501|permission denied/i.test(
        upd.error.message,
      )
        ? "rls"
        : "unexpected";
      return err(code, upd.error.message);
    }
  }

  revalidatePath("/app/admin/notifications");
  return ok({ updated: true });
}

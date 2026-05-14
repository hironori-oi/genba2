import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { NotificationsForm, type SafePreferences } from "./NotificationsForm";

export const metadata: Metadata = { title: "通知設定" };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase, tenantId } = guard.data;

  // Explicit column list — `*` would raise a permission-denied error on
  // smtp_password / webhook_secret thanks to the column-level GRANT (6f-3).
  const { data, error } = await supabase
    .from("notification_preferences")
    .select(
      "id, smtp_host, smtp_port, smtp_username, smtp_from_email, smtp_from_name, notify_correction_approval, notify_correction_completed, notify_monthly_cap, webhook_url",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return (
      <Alert tone="error" title="読込エラー">
        {error.message}
      </Alert>
    );
  }

  // The "(設定済)" flags are derived from the username/webhook URL presence
  // because the server cannot read the secret columns directly. This is
  // intentional — see ADR-P6-04 / RLS-606.
  const row = (data ?? null) as Record<string, unknown> | null;
  const initial: SafePreferences = {
    smtpHost: row ? (row.smtp_host as string | null) : null,
    smtpPort: row ? (row.smtp_port as number | null) : null,
    smtpUsername: row ? (row.smtp_username as string | null) : null,
    smtpFromEmail: row ? (row.smtp_from_email as string | null) : null,
    smtpFromName: row ? (row.smtp_from_name as string | null) : null,
    notifyCorrectionApproval: row
      ? Boolean(row.notify_correction_approval ?? true)
      : true,
    notifyCorrectionCompleted: row
      ? Boolean(row.notify_correction_completed ?? false)
      : false,
    notifyMonthlyCap: row ? Boolean(row.notify_monthly_cap ?? true) : true,
    webhookUrl: row ? (row.webhook_url as string | null) : null,
    // Phase 6f / ADR-P6-04: smtp_password and webhook_secret have
    // column-level SELECT revoked for authenticated, so the server can
    // never positively confirm whether a value is stored. We surface a
    // neutral hint instead of the misleading "(設定済)" proxy used in
    // earlier drafts — see review T-20260515-110000 P2-3.
    hasSmtpPassword: false,
    hasWebhookSecret: false,
  };

  return (
    <section className="flex flex-col gap-4" data-page="admin-notifications">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6f
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">通知設定</h2>
        <p className="text-sm text-[var(--muted)]">
          訂正承認 / 月間スキャン上限到達などの通知 (SMTP / webhook) のテナント設定です。
          パスワード等の機微情報はクライアントでは読み取れません (column-level revoke / ADR-P6-04)。
        </p>
      </header>

      <Alert tone="info" title="SMTP が未設定の間は degraded 動作">
        SMTP / webhook が未設定の場合、Edge Function 側で <code className="font-mono">STATUS: degraded</code>{" "}
        が返り、本番 SMTP 設定が完了するまで通知は保留になります。
      </Alert>

      <NotificationsForm initial={initial} />
    </section>
  );
}
